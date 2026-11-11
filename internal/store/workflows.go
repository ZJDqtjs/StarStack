package store

import (
	"database/sql"
	"time"
)

// ComfyWorkflow is one graph a user deployed, saved as a preset or left as a
// draft. Graph holds the ComfyUI UI-format workflow JSON verbatim, so a file
// exported here can be dragged straight into an upstream ComfyUI window.
type ComfyWorkflow struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	Kind      string `json:"kind"`  // image | video
	Scope     string `json:"scope"` // template | preset | draft
	Name      string `json:"name"`
	Graph     string `json:"graph"`
	Active    int    `json:"active"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

const comfyWorkflowCols = `id,user_id,kind,scope,name,graph,active,created_at,updated_at`

func scanComfyWorkflow(row interface{ Scan(...any) error }) (*ComfyWorkflow, error) {
	w := &ComfyWorkflow{}
	err := row.Scan(&w.ID, &w.UserID, &w.Kind, &w.Scope, &w.Name, &w.Graph,
		&w.Active, &w.CreatedAt, &w.UpdatedAt)
	return w, err
}

// PutComfyWorkflow inserts or updates a graph owned by the same user. The
// WHERE on the conflict clause makes an id belonging to somebody else a no-op
// instead of an overwrite.
func (s *Store) PutComfyWorkflow(w *ComfyWorkflow) (bool, error) {
	now := time.Now().Unix()
	if w.CreatedAt == 0 {
		w.CreatedAt = now
	}
	w.UpdatedAt = now
	res, err := s.db.Exec(`INSERT INTO comfy_workflows (`+comfyWorkflowCols+`)
		VALUES(?,?,?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET
			kind=excluded.kind, scope=excluded.scope, name=excluded.name,
			graph=excluded.graph, active=excluded.active, updated_at=excluded.updated_at
		WHERE comfy_workflows.user_id=excluded.user_id`,
		w.ID, w.UserID, w.Kind, w.Scope, w.Name, w.Graph, w.Active, w.CreatedAt, w.UpdatedAt)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *Store) ComfyWorkflows(userID, kind string) ([]*ComfyWorkflow, error) {
	query := `SELECT ` + comfyWorkflowCols + ` FROM comfy_workflows WHERE user_id=?`
	args := []any{userID}
	if kind != "" {
		query += ` AND kind=?`
		args = append(args, kind)
	}
	query += ` ORDER BY updated_at DESC LIMIT 100`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*ComfyWorkflow{}
	for rows.Next() {
		w, err := scanComfyWorkflow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (s *Store) ComfyWorkflow(id, userID string) (*ComfyWorkflow, error) {
	row := s.db.QueryRow(`SELECT `+comfyWorkflowCols+`
		FROM comfy_workflows WHERE id=? AND user_id=?`, id, userID)
	w, err := scanComfyWorkflow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return w, err
}

func (s *Store) DeleteComfyWorkflow(id, userID string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM comfy_workflows WHERE id=? AND user_id=?`, id, userID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// ActivateComfyWorkflow makes one graph the default for a section. Only one
// graph per (user, kind) is active, which is what the 生图/生视频 forms read.
func (s *Store) ActivateComfyWorkflow(id, userID, kind string) (bool, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE comfy_workflows SET active=0
		WHERE user_id=? AND kind=?`, userID, kind); err != nil {
		return false, err
	}
	res, err := tx.Exec(`UPDATE comfy_workflows SET active=1, updated_at=?
		WHERE id=? AND user_id=? AND kind=?`, time.Now().Unix(), id, userID, kind)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	if n == 0 {
		return false, nil
	}
	return true, tx.Commit()
}

func (s *Store) ActiveComfyWorkflow(userID, kind string) (*ComfyWorkflow, error) {
	row := s.db.QueryRow(`SELECT `+comfyWorkflowCols+`
		FROM comfy_workflows WHERE user_id=? AND kind=? AND active=1
		ORDER BY updated_at DESC LIMIT 1`, userID, kind)
	w, err := scanComfyWorkflow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return w, err
}
