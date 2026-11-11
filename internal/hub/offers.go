package hub

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"starstack/internal/store"
)

// 卖家出价：星空·星海里的一张挂牌，由卖家在星空·星栈自行发布。
// 卖家提供服务类型、配置、标题、简介、价格与一张封面图；官方供给不由这张表
// 表达，所以这里没有任何“官方”标记。

const (
	maxOfferTitleChars   = 80
	maxOfferBodyChars    = 2000
	maxOfferSpecChars    = 500
	maxOfferUnitChars    = 20
	maxOfferSceneChars   = 4000
	maxOfferMessageChars = 1000
)

var offerCategories = map[string]bool{
	"api": true, "image": true, "video": true, "render": true, "build": true,
}

type offerView struct {
	ID        string  `json:"id"`
	Category  string  `json:"category"`
	Seller    string  `json:"seller"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	Spec      string  `json:"spec"`
	Price     float64 `json:"price"`
	Unit      string  `json:"unit"`
	AutoShare bool    `json:"auto_share"`
	NodeID    string  `json:"node_id,omitempty"`
	Scene     string  `json:"scene,omitempty"`
	HasImage  bool    `json:"has_image"`
	Mine      bool    `json:"mine"`
	CreatedAt int64   `json:"created_at"`
}

func viewOffer(o *store.ServiceOffer, u *store.User) offerView {
	return offerView{
		ID: o.ID, Category: o.Category, Seller: o.Seller, Title: o.Title, Body: o.Body,
		Spec: o.Spec, Price: o.Price, Unit: o.Unit, AutoShare: o.AutoShare,
		NodeID: o.NodeID, Scene: o.Scene,
		HasImage: o.Image != "", Mine: o.UserID == u.ID, CreatedAt: o.CreatedAt,
	}
}

func (s *Server) handleOffers(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		cat := strings.TrimSpace(r.URL.Query().Get("category"))
		if cat != "" && !offerCategories[cat] {
			http.Error(w, jsonErr("未知的版块"), 400)
			return
		}
		list, err := s.st.ServiceOffers(cat, 100)
		if err != nil {
			s.deny(w, 500, "读取出价失败", "offers list", err)
			return
		}
		out := make([]offerView, 0, len(list))
		for _, o := range list {
			out = append(out, viewOffer(o, u))
		}
		writeJSON(w, map[string]any{"offers": out})
	case http.MethodPost:
		s.createOffer(w, r, u)
	default:
		http.Error(w, "GET/POST only", 405)
	}
}

func (s *Server) createOffer(w http.ResponseWriter, r *http.Request, u *store.User) {
	r.Body = http.MaxBytesReader(w, r.Body, maxImageBytes+(2<<20))
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		s.deny(w, 400, "上传失败或超出大小上限", "offer upload", err)
		return
	}
	category := strings.TrimSpace(r.FormValue("category"))
	if !offerCategories[category] {
		http.Error(w, jsonErr("未知的版块"), 400)
		return
	}
	title := strings.TrimSpace(r.FormValue("title"))
	if title == "" {
		http.Error(w, jsonErr("标题不能为空"), 400)
		return
	}
	body := strings.TrimSpace(r.FormValue("body"))
	spec := strings.TrimSpace(r.FormValue("spec"))
	unit := strings.TrimSpace(r.FormValue("unit"))
	if unit == "" {
		unit = "点/次"
	}
	if len([]rune(title)) > maxOfferTitleChars || len([]rune(body)) > maxOfferBodyChars ||
		len([]rune(spec)) > maxOfferSpecChars || len([]rune(unit)) > maxOfferUnitChars {
		http.Error(w, jsonErr("标题、简介、配置或单位过长"), 400)
		return
	}
	price, err := strconv.ParseFloat(strings.TrimSpace(r.FormValue("price")), 64)
	if err != nil || price < 0 {
		http.Error(w, jsonErr("单价必须是不小于 0 的数字"), 400)
		return
	}
	autoShare := r.FormValue("auto_share") == "1" || strings.EqualFold(r.FormValue("auto_share"), "true")
	nodeID := strings.TrimSpace(r.FormValue("node_id"))
	scene := strings.TrimSpace(r.FormValue("scene"))
	if len([]rune(scene)) > maxOfferSceneChars || (scene != "" && !json.Valid([]byte(scene))) {
		http.Error(w, jsonErr("场景任务模板不是合法 JSON 或过长"), 400)
		return
	}
	if scene == "{}" {
		scene = ""
	}
	if autoShare {
		if nodeID == "" && scene == "" {
			http.Error(w, jsonErr("开通自动共享需要绑定节点或填写场景任务"), 400)
			return
		}
		if nodeID != "" {
			owner, err := s.st.NodeOwner(nodeID)
			if err != nil || owner != u.ID {
				http.Error(w, jsonErr("只能绑定自己名下的节点"), 403)
				return
			}
		}
	}

	offer := &store.ServiceOffer{
		ID: newID(), Category: category, UserID: u.ID, Seller: u.Name,
		Title: title, Body: body, Spec: spec, Price: price, Unit: unit,
		AutoShare: autoShare, NodeID: nodeID, Scene: scene, CreatedAt: time.Now().Unix(),
	}
	if files := r.MultipartForm.File["image"]; len(files) > 0 {
		fh := files[0]
		f, err := fh.Open()
		if err == nil {
			name, mime, serr := s.saveOfferImage(f, offer.ID, fh.Size)
			f.Close()
			if serr == nil {
				offer.Image, offer.ImageMime = name, mime
			}
		}
	}
	if err := s.st.CreateServiceOffer(offer); err != nil {
		if offer.Image != "" {
			os.RemoveAll(filepath.Join(s.dataDir, "offers", offer.ID))
		}
		s.deny(w, 500, "发布失败", "create offer", err)
		return
	}
	writeJSON(w, map[string]any{"offer": viewOffer(offer, u)})
}

func (s *Server) handleOfferOp(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api/offers/")
	if strings.HasPrefix(rest, "media/") {
		if r.Method != http.MethodGet {
			http.Error(w, "GET only", 405)
			return
		}
		s.serveOfferCover(w, r, strings.TrimPrefix(rest, "media/"))
		return
	}
	id, sub, hasSub := strings.Cut(rest, "/")
	if id == "" {
		http.Error(w, "not found", 404)
		return
	}
	if hasSub {
		switch sub {
		case "use":
			s.handleOfferUse(w, r, u, id)
		case "conversation":
			s.handleOfferConversationStart(w, r, u, id)
		default:
			http.NotFound(w, r)
		}
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.handleOfferDetail(w, r, u, id)
	case http.MethodDelete:
		ok, err := s.st.DeleteServiceOffer(id, u.ID)
		if err != nil {
			s.deny(w, 500, "删除失败", "delete offer", err)
			return
		}
		if !ok {
			http.Error(w, jsonErr("出价不存在或不属于你"), 404)
			return
		}
		os.RemoveAll(filepath.Join(s.dataDir, "offers", id))
		writeJSON(w, map[string]any{"ok": true})
	default:
		http.Error(w, "GET/DELETE only", 405)
	}
}

func (s *Server) handleOfferDetail(w http.ResponseWriter, r *http.Request, u *store.User, id string) {
	o, err := s.st.ServiceOffer(id)
	if err != nil {
		s.deny(w, 500, "读取共享失败", "offer detail", err)
		return
	}
	if o == nil {
		http.Error(w, jsonErr("共享不存在"), 404)
		return
	}
	writeJSON(w, map[string]any{"offer": viewOffer(o, u)})
}

func (s *Server) serveOfferCover(w http.ResponseWriter, r *http.Request, id string) {
	offer, err := s.st.ServiceOffer(id)
	if err != nil {
		s.deny(w, 500, "读取封面失败", "offer cover", err)
		return
	}
	if offer == nil || offer.Image == "" {
		http.Error(w, "not found", 404)
		return
	}
	fh, err := os.Open(filepath.Join(s.dataDir, "offers", offer.ID, filepath.Base(offer.Image)))
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}
	defer fh.Close()
	st, err := fh.Stat()
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}
	w.Header().Set("Content-Type", offer.ImageMime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeContent(w, r, "cover", st.ModTime(), fh)
}

// saveOfferImage sniffs the payload and keeps only still images. The returned
// name is generated, never client-supplied, so reads cannot escape the folder.
func (s *Server) saveOfferImage(src io.Reader, offerID string, size int64) (name, mime string, err error) {
	head := make([]byte, 512)
	n, err := io.ReadFull(src, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return "", "", err
	}
	head = head[:n]
	mime = http.DetectContentType(head)
	if !strings.HasPrefix(mime, "image/") {
		return "", "", errors.New("unsupported image")
	}
	ext, ok := mediaExt[mime]
	if !ok {
		return "", "", errors.New("unsupported image")
	}
	if size > maxImageBytes {
		return "", "", errors.New("image too large")
	}

	dir := filepath.Join(s.dataDir, "offers", offerID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}
	name = newID() + ext
	out, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		return "", "", err
	}
	_, err = io.Copy(out, io.MultiReader(strings.NewReader(string(head)), io.LimitReader(src, size)))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(filepath.Join(dir, name))
		return "", "", err
	}
	return name, mime, nil
}

type offerMessageView struct {
	ID        string `json:"id"`
	Sender    string `json:"sender"`
	Body      string `json:"body"`
	CreatedAt int64  `json:"created_at"`
	Mine      bool   `json:"mine"`
}

func viewOfferMessages(msgs []*store.OfferMessage, userID string) []offerMessageView {
	out := make([]offerMessageView, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, offerMessageView{
			ID: m.ID, Sender: m.Sender, Body: m.Body,
			CreatedAt: m.CreatedAt, Mine: m.SenderID == userID,
		})
	}
	return out
}

func (s *Server) loadOffer(w http.ResponseWriter, id string) *store.ServiceOffer {
	o, err := s.st.ServiceOffer(id)
	if err != nil {
		s.deny(w, 500, "读取共享失败", "offer load", err)
		return nil
	}
	if o == nil {
		http.Error(w, jsonErr("共享不存在"), 404)
		return nil
	}
	return o
}

// handleOfferUse grants a buyer an idempotent authorization to use an
// auto-shared node or scene template. No extra charge is made here: the task
// still goes through the platform's normal hold/settle flow when submitted.
func (s *Server) handleOfferUse(w http.ResponseWriter, r *http.Request, u *store.User, id string) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	if !s.limiter.allow("offer-use:"+u.ID, 30) {
		http.Error(w, jsonErr("操作过于频繁，请稍后再试"), 429)
		return
	}
	o := s.loadOffer(w, id)
	if o == nil {
		return
	}
	if o.UserID == u.ID {
		http.Error(w, jsonErr("这是你发布的共享，无需下单"), 403)
		return
	}
	if !o.AutoShare {
		http.Error(w, jsonErr("卖家未开通自动共享，请先联系卖家"), 409)
		return
	}
	if o.NodeID != "" {
		owner, err := s.st.NodeOwner(o.NodeID)
		if err != nil || owner != o.UserID {
			http.Error(w, jsonErr("卖家绑定的节点已失效"), 409)
			return
		}
	}
	order, err := s.st.OfferOrderByPair(o.ID, u.ID)
	if err != nil {
		s.deny(w, 500, "读取共享授权失败", "offer order read", err)
		return
	}
	if order == nil {
		created := &store.OfferOrder{
			ID: newID(), OfferID: o.ID, BuyerID: u.ID, SellerID: o.UserID,
			NodeID: o.NodeID, Scene: o.Scene, CreatedAt: time.Now().Unix(),
		}
		if err := s.st.CreateOfferOrder(created); err != nil {
			s.deny(w, 500, "共享授权失败", "offer order create", err)
			return
		}
		order, err = s.st.OfferOrderByPair(o.ID, u.ID)
		if err != nil || order == nil {
			s.deny(w, 500, "共享授权失败", "offer order reload", err)
			return
		}
		s.commLog(&store.CommEntry{
			JobID: order.ID, NodeID: o.NodeID, BuyerID: u.ID, SellerID: o.UserID,
			Actor: "buyer", Event: "offer.auto_share",
			Detail: commDetail(map[string]any{"name": o.Title, "kind": o.Category, "price": o.Price}),
		})
	}
	writeJSON(w, map[string]any{"ok": true, "order": order, "offer": viewOffer(o, u)})
}

// handleOfferConversationStart opens (or reuses) the buyer's thread for a listing.
func (s *Server) handleOfferConversationStart(w http.ResponseWriter, r *http.Request, u *store.User, id string) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	o := s.loadOffer(w, id)
	if o == nil {
		return
	}
	if o.UserID == u.ID {
		http.Error(w, jsonErr("卖家请在「我的会话」中回复买家"), 403)
		return
	}
	if !s.limiter.allow("offer-chat:"+u.ID, 30) {
		http.Error(w, jsonErr("操作过于频繁，请稍后再试"), 429)
		return
	}
	stamp := time.Now().Unix()
	c, err := s.st.OpenOfferConversation(&store.OfferConversation{
		ID: newID(), OfferID: o.ID, BuyerID: u.ID, SellerID: o.UserID,
		CreatedAt: stamp, UpdatedAt: stamp,
	})
	if err != nil || c == nil {
		s.deny(w, 500, "发起会话失败", "offer conversation open", err)
		return
	}
	msgs, err := s.st.OfferMessages(c.ID, 200)
	if err != nil {
		s.deny(w, 500, "读取会话失败", "offer messages", err)
		return
	}
	writeJSON(w, map[string]any{
		"conversation": c, "messages": viewOfferMessages(msgs, u.ID), "offer": viewOffer(o, u),
	})
}

func (s *Server) handleOfferConversations(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", 405)
		return
	}
	list, err := s.st.OfferConversations(u.ID, strings.TrimSpace(r.URL.Query().Get("offer_id")), 100)
	if err != nil {
		s.deny(w, 500, "读取会话列表失败", "offer conversations", err)
		return
	}
	writeJSON(w, map[string]any{"conversations": list})
}

func (s *Server) handleOfferConversation(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	cid := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/offers/conversations/"), "/")
	if cid == "" || strings.Contains(cid, "/") {
		http.NotFound(w, r)
		return
	}
	c, err := s.st.OfferConversationByID(cid)
	if err != nil {
		s.deny(w, 500, "读取会话失败", "offer conversation", err)
		return
	}
	if c == nil {
		http.Error(w, jsonErr("会话不存在"), 404)
		return
	}
	if c.BuyerID != u.ID && c.SellerID != u.ID {
		http.Error(w, jsonErr("无权查看这条会话"), 403)
		return
	}
	switch r.Method {
	case http.MethodGet:
		cv, err := s.st.OfferConversationViewByID(cid, u.ID)
		if err != nil {
			s.deny(w, 500, "读取会话失败", "offer conversation view", err)
			return
		}
		msgs, err := s.st.OfferMessages(cid, 200)
		if err != nil {
			s.deny(w, 500, "读取消息失败", "offer messages", err)
			return
		}
		var ov any
		if o, err := s.st.ServiceOffer(c.OfferID); err == nil && o != nil {
			ov = viewOffer(o, u)
		}
		writeJSON(w, map[string]any{
			"conversation": cv, "messages": viewOfferMessages(msgs, u.ID), "offer": ov,
		})
	case http.MethodPost:
		var in struct {
			Body string `json:"body"`
		}
		if err := decodeJSON(r, &in); err != nil {
			http.Error(w, jsonErr("消息格式不正确"), 400)
			return
		}
		body := strings.TrimSpace(in.Body)
		if body == "" {
			http.Error(w, jsonErr("消息不能为空"), 400)
			return
		}
		if len([]rune(body)) > maxOfferMessageChars {
			http.Error(w, jsonErr("消息过长"), 400)
			return
		}
		if !s.limiter.allow("offer-msg:"+u.ID, 60) {
			http.Error(w, jsonErr("发送过于频繁，请稍后再试"), 429)
			return
		}
		m := &store.OfferMessage{
			ID: newID(), ConversationID: cid, SenderID: u.ID, Body: body,
			CreatedAt: time.Now().Unix(),
		}
		if err := s.st.AddOfferMessage(m); err != nil {
			s.deny(w, 500, "发送失败", "offer message add", err)
			return
		}
		writeJSON(w, map[string]any{"message": offerMessageView{
			ID: m.ID, Sender: u.Name, Body: m.Body, CreatedAt: m.CreatedAt, Mine: true,
		}})
	default:
		http.Error(w, "GET/POST only", 405)
	}
}
