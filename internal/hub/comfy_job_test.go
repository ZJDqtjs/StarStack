package hub

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"starstack/internal/ffx"
	"starstack/internal/render"
)

const comfyGraph = `{"3":{"class_type":"KSampler","inputs":{"seed":1}},` +
	`"9":{"class_type":"SaveImage","inputs":{"filename_prefix":"starstack"}}}`

// comfyPolicy is the double gate the deployment turns on for one account.
func comfyPolicy(user string) Policy {
	pol := DefaultPolicy()
	pol.AllowComfy = true
	pol.ComfyUsers = []string{user}
	return pol
}

func TestComfyJobNeedsBothGates(t *testing.T) {
	// 1. deployment switch off: even a named account is refused.
	pol := DefaultPolicy()
	pol.ComfyUsers = []string{"alice"}
	s := newTestServer(t, pol)
	ck := asUser(t, s, "alice")
	body := `{"kind":"image","prompt":` + comfyGraph + `}`
	rec := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/jobs/comfy", strings.NewReader(body))
	r.AddCookie(ck)
	s.handleCreateComfy(rec, r)
	if rec.Code != 403 {
		t.Fatalf("comfy off must be 403, got %d %s", rec.Code, rec.Body.String())
	}

	// 2. switch on but the account is not on the list: still refused.
	s2 := newTestServer(t, comfyPolicy("someone-else"))
	ck2 := asUser(t, s2, "alice")
	rec2 := httptest.NewRecorder()
	r2 := httptest.NewRequest("POST", "/api/jobs/comfy", strings.NewReader(body))
	r2.AddCookie(ck2)
	s2.handleCreateComfy(rec2, r2)
	if rec2.Code != 403 {
		t.Fatalf("unlisted account must be 403, got %d %s", rec2.Code, rec2.Body.String())
	}
}

func TestComfyJobHoldsOneRunAndPinsTheRuntime(t *testing.T) {
	s := newTestServer(t, comfyPolicy("alice"))
	ck := asUser(t, s, "alice")
	if _, err := s.st.AddCredits("u-alice", 100); err != nil {
		t.Fatalf("credits: %v", err)
	}
	// one node that can run graphs at 2.0 点/次, one that cannot
	gpu := node("comfy-node", 2.0, 0)
	gpu.Runtimes = []ffx.Runtime{{Name: "comfyui", Version: "1"}}
	gpu.GPUs = []ffx.GPUDetail{{Name: "RTX 4090", MemMB: 24576}}
	cpu := node("ffmpeg-node", 0.2, 0)
	s.workers[gpu.ID], s.workers[cpu.ID] = gpu, cpu

	body := `{"kind":"image","name":"夜景","prompt":` + comfyGraph + `}`
	rec := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/jobs/comfy", strings.NewReader(body))
	r.AddCookie(ck)
	s.handleCreateComfy(rec, r)
	if rec.Code != 200 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var got struct {
		ID   string  `json:"id"`
		Kind string  `json:"kind"`
		Hold float64 `json:"hold"`
		Unit string  `json:"unit"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Kind != render.KindComfy || got.Unit != "次" {
		t.Fatalf("a comfy job is billed per run: kind=%q unit=%q", got.Kind, got.Unit)
	}
	// 2.0 点/次 x 1 次: the hold is exactly one generation at the dearest
	// eligible node, not a duration.
	if got.Hold != 2.0 {
		t.Fatalf("hold = %.2f, want 2.00 (one run at the comfyui node's price)", got.Hold)
	}
	j := s.jobs[got.ID]
	if j == nil || len(j.Segs) != 1 {
		t.Fatalf("a comfy job is one indivisible slice, got %+v", j)
	}
	if j.Req.Runtime != "comfyui" || !j.Req.NeedGPU {
		t.Fatalf("comfy jobs must pin runtime=comfyui and a GPU, got %+v", j.Req)
	}
	if !strings.Contains(j.Note, "1 台可执行节点") {
		t.Fatalf("note should name the eligible pool, got %q", j.Note)
	}
}

func TestComfyJobRejectsUIWorkflow(t *testing.T) {
	s := newTestServer(t, comfyPolicy("alice"))
	ck := asUser(t, s, "alice")
	body := `{"kind":"image","prompt":{"nodes":[{"id":1,"type":"KSampler"}],"links":[]}}`
	rec := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/jobs/comfy", strings.NewReader(body))
	r.AddCookie(ck)
	s.handleCreateComfy(rec, r)
	if rec.Code != 400 {
		t.Fatalf("a UI-format workflow is not executable, want 400, got %d %s",
			rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "class_type") {
		t.Fatalf("the error must say how to fix it, got %s", rec.Body.String())
	}
}

func TestComfyDispatchSizingAndArtifact(t *testing.T) {
	j := &Job{ID: "j1", Kind: render.KindComfy,
		Spec: &render.Spec{Kind: render.KindComfy, TimeoutSec: 1200}}
	req, vcodec := jobReq(j)
	if req.Runtime != "comfyui" || vcodec != "" {
		t.Fatalf("jobReq: runtime=%q vcodec=%q", req.Runtime, vcodec)
	}
	if got := artifactName(render.KindComfy, 0); got != "result.zip" {
		t.Fatalf("artifact name = %q, want result.zip", got)
	}
	s := newTestServer(t, DefaultPolicy())
	// the lease has to outlive a sampling run, exactly like a build's
	if d := s.deadlineLocked(j); d.Minutes() < 20 {
		t.Fatalf("deadline %v is too short for a 20-minute graph", d)
	}
}

func TestComfySettlementChargesOncePerRun(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	j := &Job{ID: "j1", Kind: render.KindComfy, Hold: 5}
	seg := &Seg{ID: "j1-0", JobID: "j1", PriceAt: 2.5, Wall: 42}
	wd := node("n1", 2.5, 0)

	s.mu.Lock()
	s.settleSegment(j, seg, wd)
	s.mu.Unlock()

	if seg.Cost != 2.5 {
		t.Fatalf("cost = %.2f, want one run at the frozen price 2.50", seg.Cost)
	}
	if j.Spent != 2.5 {
		t.Fatalf("spent = %.2f, want 2.50", j.Spent)
	}
	if seg.Wall != 42 {
		t.Fatal("wall clock is still recorded for the contribution ledger")
	}
}

// TestLauncherCarriesComfyUIOption is the console half of the feature: the box
// on the 创建节点 page has to reach the generated script and the bundle config,
// and leaving it unticked must leave the flag out entirely.
func TestLauncherCarriesComfyUIOption(t *testing.T) {
	for _, want := range []bool{true, false} {
		s := newTestServer(t, PublicPolicy())
		s.policy.AgentToken = "shared-token"
		binDir := t.TempDir()
		os.WriteFile(filepath.Join(binDir, "starstack-worker-windows-amd64.exe"), []byte("stub"), 0o755)
		s.SetNodeBinDir(binDir)
		ck := asUser(t, s, "alice")

		body, _ := json.Marshal(map[string]any{"price": 0.8, "slots": 2, "name": "学校机器",
			"os": "windows", "arch": "amd64", "comfyui": want})
		rec := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/nodes/launch", bytes.NewReader(body))
		r.AddCookie(ck)
		s.handleLaunchMint(rec, r)
		if rec.Code != 200 {
			t.Fatalf("mint: %d %s", rec.Code, rec.Body.String())
		}
		var mint struct {
			Code    string `json:"code"`
			ComfyUI bool   `json:"comfyui"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &mint); err != nil {
			t.Fatal(err)
		}
		if mint.ComfyUI != want {
			t.Fatalf("mint must echo comfyui=%v, got %v", want, mint.ComfyUI)
		}

		script := httptest.NewRecorder()
		s.handleLaunchScript(script, httptest.NewRequest("GET",
			"/launch/"+mint.Code+"/windows/amd64", nil))
		if script.Code != 200 {
			t.Fatalf("script: %d %s", script.Code, script.Body.String())
		}
		if has := strings.Contains(script.Body.String(), "--allow-comfy"); has != want {
			t.Fatalf("launcher --allow-comfy present=%v, want %v", has, want)
		}

		bundle := httptest.NewRecorder()
		s.handleLaunchScript(bundle, httptest.NewRequest("GET",
			"/launch/"+mint.Code+"/windows/amd64?format=bundle", nil))
		if bundle.Code != 200 {
			t.Fatalf("bundle: %d %s", bundle.Code, bundle.Body.String())
		}
		cfg := bundleConfig(t, bundle.Body.Bytes())
		var got struct {
			ComfyUI  bool   `json:"comfyui"`
			ComfyURL string `json:"comfy_url"`
		}
		if err := json.Unmarshal([]byte(cfg), &got); err != nil {
			t.Fatalf("starstack-node.json: %v", err)
		}
		if got.ComfyUI != want {
			t.Fatalf("bundle comfyui=%v, want %v", got.ComfyUI, want)
		}
		if want && got.ComfyURL != defaultComfyURL {
			t.Fatalf("bundle comfy_url=%q, want %q", got.ComfyURL, defaultComfyURL)
		}
	}
}

func bundleConfig(t *testing.T, raw []byte) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatalf("bundle is not a zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != "starstack-node.json" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		defer rc.Close()
		b, err := io.ReadAll(rc)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	t.Fatal("bundle has no starstack-node.json")
	return ""
}

func TestComfyModelMatchingAndStatusSummary(t *testing.T) {
	s := newTestServer(t, comfyPolicy("alice"))
	ck := asUser(t, s, "alice")
	if _, err := s.st.AddCredits("u-alice", 100); err != nil {
		t.Fatalf("credits: %v", err)
	}

	sdxl := node("comfy-sdxl", 1.5, 0)
	sdxl.Runtimes = []ffx.Runtime{{Name: "comfyui", Version: "1"}}
	sdxl.GPUs = []ffx.GPUDetail{{Name: "RTX 4090", MemMB: 24576}}
	sdxl.ComfyModels = &ffx.ComfyModels{
		Reachable:   true,
		Checkpoints: []string{"SDXL/sd_xl_base_1.0.safetensors"},
		LoRAs:       []string{"detail_tweaker.safetensors"},
	}

	flux := node("comfy-flux", 3.0, 0)
	flux.Runtimes = []ffx.Runtime{{Name: "comfyui", Version: "1"}}
	flux.GPUs = []ffx.GPUDetail{{Name: "RTX 4090", MemMB: 24576}}
	flux.ComfyModels = &ffx.ComfyModels{
		Reachable:   true,
		Checkpoints: []string{"flux1-dev.safetensors"},
	}
	s.workers[sdxl.ID], s.workers[flux.ID] = sdxl, flux

	// 1. /api/comfy/status must expose pool_allowed, pool_nodes, pool_min_price & aggregated pool_models.
	stRec := httptest.NewRecorder()
	stReq := httptest.NewRequest("GET", "/api/comfy/status", nil)
	stReq.AddCookie(ck)
	s.Handlers().ServeHTTP(stRec, stReq)
	if stRec.Code != 200 {
		t.Fatalf("status: %d %s", stRec.Code, stRec.Body.String())
	}
	var st struct {
		PoolAllowed  bool    `json:"pool_allowed"`
		PoolNodes    int     `json:"pool_nodes"`
		PoolMinPrice float64 `json:"pool_min_price"`
		PoolModels   struct {
			Checkpoints []comfyPoolModelEntry `json:"checkpoints"`
			LoRAs       []comfyPoolModelEntry `json:"loras"`
		} `json:"pool_models"`
	}
	if err := json.Unmarshal(stRec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if !st.PoolAllowed || st.PoolNodes != 2 || st.PoolMinPrice != 1.5 {
		t.Fatalf("unexpected comfy pool summary: %+v", st)
	}
	if len(st.PoolModels.Checkpoints) != 2 || len(st.PoolModels.LoRAs) != 1 {
		t.Fatalf("unexpected pool models: %+v", st.PoolModels)
	}

	// 2. Submitting a graph referencing sd_xl_base_1.0.safetensors (basename match!)
	// must only match comfy-sdxl (1.5 点/次), not comfy-flux (3.0 点/次).
	graphWithCkpt := `{"1":{"class_type":"CheckpointLoaderSimple","inputs":{"ckpt_name":"sd_xl_base_1.0.safetensors"}},` +
		`"2":{"class_type":"LoraLoader","inputs":{"lora_name":"detail_tweaker.safetensors"}},` +
		`"9":{"class_type":"SaveImage","inputs":{"filename_prefix":"ss"}}}`
	body := `{"kind":"image","name":"SDXL夜景","prompt":` + graphWithCkpt + `}`
	rec := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/jobs/comfy", strings.NewReader(body))
	r.AddCookie(ck)
	s.handleCreateComfy(rec, r)
	if rec.Code != 200 {
		t.Fatalf("create comfy with ckpt: %d %s", rec.Code, rec.Body.String())
	}
	var got struct {
		ID         string  `json:"id"`
		Hold       float64 `json:"hold"`
		Checkpoint string  `json:"checkpoint"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Hold != 1.5 || got.Checkpoint != "sd_xl_base_1.0.safetensors" {
		t.Fatalf("expected hold=1.50 (sdxl node only), got %+v", got)
	}
	j := s.jobs[got.ID]
	s.mu.Lock()
	picked := s.pickWorkerLocked(j.Req, "", j.Segs[0])
	s.mu.Unlock()
	if picked == nil || picked.ID != sdxl.ID {
		t.Fatalf("expected scheduler to pick %s, got %+v", sdxl.ID, picked)
	}
}

func TestComfyJobArtifactFilesListAndServe(t *testing.T) {
	s := newTestServer(t, comfyPolicy("alice"))
	alice := asUser(t, s, "alice")
	bob := asUser(t, s, "bob")

	jobID := "comfyjob1"
	dir := filepath.Join(s.dataDir, "jobs", jobID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	zipPath := filepath.Join(dir, "result.zip")
	f, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	w, err := zw.Create("out_0001.png")
	if err != nil {
		t.Fatal(err)
	}
	pngStub := []byte("\x89PNG\r\n\x1a\nfake-png-bytes")
	w.Write(pngStub)
	zw.Close()
	f.Close()

	s.mu.Lock()
	s.jobs[jobID] = &Job{ID: jobID, OwnerID: "u-alice", Kind: render.KindComfy, Status: "done", out: zipPath}
	s.mu.Unlock()

	// List files as owner.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/jobs/"+jobID+"/files", nil)
	req.AddCookie(alice)
	s.Handlers().ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("list files: %d %s", rec.Code, rec.Body.String())
	}
	var listed struct {
		Files []struct {
			Filename string `json:"filename"`
			Mime     string `json:"mime"`
			URL      string `json:"url"`
		} `json:"files"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Files) != 1 || listed.Files[0].Filename != "out_0001.png" || listed.Files[0].Mime != "image/png" {
		t.Fatalf("unexpected listed files: %+v", listed.Files)
	}

	// Fetch individual file as owner.
	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest("GET", listed.Files[0].URL, nil)
	req2.AddCookie(alice)
	s.Handlers().ServeHTTP(rec2, req2)
	if rec2.Code != 200 || !bytes.Equal(rec2.Body.Bytes(), pngStub) {
		t.Fatalf("serve file: %d len=%d", rec2.Code, rec2.Body.Len())
	}
	if ct := rec2.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("content-type = %q, want image/png", ct)
	}

	// Another user must not access the owner's generated files.
	rec3 := httptest.NewRecorder()
	req3 := httptest.NewRequest("GET", listed.Files[0].URL, nil)
	req3.AddCookie(bob)
	s.Handlers().ServeHTTP(rec3, req3)
	if rec3.Code != 404 {
		t.Fatalf("foreign user should get 404, got %d", rec3.Code)
	}
}
