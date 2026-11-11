package hub

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"starstack/internal/store"
)

// 生图 / 生视频的 ComfyUI 工作台。这里做三件事：
//  1. 把浏览器对 /comfyui/api/<official route> 的请求转发到真实的 ComfyUI
//     服务（含 /ws 的 WebSocket 升级），并用平台会话做鉴权；
//  2. 保存用户部署 / 导入的工作流图（UI 格式 JSON 原文）；
//  3. 报告上游是否可达，让离线时前端可以退回到内置节点库继续编辑。
//
// 官方路由对照见 ComfyUI server.py：/object_info /prompt /history /queue
// /upload/image /view /interrupt /system_stats /ws ...

const maxComfyWorkflowBytes = 8 << 20 // a big graph with many notes is still << 8 MiB

var (
	comfyKinds  = map[string]bool{"image": true, "video": true}
	comfyScopes = map[string]bool{"template": true, "preset": true, "draft": true}
)

type comfyWorkflowView struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Scope     string `json:"scope"`
	Name      string `json:"name"`
	Active    bool   `json:"active"`
	Nodes     int    `json:"nodes"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

func viewComfyWorkflow(w *store.ComfyWorkflow) comfyWorkflowView {
	return comfyWorkflowView{
		ID: w.ID, Kind: w.Kind, Scope: w.Scope, Name: w.Name,
		Active: w.Active != 0, Nodes: countGraphNodes(w.Graph),
		CreatedAt: w.CreatedAt, UpdatedAt: w.UpdatedAt,
	}
}

func countGraphNodes(graph string) int {
	var v struct {
		Nodes []json.RawMessage `json:"nodes"`
	}
	if json.Unmarshal([]byte(graph), &v) == nil {
		return len(v.Nodes)
	}
	return 0
}

// SetComfyUIURL points the /comfyui/api/ proxy at a ComfyUI server.
func (s *Server) SetComfyUIURL(u string) {
	s.comfyUI = strings.TrimRight(strings.TrimSpace(u), "/")
}

func (s *Server) registerComfyRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/comfy/status", s.handleComfyStatus)
	mux.HandleFunc("/api/comfy/workflows", s.handleComfyWorkflows)
	mux.HandleFunc("/api/comfy/workflows/", s.handleComfyWorkflowOp)

	if s.comfyUI == "" {
		return
	}
	target, err := url.Parse(s.comfyUI)
	if err != nil || target.Host == "" {
		log.Printf("comfyui: invalid URL %q, API proxy disabled", s.comfyUI)
		return
	}
	mux.Handle("/comfyui/api/", s.comfyProxy(target))
	// /comfyui/api (no trailing slash) is a common typo; keep it useful.
	mux.HandleFunc("/comfyui/api", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, r.URL.Path+"/", http.StatusPermanentRedirect)
	})
}

// comfyProxy forwards the official ComfyUI routes unmodified (only the
// /comfyui/api prefix is removed). NewSingleHostReverseProxy handles 101
// Switching Protocols, so /ws keeps working through the same handler.
func (s *Server) comfyProxy(target *url.URL) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(req *http.Request) {
		req.URL.Path = strings.TrimPrefix(req.URL.Path, "/comfyui/api")
		if req.URL.Path == "" {
			req.URL.Path = "/"
		}
		director(req)
		req.Host = target.Host
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("comfyui proxy %s: %v", r.URL.Path, err)
		http.Error(w, jsonErr("ComfyUI 服务暂不可用，请检查 --comfyui 指向的实例"), http.StatusBadGateway)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := s.requireUser(w, r); !ok {
			return
		}
		proxy.ServeHTTP(w, r)
	})
}

// handleComfyStatus probes the upstream from the server side; the browser does
// not need to know (or be able to reach) the ComfyUI address.
func (s *Server) handleComfyStatus(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	out := map[string]any{"configured": s.comfyUI != "", "reachable": false}
	if s.comfyUI != "" {
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Get(s.comfyUI + "/system_stats")
		if err == nil {
			defer resp.Body.Close()
			var stats map[string]any
			if resp.StatusCode == http.StatusOK && json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&stats) == nil {
				out["reachable"] = true
				out["system_stats"] = stats
			}
		}
	}
	active := map[string]string{}
	for _, kind := range []string{"image", "video"} {
		if a, err := s.st.ActiveComfyWorkflow(u.ID, kind); err == nil && a != nil {
			active[kind] = a.ID
		}
	}
	out["active"] = active
	writeJSON(w, out)
}

func (s *Server) handleComfyWorkflows(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		kind := r.URL.Query().Get("kind")
		if kind != "" && !comfyKinds[kind] {
			http.Error(w, jsonErr("未知的工作台类型"), http.StatusBadRequest)
			return
		}
		list, err := s.st.ComfyWorkflows(u.ID, kind)
		if err != nil {
			s.deny(w, 500, "读取工作流失败", "comfy workflows list", err)
			return
		}
		views := make([]comfyWorkflowView, 0, len(list))
		for _, item := range list {
			views = append(views, viewComfyWorkflow(item))
		}
		writeJSON(w, map[string]any{"workflows": views})
	case http.MethodPost:
		s.saveComfyWorkflow(w, r, u, "")
	default:
		http.Error(w, "GET/POST only", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleComfyWorkflowOp(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api/comfy/workflows/")
	id, action, _ := strings.Cut(rest, "/")
	if id == "" {
		http.NotFound(w, r)
		return
	}
	if action == "activate" && r.Method == http.MethodPost {
		kind := strings.TrimSpace(r.URL.Query().Get("kind"))
		if !comfyKinds[kind] {
			http.Error(w, jsonErr("未知的工作台类型"), http.StatusBadRequest)
			return
		}
		ok, err := s.st.ActivateComfyWorkflow(id, u.ID, kind)
		if err != nil {
			s.deny(w, 500, "部署失败", "comfy workflow activate", err)
			return
		}
		if !ok {
			http.Error(w, jsonErr("工作流不存在或不属于你"), http.StatusNotFound)
			return
		}
		writeJSON(w, map[string]any{"ok": true, "id": id})
		return
	}
	if action != "" {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet:
		item, err := s.st.ComfyWorkflow(id, u.ID)
		if err != nil {
			s.deny(w, 500, "读取工作流失败", "comfy workflow get", err)
			return
		}
		if item == nil {
			http.Error(w, jsonErr("工作流不存在"), http.StatusNotFound)
			return
		}
		writeJSON(w, map[string]any{"workflow": item})
	case http.MethodPut:
		s.saveComfyWorkflow(w, r, u, id)
	case http.MethodDelete:
		ok, err := s.st.DeleteComfyWorkflow(id, u.ID)
		if err != nil {
			s.deny(w, 500, "删除失败", "comfy workflow delete", err)
			return
		}
		if !ok {
			http.Error(w, jsonErr("工作流不存在或不属于你"), http.StatusNotFound)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
	default:
		http.Error(w, "GET/PUT/DELETE only", http.StatusMethodNotAllowed)
	}
}

type comfySaveRequest struct {
	ID     string          `json:"id"`
	Name   string          `json:"name"`
	Kind   string          `json:"kind"`
	Scope  string          `json:"scope"`
	Graph  json.RawMessage `json:"graph"`
	Active bool            `json:"active"`
}

func (s *Server) saveComfyWorkflow(w http.ResponseWriter, r *http.Request, u *store.User, forcedID string) {
	r.Body = http.MaxBytesReader(w, r.Body, maxComfyWorkflowBytes+(64<<10))
	var req comfySaveRequest
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&req); err != nil {
		http.Error(w, jsonErr("工作流 JSON 解析失败"), http.StatusBadRequest)
		return
	}
	if forcedID != "" {
		req.ID = forcedID
	}
	if req.ID == "" {
		req.ID = newID()
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len([]rune(req.Name)) > 80 {
		http.Error(w, jsonErr("名称需为 1–80 个字符"), http.StatusBadRequest)
		return
	}
	if !comfyKinds[req.Kind] {
		http.Error(w, jsonErr("未知的工作台类型"), http.StatusBadRequest)
		return
	}
	if !comfyScopes[req.Scope] {
		http.Error(w, jsonErr("未知的保存位置"), http.StatusBadRequest)
		return
	}
	if !validComfyGraph(req.Graph) {
		http.Error(w, jsonErr("不是有效的 ComfyUI 工作流 JSON（需要 nodes/links 或 class_type）"), http.StatusBadRequest)
		return
	}
	graph := string(bytes.TrimSpace(req.Graph))
	wf := &store.ComfyWorkflow{
		ID: req.ID, UserID: u.ID, Kind: req.Kind, Scope: req.Scope,
		Name: req.Name, Graph: graph,
	}
	if req.Active {
		wf.Active = 1
	}
	ok, err := s.st.PutComfyWorkflow(wf)
	if err != nil {
		s.deny(w, 500, "保存失败", "comfy workflow save", err)
		return
	}
	if !ok {
		http.Error(w, jsonErr("工作流不存在或不属于你"), http.StatusNotFound)
		return
	}
	if req.Active {
		if _, err := s.st.ActivateComfyWorkflow(wf.ID, u.ID, wf.Kind); err != nil {
			s.deny(w, 500, "部署失败", "comfy workflow activate", err)
			return
		}
	}
	writeJSON(w, map[string]any{"workflow": viewComfyWorkflow(wf)})
}

// validComfyGraph accepts both formats ComfyUI itself writes:
//   - UI format: {"nodes":[...],"links":[...],...} (also inside a "workflow" key)
//   - API format: {"3":{"class_type":"KSampler","inputs":{...}},...}
func validComfyGraph(raw json.RawMessage) bool {
	if len(raw) == 0 || len(raw) > maxComfyWorkflowBytes {
		return false
	}
	var v map[string]json.RawMessage
	if json.Unmarshal(raw, &v) != nil || len(v) == 0 {
		return false
	}
	if nested, ok := v["workflow"]; ok && len(v) <= 3 {
		return validComfyGraph(nested)
	}
	if nodes, ok := v["nodes"]; ok {
		var arr []json.RawMessage
		return json.Unmarshal(nodes, &arr) == nil
	}
	for _, body := range v {
		var node struct {
			ClassType string `json:"class_type"`
		}
		if json.Unmarshal(body, &node) == nil && node.ClassType != "" {
			return true
		}
	}
	return false
}
