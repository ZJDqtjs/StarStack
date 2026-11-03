package store

import (
	"database/sql"
	"time"
)

// 服务出价：卖家在 API / 生图 / 生视频 / 渲染 / 编译版块下发布的挂牌。
// 官方供给是页面上的固定卡片，这里只存卖家自己写的标题、价格与封面。
type ServiceOffer struct {
	ID        string  `json:"id"`
	Category  string  `json:"category"`
	UserID    string  `json:"user_id"`
	Seller    string  `json:"seller"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	Price     float64 `json:"price"`
	Unit      string  `json:"unit"`
	Image     string  `json:"image"` // 磁盘文件名，空表示没有封面
	ImageMime string  `json:"image_mime"`
	CreatedAt int64   `json:"created_at"`
}

const offerCols = `o.id,o.category,o.user_id,COALESCE(u.name,'已注销'),o.title,o.body,
	o.price,o.unit,o.image,o.image_mime,o.created_at`

func scanOffer(row interface{ Scan(...any) error }) (*ServiceOffer, error) {
	o := &ServiceOffer{}
	err := row.Scan(&o.ID, &o.Category, &o.UserID, &o.Seller, &o.Title, &o.Body,
		&o.Price, &o.Unit, &o.Image, &o.ImageMime, &o.CreatedAt)
	return o, err
}

func (s *Store) CreateServiceOffer(o *ServiceOffer) error {
	if o.CreatedAt == 0 {
		o.CreatedAt = time.Now().Unix()
	}
	_, err := s.db.Exec(`INSERT INTO service_offers
		(id,category,user_id,title,body,price,unit,image,image_mime,created_at)
		VALUES(?,?,?,?,?,?,?,?,?,?)`,
		o.ID, o.Category, o.UserID, o.Title, o.Body, o.Price, o.Unit, o.Image, o.ImageMime, o.CreatedAt)
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
