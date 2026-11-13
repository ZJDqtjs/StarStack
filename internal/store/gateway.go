package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// ---- API keys ----

// APIKey is a buyer credential for the OpenAI-compatible gateway. Only the
// SHA-256 hash is stored: the plaintext key is shown once at creation and a
// database copy must never be enough to call the API.
type APIKey struct {
	ID, UserID, Name string
	Hash, Prefix     string
	CreatedAt        int64
	LastUsed         int64
	Revoked          bool
	DailyQuota       float64 // 0 = unlimited, in points per broker-local day
}

const apiKeyCols = `id,user_id,name,hash,prefix,created_at,last_used,revoked,daily_quota`

func (s *Store) CreateAPIKey(k *APIKey) error {
	_, err := s.db.Exec(`INSERT INTO api_keys(`+apiKeyCols+`) VALUES(?,?,?,?,?,?,?,?,?)`,
		k.ID, k.UserID, k.Name, k.Hash, k.Prefix, k.CreatedAt, 0, b2i(k.Revoked), k.DailyQuota)
	return err
}

func (s *Store) APIKeyByHash(hash string) (*APIKey, error) {
	k := &APIKey{}
	var revoked int
	err := s.db.QueryRow(`SELECT `+apiKeyCols+` FROM api_keys WHERE hash=?`, hash).
		Scan(&k.ID, &k.UserID, &k.Name, &k.Hash, &k.Prefix, &k.CreatedAt, &k.LastUsed, &revoked,
			&k.DailyQuota)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	k.Revoked = revoked != 0
	return k, err
}

func (s *Store) APIKeysByUser(userID string) ([]*APIKey, error) {
	rows, err := s.db.Query(`SELECT `+apiKeyCols+`
		FROM api_keys WHERE user_id=? ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*APIKey
	for rows.Next() {
		k := &APIKey{}
		var revoked int
		if err := rows.Scan(&k.ID, &k.UserID, &k.Name, &k.Hash, &k.Prefix,
			&k.CreatedAt, &k.LastUsed, &revoked, &k.DailyQuota); err != nil {
			return nil, err
		}
		k.Revoked = revoked != 0
		out = append(out, k)
	}
	return out, rows.Err()
}

func (s *Store) CountAPIKeys(userID string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM api_keys WHERE user_id=? AND revoked=0`, userID).Scan(&n)
	return n, err
}

// RevokeAPIKey returns false when the key does not exist or belongs to someone else.
func (s *Store) RevokeAPIKey(id, userID string) (bool, error) {
	res, err := s.db.Exec(`UPDATE api_keys SET revoked=1 WHERE id=? AND user_id=? AND revoked=0`, id, userID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// TouchAPIKey records last use, but at most once a minute per key so a busy
// gateway does not turn every completion into an extra SQLite write.
func (s *Store) TouchAPIKey(id string) error {
	_, err := s.db.Exec(`UPDATE api_keys SET last_used=? WHERE id=? AND last_used<?`,
		now(), id, now()-60)
	return err
}

// ---- model upstreams ----

// Upstream is one OpenAI-compatible endpoint a provider contributed to the
// model market. EncKey is the provider's upstream credential, sealed with the
// broker's local gateway key; Models is the list of model ids it serves and
// Price is what the provider charges per 1000 input tokens. PriceOut and
// PriceCached are optional overrides (0 means "same as Price"). MaxContext and
// Caps are the routing contract: the gateway will not send a request the
// upstream did not claim to support.
type Upstream struct {
	ID, OwnerID, Name, BaseURL string
	EncKey                     string
	Models                     []string
	Price                      float64
	MaxContext                 int
	Caps                       []string
	PriceOut                   float64
	PriceCached                float64
	Enabled                    bool
	CreatedAt                  int64
}

func (s *Store) CreateUpstream(u *Upstream) error {
	b, err := json.Marshal(u.Models)
	if err != nil {
		return err
	}
	caps, err := json.Marshal(u.Caps)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO upstreams(id,owner_id,name,base_url,api_key_enc,models,price,
		max_context,caps,price_out,price_cached,enabled,created_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, u.ID, u.OwnerID, u.Name, u.BaseURL, u.EncKey, string(b),
		u.Price, u.MaxContext, string(caps), u.PriceOut, u.PriceCached, b2i(u.Enabled), u.CreatedAt)
	return err
}

func (s *Store) Upstreams() ([]*Upstream, error) {
	return s.queryUpstreams(`SELECT id,owner_id,name,base_url,api_key_enc,models,price,
		max_context,caps,price_out,price_cached,enabled,created_at
		FROM upstreams WHERE enabled=1 ORDER BY price, created_at`)
}

func (s *Store) UpstreamsByOwner(ownerID string) ([]*Upstream, error) {
	return s.queryUpstreams(`SELECT id,owner_id,name,base_url,api_key_enc,models,price,
		max_context,caps,price_out,price_cached,enabled,created_at
		FROM upstreams WHERE owner_id=? ORDER BY created_at DESC`, ownerID)
}

func (s *Store) Upstream(id string) (*Upstream, error) {
	rows, err := s.queryUpstreams(`SELECT id,owner_id,name,base_url,api_key_enc,models,price,
		max_context,caps,price_out,price_cached,enabled,created_at
		FROM upstreams WHERE id=?`, id)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

func (s *Store) queryUpstreams(q string, args ...any) ([]*Upstream, error) {
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Upstream
	for rows.Next() {
		u := &Upstream{}
		var models, caps string
		var enabled int
		if err := rows.Scan(&u.ID, &u.OwnerID, &u.Name, &u.BaseURL, &u.EncKey, &models,
			&u.Price, &u.MaxContext, &caps, &u.PriceOut, &u.PriceCached, &enabled, &u.CreatedAt); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(models), &u.Models)
		json.Unmarshal([]byte(caps), &u.Caps)
		if len(u.Caps) == 0 {
			u.Caps = []string{"chat"}
		}
		u.Enabled = enabled != 0
		out = append(out, u)
	}
	return out, rows.Err()
}

// DeleteUpstream returns false when the row is not owned by this account.
func (s *Store) DeleteUpstream(id, ownerID string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM upstreams WHERE id=? AND owner_id=?`, id, ownerID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// SetUpstreamEnabled lets a provider pause routing to its endpoint without
// losing its model list, price or credential.
func (s *Store) SetUpstreamEnabled(id, ownerID string, enabled bool) (bool, error) {
	res, err := s.db.Exec(`UPDATE upstreams SET enabled=? WHERE id=? AND owner_id=?`,
		b2i(enabled), id, ownerID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// ---- daily spend guards ----

// DayKey is the broker-local calendar day used as the spend bucket. Hub and
// store both go through it so a test writing "yesterday" is unambiguous.
func DayKey(t time.Time) string { return t.Format("2006-01-02") }

// AddGatewaySpend records the actual settled cost of one call against its key.
// The reserve is intentionally not counted: only settled cost should consume a
// daily quota, and refunds never reach this function.
func (s *Store) AddGatewaySpend(keyID, day string, credits float64) error {
	_, err := s.db.Exec(`INSERT INTO gateway_spend(key_id,day,credits,requests) VALUES(?,?,?,1)
		ON CONFLICT(key_id,day) DO UPDATE SET credits=credits+excluded.credits,
		requests=requests+1`, keyID, day, credits)
	return err
}

func (s *Store) GatewaySpendToday(keyID string) (float64, error) {
	var spent float64
	err := s.db.QueryRow(`SELECT COALESCE(SUM(credits),0) FROM gateway_spend
		WHERE key_id=? AND day=?`, keyID, DayKey(time.Now())).Scan(&spent)
	return spent, err
}

func (s *Store) GatewaySpendAllToday() (float64, error) {
	var spent float64
	err := s.db.QueryRow(`SELECT COALESCE(SUM(credits),0) FROM gateway_spend
		WHERE day=?`, DayKey(time.Now())).Scan(&spent)
	return spent, err
}

// ---- usage reconciliation ----

type GatewayUsage struct {
	ID, ReqID, KeyID, UserID, UpstreamID, Model string
	TS                                          int64
	Prompt, Cached, Completion                  int
	Cost                                        float64
	OK                                          bool
}

func (s *Store) AddGatewayUsage(e *GatewayUsage) error {
	_, err := s.db.Exec(`INSERT INTO gateway_usage(id,ts,req_id,key_id,user_id,upstream_id,
		model,prompt,cached,completion,cost,ok) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
		e.ID, e.TS, e.ReqID, e.KeyID, e.UserID, e.UpstreamID, e.Model,
		e.Prompt, e.Cached, e.Completion, e.Cost, b2i(e.OK))
	return err
}

// UsageAgg is one line of the reconciliation view: requests, failures, points
// charged and tokens delivered, grouped by upstream or by model.
type UsageAgg struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Requests   int     `json:"requests"`
	Failed     int     `json:"failed"`
	Cost       float64 `json:"cost"`
	Prompt     int64   `json:"prompt"`
	Completion int64   `json:"completion"`
}

func (s *Store) GatewayUsageSummary(days int) (byUpstream, byModel []UsageAgg, err error) {
	if days <= 0 {
		days = 7
	}
	if days > 90 {
		days = 90
	}
	since := time.Now().AddDate(0, 0, -days).Unix()
	byUpstream, err = s.queryUsageAgg(`SELECT g.upstream_id, COALESCE(u.name,'') ,
			COUNT(*), COALESCE(SUM(CASE WHEN g.ok=0 THEN 1 ELSE 0 END),0),
			COALESCE(SUM(g.cost),0), COALESCE(SUM(g.prompt),0), COALESCE(SUM(g.completion),0)
		FROM gateway_usage g LEFT JOIN upstreams u ON u.id=g.upstream_id
		WHERE g.ts>=? GROUP BY g.upstream_id, u.name ORDER BY COUNT(*) DESC`, since)
	if err != nil {
		return nil, nil, err
	}
	byModel, err = s.queryUsageAgg(`SELECT g.model, '' , COUNT(*),
			COALESCE(SUM(CASE WHEN g.ok=0 THEN 1 ELSE 0 END),0),
			COALESCE(SUM(g.cost),0), COALESCE(SUM(g.prompt),0), COALESCE(SUM(g.completion),0)
		FROM gateway_usage g WHERE g.ts>=? GROUP BY g.model ORDER BY COUNT(*) DESC`, since)
	return byUpstream, byModel, err
}

func (s *Store) queryUsageAgg(q string, args ...any) ([]UsageAgg, error) {
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UsageAgg{}
	for rows.Next() {
		var a UsageAgg
		if err := rows.Scan(&a.ID, &a.Name, &a.Requests, &a.Failed,
			&a.Cost, &a.Prompt, &a.Completion); err != nil {
			return nil, err
		}
		if a.Name == "" {
			a.Name = a.ID
		}
		if a.Name == "" {
			a.Name = "未知上游"
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
