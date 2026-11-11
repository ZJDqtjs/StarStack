//go:build !windows && !linux && !darwin

package ffx

// No OS-level machine id on this platform; MachineID falls back to the
// hostname + account identity, which is still stable across restarts.
func machineID() string { return "" }
