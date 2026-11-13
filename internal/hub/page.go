package hub

import (
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

// listPage holds the additive paging/search parameters documented in
// docs/星舷控制台-后端对接与改造.md §7. Enabled is false unless the caller
// opted in with limit/offset/cursor/q, in which case the response is exactly
// the historical one (no extra fields at all).
type listPage struct {
	Limit   int
	Offset  int
	Enabled bool
}

// cursor is accepted as a numeric alias of offset so a front end can page with
// either vocabulary without a server-side translation table.
func parseListPage(r *http.Request, def, max int) listPage {
	q := r.URL.Query()
	p := listPage{Limit: def}
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			if n > max {
				n = max
			}
			p.Limit = n
		}
		p.Enabled = true
	}
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			p.Offset = n
		}
		p.Enabled = true
	}
	if v := q.Get("cursor"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			p.Offset = n
		}
		p.Enabled = true
	}
	// An explicitly supplied (even empty) q is still a search request: the
	// front end expects total/offset/limit from any search-shaped call.
	if _, ok := q["q"]; ok {
		p.Enabled = true
	}
	return p
}

func listQuery(r *http.Request) string {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(q) > 128 {
		q = string([]rune(q)[:128])
	}
	return q
}

// writePaged adds total/offset/limit only for opted-in requests. Old consoles
// ignore unknown fields anyway, but keeping the legacy body byte-for-byte for
// default requests makes the compatibility claim verifiable.
func writePaged(w http.ResponseWriter, p listPage, payload map[string]any, total int) {
	if p.Enabled {
		payload["total"] = total
		payload["offset"] = p.Offset
		payload["limit"] = p.Limit
	}
	writeJSON(w, payload)
}
