package hub

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"starstack/internal/render"
	"starstack/internal/store"
)

// defaultComfyURL is where a provider's ComfyUI normally listens. It is written
// into starstack-node.json so a provider can point the agent elsewhere without
// touching a command line.
const defaultComfyURL = "http://127.0.0.1:8188"

// handleCreateComfy queues a job whose executor is a provider's own ComfyUI.
//
// This is the node-executed twin of the /comfyui/api/ workbench: the workbench
// proxies the buyer to the operator's ComfyUI, while this endpoint hands a
// prompt graph to a machine that advertised the "comfyui" runtime and pays it
// per completed generation. The graph is forwarded untouched, so whatever
// checkpoint, LoRA or custom node the provider installed is what runs — the
// platform never ships model files.
//
// One slice per job, like a build: a prompt graph is one generation, and
// splitting it would mean splitting a sampling schedule.
func (s *Server) handleCreateComfy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	u := s.currentUser(r)
	if u == nil {
		http.Error(w, jsonErr("请先登录后再提交任务"), 401)
		return
	}
	if !s.policy.comfyAllowed(u.Name) {
		http.Error(w, jsonErr("本部署未向该账号开放 ComfyUI 任务"), http.StatusForbidden)
		return
	}

	var req struct {
		Name    string          `json:"name"`
		Kind    string          `json:"kind"` // image | video
		Prompt  json.RawMessage `json:"prompt"`
		Timeout int             `json:"timeout"`
		Req     *Req            `json:"req"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, int64(render.MaxComfyPromptBytes)+(64<<10))
	if err := json.NewDecoder(io.LimitReader(r.Body, int64(render.MaxComfyPromptBytes)+(64<<10))).Decode(&req); err != nil {
		http.Error(w, jsonErr("请求格式错误（需要 JSON：prompt 为 ComfyUI API 格式图）"), 400)
		return
	}
	kind := strings.ToLower(strings.TrimSpace(req.Kind))
	if kind == "" {
		kind = "image"
	}
	if kind != "image" && kind != "video" {
		http.Error(w, jsonErr("kind 必须是 image 或 video"), 400)
		return
	}
	if err := render.ValidComfyPrompt(req.Prompt); err != nil {
		http.Error(w, jsonErr(err.Error()), 400)
		return
	}
	timeout := req.Timeout
	if timeout <= 0 {
		timeout = 900
	}
	if timeout < 60 {
		timeout = 60
	}
	if timeout > 3600 {
		timeout = 3600
	}

	hard := Req{}
	if req.Req != nil {
		hard = *req.Req
		// The provider only sees this job because its agent advertised "comfyui";
		// pinning the requirement keeps a transcoding-only node out of the pool
		// even when the buyer asked for nothing in particular.
		hard.Runtime = "comfyui"
	} else {
		hard.Runtime = "comfyui"
	}
	// A prompt graph is not a video file, but "needs the provider's GPU" is the
	// honest default: image and video samplers both want VRAM, and a CPU-only
	// node that advertises comfyui cannot actually finish one in time.
	hard.NeedGPU = true

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "ComfyUI " + map[string]string{"image": "生图", "video": "生视频"}[kind]
	}
	if len([]rune(name)) > 120 {
		name = string([]rune(name)[:120])
	}

	id := newID()
	job := &Job{
		ID: id, OwnerID: u.ID, Name: name, Kind: render.KindComfy,
		Spec: &render.Spec{Kind: render.KindComfy, Prompt: req.Prompt, Media: kind,
			TimeoutSec: timeout},
		Req: hard, Status: "queued", CreatedAt: time.Now(),
		Profile: Profile{Segs: 1},
		// One generation is the billing unit, so Duration is 1 (unit "次") and
		// the hold is exactly one run at the dearest eligible node.
		Duration: 1,
	}
	job.Segs = []*Seg{{ID: id + "-0", JobID: id, Index: 0, Status: "pending"}}

	s.mu.Lock()
	if live := s.countLiveJobsLocked(u.ID); live >= s.policy.MaxActiveJobs {
		s.mu.Unlock()
		http.Error(w, jsonErr(fmt.Sprintf("你有 %d 个任务在跑或排队，单账户上限 %d 个",
			live, s.policy.MaxActiveJobs)), http.StatusTooManyRequests)
		return
	}
	hold, holdPrice, basis := s.estimateHoldLocked(job)
	job.Hold = hold
	if n := s.eligibleLocked(hard, ""); n == 0 {
		job.Note = "ComfyUI 任务；当前没有开启 --allow-comfy 的在线节点，任务将排队等待"
	} else {
		job.Note = fmt.Sprintf("ComfyUI 任务；共 %d 台可执行节点；预扣依据：%s（%.2f 点/次）",
			n, basis, holdPrice)
	}
	if u.Credits < hold {
		s.mu.Unlock()
		http.Error(w, jsonErr(fmt.Sprintf("算力点不足：本次任务预扣 %.2f 点，余额 %.2f 点",
			hold, u.Credits)), http.StatusPaymentRequired)
		return
	}
	if _, err := s.chargeJob(job, hold, store.Hold, "ComfyUI 任务预扣（按次结算，未执行全额退还）"); err != nil {
		s.mu.Unlock()
		http.Error(w, jsonErr("预扣失败"), 500)
		return
	}
	if err := s.st.InsertJob(jobRowOf(job), segRowsOf(job)); err != nil {
		s.mu.Unlock()
		http.Error(w, jsonErr("任务登记失败"), 500)
		return
	}
	s.jobs[id] = job
	s.order = append(s.order, id)
	s.mu.Unlock()
	s.commLog(&store.CommEntry{JobID: id, BuyerID: u.ID, Actor: "buyer", Event: "job.created",
		Detail: commDetail(map[string]any{"kind": render.KindComfy, "media": kind,
			"name": name, "hold": hold, "timeout": timeout})})
	log.Printf("comfy job %s queued by %s: %s graph, timeout %ds, hold=%.3f points",
		id, u.Name, kind, timeout, hold)
	writeJSON(w, map[string]any{"ok": true, "id": id, "kind": render.KindComfy,
		"hold": hold, "note": job.Note, "unit": "次", "timeout": timeout})
}
