package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"starstack/internal/auth"
	"starstack/internal/store"
)

func postBody(t *testing.T, url, body string) (int, map[string]any) {
	t.Helper()
	res, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer res.Body.Close()
	var out map[string]any
	json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

// putTestCode writes a code row the way issueEmailCode would, without needing a
// real SMTP server: the verification path is what these tests are about.
func putTestCode(t *testing.T, s *Server, email, purpose, code string) {
	t.Helper()
	if err := s.st.PutEmailCode(email, purpose, codeHash(email, purpose, code), codeTTL); err != nil {
		t.Fatal(err)
	}
}

func TestEmailRegistrationAndLogin(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	ts := httptest.NewServer(s.Handlers())
	defer ts.Close()

	code, out := postBody(t, ts.URL+"/api/auth/register",
		`{"name":"mailuser","email":"Mail.User@Example.com","password":"password123"}`)
	if code != 200 {
		t.Fatalf("register: %d %v", code, out)
	}
	if out["email"] != "mail.user@example.com" {
		t.Fatalf("email not normalised: %v", out["email"])
	}
	if out["email_verified"] != false {
		t.Fatal("an address was reported verified without an SMTP server")
	}

	// The display name was not sent by the client: it is derived from the
	// mailbox local part, and it is not a second login identifier.
	if out["name"] != "mail-user" {
		t.Fatalf("display name %v, want the sanitised local part", out["name"])
	}
	if code, out := postBody(t, ts.URL+"/api/auth/login",
		`{"email":"mail.user@example.com","password":"password123"}`); code != 200 {
		t.Fatalf("login by email: %d %v", code, out)
	}
	if code, _ := postBody(t, ts.URL+"/api/auth/login",
		`{"name":"mail-user","password":"password123"}`); code != 401 {
		t.Fatalf("display name still worked as a login name: HTTP %d", code)
	}
	if code, _ := postBody(t, ts.URL+"/api/auth/login",
		`{"name":"mail.user@example.com","password":"wrongpass1"}`); code != 401 {
		t.Fatalf("wrong password returned %d", code)
	}

	// A request that carries only a username is refused: there is no such thing
	// as a self-chosen account name any more.
	if code, _ := postBody(t, ts.URL+"/api/auth/register",
		`{"name":"legacy-only","password":"password123"}`); code != 400 {
		t.Fatalf("username-only registration: HTTP %d", code)
	}

	// A second account on the same mailbox would make "log in by email"
	// ambiguous, so it must be refused.
	if code, _ := postBody(t, ts.URL+"/api/auth/register",
		`{"name":"other","email":"mail.user@example.com","password":"password123"}`); code != http.StatusConflict {
		t.Fatalf("duplicate email: HTTP %d", code)
	}

	// Email-only signup derives a display name instead of demanding one.
	code, out = postBody(t, ts.URL+"/api/auth/register",
		`{"email":"solo@example.com","password":"password123"}`)
	if code != 200 {
		t.Fatalf("email-only register: %d %v", code, out)
	}
	if name, _ := out["name"].(string); name == "" {
		t.Fatal("email-only signup produced no display name")
	}
}

func TestRegisterNeedsCodeWhenSMTPConfigured(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	s.mail = &mailer{addr: "127.0.0.1:25", from: "no-reply@example.com"}
	ts := httptest.NewServer(s.Handlers())
	defer ts.Close()

	body := `{"name":"verified","email":"v@example.com","password":"password123"}`
	if code, _ := postBody(t, ts.URL+"/api/auth/register", body); code != 400 {
		t.Fatalf("unverified email accepted: HTTP %d", code)
	}
	putTestCode(t, s, "v@example.com", purposeSignup, "123456")
	code, out := postBody(t, ts.URL+"/api/auth/register",
		`{"name":"verified","email":"v@example.com","password":"password123","code":"123456"}`)
	if code != 200 {
		t.Fatalf("register with code: %d %v", code, out)
	}
	if out["email_verified"] != true {
		t.Fatalf("verified flag not set: %v", out)
	}
	// The code is one-shot: the same row must not work twice.
	if err := s.verifyEmailCode("v@example.com", purposeSignup, "123456"); err == nil {
		t.Fatal("a used code was accepted again")
	}
}

func TestEmailCodeIsAttemptCapped(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	s.mail = &mailer{addr: "127.0.0.1:25", from: "no-reply@example.com"}
	putTestCode(t, s, "cap@example.com", purposeSignup, "654321")

	for i := 0; i < codeMaxTries; i++ {
		if err := s.verifyEmailCode("cap@example.com", purposeSignup, "000000"); err == nil {
			t.Fatal("a wrong code was accepted")
		}
	}
	if err := s.verifyEmailCode("cap@example.com", purposeSignup, "654321"); err == nil {
		t.Fatal("the correct code survived the attempt cap")
	}
}

func TestEmailCodeEndpointNeedsSMTP(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	ts := httptest.NewServer(s.Handlers())
	defer ts.Close()
	code, _ := postBody(t, ts.URL+"/api/auth/email/code",
		`{"email":"a@example.com","purpose":"register"}`)
	if code != http.StatusServiceUnavailable {
		t.Fatalf("code endpoint without SMTP: HTTP %d", code)
	}
	// The console hides the 找回口令 entry from the same flag.
	if got := s.policyView()["email_verification"]; got != false {
		t.Fatalf("policy advertised email verification: %v", got)
	}
}

func TestPasswordResetInvalidatesSessions(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	s.mail = &mailer{addr: "127.0.0.1:25", from: "no-reply@example.com"}
	ts := httptest.NewServer(s.Handlers())
	defer ts.Close()

	salt := auth.NewSalt()
	u := &store.User{ID: "u-reset", Name: "resetme", Email: "reset@example.com",
		PassHash: auth.Hash("oldpassword", salt, auth.Iterations),
		Salt:     hexOf(salt), Iter: auth.Iterations, CreatedAt: time.Now().Unix()}
	if err := s.st.CreateUser(u); err != nil {
		t.Fatal(err)
	}
	oldToken := "tok-old"
	if err := s.st.PutSession(oldToken, u.ID, sessionTTL, "test"); err != nil {
		t.Fatal(err)
	}

	if code, _ := postBody(t, ts.URL+"/api/auth/reset",
		`{"email":"reset@example.com","code":"111111","password":"newpassword1"}`); code != 400 {
		t.Fatalf("reset without a valid code: HTTP %d", code)
	}
	putTestCode(t, s, "reset@example.com", purposeReset, "111111")
	if code, out := postBody(t, ts.URL+"/api/auth/reset",
		`{"email":"reset@example.com","code":"111111","password":"newpassword1"}`); code != 200 {
		t.Fatalf("reset: %d %v", code, out)
	}
	if _, err := s.st.Session(oldToken); err == nil {
		t.Fatal("old session survived a password reset")
	}
	if code, _ := postBody(t, ts.URL+"/api/auth/login",
		`{"email":"reset@example.com","password":"newpassword1"}`); code != 200 {
		t.Fatalf("login with the new password: HTTP %d", code)
	}
}

func TestIdentitiesAndPasswordForOAuthAccount(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	ts := httptest.NewServer(s.Handlers())
	defer ts.Close()

	u := &store.User{ID: "u-oauth", Name: "oauthonly", CreatedAt: time.Now().Unix()}
	if err := s.st.CreateUser(u); err != nil {
		t.Fatal(err)
	}
	token := "tok-oauth"
	if err := s.st.PutSession(token, u.ID, sessionTTL, "test"); err != nil {
		t.Fatal(err)
	}

	req, _ := http.NewRequest("GET", ts.URL+"/api/me/identities", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var view map[string]any
	json.NewDecoder(res.Body).Decode(&view)
	res.Body.Close()
	if view["has_password"] != false {
		t.Fatalf("passwordless account reported a password: %v", view)
	}
	// No provider configured in the test server, so the list is empty but
	// present: the console relies on the key existing.
	if _, ok := view["providers"]; !ok {
		t.Fatal("identities view has no providers key")
	}

	// Logging in with a password must explain itself instead of "wrong password".
	if code, _ := postBody(t, ts.URL+"/api/auth/login",
		`{"name":"oauthonly","password":"whatever1"}`); code != http.StatusForbidden {
		t.Fatalf("passwordless login: HTTP %d", code)
	}

	req, _ = http.NewRequest("POST", ts.URL+"/api/me/password",
		strings.NewReader(`{"new":"password123"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("set password: HTTP %d", res.StatusCode)
	}
	if code, _ := postBody(t, ts.URL+"/api/auth/login",
		`{"name":"oauthonly","password":"password123"}`); code != 200 {
		t.Fatalf("login after setting a password: HTTP %d", code)
	}
}

func TestBindEmailWithoutSMTP(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	ts := httptest.NewServer(s.Handlers())
	defer ts.Close()

	code, out := postBody(t, ts.URL+"/api/auth/register",
		`{"email":"binder2@example.com","password":"password123"}`)
	if code != 200 {
		t.Fatalf("register: %d %v", code, out)
	}
	token, _ := out["token"].(string)

	req, _ := http.NewRequest("POST", ts.URL+"/api/me/email",
		strings.NewReader(`{"email":"bind@example.com"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var bound map[string]any
	json.NewDecoder(res.Body).Decode(&bound)
	res.Body.Close()
	if res.StatusCode != 200 || bound["email_verified"] != false {
		t.Fatalf("bind email: HTTP %d %v", res.StatusCode, bound)
	}
	// The new address is now a login identifier.
	if code, _ := postBody(t, ts.URL+"/api/auth/login",
		`{"email":"bind@example.com","password":"password123"}`); code != 200 {
		t.Fatalf("login with the freshly bound email: HTTP %d", code)
	}
}

func hexOf(b []byte) string {
	const digits = "0123456789abcdef"
	out := make([]byte, 0, len(b)*2)
	for _, c := range b {
		out = append(out, digits[c>>4], digits[c&0xf])
	}
	return string(out)
}
