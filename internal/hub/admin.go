package hub

// 独立管理控制台认证面：/api/admin/*。
// 与用户会话（starstack_session）完全隔离：管理口令来自 STARSTACK_ADMIN_PASSWORD，
// 登录签发独立 admin token（Bearer 或 starstack_admin cookie），24h 过期。
// 鉴权通过后以平台账户身份代理到既有 /api/* handler，并对节点 owner 门控豁免，
// 使管理员可查看/调拨全量算力节点；上游（API 池）仍按平台账户 ownership 管理。

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"os"
	"strings"
	"time"

	"starstack/internal/store"
)

type adminCtxKey struct{}
type adminUserCtxKey struct{}

const adminCookie = "starstack_admin"
const adminTTL = 24 * time.Hour

func (s *Server) adminPassword() string { return os.Getenv("STARSTACK_ADMIN_PASSWORD") }

func (s *Server) isAdminReq(r *http.Request) bool {
	v, _ := r.Context().Value(adminCtxKey{}).(bool)
	return v
}

func (s *Server) adminToken(r *http.Request) string {
	if a := r.Header.Get("Authorization"); strings.HasPrefix(a, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(a, "Bearer "))
	}
	if c, err := r.Cookie(adminCookie); err == nil {
		return c.Value
	}
	return ""
}

func (s *Server) adminSessionValid(tok string) bool {
	if tok == "" {
		return false
	}
	s.adminMu.Lock()
	defer s.adminMu.Unlock()
	exp, ok := s.adminSessions[tok]
	if !ok {
		return false
	}
	if time.Now().After(exp) {
		delete(s.adminSessions, tok)
		return false
	}
	return true
}

func (s *Server) platformUser() *store.User {
	if s.platformOwnerID != "" {
		if u, err := s.st.User(s.platformOwnerID); err == nil {
			return u
		}
	}
	if s.platformOwnerName != "" {
		if u, err := s.st.UserByName(s.platformOwnerName); err == nil {
			return u
		}
	}
	return nil
}

func (s *Server) handleAdmin(w http.ResponseWriter, r *http.Request) {
	p := strings.TrimPrefix(r.URL.Path, "/api/admin")
	switch {
	case p == "/login" && r.Method == http.MethodPost:
		pw := s.adminPassword()
		if pw == "" {
			http.Error(w, jsonErr("未配置管理口令 STARSTACK_ADMIN_PASSWORD"), http.StatusServiceUnavailable)
			return
		}
		var req struct {
			Password string `json:"password"`
		}
		if err := decodeJSON(r, &req); err != nil {
			http.Error(w, jsonErr("请求格式错误"), http.StatusBadRequest)
			return
		}
		if subtle.ConstantTimeCompare([]byte(req.Password), []byte(pw)) != 1 {
			http.Error(w, jsonErr("管理口令错误"), http.StatusUnauthorized)
			return
		}
		b := make([]byte, 24)
		rand.Read(b)
		tok := "adm-" + hex.EncodeToString(b)
		s.adminMu.Lock()
		if s.adminSessions == nil {
			s.adminSessions = map[string]time.Time{}
		}
		s.adminSessions[tok] = time.Now().Add(adminTTL)
		s.adminMu.Unlock()
		http.SetCookie(w, &http.Cookie{
			Name: adminCookie, Value: tok, Path: s.cookiePath(), HttpOnly: true,
			Secure: s.policy.secureCookie, SameSite: http.SameSiteLaxMode, MaxAge: int(adminTTL.Seconds()),
		})
		writeJSON(w, map[string]any{"token": tok, "expires_in_sec": int(adminTTL.Seconds())})
	case p == "/logout":
		tok := s.adminToken(r)
		s.adminMu.Lock()
		delete(s.adminSessions, tok)
		s.adminMu.Unlock()
		http.SetCookie(w, &http.Cookie{Name: adminCookie, Value: "", Path: s.cookiePath(), MaxAge: -1})
		writeJSON(w, map[string]any{"ok": true})
	case p == "/me":
		if !s.adminSessionValid(s.adminToken(r)) {
			http.Error(w, jsonErr("管理会话无效"), http.StatusUnauthorized)
			return
		}
		writeJSON(w, map[string]any{"signed_in": true, "admin": true, "name": "平台管理员"})
	default:
		if !s.adminSessionValid(s.adminToken(r)) {
			http.Error(w, jsonErr("管理会话无效或已过期"), http.StatusUnauthorized)
			return
		}
		pu := s.platformUser()
		if pu == nil {
			http.Error(w, jsonErr("未配置平台账户，无法代理管理操作"), http.StatusServiceUnavailable)
			return
		}
		ctx := context.WithValue(r.Context(), adminCtxKey{}, true)
		ctx = context.WithValue(ctx, adminUserCtxKey{}, pu)
		r2 := r.Clone(ctx)
		r2.URL.Path = "/api" + p
		s.apiMux.ServeHTTP(w, r2)
	}
}
