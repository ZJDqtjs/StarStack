//go:build windows

package ffx

import (
	"os/exec"
	"strings"
)

// MachineGuid is written by Windows setup and survives reboots, renames and
// user changes. Reading it through `reg query` avoids pulling a Windows-only
// registry dependency into the agent.
func machineID() string {
	out, err := exec.Command("reg", "query",
		`HKLM\SOFTWARE\Microsoft\Cryptography`, "/v", "MachineGuid").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Fields(line)
		if len(f) >= 3 && strings.EqualFold(f[0], "MachineGuid") {
			return f[len(f)-1]
		}
	}
	return ""
}
