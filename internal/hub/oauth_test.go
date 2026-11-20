package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

var noRedirect = &http.Client{
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// fakeOAuth stands in for the provider's token and userinfo endpoints. It is a
// real HTTP server on purpose: the handler under test must exercise its own
// request building, not a mocked function.
func fakeOAuth(t *testing.T, user map[string]any, emails []map[string]any) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if r.Form.Get("code") != "good" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"error":"bad_verification_code","error_description":"code is wrong"}`))
			return
		}
		if r.Form.Get("client_secret") != "sec" || r.Form.Get("redirect_uri") == "" {
			w.Write([]byte(`{"error":"invalid_client"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"access_token":"tok","token_type":"bearer"}`))
	})
	mux.HandleFunc("/user", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(user)
	})
	mux.HandleFunc("/emails", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(emails)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func testProvider(srv *httptest.Server, id string, verifiedField, emailsPath string) *oauthProvider {
	p := &oauthProvider{
		ID: id, Label: id,
		AuthURL: srv.URL + "/authorize", TokenURL: srv.URL + "/token", UserURL: srv.URL + "/user",
		Scope: "test", IDField: "id", LoginField: "login", NameField: "name", EmailField: "email",
		ClientID: "cid", ClientSecret: "sec", VerifiedField: verifiedField,
	}
	if emailsPath != "" {
		p.EmailsURL = srv.URL + emailsPath
	}
	return p
}

func (s *Server) useTestOAuth(p *oauthProvider) {
	s.oauth = &oauthConfig{
		providers: map[string]*oauthProvider{p.ID: p},
		order:     []string{p.ID},
		redirect:  "http://broker.test/api/auth/oauth/{provider}/callback",
		signup:    true,
		client:    &http.Client{Timeout: 10 * time.Second},
	}
}

// oauthLogin runs start+callback against a live handler and returns the session
// cookie the callback set (nil when the flow refused the visitor).
func oauthLogin(t *testing.T, ts *httptest.Server, providerID, bindCookie string) *http.Cookie {
	t.Helper()
	startURL := ts.URL + "/api/auth/oauth/" + providerID + "/start"
	if bindCookie != "" {
		startURL += "?bind=1"
	}
	req, _ := http.NewRequest("GET", startURL, nil)
	if bindCookie != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: bindCookie})
	}
	res, err := noRedirect.Do(req)
	if err != nil {
		t.Fatalf("oauth start: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusFound {
		t.Fatalf("oauth start: HTTP %d", res.StatusCode)
	}
	loc, err := url.Parse(res.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if loc.Query().Get("client_id") != "cid" || loc.Query().Get("state") == "" {
		t.Fatalf("authorize redirect missing params: %s", loc)
	}
	var stateCookie *http.Cookie
	for _, c := range res.Cookies() {
		if c.Name == oauthStateCookie {
			stateCookie = c
		}
	}
	if stateCookie == nil {
		t.Fatal("start did not set the state cookie")
	}

	cb := ts.URL + "/api/auth/oauth/" + providerID + "/callback?code=good&state=" +
		url.QueryEscape(loc.Query().Get("state"))
	req, _ = http.NewRequest("GET", cb, nil)
	req.AddCookie(stateCookie)
	res, err = noRedirect.Do(req)
	if err != nil {
		t.Fatalf("oauth callback: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusFound {
		t.Fatalf("oauth callback: HTTP %d", res.StatusCode)
	}
	var sess *http.Cookie
	for _, c := range res.Cookies() {
		if c.Name == sessionCookie && c.Value != "" {
			sess = c
		}
	}
	return sess
}

func meID(t *testing.T, ts *httptest.Server, tok string) string {
	t.Helper()
	req, _ := http.NewRequest("GET", ts.URL+"/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	json.NewDecoder(res.Body).Decode(&out)
	id, _ := out["id"].(string)
	return id
}

func TestOAuthLoginCreatesOneAccountPerIdentity(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	srv := fakeOAuth(t, map[string]any{"id": 4242, "login": "octo.cat", "name": "Octo Cat", "email": nil},
		[]map[string]any{{"email": "octo@example.com", "primary": true, "verified": true}})
	s.useTestOAuth(testProvider(srv, "github", "", "/emails"))
	ts := httptest.NewServer(s.Handlers())
	defer ts.Close()

	sess := oauthLogin(t, ts, "github", "")
	if sess == nil {
		t.Fatal("callback did not set a session cookie")
	}
	first := meID(t, ts, sess.Value)
	if first == "" {
		t.Fatal("no account behind the oauth session")
	}

	// Same provider account a second time must land on the same user, not a
	// duplicate: the identity table, not the display name, is the key.
	again := oauthLogin(t, ts, "github", "")
	if got := meID(t, ts, again.Value); got != first {
		t.Fatalf("second oauth login created %s, want %s", got, first)
	}

	u, err := s.st.User(first)
	if err != nil {
		t.Fatal(err)
	}
	if u.Name != "octo-cat" {
		t.Fatalf("display name %q, want the sanitised login octo-cat", u.Name)
	}
	if u.Email != "octo@example.com" || !u.EmailVerified {
		t.Fatalf("verified provider email not stored: %+v", u)
	}
	if u.PassHash != "" {
		t.Fatal("oauth account should not get a fabricated password")
	}
}

func TestOAuthLinksVerifiedEmailButNotUnverified(t *testing.T) {
	// Verified address: an existing account that already proved it owns the
	// mailbox may be entered through the provider.
	s := newTestServer(t, DefaultPolicy())
	srv := fakeOAuth(t, map[string]any{"id": "s-1", "login": "someone", "email": "same@example.com",
		"email_verified": true}, nil)
	s.useTestOAuth(testProvider(srv, "google", "email_verified", ""))
	ts := httptest.NewServer(s.Handlers())
	defer ts.Close()

	body := `{"name":"local-acct","email":"same@example.com","password":"password123"}`
	res, err := http.Post(ts.URL+"/api/auth/register", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	var reg struct{ ID string }
	json.NewDecoder(res.Body).Decode(&reg)
	res.Body.Close()
	if reg.ID == "" {
		t.Fatalf("register failed: HTTP %d", res.StatusCode)
	}

	sess := oauthLogin(t, ts, "google", "")
	if got := meID(t, ts, sess.Value); got != reg.ID {
		t.Fatalf("verified email did not link: got %s want %s", got, reg.ID)
	}

	// Unverified address: the provider only repeats what the user typed, so it
	// must never hand over an existing account.
	s2 := newTestServer(t, DefaultPolicy())
	srv2 := fakeOAuth(t, map[string]any{"id": "s-2", "login": "impostor", "email": "victim@example.com"},
		nil)
	s2.useTestOAuth(testProvider(srv2, "google", "email_verified", ""))
	ts2 := httptest.NewServer(s2.Handlers())
	defer ts2.Close()

	body = `{"name":"victim","email":"victim@example.com","password":"password123"}`
	res, err = http.Post(ts2.URL+"/api/auth/register", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	sess2 := oauthLogin(t, ts2, "google", "")
	victim, _ := s2.st.UserByName("victim")
	if got := meID(t, ts2, sess2.Value); got == victim.ID {
		t.Fatal("an unverified provider email took over an existing account")
	}
}

func TestOAuthBindAndUnbind(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	srv := fakeOAuth(t, map[string]any{"id": "b-1", "login": "binder", "email": ""}, nil)
	s.useTestOAuth(testProvider(srv, "github", "", ""))
	ts := httptest.NewServer(s.Handlers())
	defer ts.Close()

	body := `{"name":"binder-acct","password":"password123"}`
	res, err := http.Post(ts.URL+"/api/auth/register", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	var reg struct {
		ID    string `json:"id"`
		Token string `json:"token"`
	}
	json.NewDecoder(res.Body).Decode(&reg)
	res.Body.Close()

	if sess := oauthLogin(t, ts, "github", reg.Token); sess != nil {
		t.Fatal("bind flow issued a new session; it must keep the caller signed in")
	}

	ids, err := s.st.OAuthIdentitiesByUser(reg.ID)
	if err != nil || len(ids) != 1 || ids[0].Provider != "github" {
		t.Fatalf("identity not bound: %v %v", ids, err)
	}

	// The password still works, so unbinding may drop the identity.
	req, _ := http.NewRequest("DELETE", ts.URL+"/api/me/identities/github", nil)
	req.Header.Set("Authorization", "Bearer "+reg.Token)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("unbind: HTTP %d", res.StatusCode)
	}
	if ids, _ := s.st.OAuthIdentitiesByUser(reg.ID); len(ids) != 0 {
		t.Fatalf("identity survived unbind: %v", ids)
	}
}

func TestOAuthRefusesWhenSignupClosed(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	srv := fakeOAuth(t, map[string]any{"id": "n-1", "login": "stranger", "email": ""}, nil)
	s.useTestOAuth(testProvider(srv, "github", "", ""))
	s.oauth.signup = false
	ts := httptest.NewServer(s.Handlers())
	defer ts.Close()

	sess := oauthLogin(t, ts, "github", "")
	if sess != nil {
		t.Fatal("a first-time visitor got an account with signup disabled")
	}
}

func TestOAuthStateMismatchIsRejected(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	srv := fakeOAuth(t, map[string]any{"id": "x", "login": "x"}, nil)
	s.useTestOAuth(testProvider(srv, "github", "", ""))
	ts := httptest.NewServer(s.Handlers())
	defer ts.Close()

	req, _ := http.NewRequest("GET", ts.URL+"/api/auth/oauth/github/start", nil)
	res, _ := noRedirect.Do(req)
	res.Body.Close()
	var state *http.Cookie
	for _, c := range res.Cookies() {
		if c.Name == oauthStateCookie {
			state = c
		}
	}
	if state == nil {
		t.Fatal("no state cookie")
	}
	req, _ = http.NewRequest("GET", ts.URL+"/api/auth/oauth/github/callback?code=good&state=forged", nil)
	req.AddCookie(state)
	res, _ = noRedirect.Do(req)
	res.Body.Close()
	if loc := res.Header.Get("Location"); !strings.Contains(loc, "oauth_error") {
		t.Fatalf("forged state accepted: %s", loc)
	}
	for _, c := range res.Cookies() {
		if c.Name == sessionCookie && c.Value != "" {
			t.Fatal("forged state still produced a session")
		}
	}
}
