//go:build darwin

package ffx

import (
	"os/exec"
	"strings"
)

func machineID() string {
	out, err := exec.Command("ioreg", "-rd1", "-c", "IOPlatformExpertDevice").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.Contains(line, "IOPlatformUUID") {
			continue
		}
		// "IOPlatformUUID" = "XXXXXXXX-..."
		parts := strings.Split(line, `"`)
		if len(parts) >= 4 {
			return parts[3]
		}
	}
	return ""
}
