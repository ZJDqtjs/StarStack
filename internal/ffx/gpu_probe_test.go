package ffx

import (
	"context"
	"os/exec"
	"testing"
)

// nvidia-smi prints one CSV row per card, and a card with no memory reading
// still has to show up (mem 0) instead of being dropped: the broker's "needs a
// discrete GPU" filter counts rows, not megabytes.
func TestParseGPUs(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []GPUDetail
	}{
		{"two cards", "GeForce GTX 750, 2048\nRTX 4090, 24564\n", []GPUDetail{
			{Name: "GeForce GTX 750", MemMB: 2048},
			{Name: "RTX 4090", MemMB: 24564},
		}},
		{"trailing blank line", "RTX 3060, 12288\n\n", []GPUDetail{
			{Name: "RTX 3060", MemMB: 12288},
		}},
		{"no reading", "Tesla K80, N/A\n", []GPUDetail{{Name: "Tesla K80", MemMB: 0}}},
		{"garbage", "no comma here\n", nil},
		{"empty", "", nil},
	}
	for _, c := range cases {
		got := parseGPUs([]byte(c.in))
		if len(got) != len(c.want) {
			t.Fatalf("%s: got %d cards (%v), want %d", c.name, len(got), got, len(c.want))
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Fatalf("%s: card %d = %+v, want %+v", c.name, i, got[i], c.want[i])
			}
		}
	}
}

// Live probe: this is the assertion the provider cares about. It fails, rather
// than skips, when nvidia-smi exists somewhere on the machine but no candidate
// can read the card — that is exactly the broken-PATH case the fallback list is
// there to survive.
func TestGPUsLive(t *testing.T) {
	found := false
	for _, bin := range nvidiaSMICandidates() {
		if _, err := exec.LookPath(bin); err == nil {
			found = true
			break
		}
	}
	if !found {
		t.Skip("no nvidia-smi on this machine")
	}
	list := GPUs(context.Background())
	if len(list) == 0 {
		t.Fatal("nvidia-smi exists but no candidate reported a card; see `nvidia-smi` output for the driver mismatch")
	}
	for _, g := range list {
		t.Logf("gpu: %s %d MB", g.Name, g.MemMB)
	}
}

// Live probe: whatever this machine really is, the advertised encoder list must
// be a list this machine can open. Logged, not asserted, since the answer
// depends on the silicon — a headless CI box legitimately has none.
func TestEncodersLive(t *testing.T) {
	if _, err := exec.LookPath(Ffmpeg); err != nil {
		t.Skip("ffmpeg not installed")
	}
	encs, err := Encoders(context.Background())
	if err != nil {
		t.Fatalf("list encoders: %v", err)
	}
	kept := filterHardwareEncoders(context.Background(), encs)
	t.Logf("compiled in: %v", encs)
	t.Logf("advertised:  %v", kept)
}
