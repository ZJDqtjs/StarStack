package hub

import "testing"

// Android / HarmonyOS 节点上报的是 h264_mediacodec（MediaCodec 硬编），任务里写的是 libx264。
// canEncode 只对移动端做家族等价；桌面节点之间必须保持精确匹配，否则
// 「只会 NVENC 的机器」会被派上 libx264 的活，参数对不上导致拼接失败。
func TestCanEncodeFamilyOnlyOpensForMobile(t *testing.T) {
	android := &Worker{OS: "android/arm64", Encoders: []string{"h264_mediacodec", "hevc_mediacodec"}}
	harmony := &Worker{OS: "harmony/arm64", Encoders: []string{"h264_mediacodec", "hevc_mediacodec"}}
	desktop := &Worker{OS: "windows/amd64", Encoders: []string{"h264_nvenc", "libx264"}}

	cases := []struct {
		name  string
		w     *Worker
		codec string
		want  bool
	}{
		{"android 接 libx264", android, "libx264", true},
		{"android 接 libx265", android, "libx265", true},
		{"android 接 h264_nvenc（同 h264 家族）", android, "h264_nvenc", true},
		{"android 不接 av1", android, "libsvtav1", false},
		{"harmony 接 libx264", harmony, "libx264", true},
		{"harmony 接 libx265", harmony, "libx265", true},
		{"harmony 不接 av1", harmony, "libsvtav1", false},
		{"桌面精确命中", desktop, "libx264", true},
		{"桌面不跨家族顶替", desktop, "libx265", false},
		{"桌面 nvenc 不冒充 libx264", &Worker{OS: "windows/amd64", Encoders: []string{"h264_nvenc"}}, "libx264", false},
		{"无编码器上报时拒绝", &Worker{OS: "android/arm64"}, "libx264", false},
	}

	for _, c := range cases {
		if got := c.w.canEncode(c.codec); got != c.want {
			t.Fatalf("%s: canEncode(%q)=%v, want %v", c.name, c.codec, got, c.want)
		}
	}
}

// launch 必须接受 android / harmony，否则 mintLaunch 会把它们悄悄改回 windows，
// App 拿到的启动码就用在了错误的平台上。
func TestLaunchAcceptsMobilePlatforms(t *testing.T) {
	for _, os := range []string{"android", "harmony"} {
		if _, ok := launchOS[os]; !ok {
			t.Fatalf("launchOS 未登记 %s", os)
		}
		if bin := nodeBinName(os, "arm64"); bin == "" {
			t.Fatalf("%s 应返回占位二进制名（实际不会下载）", os)
		}
	}
	if !launchArch["arm64"] {
		t.Fatal("launchArch 不支持 arm64")
	}
}
