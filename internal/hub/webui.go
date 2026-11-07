package hub

import (
	"bytes"
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

//go:embed web
var webFS embed.FS

var webRoot, _ = fs.Sub(webFS, "web")

// handleIndex serves the zero-build console. The workbench's JS/CSS live in
// web/assets/ and are embedded into the same binary; a reverse proxy may mount
// the console under a prefix, so asset paths are matched by suffix instead of
// by an absolute route.
func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}
	if i := strings.LastIndex(r.URL.Path, "/assets/"); i >= 0 {
		serveWebAsset(w, r, r.URL.Path[i+len("/assets/"):])
		return
	}
	p := r.URL.Path
	if p != "/" && !strings.HasSuffix(p, "/") && !strings.HasSuffix(p, "/index.html") {
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(webRoot, "index.html")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(data))
}

func serveWebAsset(w http.ResponseWriter, r *http.Request, name string) {
	name = strings.TrimPrefix(path.Clean("/"+name), "/")
	if name == "" || strings.Contains(name, "/") {
		http.NotFound(w, r)
		return
	}
	var ctype string
	switch {
	case strings.HasSuffix(name, ".js"):
		ctype = "text/javascript; charset=utf-8"
	case strings.HasSuffix(name, ".css"):
		ctype = "text/css; charset=utf-8"
	default:
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(webRoot, "assets/"+name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "public, max-age=300")
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}
