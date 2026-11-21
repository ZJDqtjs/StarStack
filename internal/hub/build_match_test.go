package hub

import (
	"testing"

	"starstack/internal/ffx"
)

func TestBuildReqMatchesOSAndToolchains(t *testing.T) {
	w := node("w", 1, 1)
	w.OS = "windows/amd64"
	w.Runtimes = []ffx.Runtime{{Name: "build"}, {Name: "java"}, {Name: "android-sdk"}}

	cases := []struct {
		name string
		req  Req
		want bool
	}{
		{"no constraint", Req{Runtime: "build"}, true},
		{"os matches", Req{Runtime: "build", GOOS: "windows", Arch: "amd64"}, true},
		{"os differs", Req{Runtime: "build", GOOS: "linux"}, false},
		{"arch differs", Req{Runtime: "build", Arch: "arm64"}, false},
		{"toolchains present", Req{Runtime: "build", Toolchains: []string{"java", "android-sdk"}}, true},
		{"toolchain missing", Req{Runtime: "build", Toolchains: []string{"java", "dotnet"}}, false},
	}
	for _, c := range cases {
		if got := w.meets(c.req, ""); got != c.want {
			t.Errorf("%s: meets=%v want %v", c.name, got, c.want)
		}
	}
}
