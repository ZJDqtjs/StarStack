package hub

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"starstack/internal/ffx"
	"starstack/internal/render"
	"starstack/internal/store"
)

// comfyModelsJSON encodes a worker's reported ComfyUI model summary for SQLite.
func comfyModelsJSON(m *ffx.ComfyModels) string {
	if m == nil {
		return ""
	}
	b, err := json.Marshal(m)
	if err != nil {
		return ""
	}
	return string(b)
}

// extractComfyModels inspects an API-format ComfyUI prompt graph for the first
// referenced checkpoint/unet and any LoRA filenames.
func extractComfyModels(raw json.RawMessage) (checkpoint string, loras []string) {
	var nodes map[string]struct {
		ClassType string         `json:"class_type"`
		Inputs    map[string]any `json:"inputs"`
	}
	if json.Unmarshal(raw, &nodes) != nil {
		return "", nil
	}
	// Deterministic order over node IDs.
	ids := make([]string, 0, len(nodes))
	for id := range nodes {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	seenLora := map[string]bool{}
	for _, id := range ids {
		n := nodes[id]
		ct := strings.TrimSpace(n.ClassType)
		if checkpoint == "" {
			switch ct {
			case "CheckpointLoaderSimple", "CheckpointLoader":
				if s, ok := n.Inputs["ckpt_name"].(string); ok && strings.TrimSpace(s) != "" {
					checkpoint = strings.TrimSpace(s)
				}
			case "UNETLoader":
				if s, ok := n.Inputs["unet_name"].(string); ok && strings.TrimSpace(s) != "" {
					checkpoint = strings.TrimSpace(s)
				}
			}
		}
		if ct == "LoraLoader" || ct == "LoraLoaderModelOnly" {
			if s, ok := n.Inputs["lora_name"].(string); ok {
				s = strings.TrimSpace(s)
				if s != "" && !seenLora[strings.ToLower(s)] {
					seenLora[strings.ToLower(s)] = true
					loras = append(loras, s)
				}
			}
		}
	}
	return checkpoint, loras
}

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
		Name       string          `json:"name"`
		Kind       string          `json:"kind"` // image | video
		Prompt     json.RawMessage `json:"prompt"`
		Timeout    int             `json:"timeout"`
		Checkpoint string          `json:"checkpoint"`
		LoRAs      []string        `json:"loras"`
		Req        *Req            `json:"req"`
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
	if hard.ComfyCheckpoint == "" && strings.TrimSpace(req.Checkpoint) != "" {
		hard.ComfyCheckpoint = strings.TrimSpace(req.Checkpoint)
	}
	if len(hard.ComfyLoRAs) == 0 && len(req.LoRAs) > 0 {
		for _, l := range req.LoRAs {
			if s := strings.TrimSpace(l); s != "" {
				hard.ComfyLoRAs = append(hard.ComfyLoRAs, s)
			}
		}
	}
	graphCkpt, graphLoRAs := extractComfyModels(req.Prompt)

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
	// Auto-apply model constraints inferred from the prompt graph when at least
	// one online ComfyUI node reports its installed models, so graphs land on a
	// node that actually has the referenced checkpoint/LoRA without stranding
	// legacy workers that do not report ComfyModels yet.
	if hard.ComfyCheckpoint == "" || len(hard.ComfyLoRAs) == 0 {
		anyModelAware := false
		for _, wd := range s.workers {
			if wd.online() && wd.hasRuntime("comfyui") && wd.ComfyModels != nil && wd.ComfyModels.Reachable {
				anyModelAware = true
				break
			}
		}
		if anyModelAware {
			if hard.ComfyCheckpoint == "" && graphCkpt != "" {
				hard.ComfyCheckpoint = graphCkpt
			}
			if len(hard.ComfyLoRAs) == 0 && len(graphLoRAs) > 0 {
				hard.ComfyLoRAs = graphLoRAs
			}
			job.Req = hard
		}
	}
	if live := s.countLiveJobsLocked(u.ID); live >= s.policy.MaxActiveJobs {
		s.mu.Unlock()
		http.Error(w, jsonErr(fmt.Sprintf("你有 %d 个任务在跑或排队，单账户上限 %d 个",
			live, s.policy.MaxActiveJobs)), http.StatusTooManyRequests)
		return
	}
	hold, holdPrice, basis := s.estimateHoldLocked(job)
	job.Hold = hold
	if n := s.eligibleLocked(hard, ""); n == 0 {
		if hard.ComfyCheckpoint != "" {
			job.Note = fmt.Sprintf("ComfyUI 任务；当前没有安装了 %s 的在线节点，任务将排队等待", hard.ComfyCheckpoint)
		} else {
			job.Note = "ComfyUI 任务；当前没有开启 --allow-comfy 的在线节点，任务将排队等待"
		}
	} else {
		modelTag := ""
		if hard.ComfyCheckpoint != "" {
			modelTag = " · 模型 " + filepath.Base(strings.ReplaceAll(hard.ComfyCheckpoint, "\\", "/"))
		}
		job.Note = fmt.Sprintf("ComfyUI 任务%s；共 %d 台可执行节点；预扣依据：%s（%.2f 点/次）",
			modelTag, n, basis, holdPrice)
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
		"hold": hold, "note": job.Note, "unit": "次", "timeout": timeout,
		"checkpoint": hard.ComfyCheckpoint, "loras": hard.ComfyLoRAs})
}

// handleJobArtifactFiles lists or serves individual files inside a completed
// job's zip artifact (e.g. ComfyUI generated images/videos in result.zip) so
// the web console can display outputs inline without forcing a manual unzip.
func (s *Server) handleJobArtifactFiles(w http.ResponseWriter, r *http.Request, jobID, wantName string) {
	u := s.currentUser(r)
	if u == nil {
		http.Error(w, jsonErr("请先登录"), http.StatusUnauthorized)
		return
	}
	s.mu.Lock()
	j := s.jobs[jobID]
	outPath := ""
	allowed := j != nil && j.OwnerID == u.ID
	if allowed {
		outPath = j.out
	}
	s.mu.Unlock()
	if !allowed {
		if row, err := s.st.Job(jobID); err == nil && row.OwnerID == u.ID {
			allowed = true
		}
	}
	if !allowed {
		http.NotFound(w, r)
		return
	}
	if outPath == "" {
		for _, cand := range []string{"result.zip", "out.zip"} {
			p := filepath.Join(s.dataDir, "jobs", jobID, cand)
			if _, err := os.Stat(p); err == nil {
				outPath = p
				break
			}
		}
	}
	if outPath == "" || !strings.EqualFold(filepath.Ext(outPath), ".zip") {
		if wantName == "" {
			writeJSON(w, map[string]any{"job_id": jobID, "files": []any{}})
			return
		}
		http.NotFound(w, r)
		return
	}
	zr, err := zip.OpenReader(outPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer zr.Close()

	if wantName == "" {
		type fileItem struct {
			Filename string `json:"filename"`
			Size     uint64 `json:"size"`
			Mime     string `json:"mime"`
			URL      string `json:"url"`
		}
		files := make([]fileItem, 0, len(zr.File))
		for _, f := range zr.File {
			if f.FileInfo().IsDir() {
				continue
			}
			base := filepath.Base(strings.ReplaceAll(f.Name, "\\", "/"))
			if base == "" || base == "." || base == ".." {
				continue
			}
			ct := artifactMime(base)
			files = append(files, fileItem{
				Filename: base,
				Size:     f.UncompressedSize64,
				Mime:     ct,
				URL:      "/api/jobs/" + url.PathEscape(jobID) + "/files/" + url.PathEscape(base),
			})
		}
		writeJSON(w, map[string]any{"job_id": jobID, "files": files})
		return
	}

	decoded, err := url.PathUnescape(wantName)
	if err != nil {
		decoded = wantName
	}
	cleanWant := filepath.Base(strings.ReplaceAll(decoded, "\\", "/"))
	if cleanWant == "" || cleanWant == "." || cleanWant == ".." {
		http.NotFound(w, r)
		return
	}
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		base := filepath.Base(strings.ReplaceAll(f.Name, "\\", "/"))
		if base != cleanWant {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			http.Error(w, jsonErr("读取产物失败"), http.StatusInternalServerError)
			return
		}
		defer rc.Close()
		w.Header().Set("Content-Type", artifactMime(base))
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "private, max-age=3600")
		io.Copy(w, io.LimitReader(rc, 256<<20))
		return
	}
	http.NotFound(w, r)
}

func artifactMime(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mov":
		return "video/quicktime"
	}
	if ct := mime.TypeByExtension(filepath.Ext(name)); ct != "" {
		return ct
	}
	return "application/octet-stream"
}
