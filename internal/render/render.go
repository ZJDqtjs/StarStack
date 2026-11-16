// Package render turns a creative-project file into independent pieces of work
// that can run on different machines. Two formats are supported: Blender scenes,
// where the natural unit is a frame range, and edited timelines exported from
// Premiere (FCP XML / xmeml) or Final Cut (FCPXML), where the unit is a time
// range of the sequence.
//
// The package is deliberately pure: it parses, validates and plans, and never
// touches ffmpeg or Blender. Both the broker (which splits a job) and the agent
// (which executes one piece) import it, so the two sides cannot drift apart on
// what a slice means.
package render

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
)

const (
	KindBlender = "blender"
	KindPR      = "pr"
	// KindBuild runs a buyer-supplied build command inside an uploaded source
	// archive. It is deliberately a single unit of work: compiling is not
	// shardable along file boundaries without a dependency graph, so the
	// scheduler treats the whole job as one slice.
	KindBuild = "build"
	// KindComfy runs one ComfyUI prompt graph on a provider machine. Like a
	// build it is one indivisible unit — a graph is one generation, not a range
	// that splits — but the executor is the provider's own ComfyUI, reached over
	// HTTP, so the node must advertise the "comfyui" runtime to be matched.
	KindComfy = "comfy"
)

// MaxComfyPromptBytes caps the graph a buyer may submit. A large workflow with
// embedded notes is still far below this; anything bigger is a mistake or an
// attempt to make every claim payload huge.
const MaxComfyPromptBytes = 512 << 10

// Spec is the whole render job as the broker stores it: everything an agent
// needs except the piece it is currently handed.
type Spec struct {
	Kind string `json:"kind"`

	// Blender. Scene is a file name inside the uploaded bundle; FPS is used by
	// the broker when it turns the returned frames into a video.
	Scene   string  `json:"scene,omitempty"`
	Engine  string  `json:"engine,omitempty"` // CYCLES | BLENDER_EEVEE | BLENDER_WORKBENCH
	Samples int     `json:"samples,omitempty"`
	Percent int     `json:"percent,omitempty"` // resolution percentage
	FPS     float64 `json:"fps,omitempty"`

	// Timeline. The sequence is kept so a broker restart can re-plan; agents
	// only ever receive the clips of their own slice.
	Timeline *Timeline `json:"timeline,omitempty"`
	Width    int       `json:"width,omitempty"`
	Height   int       `json:"height,omitempty"`

	// Bundle says the uploaded source is a zip that must be unpacked before the
	// scene or the timeline's assets are reachable.
	Bundle bool `json:"bundle,omitempty"`

	// Build. Command runs with the unpacked bundle as its working directory;
	// Output is the path (inside that directory) whose tree is returned to the
	// buyer; TimeoutSec is the hard ceiling for one attempt.
	Command    string `json:"command,omitempty"`
	Output     string `json:"output,omitempty"`
	TimeoutSec int    `json:"timeout_sec,omitempty"`

	// Comfy. Prompt is the ComfyUI API-format graph — exactly the object the
	// buyer would POST to /prompt — and the agent forwards it to its own ComfyUI
	// unmodified, so model names are the provider's business, not the platform's.
	// Media is "image" or "video" and only decides labels and the unit; billing
	// is one charge per completed generation either way.
	Prompt json.RawMessage `json:"prompt,omitempty"`
	Media  string          `json:"media,omitempty"`
}

// Unit names the thing the buyer is billed for: seconds of footage, seconds of
// timeline, or rendered frames. It is what the console prints next to a price.
func (s *Spec) Unit() string {
	if s != nil && s.Kind == KindBlender {
		return "帧"
	}
	if s != nil && s.Kind == KindBuild {
		return "分钟"
	}
	if s != nil && s.Kind == KindComfy {
		return "次"
	}
	return "视频秒"
}

// ValidComfyPrompt checks that raw is a ComfyUI *API-format* graph: one object
// per node, each carrying class_type. The UI format ({"nodes":[...],"links":[...]})
// is deliberately rejected — it is an editor document, not something /prompt
// accepts, and silently converting it would hide that from the buyer.
func ValidComfyPrompt(raw json.RawMessage) error {
	if len(raw) == 0 {
		return errors.New("缺少 ComfyUI 工作流（API 格式 JSON）")
	}
	if len(raw) > MaxComfyPromptBytes {
		return fmt.Errorf("工作流超过 %d KiB", MaxComfyPromptBytes>>10)
	}
	var graph map[string]json.RawMessage
	if err := json.Unmarshal(raw, &graph); err != nil {
		return errors.New("工作流必须是 JSON 对象（ComfyUI 的 API 格式）")
	}
	if len(graph) == 0 {
		return errors.New("工作流里没有任何节点")
	}
	for id, body := range graph {
		var node struct {
			ClassType string `json:"class_type"`
		}
		if err := json.Unmarshal(body, &node); err != nil || node.ClassType == "" {
			return fmt.Errorf("节点 %s 缺少 class_type：这是 UI 工作流，请在 ComfyUI 里用「导出（API）」", id)
		}
	}
	return nil
}

// Validate rejects a spec the planner cannot honour, before any credits are
// held. Anything accepted here must be executable by an agent with only the
// bundle and the claim.
func (s *Spec) Validate() error {
	switch s.Kind {
	case KindBlender:
		if s.Scene == "" {
			return errors.New("没有找到 .blend 场景文件")
		}
		if s.Samples < 0 || s.Samples > 100000 {
			return errors.New("采样数不合理")
		}
		if s.Percent != 0 && (s.Percent < 1 || s.Percent > 100) {
			return errors.New("分辨率百分比需在 1~100 之间")
		}
		if s.FPS < 0 || s.FPS > 240 {
			return errors.New("帧率需在 0~240 之间")
		}
	case KindPR:
		if s.Timeline == nil || len(s.Timeline.Clips) == 0 {
			return errors.New("时间线里没有可渲染的片段")
		}
		if s.Width < 0 || s.Height < 0 {
			return errors.New("输出尺寸无效")
		}
	case KindComfy:
		if err := ValidComfyPrompt(s.Prompt); err != nil {
			return err
		}
		if s.Media != "" && s.Media != "image" && s.Media != "video" {
			return fmt.Errorf("未知的 ComfyUI 产物类型 %q", s.Media)
		}
		if s.TimeoutSec < 0 || s.TimeoutSec > 3600 {
			return errors.New("超时需在 0~3600 秒之间")
		}
	default:
		return fmt.Errorf("未知的渲染类型 %q", s.Kind)
	}
	return nil
}

// Clip is one cut: a piece of a source asset placed at a position on the
// timeline. In and Dur are in source seconds; At is the timeline position and
// is slice-relative when a clip travels in a claim.
type Clip struct {
	Asset string  `json:"asset"` // base name inside the bundle
	In    float64 `json:"in"`
	Dur   float64 `json:"dur"`
	At    float64 `json:"at"`
}

// Timeline is a flat cut list. Effect stacks, transitions, speed ramps and
// multi-track compositing are not represented: those live in the NLE's own
// renderer, not in the interchange XML. What is represented — in/out points and
// order — is exactly what can be rendered in parallel.
type Timeline struct {
	Name     string  `json:"name"`
	FPS      float64 `json:"fps"`
	Width    int     `json:"width"`
	Height   int     `json:"height"`
	Duration float64 `json:"duration"`
	Clips    []Clip  `json:"clips"`
	Note     string  `json:"note,omitempty"`
}

// Slice is one independent piece of a job. For a timeline it is a time range of
// the sequence with the clips clipped to it; for Blender it is a frame range.
type Slice struct {
	Index int
	Start float64 // timeline seconds, or first frame
	Dur   float64 // seconds, or frame count
	Clips []Clip
}

// round trims floating-point noise from NLE frame arithmetic so a boundary
// shared by two slices is exactly the same number on both sides.
func round(v float64) float64 { return math.Round(v*1e6) / 1e6 }

// PlanTimeline cuts a sequence into want contiguous time ranges. Splitting by
// time rather than by clip keeps the pieces even: a one-second insert at the end
// of a long sequence must not become a whole task of its own.
func PlanTimeline(tl *Timeline, want int) []Slice {
	if tl == nil || len(tl.Clips) == 0 {
		return nil
	}
	if want < 1 {
		want = 1
	}
	if want > 64 {
		want = 64
	}
	total := tl.Duration
	if total <= 0 {
		for _, c := range tl.Clips {
			if end := c.At + c.Dur; end > total {
				total = end
			}
		}
	}
	if total <= 0 {
		return nil
	}
	step := total / float64(want)
	var out []Slice
	for i := 0; i < want; i++ {
		s := round(step * float64(i))
		e := round(step * float64(i+1))
		if i == want-1 {
			e = round(total)
		}
		if e-s < 1e-4 {
			continue
		}
		var clips []Clip
		for _, c := range tl.Clips {
			cs, ce := c.At, c.At+c.Dur
			lo, hi := math.Max(s, cs), math.Min(e, ce)
			if hi-lo < 1e-4 {
				continue
			}
			clips = append(clips, Clip{
				Asset: c.Asset,
				In:    round(c.In + (lo - cs)),
				Dur:   round(hi - lo),
				At:    round(lo - s),
			})
		}
		if len(clips) == 0 {
			continue
		}
		out = append(out, Slice{Index: len(out), Start: s, Dur: round(e - s), Clips: clips})
	}
	return out
}

// PlanFrames cuts [from,to] into want contiguous frame ranges. Ranges are
// inclusive, like the -s/-e pair Blender takes.
func PlanFrames(from, to, want int) []Slice {
	if from < 0 {
		from = 0
	}
	if to < from {
		return nil
	}
	if want < 1 {
		want = 1
	}
	if want > 64 {
		want = 64
	}
	total := to - from + 1
	if want > total {
		want = total
	}
	var out []Slice
	cursor := from
	for i := 0; i < want; i++ {
		left := want - i
		n := (to - cursor + 1) / left
		if n < 1 {
			n = 1
		}
		out = append(out, Slice{Index: i, Start: float64(cursor), Dur: float64(n)})
		cursor += n
	}
	return out
}

// SliceClips returns the clips that fall inside [start, start+dur), trimmed to
// the window and rebased so the first one starts at 0. The broker uses it when
// it hands a slice to an agent; the agent never sees the whole timeline.
func SliceClips(tl *Timeline, start, dur float64) []Clip {
	if tl == nil {
		return nil
	}
	end := start + dur
	var out []Clip
	for _, c := range tl.Clips {
		cs, ce := c.At, c.At+c.Dur
		lo, hi := math.Max(start, cs), math.Min(end, ce)
		if hi-lo < 1e-4 {
			continue
		}
		out = append(out, Clip{
			Asset: c.Asset,
			In:    round(c.In + (lo - cs)),
			Dur:   round(hi - lo),
			At:    round(lo - start),
		})
	}
	return out
}

// Assets lists the distinct asset base names a timeline needs, in first-use
// order. The broker uses it to prove every referenced file is inside the bundle
// before it accepts the job.
func (tl *Timeline) Assets() []string {
	seen := map[string]bool{}
	var out []string
	for _, c := range tl.Clips {
		if !seen[c.Asset] {
			seen[c.Asset] = true
			out = append(out, c.Asset)
		}
	}
	return out
}

// BaseName normalises a path from an NLE XML file to the name a bundle entry is
// matched by. NLEs write platform paths and percent-encoded URLs; neither
// survives a trip to a different machine, so only the file name is portable.
func BaseName(p string) string {
	p = strings.TrimSpace(p)
	p = strings.TrimPrefix(p, "file://localhost")
	p = strings.TrimPrefix(p, "file://")
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		p = p[i+1:]
	}
	p = strings.ReplaceAll(p, "%20", " ")
	return p
}
