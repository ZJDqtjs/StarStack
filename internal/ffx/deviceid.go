package ffx

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"runtime"
	"strings"
)

// MachineID is a stable, opaque fingerprint of the physical machine running
// the agent. It is hashed so the broker never stores a hardware serial or a
// motherboard UUID, and it deliberately does not include the process id: a
// restarted worker must still be the same node, with the same owner, price,
// reputation and contribution history.
//
// The platform files read an OS-level machine id. When that is unavailable
// (containers, locked-down Windows, unsupported OS) we fall back to identity
// that is weaker but still stable across restarts; the broker also keeps the
// per-node credential as a second factor.
func MachineID() string {
	raw := strings.TrimSpace(machineID())
	if raw == "" {
		host, _ := os.Hostname()
		raw = strings.Join([]string{
			host, os.Getenv("USERNAME"), os.Getenv("USER"), runtime.GOOS, runtime.GOARCH,
		}, "|")
	}
	sum := sha256.Sum256([]byte(raw))
	return "dev-" + hex.EncodeToString(sum[:])[:16]
}
