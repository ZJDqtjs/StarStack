package store

import (
	"strings"
)

// The console's list endpoints historically returned a fixed, hard-capped
// slice. These paged variants are additive: handlers that do not see the new
// query parameters keep calling the original functions and keep the original
// response shape. Every paged query returns the real total so the UI can render
// paging without a second round trip.

const maxSearchTerms = 6

func searchTerms(query string) []string {
	fields := strings.Fields(strings.ToLower(query))
	if len(fields) > maxSearchTerms {
		fields = fields[:maxSearchTerms]
	}
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if r := []rune(f); len(r) > 64 {
			f = string(r[:64])
		}
		out = append(out, f)
	}
	return out
}

// searchClauses ANDs one case-insensitive substring match per term over a SQL
// haystack expression. instr/lower is deliberate: these tables are small, and
// it avoids LIKE wildcard escaping for user input.
func searchClauses(haystack, query string, args []any) (string, []any) {
	var b strings.Builder
	for _, term := range searchTerms(query) {
		b.WriteString(` AND instr(lower(`)
		b.WriteString(haystack)
		b.WriteString(`), lower(?)) > 0`)
		args = append(args, term)
	}
	return b.String(), args
}

func (s *Store) pageCount(query string, args ...any) (int, error) {
	var n int
	err := s.db.QueryRow(query, args...).Scan(&n)
	return n, err
}

// ServiceOffersPage narrows listings by category and free-text query, then
// returns one page in the same newest-first order as ServiceOffers (with a
// stable id tiebreaker so paging cannot repeat a row).
func (s *Store) ServiceOffersPage(category, query string, limit, offset int) ([]*ServiceOffer, int, error) {
	where, args := "", []any{}
	if category != "" {
		where, args = ` WHERE o.category=?`, append(args, category)
	}
	clauses, args := searchClauses(`coalesce(o.title,'')||' '||coalesce(o.body,'')||' '||coalesce(o.spec,'')||' '||coalesce(o.category,'')||' '||coalesce(u.name,'')`, query, args)
	if clauses != "" {
		if where == "" {
			where = ` WHERE 1=1`
		}
		where += clauses
	}
	from := ` FROM service_offers o LEFT JOIN users u ON u.id=o.user_id`
	total, err := s.pageCount(`SELECT COUNT(*)`+from+where, args...)
	if err != nil {
		return nil, 0, err
	}
	listArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.db.Query(`SELECT `+offerCols+from+where+` ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?`, listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*ServiceOffer{}
	for rows.Next() {
		o, err := scanOffer(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, o)
	}
	return out, total, rows.Err()
}

// PostsPage searches title, body and author name.
func (s *Store) PostsPage(query string, limit, offset int) ([]*ForumPost, int, error) {
	from := ` FROM forum_posts p LEFT JOIN users u ON u.id=p.user_id`
	clauses, args := searchClauses(`coalesce(p.title,'')||' '||coalesce(p.body,'')||' '||coalesce(u.name,'')`, query, nil)
	where := ""
	if clauses != "" {
		where = ` WHERE 1=1` + clauses
	}
	total, err := s.pageCount(`SELECT COUNT(*)`+from+where, args...)
	if err != nil {
		return nil, 0, err
	}
	listArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.db.Query(`SELECT `+postCols+from+where+` ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?`, listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*ForumPost{}
	for rows.Next() {
		p, err := scanPost(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, p)
	}
	return out, total, rows.Err()
}

// OfferConversationsPage keeps the viewer's private threads only; viewerID is
// also the first argument of offerConvCols so "peer" resolves correctly.
func (s *Store) OfferConversationsPage(userID, offerID string, limit, offset int) ([]*OfferConversationView, int, error) {
	where := ` WHERE (c.buyer_id=? OR c.seller_id=?)`
	countArgs := []any{userID, userID}
	if offerID != "" {
		where += ` AND c.offer_id=?`
		countArgs = append(countArgs, offerID)
	}
	total, err := s.pageCount(`SELECT COUNT(*) FROM offer_conversations c`+where, countArgs...)
	if err != nil {
		return nil, 0, err
	}
	args := append([]any{userID}, countArgs...)
	args = append(args, limit, offset)
	rows, err := s.db.Query(`SELECT `+offerConvCols+offerConvJoins+where+
		` ORDER BY c.updated_at DESC,c.id DESC LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*OfferConversationView{}
	for rows.Next() {
		v, err := scanOfferConv(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, v)
	}
	return out, total, rows.Err()
}

// OfferMessagesPage pages newest messages first, then returns that page in
// chronological order just like OfferMessages. offset therefore counts back
// from the newest message.
func (s *Store) OfferMessagesPage(conversationID string, limit, offset int) ([]*OfferMessage, int, error) {
	total, err := s.pageCount(`SELECT COUNT(*) FROM offer_messages WHERE conversation_id=?`, conversationID)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(`SELECT m.id,m.conversation_id,m.sender_id,
		COALESCE(u.name,'已注销'),m.body,m.created_at
		FROM offer_messages m LEFT JOIN users u ON u.id=m.sender_id
		WHERE m.conversation_id=? ORDER BY m.created_at DESC,m.rowid DESC LIMIT ? OFFSET ?`,
		conversationID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*OfferMessage{}
	for rows.Next() {
		m := &OfferMessage{}
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.Sender, &m.Body, &m.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, total, nil
}

// JobsByOwnerPage pages the account's jobs before loading segments, so a large
// history does not deserialize every segment of every job.
func (s *Store) JobsByOwnerPage(ownerID string, limit, offset int) ([]*JobRow, int, error) {
	total, err := s.pageCount(`SELECT COUNT(*) FROM jobs WHERE owner_id=?`, ownerID)
	if err != nil {
		return nil, 0, err
	}
	jobs, err := s.queryJobs(`SELECT `+jobCols+` FROM jobs WHERE owner_id=?
		ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`, ownerID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	for _, j := range jobs {
		if err := s.loadSegs(j); err != nil {
			return nil, 0, err
		}
	}
	return jobs, total, nil
}

// LedgerForUserPage and LedgerForNodesPage page the two ledger halves
// independently; the handler reports both totals because they are different
// result sets (spend vs earnings).
func (s *Store) LedgerForUserPage(userID string, limit, offset int) ([]*Entry, int, error) {
	total, err := s.pageCount(`SELECT COUNT(*) FROM ledger WHERE user_id=?`, userID)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.queryLedger(`SELECT `+ledgerCols+` FROM ledger
		WHERE user_id=? ORDER BY ts DESC,id DESC LIMIT ? OFFSET ?`, userID, limit, offset)
	return rows, total, err
}

func (s *Store) LedgerForNodesPage(nodeIDs []string, limit, offset int) ([]*Entry, int, error) {
	if len(nodeIDs) == 0 {
		return nil, 0, nil
	}
	where := ` WHERE node_id IN (`
	args := make([]any, 0, len(nodeIDs)+2)
	for i, id := range nodeIDs {
		if i > 0 {
			where += ","
		}
		where += "?"
		args = append(args, id)
	}
	where += `)`
	total, err := s.pageCount(`SELECT COUNT(*) FROM ledger`+where, args...)
	if err != nil {
		return nil, 0, err
	}
	args = append(args, limit, offset)
	rows, err := s.queryLedger(`SELECT `+ledgerCols+` FROM ledger`+where+
		` ORDER BY ts DESC,id DESC LIMIT ? OFFSET ?`, args...)
	return rows, total, err
}
