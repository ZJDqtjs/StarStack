package store

import (
	"database/sql"
	"errors"
	"time"
)

// OAuthIdentity is one third-party account bound to a platform account. subject
// is the provider's own immutable user id (GitHub's numeric id, Google's sub),
// never the login name: people rename themselves, ids do not change.
type OAuthIdentity struct {
	Provider  string `json:"provider"`
	Subject   string `json:"subject"`
	UserID    string `json:"-"`
	Login     string `json:"login,omitempty"`
	Email     string `json:"email,omitempty"`
	CreatedAt int64  `json:"created_at"`
}

func (s *Store) CreateOAuthIdentity(o *OAuthIdentity) error {
	if o.CreatedAt == 0 {
		o.CreatedAt = now()
	}
	_, err := s.db.Exec(`INSERT INTO oauth_identities(provider,subject,user_id,login,email,created_at)
		VALUES(?,?,?,?,?,?)
		ON CONFLICT(provider,subject) DO UPDATE SET login=excluded.login, email=excluded.email`,
		o.Provider, o.Subject, o.UserID, o.Login, o.Email, o.CreatedAt)
	return err
}

func (s *Store) OAuthIdentity(provider, subject string) (*OAuthIdentity, error) {
	o := &OAuthIdentity{}
	err := s.db.QueryRow(`SELECT provider,subject,user_id,login,email,created_at FROM oauth_identities
		WHERE provider=? AND subject=?`, provider, subject).
		Scan(&o.Provider, &o.Subject, &o.UserID, &o.Login, &o.Email, &o.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return o, nil
}

func (s *Store) OAuthIdentitiesByUser(userID string) ([]*OAuthIdentity, error) {
	rows, err := s.db.Query(`SELECT provider,subject,user_id,login,email,created_at FROM oauth_identities
		WHERE user_id=? ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*OAuthIdentity
	for rows.Next() {
		o := &OAuthIdentity{}
		if err := rows.Scan(&o.Provider, &o.Subject, &o.UserID, &o.Login, &o.Email, &o.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *Store) DeleteOAuthIdentity(userID, provider string) error {
	_, err := s.db.Exec(`DELETE FROM oauth_identities WHERE user_id=? AND provider=?`, userID, provider)
	return err
}

// DeleteOAuthIdentityBySubject is the unbind path used by the callback when a
// provider account turns out to be bound to somebody else.
func (s *Store) DeleteOAuthIdentityBySubject(provider, subject string) error {
	_, err := s.db.Exec(`DELETE FROM oauth_identities WHERE provider=? AND subject=?`, provider, subject)
	return err
}

// ---- email verification codes ----

// EmailCode is a one-shot code row. Only its hash is stored.
type EmailCode struct {
	ID        int64
	Email     string
	Purpose   string
	Hash      string
	Attempts  int
	ExpiresAt int64
	CreatedAt int64
}

// PutEmailCode stores a new code and drops every earlier row for the same
// (email, purpose): a user who asks for a second code must not be able to keep
// using the first, and the table must not grow by one row per click.
func (s *Store) PutEmailCode(email, purpose, hash string, ttl time.Duration) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM email_codes WHERE email=? AND purpose=?`,
		normalizeEmail(email), purpose); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO email_codes(email,purpose,hash,attempts,expires_at,created_at)
		VALUES(?,?,?,0,?,?)`, normalizeEmail(email), purpose, hash,
		time.Now().Add(ttl).Unix(), now()); err != nil {
		return err
	}
	return tx.Commit()
}

// LatestEmailCode returns the newest still-usable row, expired ones excluded.
func (s *Store) LatestEmailCode(email, purpose string) (*EmailCode, error) {
	c := &EmailCode{}
	err := s.db.QueryRow(`SELECT id,email,purpose,hash,attempts,expires_at,created_at
		FROM email_codes WHERE email=? AND purpose=? AND expires_at>?
		ORDER BY created_at DESC LIMIT 1`, normalizeEmail(email), purpose, now()).
		Scan(&c.ID, &c.Email, &c.Purpose, &c.Hash, &c.Attempts, &c.ExpiresAt, &c.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Store) BumpEmailCodeAttempts(id int64) error {
	_, err := s.db.Exec(`UPDATE email_codes SET attempts=attempts+1 WHERE id=?`, id)
	return err
}

func (s *Store) DeleteEmailCodes(email, purpose string) error {
	_, err := s.db.Exec(`DELETE FROM email_codes WHERE email=? AND purpose=?`,
		normalizeEmail(email), purpose)
	return err
}

// CountEmailCodes counts codes issued for an address since ts. It is how the
// sender is rate limited per mailbox, independently of the per-IP limiter.
func (s *Store) CountEmailCodes(email string, since int64) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM email_codes WHERE email=? AND created_at>=?`,
		normalizeEmail(email), since).Scan(&n)
	return n, err
}

// PurgeEmailCodes drops rows that can never be used again. Cheap enough to run
// on every send, which keeps the table from growing without a cron job.
func (s *Store) PurgeEmailCodes() {
	s.db.Exec(`DELETE FROM email_codes WHERE expires_at < ?`, now()-86400)
}
