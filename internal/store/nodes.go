package store

import (
	"time"
)

// AddNodeContribution credits one device for verified work. This is the only
// writer of node-level earnings: the task market and the VM market both go
// through it, so their seconds never get silently added to the same counter.
// The lifetime totals (earned / seconds_billed) are still kept for old rows and
// for clients that only know those two fields.
func (s *Store) AddNodeContribution(nodeID, source string, seconds, amount float64) error {
	task, vm := 1, 0
	if source == "vm" {
		task, vm = 0, 1
	}
	_, err := s.db.Exec(`UPDATE nodes SET
			earned = earned + ?, seconds_billed = seconds_billed + ?,
			earned_task = earned_task + ?, earned_vm = earned_vm + ?,
			billed_task_sec = billed_task_sec + ?, billed_vm_sec = billed_vm_sec + ?
		WHERE id=?`, amount, seconds,
		float64(task)*amount, float64(vm)*amount,
		float64(task)*seconds, float64(vm)*seconds,
		nodeID)
	return err
}

// NodeForDevice is the "one account, one machine, one node" rule. It returns
// the node id an agent must use for this fingerprint:
//
//   - an existing node of this owner (or an unclaimed one that can be bound) wins;
//   - an empty id means the caller should mint a fresh stable id;
//   - conflict means the machine already belongs to a different account, so a
//     second launcher must not be allowed to take it over.
//
// Rows left behind by older builds (device_id = ”) are ignored: there is no
// reliable way to tell which physical machine they came from, and guessing
// would merge two different computers. The console marks those as duplicates
// so their owner can delete them by hand.
func (s *Store) NodeForDevice(ownerID, deviceID, currentID string) (id string, conflict bool, err error) {
	if deviceID == "" {
		return currentID, false, nil
	}
	rows, err := s.db.Query(`SELECT id, COALESCE(owner_id,'') FROM nodes
		WHERE device_id=? ORDER BY registered_at, id`, deviceID)
	if err != nil {
		return "", false, err
	}
	defer rows.Close()
	var mine, unclaimed, others []string
	for rows.Next() {
		var nid, owner string
		if err := rows.Scan(&nid, &owner); err != nil {
			return "", false, err
		}
		switch {
		case ownerID != "" && owner == ownerID:
			mine = append(mine, nid)
		case owner == "":
			unclaimed = append(unclaimed, nid)
		default:
			others = append(others, nid)
		}
	}
	if err := rows.Err(); err != nil {
		return "", false, err
	}
	// The agent's own id stays authoritative when it already names one of the
	// nodes we would have picked anyway; changing it would orphan its cached
	// credential and its in-flight slices.
	for _, group := range [][]string{mine, unclaimed} {
		for _, nid := range group {
			if nid == currentID {
				return currentID, false, nil
			}
		}
	}
	if len(mine) > 0 {
		return mine[0], false, nil
	}
	if len(unclaimed) > 0 {
		return unclaimed[0], false, nil
	}
	if len(others) > 0 {
		return "", true, nil
	}
	return "", false, nil
}

// NodeIDsByDevice lists every node ever registered for a fingerprint. A
// returning agent presents the credential of the node the broker folded it
// into, which may no longer be the id written in its launcher config.
func (s *Store) NodeIDsByDevice(deviceID string) ([]string, error) {
	if deviceID == "" {
		return nil, nil
	}
	rows, err := s.db.Query(`SELECT id FROM nodes WHERE device_id=? ORDER BY registered_at, id`, deviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// RetireNode removes a node from its owner's pool and leaves a tombstone. The
// ledger, segments and communication logs are deliberately kept: they are the
// audit trail of work that was already paid for, and deleting them would make
// the seller's contribution history silently shrink.
func (s *Store) RetireNode(nodeID, ownerID, deviceID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM vm_offers WHERE node_id=?`, nodeID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM nodes WHERE id=?`, nodeID); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO retired_nodes(node_id,owner_id,device_id,retired_at)
		VALUES(?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET
		owner_id=excluded.owner_id, device_id=excluded.device_id, retired_at=excluded.retired_at`,
		nodeID, ownerID, deviceID, time.Now().Unix()); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) IsRetiredNode(nodeID string) bool {
	var one int
	err := s.db.QueryRow(`SELECT 1 FROM retired_nodes WHERE node_id=?`, nodeID).Scan(&one)
	return err == nil
}

// EarningsBySource sums the seller's entire Earn history (not a page of it).
// source was added after the first deployments, so older rows are classified
// from the shape of the entry: no node means a model upstream, a "云主机" note
// means a VM rental, everything else is a verified task slice.
func (s *Store) EarningsBySource(userID string) (map[string]float64, error) {
	rows, err := s.db.Query(`SELECT CASE
			WHEN source<>'' THEN source
			WHEN node_id IS NULL OR node_id='' THEN 'model'
			WHEN note LIKE '云主机%' THEN 'vm'
			ELSE 'task' END AS src, COALESCE(SUM(amount),0)
		FROM ledger WHERE user_id=? AND kind=? GROUP BY src`, userID, Earn)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]float64{"task": 0, "vm": 0, "model": 0}
	for rows.Next() {
		var src string
		var amount float64
		if err := rows.Scan(&src, &amount); err != nil {
			return nil, err
		}
		out[src] = amount
	}
	return out, rows.Err()
}

// EarningsByNode is the same ledger viewed per device, used to reconcile the
// account-level ("seller") contribution against the per-node totals.
func (s *Store) EarningsByNode(userID string) (map[string]float64, error) {
	rows, err := s.db.Query(`SELECT node_id, COALESCE(SUM(amount),0) FROM ledger
		WHERE user_id=? AND kind=? AND node_id IS NOT NULL AND node_id<>''
		GROUP BY node_id`, userID, Earn)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var id string
		var amount float64
		if err := rows.Scan(&id, &amount); err != nil {
			return nil, err
		}
		out[id] = amount
	}
	return out, rows.Err()
}
