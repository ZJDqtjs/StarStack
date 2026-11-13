package hub

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"

	"starstack/internal/store"
)

// /api/state is polled once a second by both consoles and serialises every
// worker and every live job. A strong ETag lets the browser revalidate instead
// of downloading an identical body. The tag is computed from the body without
// "now" (which changes every second and would defeat every conditional
// request) plus the viewer's identity, so switching accounts can never be
// served another account's cached private fields.
func stateETag(u *store.User, payload map[string]any) string {
	// "since" (seconds since a heartbeat) and "parked_sec" (cooldown left)
	// change on every poll even when nothing happened. Bucket them into 5s
	// windows so an idle pool still yields a reusable validator, while the
	// console's countdowns are refreshed at most 5s late on a 304.
	const bucketSeconds = 5
	stable := make(map[string]any, len(payload))
	for k, v := range payload {
		stable[k] = v
	}
	if ws, ok := stable["workers"].([]map[string]any); ok {
		cleaned := make([]map[string]any, 0, len(ws))
		for _, w := range ws {
			c := make(map[string]any, len(w))
			for k, v := range w {
				c[k] = v
			}
			if v, ok := c["since"].(float64); ok {
				c["since"] = int64(v) / bucketSeconds
			} else {
				delete(c, "since")
			}
			if v, ok := c["parked_sec"].(int); ok {
				c["parked_sec"] = v / bucketSeconds
			} else {
				delete(c, "parked_sec")
			}
			cleaned = append(cleaned, c)
		}
		stable["workers"] = cleaned
	}
	body, err := json.Marshal(stable)
	if err != nil {
		return ""
	}
	viewer := "anonymous"
	if u != nil {
		viewer = u.ID
	}
	h := sha256.New()
	h.Write([]byte(viewer))
	h.Write([]byte{0})
	h.Write(body)
	sum := h.Sum(nil)
	return `"` + hex.EncodeToString(sum[:16]) + `"`
}

// etagMatches handles weak validators, comma-separated lists and the wildcard
// form, all of which a browser or proxy may send in If-None-Match.
func etagMatches(header, tag string) bool {
	for _, part := range strings.Split(header, ",") {
		v := strings.TrimSpace(part)
		v = strings.TrimPrefix(v, "W/")
		if v == "*" || v == tag {
			return true
		}
	}
	return false
}
