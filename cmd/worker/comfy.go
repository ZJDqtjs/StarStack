package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"starstack/internal/ffx"
	"starstack/internal/hub"
	"starstack/internal/render"
)

// runComfy executes one ComfyUI job on this machine's own ComfyUI.
//
// The graph is forwarded untouched: /prompt takes exactly the object the buyer
// exported with "Save (API Format)", so checkpoints, LoRAs and custom nodes are
// whatever this provider installed. The agent's only jobs are to enqueue it,
// wait, collect every output file, and hand the bundle back.
//
// The provider opted in with --allow-comfy; the broker additionally restricts
// which accounts may submit.
func (a *agent) runComfy(c *hub.Claim) {
	spec := c.Spec
	if spec == nil || spec.Kind != render.KindComfy || len(spec.Prompt) == 0 {
		a.fail(c, "任务缺少 ComfyUI 工作流")
		return
	}
	if a.comfyURL == "" {
		a.fail(c, "这台节点没有开启 --allow-comfy")
		return
	}
	timeout := spec.TimeoutSec
	if timeout < 60 {
		timeout = 900
	}
	if timeout > 3600 {
		timeout = 3600
	}
	if err := comfyProbe(context.Background(), a.comfyURL); err != nil {
		a.fail(c, fmt.Sprintf("本机 ComfyUI 不可用（%s）：%v", a.comfyURL, err))
		return
	}
	a.post(a.server+"/api/report", map[string]any{
		"worker": a.nodeID(), "seg": c.SegID, "state": "running", "pct": 5}, true)

	client := a.nodeID() + "-" + c.SegID
	promptID, err := comfySubmit(a.comfyURL, spec.Prompt, client)
	if err != nil {
		a.fail(c, "提交 ComfyUI 队列失败: "+err.Error())
		return
	}
	log.Printf("comfy seg %s: queued prompt %s on %s (timeout %ds)", c.SegID, promptID, a.comfyURL, timeout)

	t0 := time.Now()
	entry, err := comfyWait(c, a, promptID, time.Duration(timeout)*time.Second)
	wall := time.Since(t0).Seconds()
	if err != nil {
		// A prompt that never finishes must not keep the slot: drop it from the
		// queue so the GPU is free for the next buyer.
		comfyCancel(a.comfyURL, promptID)
		a.fail(c, err.Error())
		return
	}
	files, err := comfyOutputs(entry)
	if err != nil {
		a.fail(c, err.Error())
		return
	}
	a.post(a.server+"/api/report", map[string]any{
		"worker": a.nodeID(), "seg": c.SegID, "state": "running", "pct": 80}, true)

	dir := filepath.Join(a.work, "comfy-"+c.SegID)
	os.RemoveAll(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		a.fail(c, err.Error())
		return
	}
	defer os.RemoveAll(dir)
	for _, f := range files {
		if err := comfyDownload(a.comfyURL, f, dir); err != nil {
			a.fail(c, "取回产物 "+f.Filename+": "+err.Error())
			return
		}
	}
	zipPath := filepath.Join(a.work, "comfy-"+c.SegID+".zip")
	defer os.Remove(zipPath)
	if err := zipTree(dir, zipPath, ""); err != nil {
		a.fail(c, "打包产物: "+err.Error())
		return
	}
	log.Printf("comfy seg %s: %d file(s) in %.1fs", c.SegID, len(files), wall)
	a.finish(c, zipPath, wall, 0)
}

// comfyProbe is the cheapest liveness check ComfyUI offers. It is called before
// enqueuing so a provider whose ComfyUI is closed gets one clear line instead of
// a queue that never moves.
func comfyProbe(ctx context.Context, base string) error {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/system_stats", nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("/system_stats 返回 %d", resp.StatusCode)
	}
	return nil
}

const (
	maxComfyModelItems = 64
	maxComfyModelChars = 160
)

// comfyProbeModels queries the provider's local ComfyUI for installed
// checkpoints (and UNET/diffusion models) and LoRAs so the broker can expose a
// compact summary in the compute pool and match prompt graphs to nodes that
// actually have the model files.
func comfyProbeModels(ctx context.Context, base string) *ffx.ComfyModels {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return nil
	}
	summary := &ffx.ComfyModels{UpdatedAt: time.Now().Unix()}
	if err := comfyProbe(ctx, base); err != nil {
		return summary
	}
	summary.Reachable = true

	ckpts := comfyObjectInfoChoices(ctx, base, "CheckpointLoaderSimple", "ckpt_name")
	if len(ckpts) == 0 {
		ckpts = comfyModelFolder(ctx, base, "checkpoints")
	}
	unets := comfyObjectInfoChoices(ctx, base, "UNETLoader", "unet_name")
	if len(unets) == 0 {
		unets = comfyModelFolder(ctx, base, "diffusion_models")
	}
	summary.Checkpoints = cleanModelList(append(ckpts, unets...))

	loras := comfyObjectInfoChoices(ctx, base, "LoraLoader", "lora_name")
	if len(loras) == 0 {
		loras = comfyModelFolder(ctx, base, "loras")
	}
	summary.LoRAs = cleanModelList(loras)
	return summary
}

// comfyObjectInfoChoices reads the dropdown choices ComfyUI advertises at
// /object_info/<nodeClass> -> input.required.<field>[0] (works across old and
// new ComfyUI releases).
func comfyObjectInfoChoices(ctx context.Context, base, nodeClass, field string) []string {
	c, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(c, http.MethodGet,
		base+"/object_info/"+url.PathEscape(nodeClass), nil)
	if err != nil {
		return nil
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 16<<10))
		return nil
	}
	var raw map[string]struct {
		Input struct {
			Required map[string][]json.RawMessage `json:"required"`
			Optional map[string][]json.RawMessage `json:"optional"`
		} `json:"input"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&raw); err != nil {
		return nil
	}
	info, ok := raw[nodeClass]
	if !ok {
		return nil
	}
	spec := info.Input.Required[field]
	if len(spec) == 0 {
		spec = info.Input.Optional[field]
	}
	if len(spec) == 0 {
		return nil
	}
	var choices []string
	if err := json.Unmarshal(spec[0], &choices); err == nil {
		return choices
	}
	return nil
}

// comfyModelFolder falls back to ComfyUI's newer /models/<folder> endpoint.
func comfyModelFolder(ctx context.Context, base, folder string) []string {
	c, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(c, http.MethodGet,
		base+"/models/"+url.PathEscape(folder), nil)
	if err != nil {
		return nil
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 16<<10))
		return nil
	}
	var list []string
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&list); err != nil {
		return nil
	}
	return list
}

func cleanModelList(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, raw := range in {
		s := strings.TrimSpace(raw)
		if s == "" {
			continue
		}
		if r := []rune(s); len(r) > maxComfyModelChars {
			s = string(r[:maxComfyModelChars])
		}
		k := strings.ToLower(s)
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, s)
	}
	sort.Strings(out)
	if len(out) > maxComfyModelItems {
		out = out[:maxComfyModelItems]
	}
	return out
}

func comfyModelsEqual(a, b *ffx.ComfyModels) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil || a.Reachable != b.Reachable {
		return false
	}
	if len(a.Checkpoints) != len(b.Checkpoints) || len(a.LoRAs) != len(b.LoRAs) {
		return false
	}
	for i := range a.Checkpoints {
		if a.Checkpoints[i] != b.Checkpoints[i] {
			return false
		}
	}
	for i := range a.LoRAs {
		if a.LoRAs[i] != b.LoRAs[i] {
			return false
		}
	}
	return true
}

// comfySubmit posts the graph and returns the prompt id the queue assigned.
func comfySubmit(base string, graph json.RawMessage, clientID string) (string, error) {
	body, err := json.Marshal(map[string]any{
		"prompt":    graph,
		"client_id": clientID,
	})
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/prompt", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 256<<10))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%d %s", resp.StatusCode, clipText(string(raw), 600))
	}
	var out struct {
		PromptID   string         `json:"prompt_id"`
		NodeErrors map[string]any `json:"node_errors"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("响应不是 JSON: %s", clipText(string(raw), 200))
	}
	if len(out.NodeErrors) > 0 {
		return "", fmt.Errorf("工作流校验未通过: %s", clipText(string(raw), 600))
	}
	if out.PromptID == "" {
		return "", fmt.Errorf("ComfyUI 没有返回 prompt_id: %s", clipText(string(raw), 200))
	}
	return out.PromptID, nil
}

// comfyHistoryEntry is the slice of /history/<id> this agent needs: the output
// map plus the execution status ComfyUI writes after a failed run.
type comfyHistoryEntry struct {
	Outputs map[string]map[string][]comfyFile `json:"outputs"`
	Status  struct {
		StatusStr string `json:"status_str"`
		Completed bool   `json:"completed"`
		Messages  []any  `json:"messages"`
	} `json:"status"`
}

type comfyFile struct {
	Filename  string `json:"filename"`
	Subfolder string `json:"subfolder"`
	Type      string `json:"type"`
}

// comfyWait polls /history until the prompt has an entry. The heartbeat doubles
// as the lease keeper: a graph can sample for twenty minutes and the broker
// reclaims a slice after 25 silent seconds.
func comfyWait(c *hub.Claim, a *agent, promptID string, timeout time.Duration) (*comfyHistoryEntry, error) {
	deadline := time.Now().Add(timeout)
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	lastBeat := time.Now()
	start := time.Now()
	for {
		select {
		case <-t.C:
		case <-time.After(time.Until(deadline)):
			return nil, fmt.Errorf("ComfyUI 执行超时（%d 秒）", int(timeout.Seconds()))
		}
		entry, done, err := comfyHistory(a.comfyURL, promptID)
		if err != nil {
			log.Printf("comfy seg %s: history %v (retrying)", c.SegID, err)
		} else if done {
			if entry.Status.StatusStr == "error" {
				return nil, fmt.Errorf("ComfyUI 执行失败: %s", clipText(fmt.Sprint(entry.Status.Messages), 900))
			}
			return entry, nil
		}
		if time.Since(lastBeat) > 15*time.Second {
			lastBeat = time.Now()
			pct := 10 + 65*time.Since(start).Seconds()/timeout.Seconds()
			if pct > 75 {
				pct = 75
			}
			a.post(a.server+"/api/report", map[string]any{
				"worker": a.nodeID(), "seg": c.SegID, "state": "running", "pct": pct}, true)
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("ComfyUI 执行超时（%d 秒）", int(timeout.Seconds()))
		}
	}
}

func comfyHistory(base, promptID string) (*comfyHistoryEntry, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/history/"+url.PathEscape(promptID), nil)
	if err != nil {
		return nil, false, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, false, fmt.Errorf("/history 返回 %d", resp.StatusCode)
	}
	var all map[string]*comfyHistoryEntry
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&all); err != nil {
		return nil, false, err
	}
	entry := all[promptID]
	if entry == nil {
		return nil, false, nil // still queued or running
	}
	return entry, true, nil
}

// comfyOutputs flattens the per-node output map into a file list. Different
// output nodes use different keys (SaveImage → images, VHS → gifs/videos), so
// every array of file descriptors is taken rather than a fixed one.
func comfyOutputs(entry *comfyHistoryEntry) ([]comfyFile, error) {
	var out []comfyFile
	for _, node := range entry.Outputs {
		for _, files := range node {
			for _, f := range files {
				if f.Filename == "" {
					continue
				}
				if f.Type == "" {
					f.Type = "output"
				}
				out = append(out, f)
			}
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("工作流执行完成但没有任何产物：确认图里包含 SaveImage 类输出节点")
	}
	return out, nil
}

// comfyDownload pulls one produced file into dir, keeping only its base name so
// a graph cannot write outside the job directory.
func comfyDownload(base string, f comfyFile, dir string) error {
	q := url.Values{}
	q.Set("filename", f.Filename)
	q.Set("subfolder", f.Subfolder)
	q.Set("type", f.Type)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/view?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("/view 返回 %d", resp.StatusCode)
	}
	name := filepath.Base(strings.ReplaceAll(f.Filename, "\\", "/"))
	if name == "" || name == "." || name == ".." {
		return fmt.Errorf("非法文件名 %q", f.Filename)
	}
	dst, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(dst, io.LimitReader(resp.Body, 2<<30))
	closeErr := dst.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

// comfyCancel is best effort: remove the prompt if it is still pending, and
// interrupt the queue if our prompt is the one running. Errors are ignored —
// the slice is already being reported as failed.
func comfyCancel(base, promptID string) {
	body, _ := json.Marshal(map[string]any{"delete": []string{promptID}})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/queue", bytes.NewReader(body)); err == nil {
		req.Header.Set("Content-Type", "application/json")
		if resp, err := http.DefaultClient.Do(req); err == nil {
			resp.Body.Close()
		}
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel2()
	if req, err := http.NewRequestWithContext(ctx2, http.MethodPost, base+"/interrupt", nil); err == nil {
		if resp, err := http.DefaultClient.Do(req); err == nil {
			resp.Body.Close()
		}
	}
}

// clipText keeps an error message readable: buy-side logs and job cards show
// these strings, and ComfyUI tracebacks can run for pages.
func clipText(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}
