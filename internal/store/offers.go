package store

import (
	"database/sql"
	"time"
)

// 服务出价：卖家在 API / 生图 / 生视频 / 渲染 / 编译版块下发布的挂牌。
// auto_share 打开后，node_id / scene 描述买家无需协商即可使用的节点或场景模板；
// 场景模板是 JSON 原文，控制台按版块把它预填进对应任务表单。
type ServiceOffer struct {
	ID        string  `json:"id"`
	Category  string  `json:"category"`
	UserID    string  `json:"user_id"`
	Seller    string  `json:"seller"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	Spec      string  `json:"spec"`
	Price     float64 `json:"price"`
	Unit      string  `json:"unit"`
	Image     string  `json:"image"` // 磁盘文件名，空表示没有封面
	ImageMime string  `json:"image_mime"`
	AutoShare bool    `json:"auto_share"`
	NodeID    string  `json:"node_id"`
	Scene     string  `json:"scene"`
	CreatedAt int64   `json:"created_at"`
}

const offerCols = `o.id,o.category,o.user_id,COALESCE(u.name,'已注销'),o.title,o.body,o.spec,
	o.price,o.unit,o.image,o.image_mime,o.auto_share,o.node_id,o.scene,o.created_at`

func scanOffer(row interface{ Scan(...any) error }) (*ServiceOffer, error) {
	o := &ServiceOffer{}
	var auto int
	err := row.Scan(&o.ID, &o.Category, &o.UserID, &o.Seller, &o.Title, &o.Body, &o.Spec,
		&o.Price, &o.Unit, &o.Image, &o.ImageMime, &auto, &o.NodeID, &o.Scene, &o.CreatedAt)
	o.AutoShare = auto != 0
	return o, err
}

func (s *Store) CreateServiceOffer(o *ServiceOffer) error {
	if o.CreatedAt == 0 {
		o.CreatedAt = time.Now().Unix()
	}
	_, err := s.db.Exec(`INSERT INTO service_offers
		(id,category,user_id,title,body,spec,price,unit,image,image_mime,auto_share,node_id,scene,created_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		o.ID, o.Category, o.UserID, o.Title, o.Body, o.Spec, o.Price, o.Unit, o.Image, o.ImageMime,
		b2i(o.AutoShare), o.NodeID, o.Scene, o.CreatedAt)
	return err
}

// ServiceOffers returns the newest listings, optionally narrowed to one section.
func (s *Store) ServiceOffers(category string, limit int) ([]*ServiceOffer, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	query := `SELECT ` + offerCols + ` FROM service_offers o
		LEFT JOIN users u ON u.id=o.user_id`
	args := []any{}
	if category != "" {
		query += ` WHERE o.category=?`
		args = append(args, category)
	}
	query += ` ORDER BY o.created_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*ServiceOffer{}
	for rows.Next() {
		o, err := scanOffer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *Store) ServiceOffer(id string) (*ServiceOffer, error) {
	row := s.db.QueryRow(`SELECT `+offerCols+` FROM service_offers o
		LEFT JOIN users u ON u.id=o.user_id WHERE o.id=?`, id)
	o, err := scanOffer(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return o, err
}

// DeleteServiceOffer removes only the caller's own listing and reports whether
// a row was actually deleted, so the handler can tell "not yours" from "gone".
func (s *Store) DeleteServiceOffer(id, userID string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM service_offers WHERE id=? AND user_id=?`, id, userID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// OfferOrder records one buyer's authorization to use an auto-shared listing.
// The task itself is still billed by the platform's normal hold/settle flow.
type OfferOrder struct {
	ID        string `json:"id"`
	OfferID   string `json:"offer_id"`
	BuyerID   string `json:"buyer_id"`
	SellerID  string `json:"seller_id"`
	NodeID    string `json:"node_id"`
	Scene     string `json:"scene"`
	CreatedAt int64  `json:"created_at"`
}

func (s *Store) OfferOrderByPair(offerID, buyerID string) (*OfferOrder, error) {
	row := s.db.QueryRow(`SELECT id,offer_id,buyer_id,seller_id,node_id,scene,created_at
		FROM offer_orders WHERE offer_id=? AND buyer_id=?`, offerID, buyerID)
	o := &OfferOrder{}
	err := row.Scan(&o.ID, &o.OfferID, &o.BuyerID, &o.SellerID, &o.NodeID, &o.Scene, &o.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return o, err
}

func (s *Store) CreateOfferOrder(o *OfferOrder) error {
	if o.CreatedAt == 0 {
		o.CreatedAt = now()
	}
	_, err := s.db.Exec(`INSERT OR IGNORE INTO offer_orders
		(id,offer_id,buyer_id,seller_id,node_id,scene,created_at) VALUES(?,?,?,?,?,?,?)`,
		o.ID, o.OfferID, o.BuyerID, o.SellerID, o.NodeID, o.Scene, o.CreatedAt)
	return err
}

type OfferConversation struct {
	ID        string `json:"id"`
	OfferID   string `json:"offer_id"`
	BuyerID   string `json:"buyer_id"`
	SellerID  string `json:"seller_id"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

// OfferConversationView is the conversation-list row: it carries the listing
// title, the other party's name and a preview of the newest message.
type OfferConversationView struct {
	ID        string `json:"id"`
	OfferID   string `json:"offer_id"`
	BuyerID   string `json:"buyer_id"`
	SellerID  string `json:"seller_id"`
	Title     string `json:"title"`
	Category  string `json:"category"`
	Peer      string `json:"peer"`
	LastBody  string `json:"last_body"`
	AutoShare bool   `json:"auto_share"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

type OfferMessage struct {
	ID             string `json:"id"`
	ConversationID string `json:"conversation_id"`
	SenderID       string `json:"sender_id"`
	Sender         string `json:"sender"`
	Body           string `json:"body"`
	CreatedAt      int64  `json:"created_at"`
}

// offerConvCols needs viewerID as its first argument to resolve "peer".
const offerConvCols = `c.id,c.offer_id,c.buyer_id,c.seller_id,c.created_at,c.updated_at,
	o.title,o.category,o.auto_share,
	CASE WHEN c.buyer_id=? THEN COALESCE(us.name,'已注销') ELSE COALESCE(ub.name,'已注销') END,
	COALESCE((SELECT m.body FROM offer_messages m WHERE m.conversation_id=c.id
		ORDER BY m.rowid DESC LIMIT 1),'')`

const offerConvJoins = ` FROM offer_conversations c
	JOIN service_offers o ON o.id=c.offer_id
	LEFT JOIN users ub ON ub.id=c.buyer_id
	LEFT JOIN users us ON us.id=c.seller_id`

func scanOfferConv(row interface{ Scan(...any) error }) (*OfferConversationView, error) {
	v := &OfferConversationView{}
	var auto int
	err := row.Scan(&v.ID, &v.OfferID, &v.BuyerID, &v.SellerID, &v.CreatedAt, &v.UpdatedAt,
		&v.Title, &v.Category, &auto, &v.Peer, &v.LastBody)
	v.AutoShare = auto != 0
	return v, err
}

// OpenOfferConversation is idempotent: one buyer has exactly one thread per listing.
func (s *Store) OpenOfferConversation(c *OfferConversation) (*OfferConversationView, error) {
	if c.CreatedAt == 0 {
		c.CreatedAt = now()
	}
	if c.UpdatedAt == 0 {
		c.UpdatedAt = c.CreatedAt
	}
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO offer_conversations
		(id,offer_id,buyer_id,seller_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
		c.ID, c.OfferID, c.BuyerID, c.SellerID, c.CreatedAt, c.UpdatedAt); err != nil {
		return nil, err
	}
	row := s.db.QueryRow(`SELECT `+offerConvCols+offerConvJoins+
		` WHERE c.offer_id=? AND c.buyer_id=?`, c.BuyerID, c.OfferID, c.BuyerID)
	return scanOfferConv(row)
}

func (s *Store) OfferConversationByID(id string) (*OfferConversation, error) {
	row := s.db.QueryRow(`SELECT id,offer_id,buyer_id,seller_id,created_at,updated_at
		FROM offer_conversations WHERE id=?`, id)
	c := &OfferConversation{}
	err := row.Scan(&c.ID, &c.OfferID, &c.BuyerID, &c.SellerID, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return c, err
}

func (s *Store) OfferConversationViewByID(id, viewerID string) (*OfferConversationView, error) {
	row := s.db.QueryRow(`SELECT `+offerConvCols+offerConvJoins+` WHERE c.id=?`, viewerID, id)
	v, err := scanOfferConv(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return v, err
}

func (s *Store) OfferConversations(userID, offerID string, limit int) ([]*OfferConversationView, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	query := `SELECT ` + offerConvCols + offerConvJoins + ` WHERE (c.buyer_id=? OR c.seller_id=?)`
	args := []any{userID, userID, userID}
	if offerID != "" {
		query += ` AND c.offer_id=?`
		args = append(args, offerID)
	}
	query += ` ORDER BY c.updated_at DESC,c.id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*OfferConversationView{}
	for rows.Next() {
		v, err := scanOfferConv(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// OfferMessages returns the newest limited slice in chronological order.
func (s *Store) OfferMessages(conversationID string, limit int) ([]*OfferMessage, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.db.Query(`SELECT m.id,m.conversation_id,m.sender_id,
		COALESCE(u.name,'已注销'),m.body,m.created_at
		FROM offer_messages m LEFT JOIN users u ON u.id=m.sender_id
		WHERE m.conversation_id=? ORDER BY m.created_at DESC,m.rowid DESC LIMIT ?`,
		conversationID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*OfferMessage{}
	for rows.Next() {
		m := &OfferMessage{}
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.Sender, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

func (s *Store) AddOfferMessage(m *OfferMessage) error {
	if m.CreatedAt == 0 {
		m.CreatedAt = now()
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO offer_messages
		(id,conversation_id,sender_id,body,created_at) VALUES(?,?,?,?,?)`,
		m.ID, m.ConversationID, m.SenderID, m.Body, m.CreatedAt); err != nil {
		tx.Rollback()
		return err
	}
	if _, err := tx.Exec(`UPDATE offer_conversations SET updated_at=? WHERE id=?`,
		m.CreatedAt, m.ConversationID); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}
