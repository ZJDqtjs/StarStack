package hub

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"starstack/internal/store"
)

func offerCall(t *testing.T, s *Server, method, path string, cookie *http.Cookie, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	s.Handlers().ServeHTTP(rec, r)
	return rec
}

func createOfferForTest(t *testing.T, s *Server, cookie *http.Cookie, fields map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	body, ct := multipartBody(t, fields, nil)
	r := httptest.NewRequest(http.MethodPost, "/api/offers", body)
	r.Header.Set("Content-Type", ct)
	r.AddCookie(cookie)
	rec := httptest.NewRecorder()
	s.Handlers().ServeHTTP(rec, r)
	return rec
}

func offerID(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	if rec.Code != 200 {
		t.Fatalf("create offer: %d %s", rec.Code, rec.Body.String())
	}
	var d struct {
		Offer struct {
			ID string `json:"id"`
		} `json:"offer"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil {
		t.Fatalf("decode create offer: %v", err)
	}
	if d.Offer.ID == "" {
		t.Fatal("create offer returned no id")
	}
	return d.Offer.ID
}

func TestOfferAutoShareUseAndConversation(t *testing.T) {
	s := newTestServer(t, Policy{})
	seller := asUser(t, s, "oseller")
	buyer := asUser(t, s, "obuyer")
	outsider := asUser(t, s, "ooutsider")

	base := map[string]string{
		"category": "render", "title": "4090 共享", "price": "0.8", "unit": "点/次",
		"body": "联系方式见简介", "spec": "RTX 4090",
	}

	with := func(extra map[string]string) map[string]string {
		out := map[string]string{}
		for k, v := range base {
			out[k] = v
		}
		for k, v := range extra {
			out[k] = v
		}
		return out
	}

	// Auto-share must point at something usable, and a node must belong to the seller.
	if rec := createOfferForTest(t, s, seller, with(map[string]string{"auto_share": "1"})); rec.Code != 400 {
		t.Fatalf("empty auto-share should be rejected: %d %s", rec.Code, rec.Body.String())
	}
	if rec := createOfferForTest(t, s, seller, with(map[string]string{
		"auto_share": "1", "node_id": "n-not-mine",
	})); rec.Code != 403 {
		t.Fatalf("foreign node should be rejected: %d %s", rec.Code, rec.Body.String())
	}

	scene := `{"scene":"demo.blend","from":1,"to":10,"samples":32}`
	id := offerID(t, createOfferForTest(t, s, seller, with(map[string]string{
		"auto_share": "1", "scene": scene,
	})))

	rec := offerCall(t, s, http.MethodGet, "/api/offers/"+id, buyer, "")
	if rec.Code != 200 {
		t.Fatalf("offer detail: %d %s", rec.Code, rec.Body.String())
	}
	var detail struct {
		Offer struct {
			AutoShare bool   `json:"auto_share"`
			Scene     string `json:"scene"`
			Mine      bool   `json:"mine"`
		} `json:"offer"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if !detail.Offer.AutoShare || detail.Offer.Scene != scene || detail.Offer.Mine {
		t.Fatalf("unexpected offer detail: %+v", detail.Offer)
	}

	use := func(cookie *http.Cookie) *httptest.ResponseRecorder {
		return offerCall(t, s, http.MethodPost, "/api/offers/"+id+"/use", cookie, "")
	}
	rec = use(buyer)
	if rec.Code != 200 {
		t.Fatalf("use auto-shared offer: %d %s", rec.Code, rec.Body.String())
	}
	var used struct {
		Order struct {
			ID    string `json:"id"`
			Scene string `json:"scene"`
		} `json:"order"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &used); err != nil {
		t.Fatal(err)
	}
	if used.Order.ID == "" || used.Order.Scene != scene {
		t.Fatalf("use did not return the scene template: %+v", used.Order)
	}

	// Re-clicking must reuse the same authorization, and the seller cannot buy it.
	rec = use(buyer)
	if rec.Code != 200 {
		t.Fatalf("repeat use: %d %s", rec.Code, rec.Body.String())
	}
	var again struct {
		Order struct {
			ID string `json:"id"`
		} `json:"order"`
	}
	json.Unmarshal(rec.Body.Bytes(), &again)
	if again.Order.ID != used.Order.ID {
		t.Fatalf("authorization was not idempotent: %s != %s", again.Order.ID, used.Order.ID)
	}
	if rec := use(seller); rec.Code != 403 {
		t.Fatalf("seller should not buy own listing: %d %s", rec.Code, rec.Body.String())
	}

	plainID := offerID(t, createOfferForTest(t, s, seller, with(nil)))
	if rec := offerCall(t, s, http.MethodPost, "/api/offers/"+plainID+"/use", buyer, ""); rec.Code != 409 {
		t.Fatalf("non-auto-shared listing should need a conversation: %d %s", rec.Code, rec.Body.String())
	}

	// A seller-owned node can also be shared directly.
	nodeID := "n-oseller"
	if err := s.st.RegisterNode(&store.NodeRow{
		ID: nodeID, OwnerID: "u-oseller", Name: "seller-node",
		Price: 1, Slots: 1, RegisteredAt: 1, LastSeen: 1,
	}); err != nil {
		t.Fatal(err)
	}
	nodeOfferID := offerID(t, createOfferForTest(t, s, seller, with(map[string]string{
		"auto_share": "1", "node_id": nodeID,
	})))
	rec = offerCall(t, s, http.MethodPost, "/api/offers/"+nodeOfferID+"/use", buyer, "")
	if rec.Code != 200 {
		t.Fatalf("use node-shared listing: %d %s", rec.Code, rec.Body.String())
	}
	var nodeUse struct {
		Order struct {
			NodeID string `json:"node_id"`
		} `json:"order"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &nodeUse); err != nil {
		t.Fatal(err)
	}
	if nodeUse.Order.NodeID != nodeID {
		t.Fatalf("authorization did not carry the node: %+v", nodeUse.Order)
	}

	start := func() *httptest.ResponseRecorder {
		return offerCall(t, s, http.MethodPost, "/api/offers/"+id+"/conversation", buyer, "")
	}
	rec = start()
	if rec.Code != 200 {
		t.Fatalf("start conversation: %d %s", rec.Code, rec.Body.String())
	}
	var opened struct {
		Conversation struct {
			ID   string `json:"id"`
			Peer string `json:"peer"`
		} `json:"conversation"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &opened); err != nil {
		t.Fatal(err)
	}
	cid := opened.Conversation.ID
	if cid == "" || opened.Conversation.Peer != "oseller" {
		t.Fatalf("unexpected conversation: %+v", opened.Conversation)
	}
	rec = start()
	var reopened struct {
		Conversation struct {
			ID string `json:"id"`
		} `json:"conversation"`
	}
	json.Unmarshal(rec.Body.Bytes(), &reopened)
	if reopened.Conversation.ID != cid {
		t.Fatal("conversation was not reused for the same buyer and listing")
	}

	if rec := offerCall(t, s, http.MethodPost, "/api/offers/conversations/"+cid, buyer,
		`{"body":"你好，想直接跑 demo.blend"}`); rec.Code != 200 {
		t.Fatalf("send message: %d %s", rec.Code, rec.Body.String())
	}
	if rec := offerCall(t, s, http.MethodGet, "/api/offers/conversations/"+cid, outsider, ""); rec.Code != 403 {
		t.Fatalf("outsider should not read the thread: %d %s", rec.Code, rec.Body.String())
	}

	rec = offerCall(t, s, http.MethodGet, "/api/offers/conversations", seller, "")
	if rec.Code != 200 {
		t.Fatalf("seller conversation list: %d %s", rec.Code, rec.Body.String())
	}
	var list struct {
		Conversations []struct {
			ID       string `json:"id"`
			LastBody string `json:"last_body"`
			Peer     string `json:"peer"`
		} `json:"conversations"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Conversations) != 1 || list.Conversations[0].ID != cid ||
		list.Conversations[0].Peer != "obuyer" || list.Conversations[0].LastBody == "" {
		t.Fatalf("unexpected seller conversation list: %+v", list.Conversations)
	}

	if rec := offerCall(t, s, http.MethodPost, "/api/offers/conversations/"+cid, seller,
		`{"body":"已开通自动共享，直接点立即使用即可"}`); rec.Code != 200 {
		t.Fatalf("seller reply: %d %s", rec.Code, rec.Body.String())
	}
	rec = offerCall(t, s, http.MethodGet, "/api/offers/conversations/"+cid, buyer, "")
	if rec.Code != 200 {
		t.Fatalf("buyer read thread: %d %s", rec.Code, rec.Body.String())
	}
	var thread struct {
		Messages []struct {
			Body string `json:"body"`
			Mine bool   `json:"mine"`
		} `json:"messages"`
		Offer *struct {
			ID string `json:"id"`
		} `json:"offer"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &thread); err != nil {
		t.Fatal(err)
	}
	if len(thread.Messages) != 2 || !thread.Messages[0].Mine || thread.Messages[1].Mine {
		t.Fatalf("unexpected message order/ownership: %+v", thread.Messages)
	}
	if thread.Offer == nil || thread.Offer.ID != id {
		t.Fatalf("thread did not carry its listing: %+v", thread.Offer)
	}
}

func TestOfferMigrationAddsAutoShareColumns(t *testing.T) {
	// A database written before auto_share existed must gain the new columns
	// during Open; otherwise the fixed-column SELECT on /api/offers fails.
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE service_offers(
		id TEXT PRIMARY KEY, category TEXT NOT NULL, user_id TEXT NOT NULL,
		title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL DEFAULT '',
		price REAL NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT '点/次',
		image TEXT NOT NULL DEFAULT '', image_mime TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO service_offers(id,category,user_id,title,created_at)
		VALUES('o-old','render','u-old','旧挂牌',1)`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	st, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	o, err := st.ServiceOffer("o-old")
	if err != nil {
		t.Fatalf("old listing should still be readable: %v", err)
	}
	if o == nil || o.Title != "旧挂牌" || o.AutoShare || o.NodeID != "" || o.Scene != "" {
		t.Fatalf("unexpected migrated offer: %+v", o)
	}
}
