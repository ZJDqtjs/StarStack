package hub

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"starstack/internal/store"
)

func consoleCall(t *testing.T, s *Server, path string, cookie *http.Cookie, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, path, nil)
	if cookie != nil {
		r.AddCookie(cookie)
	}
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	s.Handlers().ServeHTTP(rec, r)
	return rec
}

func consoleJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]json.RawMessage {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode response: %v (%s)", err, rec.Body.String())
	}
	return m
}

func consoleArrayLen(t *testing.T, m map[string]json.RawMessage, key string) int {
	t.Helper()
	raw, ok := m[key]
	if !ok {
		t.Fatalf("response has no %q field: %v", key, m)
	}
	var out []json.RawMessage
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode %q: %v", key, err)
	}
	return len(out)
}

func consoleInt(t *testing.T, m map[string]json.RawMessage, key string) int {
	t.Helper()
	raw, ok := m[key]
	if !ok {
		t.Fatalf("response has no %q field: %v", key, m)
	}
	var n int
	if err := json.Unmarshal(raw, &n); err != nil {
		t.Fatalf("decode %q: %v", key, err)
	}
	return n
}

func TestStateConditionalRequests(t *testing.T) {
	s := newTestServer(t, Policy{})
	alice := asUser(t, s, "alice")
	bob := asUser(t, s, "bob")

	anon := consoleCall(t, s, "/api/state", nil, nil)
	if anon.Code != http.StatusOK {
		t.Fatalf("anonymous state: %d %s", anon.Code, anon.Body.String())
	}
	anonTag := anon.Header().Get("ETag")
	if anonTag == "" {
		t.Fatal("state response has no ETag")
	}
	if got := anon.Header().Get("Cache-Control"); got != "private, no-cache" {
		t.Fatalf("cache-control = %q, want private, no-cache", got)
	}
	if got := anon.Header().Get("Vary"); got != "Cookie" {
		t.Fatalf("vary = %q, want Cookie", got)
	}
	cond := consoleCall(t, s, "/api/state", nil, map[string]string{"If-None-Match": anonTag})
	if cond.Code != http.StatusNotModified || cond.Body.Len() != 0 {
		t.Fatalf("conditional poll: %d, body %q", cond.Code, cond.Body.String())
	}

	a := consoleCall(t, s, "/api/state", alice, nil)
	b := consoleCall(t, s, "/api/state", bob, nil)
	aTag, bTag := a.Header().Get("ETag"), b.Header().Get("ETag")
	if aTag == "" || bTag == "" || aTag == bTag {
		t.Fatalf("per-viewer tags missing or equal: %q / %q", aTag, bTag)
	}
	// A cached body from another account must never be reused.
	if got := consoleCall(t, s, "/api/state", bob, map[string]string{"If-None-Match": aTag}); got.Code != http.StatusOK {
		t.Fatalf("cross-account conditional request: %d", got.Code)
	}
	for _, header := range []string{aTag, "W/" + aTag, "W/\"other\", " + aTag, "*"} {
		if got := consoleCall(t, s, "/api/state", alice, map[string]string{"If-None-Match": header}); got.Code != http.StatusNotModified {
			t.Fatalf("If-None-Match %q: %d, want 304", header, got.Code)
		}
	}

	// A real state change must invalidate the validator immediately.
	s.workers["n1"] = node("n1", 0.4, 1)
	changed := consoleCall(t, s, "/api/state", alice, map[string]string{"If-None-Match": aTag})
	if changed.Code != http.StatusOK || changed.Header().Get("ETag") == aTag {
		t.Fatalf("state change not reflected: %d, tag %q", changed.Code, changed.Header().Get("ETag"))
	}
}

func TestOffersPagingAndSearch(t *testing.T) {
	s := newTestServer(t, Policy{})
	u := asUser(t, s, "oseller2")
	for _, title := range []string{"4090 共享", "A100 共享", "4090 渲染"} {
		rec := createOfferForTest(t, s, u, map[string]string{
			"category": "render", "title": title, "price": "0.8", "unit": "点/次",
			"body": "配置说明", "spec": "GPU",
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("create offer: %d %s", rec.Code, rec.Body.String())
		}
	}

	page := consoleJSON(t, consoleCall(t, s, "/api/offers?limit=2&offset=0", u, nil))
	if got := consoleInt(t, page, "total"); got != 3 {
		t.Fatalf("total = %d, want 3", got)
	}
	if got := consoleArrayLen(t, page, "offers"); got != 2 {
		t.Fatalf("first page has %d offers, want 2", got)
	}
	next := consoleJSON(t, consoleCall(t, s, "/api/offers?limit=2&cursor=2", u, nil))
	if got := consoleArrayLen(t, next, "offers"); got != 1 {
		t.Fatalf("second page has %d offers, want 1", got)
	}
	if got := consoleInt(t, next, "offset"); got != 2 {
		t.Fatalf("cursor alias did not set offset: %d", got)
	}

	for _, tc := range []struct {
		query string
		want  int
	}{
		{"4090", 2}, {"a100", 1}, {"4090 渲染", 1}, {"不存在", 0},
	} {
		got := consoleJSON(t, consoleCall(t, s, "/api/offers?q="+url.QueryEscape(tc.query), u, nil))
		if n := consoleInt(t, got, "total"); n != tc.want {
			t.Fatalf("q=%q total = %d, want %d", tc.query, n, tc.want)
		}
	}

	legacy := consoleJSON(t, consoleCall(t, s, "/api/offers", u, nil))
	if _, ok := legacy["total"]; ok {
		t.Fatal("default response must keep its historical shape")
	}
	if got := consoleArrayLen(t, legacy, "offers"); got != 3 {
		t.Fatalf("default response has %d offers, want 3", got)
	}
}

func TestForumPagingAndSearch(t *testing.T) {
	s := newTestServer(t, Policy{})
	u := asUser(t, s, "fauthor")
	posts := []struct{ id, title, body string }{
		{"fp0", "分片调度", "转码经验"},
		{"fp1", "4090 出租", "显卡配置"},
		{"fp2", "分片调度复盘", "二次经验"},
	}
	for i, p := range posts {
		if err := s.st.CreatePost(&store.ForumPost{
			ID: p.id, UserID: "u-fauthor", Title: p.title, Body: p.body,
			CreatedAt: time.Now().Unix() + int64(i),
		}); err != nil {
			t.Fatalf("create post: %v", err)
		}
	}

	page := consoleJSON(t, consoleCall(t, s, "/api/forum/posts?limit=2&offset=0", u, nil))
	if got := consoleInt(t, page, "total"); got != 3 {
		t.Fatalf("total = %d, want 3", got)
	}
	if got := consoleArrayLen(t, page, "posts"); got != 2 {
		t.Fatalf("first page has %d posts, want 2", got)
	}
	next := consoleJSON(t, consoleCall(t, s, "/api/forum/posts?limit=2&offset=2", u, nil))
	if got := consoleArrayLen(t, next, "posts"); got != 1 {
		t.Fatalf("second page has %d posts, want 1", got)
	}
	for _, tc := range []struct {
		query string
		want  int
	}{
		{"分片", 2}, {"4090", 1}, {"fauthor", 3}, {"", 3},
	} {
		got := consoleJSON(t, consoleCall(t, s, "/api/forum/posts?q="+url.QueryEscape(tc.query), u, nil))
		if n := consoleInt(t, got, "total"); n != tc.want {
			t.Fatalf("q=%q total = %d, want %d", tc.query, n, tc.want)
		}
	}
	legacy := consoleJSON(t, consoleCall(t, s, "/api/forum/posts", u, nil))
	if _, ok := legacy["total"]; ok {
		t.Fatal("default response must keep its historical shape")
	}
}

func TestJobsLedgerAndConversationPaging(t *testing.T) {
	s := newTestServer(t, Policy{})
	u := asUser(t, s, "pager")
	const uid = "u-pager"

	for _, id := range []string{"j0", "j1", "j2"} {
		if err := s.st.InsertJob(&store.JobRow{
			ID: id, OwnerID: uid, Name: id, Status: "done", CreatedAt: time.Now().Unix(),
		}, nil); err != nil {
			t.Fatalf("insert job: %v", err)
		}
	}
	jobs := consoleJSON(t, consoleCall(t, s, "/api/jobs?limit=2&offset=0", u, nil))
	if got := consoleInt(t, jobs, "total"); got != 3 {
		t.Fatalf("jobs total = %d, want 3", got)
	}
	if got := consoleArrayLen(t, jobs, "jobs"); got != 2 {
		t.Fatalf("jobs page has %d rows, want 2", got)
	}

	for i := 0; i < 3; i++ {
		if err := s.st.Ledger(&store.Entry{
			TS: time.Now().Unix() + int64(i), Kind: store.Hold, UserID: uid,
			Amount: -1, Balance: 10, Note: "paging",
		}); err != nil {
			t.Fatalf("ledger: %v", err)
		}
	}
	ledger := consoleJSON(t, consoleCall(t, s, "/api/ledger?limit=2&offset=0", u, nil))
	if got := consoleInt(t, ledger, "total_spend"); got != 3 {
		t.Fatalf("total_spend = %d, want 3", got)
	}
	if got := consoleArrayLen(t, ledger, "spend"); got != 2 {
		t.Fatalf("spend page has %d rows, want 2", got)
	}
	if got := consoleInt(t, ledger, "total_earn"); got != 0 {
		t.Fatalf("total_earn = %d, want 0", got)
	}
	if legacy := consoleJSON(t, consoleCall(t, s, "/api/ledger", u, nil)); len(legacy) != 4 {
		t.Fatalf("default ledger response changed shape: %v", legacy)
	}

	// Two threads and three messages exercise the remaining paged handlers.
	for _, id := range []string{"o1", "o2"} {
		if err := s.st.CreateServiceOffer(&store.ServiceOffer{
			ID: id, Category: "render", UserID: uid, Seller: "pager",
			Title: id, Price: 1, CreatedAt: time.Now().Unix(),
		}); err != nil {
			t.Fatalf("create offer: %v", err)
		}
		conv := &store.OfferConversation{
			ID: "c-" + id, OfferID: id, BuyerID: uid, SellerID: uid,
			CreatedAt: time.Now().Unix(),
		}
		if _, err := s.st.OpenOfferConversation(conv); err != nil {
			t.Fatalf("open conversation: %v", err)
		}
	}
	convs := consoleJSON(t, consoleCall(t, s, "/api/offers/conversations?limit=1&offset=0", u, nil))
	if got := consoleInt(t, convs, "total"); got != 2 {
		t.Fatalf("conversations total = %d, want 2", got)
	}
	if got := consoleArrayLen(t, convs, "conversations"); got != 1 {
		t.Fatalf("conversations page has %d rows, want 1", got)
	}

	for i := 0; i < 3; i++ {
		if err := s.st.AddOfferMessage(&store.OfferMessage{
			ID: fmt.Sprintf("m%d", i), ConversationID: "c-o1", SenderID: uid,
			Body: fmt.Sprintf("msg%d", i), CreatedAt: time.Now().Unix() + int64(i),
		}); err != nil {
			t.Fatalf("add message: %v", err)
		}
	}
	msgs := consoleJSON(t, consoleCall(t, s, "/api/offers/conversations/c-o1?limit=2&offset=0", u, nil))
	if got := consoleInt(t, msgs, "total"); got != 3 {
		t.Fatalf("messages total = %d, want 3", got)
	}
	if got := consoleArrayLen(t, msgs, "messages"); got != 2 {
		t.Fatalf("messages page has %d rows, want 2", got)
	}
	last := consoleJSON(t, consoleCall(t, s, "/api/offers/conversations/c-o1?limit=2&offset=2", u, nil))
	if got := consoleArrayLen(t, last, "messages"); got != 1 {
		t.Fatalf("last messages page has %d rows, want 1", got)
	}
}
