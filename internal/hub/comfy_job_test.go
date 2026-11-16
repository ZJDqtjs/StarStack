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
