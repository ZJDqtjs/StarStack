package hub

// 第三方账号授权登录（OAuth 2.0 授权码流程）。
//
// 设计取舍：
//   - 只用授权码 + state Cookie，不碰隐式流程，也不在浏览器里放 access_token；
//   - 平台账号是第一身份，第三方身份只是「一把可以开这扇门的钥匙」。所以同一
//     个账号能绑 GitHub 与 Gitee，解绑任何一个都不会丢账号；
//   - 只有第三方明确声明「这个邮箱已验证」时，才允许按邮箱自动并入既有账号；
//     否则一律新建账号。少了这一条，任何人只要在第三方填上别人的邮箱，就能
//     接管那个人的账户；
//   - 新账号的名是从第三方昵称推出来的，重名自动加后缀，不覆盖既有账号。

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"starstack/internal/auth"
	"starstack/internal/store"
)

const (
	oauthStateCookie = "starstack_oauth"
	oauthStateTTL    = 10 * time.Minute
)

type oauthProvider struct {
	ID    string
	Label string
	// AuthURL/TokenURL/UserURL are the provider's three fixed endpoints.
	AuthURL, TokenURL, UserURL, Scope string
	// Field names in the userinfo JSON. Providers disagree, so they are data.
	IDField, LoginField, NameField, EmailField, VerifiedField string
	// EmailsURL is GitHub's separate endpoint: /user hides the address unless it
	// is public, while /user/emails returns primary+verified flags.
	EmailsURL string

	ClientID, ClientSecret string
}

// oauthTable lists the providers this build knows how to talk to. Adding another
// one is a row here plus two environment variables, no new code path.
func oauthTable() []oauthProvider {
	return []oauthProvider{
		{
			ID: "github", Label: "GitHub",
			AuthURL:  "https://github.com/login/oauth/authorize",
			TokenURL: "https://github.com/login/oauth/access_token",
			UserURL:  "https://api.github.com/user",
			Scope:    "read:user user:email",
			IDField:  "id", LoginField: "login", NameField: "name", EmailField: "email",
			EmailsURL: "https://api.github.com/user/emails",
		},
		{
			ID: "gitee", Label: "Gitee",
			AuthURL:  "https://gitee.com/oauth/authorize",
			TokenURL: "https://gitee.com/oauth/token",
			UserURL:  "https://gitee.com/api/v5/user",
			Scope:    "user_info emails",
			IDField:  "id", LoginField: "login", NameField: "name", EmailField: "email",
		},
		{
			ID: "google", Label: "Google",
			AuthURL:  "https://accounts.google.com/o/oauth2/v2/auth",
			TokenURL: "https://oauth2.googleapis.com/token",
			UserURL:  "https://openidconnect.googleapis.com/v1/userinfo",
			Scope:    "openid email profile",
			IDField:  "sub", LoginField: "email", NameField: "name", EmailField: "email",
			VerifiedField: "email_verified",
		},
	}
}

// oauthConfig is the resolved set of enabled providers, read once at startup.
type oauthConfig struct {
	providers map[string]*oauthProvider
	order     []string
	redirect  string // template with {provider}
	signup    bool   // may a first-time third-party visitor get an account
	client    *http.Client
}

// loadOAuthConfig resolves the enabled providers. requireInvite mirrors the
// broker's own signup gate: a deployment that hands out invite codes did not
// mean "anyone with a GitHub account may create an account instead", so
// third-party signup stays off until STARSTACK_OAUTH_SIGNUP says otherwise.
// Logging in and binding an existing account keep working either way.
func loadOAuthConfig(baseURL string, requireInvite bool) *oauthConfig {
	cfg := &oauthConfig{
		providers: map[string]*oauthProvider{},
		client:    &http.Client{Timeout: 12 * time.Second},
		signup:    true,
	}
	for _, p := range oauthTable() {
		p := p
		up := "STARSTACK_OAUTH_" + strings.ToUpper(p.ID)
		p.ClientID = strings.TrimSpace(os.Getenv(up + "_CLIENT_ID"))
		p.ClientSecret = strings.TrimSpace(os.Getenv(up + "_CLIENT_SECRET"))
		if p.ClientID == "" || p.ClientSecret == "" {
			continue
		}
		cfg.providers[p.ID] = &p
		cfg.order = append(cfg.order, p.ID)
	}
	if len(cfg.providers) == 0 {
		return cfg
	}
	cfg.redirect = strings.TrimSpace(os.Getenv("STARSTACK_OAUTH_REDIRECT_URL"))
	if cfg.redirect == "" {
		cfg.redirect = strings.TrimRight(baseURL, "/") + "/api/auth/oauth/{provider}/callback"
	}
	if v := strings.TrimSpace(os.Getenv("STARSTACK_OAUTH_SIGNUP")); v != "" {
		cfg.signup = !(v == "0" || strings.EqualFold(v, "false") || strings.EqualFold(v, "no"))
	} else if requireInvite {
		cfg.signup = false
	}
	for _, id := range cfg.order {
		log.Printf("oauth: %s 已启用，回跳地址 %s", cfg.providers[id].Label, cfg.redirectFor(id))
	}
	if u, err := url.Parse(cfg.redirectFor(cfg.order[0])); err == nil {
		switch u.Hostname() {
		case "127.0.0.1", "localhost", "::1":
			log.Printf("警告：回跳地址指向本机 %s，公网访客授权后会被跳回自己的机器；"+
				"请用 --base-url 或 STARSTACK_OAUTH_REDIRECT_URL 指定对外地址", u.Host)
		}
	}
	log.Printf("提示：请把上面的回跳地址原样登记到各平台的 OAuth 应用里，否则授权后会被拒绝")
	return cfg
}

func (c *oauthConfig) redirectFor(provider string) string {
	return strings.ReplaceAll(c.redirect, "{provider}", provider)
}

func (s *Server) oauthProvider(id string) *oauthProvider {
	if s.oauth == nil {
		return nil
	}
	return s.oauth.providers[id]
}

// oauthProvidersView is what the login page needs: which buttons to show.
func (s *Server) oauthProvidersView() []map[string]any {
	out := []map[string]any{}
	if s.oauth == nil {
		return out
	}
	for _, id := range s.oauth.order {
		p := s.oauth.providers[id]
		out = append(out, map[string]any{"id": p.ID, "label": p.Label})
	}
	return out
}

// ---- state cookie ----

type oauthState struct {
	State    string `json:"s"`
	Provider string `json:"p"`
	// Bind carries the account id when the flow was started from 设置 → 绑定;
	// empty means "log the visitor in".
	Bind string `json:"b,omitempty"`
	Next string `json:"n,omitempty"`
	Exp  int64  `json:"e"`
}

func (s *Server) setOAuthState(w http.ResponseWriter, st oauthState) {
	raw, _ := json.Marshal(st)
	http.SetCookie(w, &http.Cookie{
		Name: oauthStateCookie, Value: base64.RawURLEncoding.EncodeToString(raw),
		Path: s.cookiePath(), HttpOnly: true, Secure: s.policy.secureCookie,
		SameSite: http.SameSiteLaxMode, MaxAge: int(oauthStateTTL.Seconds()),
		Expires: time.Now().Add(oauthStateTTL),
	})
}

func (s *Server) takeOAuthState(w http.ResponseWriter, r *http.Request) (oauthState, error) {
	c, err := r.Cookie(oauthStateCookie)
	// One-shot: the cookie is cleared whether or not the state matched, so a
	// replayed callback URL cannot be used twice.
	http.SetCookie(w, &http.Cookie{Name: oauthStateCookie, Value: "", Path: s.cookiePath(),
		MaxAge: -1, Expires: time.Unix(0, 0), HttpOnly: true,
		Secure: s.policy.secureCookie, SameSite: http.SameSiteLaxMode})
	if err != nil || c.Value == "" {
		return oauthState{}, errors.New("授权状态已失效，请重新点击登录按钮")
	}
	raw, err := base64.RawURLEncoding.DecodeString(c.Value)
	if err != nil {
		return oauthState{}, errors.New("授权状态无法识别，请重试")
	}
	var st oauthState
	if err := json.Unmarshal(raw, &st); err != nil {
		return oauthState{}, errors.New("授权状态无法识别，请重试")
	}
	if st.Exp < time.Now().Unix() {
		return oauthState{}, errors.New("授权超时，请重新点击登录按钮")
	}
	return st, nil
}

// safeNext keeps the post-login redirect on this site. "//evil.com" is a
// protocol-relative URL, which browsers happily treat as another origin.
func safeNext(v string) string {
	v = strings.TrimSpace(v)
	if v == "" || !strings.HasPrefix(v, "/") || strings.HasPrefix(v, "//") ||
		strings.ContainsAny(v, "\\\r\n") {
		return "/"
	}
	return v
}

// ---- start / callback ----

func (s *Server) handleOAuth(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/auth/oauth/")
	parts := strings.Split(strings.Trim(rest, "/"), "/")
	if len(parts) != 2 {
		http.NotFound(w, r)
		return
	}
	prov := s.oauthProvider(parts[0])
	if prov == nil {
		http.NotFound(w, r)
		return
	}
	switch parts[1] {
	case "start":
		s.startOAuth(w, r, prov)
	case "callback":
		s.finishOAuth(w, r, prov)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) startOAuth(w http.ResponseWriter, r *http.Request, prov *oauthProvider) {
	if !s.authAllowed(w, r) {
		return
	}
	bind := ""
	if r.URL.Query().Get("bind") != "" {
		u := s.currentUser(r)
		if u == nil {
			http.Error(w, jsonErr("请先登录再绑定第三方账号"), http.StatusUnauthorized)
			return
		}
		bind = u.ID
	}
	st := oauthState{
		State: auth.RandomHex(20), Provider: prov.ID, Bind: bind,
		Next: safeNext(r.URL.Query().Get("next")),
		Exp:  time.Now().Add(oauthStateTTL).Unix(),
	}
	s.setOAuthState(w, st)
	q := url.Values{}
	q.Set("client_id", prov.ClientID)
	q.Set("redirect_uri", s.oauth.redirectFor(prov.ID))
	q.Set("response_type", "code")
	q.Set("scope", prov.Scope)
	q.Set("state", st.State)
	http.Redirect(w, r, prov.AuthURL+"?"+q.Encode(), http.StatusFound)
}

func (s *Server) finishOAuth(w http.ResponseWriter, r *http.Request, prov *oauthProvider) {
	st, err := s.takeOAuthState(w, r)
	if err != nil {
		s.oauthFail(w, r, "/", err.Error())
		return
	}
	if st.Provider != prov.ID {
		s.oauthFail(w, r, st.Next, "授权来源与发起时不一致，请重试")
		return
	}
	q := r.URL.Query()
	if e := q.Get("error"); e != "" {
		if e == "access_denied" {
			s.oauthFail(w, r, st.Next, "你取消了授权")
			return
		}
		s.oauthFail(w, r, st.Next, "第三方授权失败："+clip(q.Get("error_description"), 80))
		return
	}
	code := q.Get("code")
	if code == "" || q.Get("state") != st.State {
		s.oauthFail(w, r, st.Next, "授权回调缺少参数，请重新登录")
		return
	}
	prof, err := s.fetchOAuthProfile(prov, code)
	if err != nil {
		log.Printf("oauth %s profile: %v", prov.ID, err)
		s.oauthFail(w, r, st.Next, "读取第三方账号信息失败，请重试")
		return
	}
	if st.Bind != "" {
		s.bindOAuth(w, r, prov, prof, st)
		return
	}
	s.loginOAuth(w, r, prov, prof, st)
}

func (s *Server) bindOAuth(w http.ResponseWriter, r *http.Request, prov *oauthProvider, prof oauthProfile, st oauthState) {
	if _, err := s.st.User(st.Bind); err != nil {
		s.oauthFail(w, r, st.Next, "发起绑定的账号已不存在")
		return
	}
	if other, err := s.st.OAuthIdentity(prov.ID, prof.Subject); err == nil && other.UserID != st.Bind {
		s.oauthFail(w, r, st.Next, "这个 "+prov.Label+" 账号已经绑定在其它星栈账号上")
		return
	}
	if err := s.st.CreateOAuthIdentity(&store.OAuthIdentity{
		Provider: prov.ID, Subject: prof.Subject, UserID: st.Bind,
		Login: prof.Login, Email: prof.Email,
	}); err != nil {
		log.Printf("oauth bind %s: %v", prov.ID, err)
		s.oauthFail(w, r, st.Next, "绑定失败，请稍后重试")
		return
	}
	log.Printf("user %s bound %s (%s)", st.Bind, prov.ID, prof.Login)
	s.oauthRedirect(w, r, st.Next, "")
}

func (s *Server) loginOAuth(w http.ResponseWriter, r *http.Request, prov *oauthProvider, prof oauthProfile, st oauthState) {
	var u *store.User
	ident, err := s.st.OAuthIdentity(prov.ID, prof.Subject)
	if err == nil {
		u, _ = s.st.User(ident.UserID)
		if u == nil {
			// The account behind this identity is gone. Drop the dangling row and
			// fall through to the normal "create or link" path.
			s.st.DeleteOAuthIdentityBySubject(prov.ID, prof.Subject)
		}
	}
	if u == nil && prof.EmailVerified && prof.Email != "" {
		// Only a provider-verified address may merge into an existing account.
		if other, err := s.st.UserByEmail(prof.Email); err == nil {
			u = other
		}
	}
	if u == nil {
		if !prof.EmailVerified || prof.Email == "" {
			// 邮箱就是账号，所以没有「已验证邮箱」的第三方身份既不能建号也不能
			// 并入别人的号：否则它既没有一个可用来找回的地址，也无法证明归属。
			s.oauthFail(w, r, st.Next, prov.Label+" 没有返回已验证的邮箱。请先在 "+
				prov.Label+" 里验证主邮箱再登录；也可以先用邮箱注册，再到「设置」里绑定 "+prov.Label+"。")
			return
		}
		if s.oauth == nil || !s.oauth.signup {
			s.oauthFail(w, r, st.Next, "本站未开放第三方注册，请先用邮箱注册，再到「设置」里绑定")
			return
		}
		created, err := s.createOAuthUser(prof)
		if err != nil {
			log.Printf("oauth create user (%s): %v", prov.ID, err)
			s.oauthFail(w, r, st.Next, "创建账号失败，请稍后重试")
			return
		}
		u = created
		log.Printf("user %s created via %s (%s)", u.Name, prov.ID, prof.Login)
	}
	// Keep the snapshot fresh: a rename at GitHub should be visible in the
	// console without asking the user to re-authorise.
	if err := s.st.CreateOAuthIdentity(&store.OAuthIdentity{
		Provider: prov.ID, Subject: prof.Subject, UserID: u.ID,
		Login: prof.Login, Email: prof.Email,
	}); err != nil {
		log.Printf("oauth link %s: %v", prov.ID, err)
	}
	// 老账号（这次改造之前用用户名注册、没有邮箱的）第一次用第三方登录时补上
	// 邮箱。已有邮箱的账号不覆盖：那是他自己的登录标识，换成第三方那边的地址会
	// 让原来记着旧邮箱的人登不进来。
	if u.Email == "" && prof.EmailVerified && prof.Email != "" {
		if s.emailTakenByOther(prof.Email, u.ID) == nil {
			if err := s.st.SetUserEmail(u.ID, prof.Email, true); err != nil {
				log.Printf("oauth email %s: %v", u.ID, err)
			}
		} else {
			log.Printf("oauth email %s: %q already belongs to another account; kept empty", u.ID, prof.Email)
		}
	}
	if _, err := s.startSession(w, r, u); err != nil {
		s.oauthFail(w, r, st.Next, "会话创建失败，请重试")
		return
	}
	log.Printf("user %s logged in via %s", u.Name, prov.ID)
	s.oauthRedirect(w, r, st.Next, "")
}

func (s *Server) oauthRedirect(w http.ResponseWriter, r *http.Request, next, errMsg string) {
	next = safeNext(next)
	u, _ := url.Parse(next)
	q := u.Query()
	if errMsg != "" {
		q.Set("oauth_error", errMsg)
	}
	u.RawQuery = q.Encode()
	if u.Path == "" {
		u.Path = "/"
	}
	http.Redirect(w, r, u.String(), http.StatusFound)
}

func (s *Server) oauthFail(w http.ResponseWriter, r *http.Request, next, msg string) {
	s.oauthRedirect(w, r, next, msg)
}

// ---- provider calls ----

type oauthProfile struct {
	Subject       string
	Login         string
	Name          string
	Email         string
	EmailVerified bool
}

func (s *Server) fetchOAuthProfile(p *oauthProvider, code string) (oauthProfile, error) {
	tok, err := s.exchangeOAuthCode(p, code)
	if err != nil {
		return oauthProfile{}, err
	}
	raw, err := s.oauthGET(p.UserURL, tok)
	if err != nil {
		return oauthProfile{}, err
	}
	return s.profileFromJSON(p, raw, tok)
}

func (s *Server) exchangeOAuthCode(p *oauthProvider, code string) (string, error) {
	form := url.Values{}
	form.Set("client_id", p.ClientID)
	form.Set("client_secret", p.ClientSecret)
	form.Set("code", code)
	form.Set("grant_type", "authorization_code")
	form.Set("redirect_uri", s.oauth.redirectFor(p.ID))
	req, err := http.NewRequest(http.MethodPost, p.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	res, err := s.oauth.client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", err
	}
	var out struct {
		AccessToken      string `json:"access_token"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", errors.New("token 响应无法解析")
	}
	if out.AccessToken == "" {
		msg := out.ErrorDescription
		if msg == "" {
			msg = out.Error
		}
		if msg == "" {
			msg = "HTTP " + strconv.Itoa(res.StatusCode)
		}
		return "", errors.New("换取 token 失败：" + msg)
	}
	return out.AccessToken, nil
}

func (s *Server) oauthGET(u, token string) (map[string]any, error) {
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "starstack-broker")
	res, err := s.oauth.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, errors.New("userinfo HTTP " + strconv.Itoa(res.StatusCode))
	}
	var m map[string]any
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&m); err != nil {
		return nil, err
	}
	return m, nil
}

func oauthStr(m map[string]any, key string) string {
	if key == "" {
		return ""
	}
	switch v := m[key].(type) {
	case string:
		return strings.TrimSpace(v)
	case float64:
		return strconv.FormatInt(int64(v), 10)
	case json.Number:
		return v.String()
	case bool:
		if v {
			return "1"
		}
	}
	return ""
}

func (s *Server) profileFromJSON(p *oauthProvider, m map[string]any, token string) (oauthProfile, error) {
	prof := oauthProfile{
		Subject: oauthStr(m, p.IDField),
		Login:   oauthStr(m, p.LoginField),
		Name:    oauthStr(m, p.NameField),
		Email:   strings.ToLower(oauthStr(m, p.EmailField)),
	}
	if prof.Subject == "" {
		return prof, errors.New("响应里没有账号 id")
	}
	if p.VerifiedField != "" {
		switch v := m[p.VerifiedField].(type) {
		case bool:
			prof.EmailVerified = v
		case string:
			prof.EmailVerified = v == "true" || v == "1"
		}
	}
	if p.EmailsURL != "" && token != "" {
		// GitHub: the public profile may have no address at all. The dedicated
		// endpoint returns every address with primary/verified flags, which is
		// the only trustworthy answer to "does this person own that mailbox".
		if list, err := s.oauthGETList(p.EmailsURL, token); err == nil {
			for _, e := range list {
				addr := strings.ToLower(oauthStr(e, "email"))
				if addr == "" {
					continue
				}
				primary, _ := e["primary"].(bool)
				verified, _ := e["verified"].(bool)
				if verified && (prof.Email == "" || primary) {
					prof.Email = addr
					prof.EmailVerified = true
					if primary {
						break
					}
				}
			}
		}
	}
	if e, err := auth.ValidEmail(prof.Email); err == nil {
		prof.Email = e
	} else {
		prof.Email, prof.EmailVerified = "", false
	}
	return prof, nil
}

func (s *Server) oauthGETList(u, token string) ([]map[string]any, error) {
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "starstack-broker")
	res, err := s.oauth.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, errors.New("list HTTP " + strconv.Itoa(res.StatusCode))
	}
	var list []map[string]any
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&list); err != nil {
		return nil, err
	}
	return list, nil
}

// ---- account creation ----

func (s *Server) createOAuthUser(prof oauthProfile) (*store.User, error) {
	u := &store.User{
		ID: "u" + newID() + newID(), CreatedAt: time.Now().Unix(),
		Name: s.uniqueName(oauthBaseName(prof)),
	}
	if prof.EmailVerified && prof.Email != "" {
		u.Email, u.EmailVerified = prof.Email, true
	}
	if err := s.st.CreateUser(u); err != nil {
		return nil, err
	}
	s.grantSignup(u)
	return u, nil
}

func oauthBaseName(prof oauthProfile) string {
	base := prof.Login
	if base == "" {
		base = prof.Name
	}
	if base == "" && prof.Email != "" {
		base = prof.Email[:strings.IndexByte(prof.Email, '@')]
	}
	var b strings.Builder
	for _, r := range base {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '_', r == '-':
			b.WriteRune(r)
		case r == ' ' || r == '.':
			// ValidName does not accept dots: "octo.cat" becomes "octo-cat".
			b.WriteByte('-')
		}
	}
	name := strings.Trim(b.String(), "-._")
	if len([]rune(name)) > 20 {
		name = string([]rune(name)[:20])
	}
	if len([]rune(name)) < 2 {
		name = "user-" + auth.RandomHex(2)
	}
	return name
}

// uniqueName keeps the display name free of collisions: ValidName caps it at 24
// characters, so the suffix is cut before the prefix is. The reserved platform
// account name counts as taken: a mailbox like admin10086@example.com must not
// be able to mint the 官方 账户 by registering.
func (s *Server) uniqueName(base string) string {
	if err := auth.ValidName(base); err != nil {
		base = "user"
	}
	if s.nameFree(base) {
		return base
	}
	for i := 0; i < 20; i++ {
		suffix := "-" + auth.RandomHex(2)
		runes := []rune(base)
		keep := 24 - len([]rune(suffix))
		if len(runes) > keep {
			runes = runes[:keep]
		}
		cand := string(runes) + suffix
		if s.nameFree(cand) {
			return cand
		}
	}
	return "user-" + auth.RandomHex(6)
}

func (s *Server) nameFree(name string) bool {
	if s.platformOwnerName != "" && strings.EqualFold(name, s.platformOwnerName) {
		return false
	}
	_, err := s.st.UserByName(name)
	return err != nil
}

// ---- account endpoints ----

// handleIdentities is GET /api/me/identities: which login methods this account
// has. The settings page uses it to render 绑定/解绑 buttons.
func (s *Server) handleIdentities(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	bound, err := s.st.OAuthIdentitiesByUser(u.ID)
	if err != nil {
		http.Error(w, jsonErr("读取失败"), 500)
		return
	}
	byProvider := map[string]*store.OAuthIdentity{}
	for _, b := range bound {
		byProvider[b.Provider] = b
	}
	list := []map[string]any{}
	for _, id := range s.oauthOrder() {
		p := s.oauth.providers[id]
		item := map[string]any{"id": p.ID, "label": p.Label, "bound": false}
		if b := byProvider[id]; b != nil {
			item["bound"] = true
			item["login"] = b.Login
			item["bound_at"] = b.CreatedAt
		}
		list = append(list, item)
	}
	writeJSON(w, map[string]any{
		"name": u.Name, "email": u.Email, "email_verified": u.EmailVerified,
		"has_password": u.PassHash != "", "providers": list,
		"email_verification": s.mail != nil,
	})
}

func (s *Server) oauthOrder() []string {
	if s.oauth == nil {
		return nil
	}
	return s.oauth.order
}

// handleIdentityOp is DELETE /api/me/identities/{provider}. Refusing to remove
// the last way in is the whole point: an account with no password and no
// identity would be unreachable and its credits stranded.
func (s *Server) handleIdentityOp(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodDelete {
		http.Error(w, jsonErr("只支持 DELETE"), http.StatusMethodNotAllowed)
		return
	}
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/me/identities/"), "/")
	if id == "" {
		http.NotFound(w, r)
		return
	}
	ids, err := s.st.OAuthIdentitiesByUser(u.ID)
	if err != nil {
		http.Error(w, jsonErr("读取失败"), 500)
		return
	}
	found := false
	for _, b := range ids {
		if b.Provider == id {
			found = true
			break
		}
	}
	if !found {
		http.NotFound(w, r)
		return
	}
	if u.PassHash == "" && len(ids) <= 1 {
		http.Error(w, jsonErr("这是账号唯一的登录方式，请先设置口令再解绑"), http.StatusConflict)
		return
	}
	if err := s.st.DeleteOAuthIdentity(u.ID, id); err != nil {
		http.Error(w, jsonErr("解绑失败"), 500)
		return
	}
	log.Printf("user %s unbound %s", u.Name, id)
	writeJSON(w, map[string]any{"ok": true})
}

// handleMyPassword is POST /api/me/password {old, new}. Accounts created through
// a third party have no password yet, so "old" is only required when one exists.
func (s *Server) handleMyPassword(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, jsonErr("只支持 POST"), http.StatusMethodNotAllowed)
		return
	}
	var req struct{ Old, New string }
	if err := decodeJSON(r, &req); err != nil {
		http.Error(w, jsonErr("请求格式错误"), 400)
		return
	}
	if u.PassHash != "" && !auth.Match(req.Old, u.Salt, u.PassHash, u.Iter) {
		http.Error(w, jsonErr("原口令不正确"), http.StatusForbidden)
		return
	}
	if err := auth.ValidPassword(req.New); err != nil {
		http.Error(w, jsonErr(err.Error()), 400)
		return
	}
	salt := auth.NewSalt()
	if err := s.st.SetUserPassword(u.ID, auth.Hash(req.New, salt, auth.Iterations),
		hex.EncodeToString(salt), auth.Iterations); err != nil {
		http.Error(w, jsonErr("保存失败"), 500)
		return
	}
	log.Printf("user %s set a password", u.Name)
	writeJSON(w, map[string]any{"ok": true})
}
