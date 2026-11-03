package hub

import (
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

// 卖家出价：每个服务版块（API / 生图 / 生视频 / 渲染 / 编译）下方的一张挂牌。
// 卖家只提供标题、简介、价格与一张封面图；官方供给不由这张表表达，页面固定
// 展示平台自己的算力，所以这里没有任何“官方”标记。

const (
	maxOfferTitleChars = 80
	maxOfferBodyChars  = 2000
	maxOfferUnitChars  = 20
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
	Price     float64 `json:"price"`
	Unit      string  `json:"unit"`
	HasImage  bool    `json:"has_image"`
	Mine      bool    `json:"mine"`
	CreatedAt int64   `json:"created_at"`
}

func viewOffer(o *store.ServiceOffer, u *store.User) offerView {
	return offerView{
		ID: o.ID, Category: o.Category, Seller: o.Seller, Title: o.Title, Body: o.Body,
		Price: o.Price, Unit: o.Unit, HasImage: o.Image != "", Mine: o.UserID == u.ID,
		CreatedAt: o.CreatedAt,
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
	unit := strings.TrimSpace(r.FormValue("unit"))
	if unit == "" {
		unit = "点/次"
	}
	if len([]rune(title)) > maxOfferTitleChars || len([]rune(body)) > maxOfferBodyChars ||
		len([]rune(unit)) > maxOfferUnitChars {
		http.Error(w, jsonErr("标题、简介或单位过长"), 400)
		return
	}
	price, err := strconv.ParseFloat(strings.TrimSpace(r.FormValue("price")), 64)
	if err != nil || price < 0 {
		http.Error(w, jsonErr("单价必须是不小于 0 的数字"), 400)
		return
	}

	offer := &store.ServiceOffer{
		ID: newID(), Category: category, UserID: u.ID, Seller: u.Name,
		Title: title, Body: body, Price: price, Unit: unit, CreatedAt: time.Now().Unix(),
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
	id, _, _ := strings.Cut(rest, "/")
	if id == "" {
		http.Error(w, "not found", 404)
		return
	}
	if r.Method != http.MethodDelete {
		http.Error(w, "DELETE only", 405)
		return
	}
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
