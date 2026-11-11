package hub

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testGraph = `{"last_node_id":3,"last_link_id":1,"nodes":[
 {"id":1,"type":"CheckpointLoaderSimple","pos":[0,0],"size":[220,100],"inputs":[],"outputs":[{"name":"MODEL","type":"MODEL","links":[1]}],"widgets_values":["v1-5.safetensors"]},
 {"id":2,"type":"CLIPTextEncode","pos":[300,0],"size":[220,100],"inputs":[{"name":"clip","type":"CLIP","link":null}],"outputs":[{"name":"CONDITIONING","type":"CONDITIONING","links":[]}],"widgets_values":["a cat"]},
 {"id":3,"type":"SaveImage","pos":[600,0],"size":[220,100],"inputs":[{"name":"images","type":"IMAGE","link":1}],"outputs":[],"widgets_values":["out"]}
],"links":[[1,1,0,3,0,"MODEL"]],"groups":[],"version":0.4}`

func comfyReq(t *testing.T, s *Server, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	s.Handlers().ServeHTTP(rec, r)
	return rec
}

func TestComfyWorkflowCRUD(t *testing.T) {
	s := newTestServer(t, Policy{})
	alice := asUser(t, s, "alice")
	bob := asUser(t, s, "bob")

	if rec := comfyReq(t, s, "GET", "/api/comfy/status", "", nil); rec.Code != 401 {
		t.Fatalf("anonymous status should be 401, got %d", rec.Code)
	}

	payload := `{"name":"我的生图流程","kind":"image","scope":"preset","graph":` + testGraph + `}`
	rec := comfyReq(t, s, "POST", "/api/comfy/workflows", payload, alice)
	if rec.Code != 200 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Workflow struct {
			ID    string `json:"id"`
			Nodes int    `json:"nodes"`
		} `json:"workflow"`
	}
	json.Unmarshal(rec.Body.Bytes(), &created)
	if created.Workflow.ID == "" || created.Workflow.Nodes != 3 {
		t.Fatalf("bad create response: %s", rec.Body.String())
	}
	id := created.Workflow.ID

	rec = comfyReq(t, s, "GET", "/api/comfy/workflows?kind=image", "", alice)
	var list struct {
		Workflows []struct {
			ID     string `json:"id"`
			Active bool   `json:"active"`
		} `json:"workflows"`
	}
	json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Workflows) != 1 || list.Workflows[0].ID != id {
		t.Fatalf("list: %s", rec.Body.String())
	}

	rec = comfyReq(t, s, "GET", "/api/comfy/workflows/"+id, "", alice)
	var full struct {
		Workflow struct {
			Graph string `json:"graph"`
		} `json:"workflow"`
	}
	json.Unmarshal(rec.Body.Bytes(), &full)
	if !strings.Contains(full.Workflow.Graph, "CheckpointLoaderSimple") {
		t.Fatalf("graph not returned verbatim: %s", rec.Body.String())
	}

	// 部署为生图版块默认工作流，状态接口应报告 active。
	rec = comfyReq(t, s, "POST", "/api/comfy/workflows/"+id+"/activate?kind=image", "{}", alice)
	if rec.Code != 200 {
		t.Fatalf("activate: %d %s", rec.Code, rec.Body.String())
	}
	rec = comfyReq(t, s, "GET", "/api/comfy/status", "", alice)
	var status struct {
		Configured bool              `json:"configured"`
		Active     map[string]string `json:"active"`
	}
	json.Unmarshal(rec.Body.Bytes(), &status)
	if status.Active["image"] != id {
		t.Fatalf("active workflow missing: %s", rec.Body.String())
	}

	// 别人的工作流不可改、不可删。
	if rec := comfyReq(t, s, "DELETE", "/api/comfy/workflows/"+id, "", bob); rec.Code != 404 {
		t.Fatalf("cross-user delete should be 404, got %d", rec.Code)
	}
	if rec := comfyReq(t, s, "POST", "/api/comfy/workflows", `{"name":"坏图","kind":"image","scope":"draft","graph":{"hello":"world"}}`, alice); rec.Code != 400 {
		t.Fatalf("invalid graph should be 400, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := comfyReq(t, s, "DELETE", "/api/comfy/workflows/"+id, "", alice); rec.Code != 200 {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	if rec := comfyReq(t, s, "GET", "/api/comfy/workflows/"+id, "", alice); rec.Code != 404 {
		t.Fatalf("deleted workflow still readable: %d", rec.Code)
	}
}

func TestComfyRoutesAndAssets(t *testing.T) {
	s := newTestServer(t, Policy{})
	s.SetComfyUIURL("http://127.0.0.1:1")
	alice := asUser(t, s, "alice")

	for _, p := range []string{"/assets/comfy.js", "/assets/comfy.css"} {
		rec := comfyReq(t, s, "GET", p, "", nil)
		if rec.Code != 200 || rec.Body.Len() < 1000 {
			t.Fatalf("asset %s: %d (%d bytes)", p, rec.Code, rec.Body.Len())
		}
	}
	if rec := comfyReq(t, s, "GET", "/assets/../go.mod", "", nil); rec.Code == 200 {
		t.Fatal("directory traversal must not be served")
	}

	// 官方 API 代理必须复用平台会话；未登录直接 401，登录后才转发到上游。
	if rec := comfyReq(t, s, "GET", "/comfyui/api/object_info", "", nil); rec.Code != 401 {
		t.Fatalf("anonymous proxy should be 401, got %d", rec.Code)
	}
	if rec := comfyReq(t, s, "GET", "/comfyui/api/object_info", "", alice); rec.Code == 401 {
		t.Fatal("authenticated proxy should pass the auth guard")
	}
}
