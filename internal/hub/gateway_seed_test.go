package hub

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"starstack/internal/auth"
	"starstack/internal/store"
)

// captureLogs redirects the package-global logger for one synchronous call.
// Tests here never run in parallel.
func captureLogs(t *testing.T, fn func()) string {
	t.Helper()
	var buf bytes.Buffer
	old := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(old)
	fn()
	log.SetOutput(old)
	return buf.String()
}

func vendorUpstream(t *testing.T, usage string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/models" {
			io.WriteString(w, `{"data":[{"id":"deepseek-chat"},{"id":"deepseek-reasoner"},{"id":"Qwen/Qwen3-32B"}]}`)
			return
		}
		if usage != "" {
			io.WriteString(w, usage)
			return
		}
		io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"ok"}}],
			"usage":{"prompt_tokens":10,"completion_tokens":10}}`)
	}))
}

func createKeyWithQuota(t *testing.T, base string, cookie *http.Cookie, quota float64) (string, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, base+"/api/keys",
		strings.NewReader(fmt.Sprintf(`{"name":"限额测试","daily_quota":%g}`, quota)))
	var out struct {
		Key string `json:"key"`
		ID  string `json:"id"`
	}
	if code := postJSON(t, withCookie(req, cookie), nil, &out); code != 200 || out.Key == "" {
		t.Fatalf("create key with quota %g: HTTP %d %+v", quota, code, out)
	}
	return out.Key, out.ID
}

func getUsage(t *testing.T, base string, cookie *http.Cookie) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, base+"/api/models/usage?days=7", nil)
	req.AddCookie(cookie)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	var out map[string]any
	if len(body) > 0 {
		json.Unmarshal(body, &out)
	}
	return res.StatusCode, out
}

func TestSeedHostAllowlist(t *testing.T) {
	cases := []struct {
		base   string
		public bool
		want   bool
	}{
		{"https://ai.yun.139.com/api/llm/102001/v1", false, true},
		{"https://ai.yun.139.com/api/llm/102001/v1", true, true},
		{"https://API.DEEPSEEK.COM", true, true},
		{"https://sub.api.deepseek.com", true, true},
		{"https://sketchy-reseller.example", false, false},
		{"http://127.0.0.1:8080", false, true}, // local demo/test endpoint only
		{"http://127.0.0.1:8080", true, false}, // public profile never seeds loopback
		{"file:///etc/passwd", false, false},
	}
	for _, c := range cases {
		if got := seedHostAllowed(c.base, c.public); got != c.want {
			t.Errorf("seedHostAllowed(%q, public=%v) = %v, want %v",
				c.base, c.public, got, c.want)
		}
	}
}

func TestSeedNoEnvIsNoOp(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	logs := captureLogs(t, func() { s.SeedPlatformUpstreams() })
	if strings.Contains(logs, "自营上游") {
		t.Fatalf("不配 env 时不应有播种日志：%s", logs)
	}
	ups, err := s.st.Upstreams()
	if err != nil || len(ups) != 0 {
		t.Fatalf("不配 env 不应产生上游：%v %d", err, len(ups))
	}
	if s.maxPromptTokens != DefaultGatewayMaxPromptTokens || s.maxTokens != DefaultGatewayMaxTokens {
		t.Fatalf("默认上限被改动：%d/%d", s.maxPromptTokens, s.maxTokens)
	}
}

func TestPlatformAccountResolvesWithoutSeeding(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	salt := auth.NewSalt()
	u := &store.User{
		ID: "u-platform", Name: "platform-x",
		PassHash: auth.Hash("testpass123", salt, auth.Iterations),
		Salt:     hex.EncodeToString(salt), Iter: auth.Iterations,
		CreatedAt: time.Now().Unix(),
	}
	if err := s.st.CreateUser(u); err != nil {
		t.Fatal(err)
	}
	s.SetPlatformAccount("platform-x")
	if s.platformOwnerID != u.ID || !s.isPlatformUser(u) {
		t.Fatalf("停播种重启后应仍能识别自营账户：id=%q", s.platformOwnerID)
	}

	broker := httptest.NewServer(s.Handlers())
	defer broker.Close()
	res, err := http.Post(broker.URL+"/api/auth/register", "application/json",
		strings.NewReader(`{"name":"platform-x","password":"testpass123"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatalf("自营账户名应保留，不能被抢注：HTTP %d", res.StatusCode)
	}
}

func TestSeedPlatformUpstreamsIdempotent(t *testing.T) {
	vendor := vendorUpstream(t, "")
	defer vendor.Close()

	s := newTestServer(t, DefaultPolicy())
	t.Setenv("STARSTACK_PLATFORM_USER", "starstack-platform")
	t.Setenv("STARSTACK_PLATFORM_PASSWORD", "testpass123")
	t.Setenv("STARSTACK_POINT_YUAN", "0.01")
	t.Setenv("STARSTACK_SEED_UPSTREAMS", fmt.Sprintf(`[
	 {"name":"DeepSeek 官方","base_url":%q,"api_key":"sk-fake-key",
	  "models":["deepseek-chat","deepseek-reasoner"],"caps":["tools","json_object","prefix_cache"],
	  "cost_in_yuan_per_1k":0.002,"cost_out_yuan_per_1k":0.008,"markup":1.35,"max_context":65536},
	 {"name":"硅基流动","base_url":%q,"api_key":"sk-other-key",
	  "models":["Qwen/Qwen3-32B","not-listed-model"],"caps":["tools"],
	  "cost_in_yuan_per_1k":0.002,"markup":1.35,"max_context":32768}]`,
		vendor.URL, vendor.URL+"/v1"))

	logs := captureLogs(t, func() {
		s.SeedPlatformUpstreams()
		s.SeedPlatformUpstreams() // restart: must not insert duplicates
	})

	owner, err := s.st.UserByName("starstack-platform")
	if err != nil || owner.ID != s.platformOwnerID {
		t.Fatalf("平台自营账户未创建/未绑定 owner：%v %q", err, s.platformOwnerID)
	}
	ups, err := s.st.UpstreamsByOwner(owner.ID)
	if err != nil || len(ups) != 2 {
		t.Fatalf("期望 2 条自营上游，实际 %d (%v)；日志：%s", len(ups), err, logs)
	}
	for _, up := range ups {
		if up.EncKey == "" || strings.Contains(up.EncKey, "sk-fake") || strings.Contains(up.EncKey, "sk-other") {
			t.Fatalf("凭据未加密：%q", up.EncKey)
		}
		if _, err := s.secrets.open(up.EncKey); err != nil {
			t.Fatalf("凭据无法解密：%v", err)
		}
		if up.Name == "DeepSeek 官方" {
			if up.Price != 0.27 || up.PriceOut != 1.08 || up.MaxContext != 65536 {
				t.Fatalf("换算结果不对：in=%g out=%g ctx=%d", up.Price, up.PriceOut, up.MaxContext)
			}
			if !has(up.Caps, "tools") || !has(up.Caps, "prefix_cache") {
				t.Fatalf("能力归一化丢失：%v", up.Caps)
			}
		} else if up.Price != 0.27 || up.PriceOut != 0 {
			t.Fatalf("缺省输出价应沿用输入价：in=%g out=%g", up.Price, up.PriceOut)
		}
		view := s.upstreamView(up)
		if view["official"] != true || view["has_key"] != true || view["key_state"] != "ok" {
			t.Fatalf("自营上游展示字段不对：%v", view)
		}
	}
	if strings.Contains(logs, "sk-fake-key") || strings.Contains(logs, "sk-other-key") {
		t.Fatal("日志出现明文厂商 key")
	}
	if !strings.Contains(logs, "自营上游已播种") || !strings.Contains(logs, "已存在，跳过") {
		t.Fatalf("缺少播种/幂等日志：%s", logs)
	}
	if !strings.Contains(logs, "警告") || !strings.Contains(logs, "not-listed-model") {
		t.Fatalf("配置模型不在厂商列表时应 warn 且保留：%s", logs)
	}
	catalog := s.modelCatalog()
	found := false
	for _, m := range catalog {
		if m.Official {
			found = true
		}
	}
	if !found {
		t.Fatal("模型目录缺少 official 标记")
	}
}

func TestSeedFailuresAreNonFatal(t *testing.T) {
	t.Run("invalid json", func(t *testing.T) {
		s := newTestServer(t, DefaultPolicy())
		t.Setenv("STARSTACK_SEED_UPSTREAMS", `{not json`)
		logs := captureLogs(t, func() { s.SeedPlatformUpstreams() })
		if !strings.Contains(logs, "不是合法 JSON") {
			t.Fatalf("解析失败应打日志：%s", logs)
		}
		if n, _ := s.st.Upstreams(); len(n) != 0 {
			t.Fatal("解析失败不应插入上游")
		}
	})
	t.Run("missing password", func(t *testing.T) {
		vendor := vendorUpstream(t, "")
		defer vendor.Close()
		s := newTestServer(t, DefaultPolicy())
		t.Setenv("STARSTACK_PLATFORM_USER", "platform-x")
		t.Setenv("STARSTACK_SEED_UPSTREAMS", fmt.Sprintf(
			`[{"name":"x","base_url":%q,"api_key":"fake","models":["m"],"cost_in_yuan_per_1k":0.002}]`,
			vendor.URL))
		logs := captureLogs(t, func() { s.SeedPlatformUpstreams() })
		if !strings.Contains(logs, "不创建账户、不播种") {
			t.Fatalf("缺口令应有明确日志：%s", logs)
		}
		if _, err := s.st.UserByName("platform-x"); err == nil {
			t.Fatal("缺口令不应创建账户")
		}
	})
	t.Run("missing account name", func(t *testing.T) {
		s := newTestServer(t, DefaultPolicy())
		t.Setenv("STARSTACK_SEED_UPSTREAMS", `[{"name":"x","base_url":"https://api.deepseek.com","models":["m"]}]`)
		logs := captureLogs(t, func() { s.SeedPlatformUpstreams() })
		if !strings.Contains(logs, "STARSTACK_PLATFORM_USER") {
			t.Fatalf("缺账户名应有明确日志：%s", logs)
		}
	})
	t.Run("host outside vendor whitelist", func(t *testing.T) {
		s := newTestServer(t, DefaultPolicy())
		t.Setenv("STARSTACK_PLATFORM_USER", "platform-y")
		t.Setenv("STARSTACK_PLATFORM_PASSWORD", "testpass123")
		t.Setenv("STARSTACK_SEED_UPSTREAMS",
			`[{"name":"x","base_url":"https://sketchy-reseller.example","api_key":"fake","models":["m"],"cost_in_yuan_per_1k":0.002}]`)
		logs := captureLogs(t, func() { s.SeedPlatformUpstreams() })
		if !strings.Contains(logs, "白名单") {
			t.Fatalf("非白名单主机应被拒绝：%s", logs)
		}
		if n, _ := s.st.Upstreams(); len(n) != 0 {
			t.Fatal("非白名单主机不应入库")
		}
	})
}

func TestGatewayDailyQuota(t *testing.T) {
	vendor := vendorUpstream(t, `{"choices":[{"message":{"content":"ok"}}],
		"usage":{"prompt_tokens":15,"completion_tokens":100}}`)
	defer vendor.Close()

	s := newTestServer(t, DefaultPolicy())
	broker := httptest.NewServer(s.Handlers())
	defer broker.Close()
	providerCookie, _ := registerAndCookie(t, broker.URL, "provider")
	buyerCookie, _ := registerAndCookie(t, broker.URL, "buyer")
	createUpstreamJSON(t, broker.URL, providerCookie, fmt.Sprintf(
		`{"name":"u","base_url":%q,"models":"m","price":10,"max_context":131072}`, vendor.URL))

	const chatBody = `{"model":"m","messages":[{"role":"user","content":"hello"}],"max_tokens":100}`

	limited, _ := createKeyWithQuota(t, broker.URL, buyerCookie, 0.1)
	if code, body := chat(t, broker.URL, limited, chatBody); code != 429 ||
		!strings.Contains(body, "该密钥今日额度已用完") {
		t.Fatalf("限额 0.1 + 大额预扣应 429：HTTP %d %s", code, body)
	}

	unlimited, _ := createKeyWithQuota(t, broker.URL, buyerCookie, 0)
	if code, body := chat(t, broker.URL, unlimited, chatBody); code != 200 {
		t.Fatalf("限额 0 应不限：HTTP %d %s", code, body)
	}

	// A large spend yesterday must not consume today's quota.
	crossDay, crossDayID := createKeyWithQuota(t, broker.URL, buyerCookie, 5)
	if err := s.st.AddGatewaySpend(crossDayID, store.DayKey(time.Now().AddDate(0, 0, -1)), 100); err != nil {
		t.Fatal(err)
	}
	if spent, _ := s.st.GatewaySpendToday(crossDayID); spent != 0 {
		t.Fatalf("跨天应归零，实际 %.4f", spent)
	}
	if code, body := chat(t, broker.URL, crossDay, chatBody); code != 200 {
		t.Fatalf("昨日用量不应影响今日：HTTP %d %s", code, body)
	}
	if err := s.st.AddGatewaySpend(crossDayID, store.DayKey(time.Now()), 4.5); err != nil {
		t.Fatal(err)
	}
	if code, body := chat(t, broker.URL, crossDay, chatBody); code != 429 {
		t.Fatalf("今日累计超限额应 429：HTTP %d %s", code, body)
	}
}

func TestGatewayPlatformDailyBudget(t *testing.T) {
	vendor := vendorUpstream(t, `{"choices":[{"message":{"content":"ok"}}],
		"usage":{"prompt_tokens":1000,"completion_tokens":1000}}`)
	defer vendor.Close()

	s := newTestServer(t, DefaultPolicy())
	s.SetGatewayDailyBudget(0.01)
	broker := httptest.NewServer(s.Handlers())
	defer broker.Close()
	providerCookie, _ := registerAndCookie(t, broker.URL, "provider")
	buyerCookie, _ := registerAndCookie(t, broker.URL, "buyer")
	createUpstream(t, broker.URL, providerCookie, "u", vendor.URL, "m", 0.01)
	key := createKey(t, broker.URL, buyerCookie, "预算测试")
	const chatBody = `{"model":"m","messages":[{"role":"user","content":"hello"}],"max_tokens":1}`
	if code, body := chat(t, broker.URL, key, chatBody); code != 200 {
		t.Fatalf("预算内首次请求应成功：HTTP %d %s", code, body)
	}
	if code, body := chat(t, broker.URL, key, chatBody); code != 503 ||
		!strings.Contains(body, "platform_budget_exhausted") {
		t.Fatalf("预算耗尽后应 503：HTTP %d %s", code, body)
	}
	if spent, err := s.st.GatewaySpendAllToday(); err != nil || spent <= 0.01 {
		t.Fatalf("当日累计应落库：%.4f %v", spent, err)
	}
}

func TestGatewayUsageReconciliation(t *testing.T) {
	good := vendorUpstream(t, `{"choices":[{"message":{"content":"ok"}}],
		"usage":{"prompt_tokens":100,"completion_tokens":50}}`)
	defer good.Close()
	bad := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	badURL := bad.URL
	bad.Close() // an unreachable endpoint: every attempt must fail

	s := newTestServer(t, DefaultPolicy())
	broker := httptest.NewServer(s.Handlers())
	defer broker.Close()
	platformCookie, platformID := registerAndCookie(t, broker.URL, "platform-owner")
	s.platformOwnerID = platformID
	s.platformOwnerName = "platform-owner"
	buyerCookie, _ := registerAndCookie(t, broker.URL, "buyer")

	// Register both upstreams under the provider account through the console.
	providerCK, _ := registerAndCookie(t, broker.URL, "provider2")
	createUpstream(t, broker.URL, providerCK, "good", good.URL, "good-model", 0.5)
	createUpstream(t, broker.URL, providerCK, "bad", badURL, "bad-model", 0.5)
	key := createKey(t, broker.URL, buyerCookie, "对账测试")

	for i := 0; i < 3; i++ {
		if code, body := chat(t, broker.URL, key,
			`{"model":"good-model","messages":[{"role":"user","content":"hello"}]}`); code != 200 {
			t.Fatalf("第 %d 次调用失败：HTTP %d %s", i+1, code, body)
		}
	}
	if code, body := chat(t, broker.URL, key,
		`{"model":"bad-model","messages":[{"role":"user","content":"hello"}]}`); code != http.StatusBadGateway {
		t.Fatalf("全失败路径应 502：HTTP %d %s", code, body)
	}

	code, doc := getUsage(t, broker.URL, platformCookie)
	if code != 200 {
		t.Fatalf("平台账户访问对账接口应 200，实际 %d %v", code, doc)
	}
	sumUsage := func(items []any) (requests, failed int, cost float64) {
		for _, raw := range items {
			m, _ := raw.(map[string]any)
			requests += int(asFloat(m["requests"]))
			failed += int(asFloat(m["failed"]))
			cost += asFloat(m["cost"])
		}
		return
	}
	byUp, _ := doc["by_upstream"].([]any)
	req, failed, cost := sumUsage(byUp)
	if req != 4 || failed != 1 {
		t.Fatalf("聚合调用数应为 4、失败 1，实际 %d/%d：%v", req, failed, byUp)
	}
	if cost <= 0 {
		t.Fatal("成功调用应计入成本")
	}
	byModel, _ := doc["by_model"].([]any)
	if r, _, _ := sumUsage(byModel); r != 4 {
		t.Fatalf("按模型聚合调用数应为 4，实际 %d", r)
	}
	if code, _ := getUsage(t, broker.URL, buyerCookie); code != 403 {
		t.Fatalf("普通用户访问对账接口应 403，实际 %d", code)
	}
}

func asFloat(v any) float64 {
	f, _ := v.(float64)
	return f
}

func TestGatewayBalanceShortfallStillReturns402(t *testing.T) {
	vendor := vendorUpstream(t, "")
	defer vendor.Close()

	s := newTestServer(t, DefaultPolicy())
	broker := httptest.NewServer(s.Handlers())
	defer broker.Close()
	providerCookie, _ := registerAndCookie(t, broker.URL, "provider")
	buyerCookie, buyerID := registerAndCookie(t, broker.URL, "buyer")
	createUpstream(t, broker.URL, providerCookie, "u", vendor.URL, "m", 10)
	key := createKey(t, broker.URL, buyerCookie, "余额测试")
	if _, err := s.st.AddCredits(buyerID, -100); err != nil {
		t.Fatal(err)
	}
	if code, body := chat(t, broker.URL, key,
		`{"model":"m","messages":[{"role":"user","content":"hello"}]}`); code != 402 ||
		!strings.Contains(body, "余额不足") {
		t.Fatalf("余额不足仍应 402（新日限额/预算护栏不得遮蔽）：HTTP %d %s", code, body)
	}
}

func TestGatewayErrorDoesNotLeakUpstreamKey(t *testing.T) {
	vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		io.WriteString(w, `{"error":{"message":"Your api key: up-secret is invalid"}}`)
	}))
	defer vendor.Close()

	s := newTestServer(t, DefaultPolicy())
	broker := httptest.NewServer(s.Handlers())
	defer broker.Close()
	providerCookie, _ := registerAndCookie(t, broker.URL, "provider")
	buyerCookie, _ := registerAndCookie(t, broker.URL, "buyer")
	createUpstreamJSON(t, broker.URL, providerCookie, fmt.Sprintf(
		`{"name":"u","base_url":%q,"api_key":"up-secret","models":"m","price":0.5}`, vendor.URL))
	key := createKey(t, broker.URL, buyerCookie, "脱敏测试")
	if code, body := chat(t, broker.URL, key,
		`{"model":"m","messages":[{"role":"user","content":"hello"}]}`); code != 400 ||
		strings.Contains(body, "up-secret") {
		t.Fatalf("厂商错误体不得回显上游 key：HTTP %d %s", code, body)
	}
	// Probe failures must not carry the vendor body (it may echo the key too).
	if got := probeFailureReason(fmt.Errorf("HTTP 401: api key up-secret invalid"), "up-secret"); got != "HTTP 401" {
		t.Fatalf("probe failure should be reduced to the status: %q", got)
	}
}

func TestGatewayLimitsConfigurable(t *testing.T) {
	s := newTestServer(t, DefaultPolicy())
	s.SetGatewayLimits(99999999, 99999999)
	if s.maxPromptTokens != DefaultGatewayMaxPromptTokens || s.maxTokens != DefaultGatewayMaxTokens {
		t.Fatalf("越界应回落默认值：%d/%d", s.maxPromptTokens, s.maxTokens)
	}

	vendor := vendorUpstream(t, "")
	defer vendor.Close()
	broker := httptest.NewServer(s.Handlers())
	defer broker.Close()
	providerCookie, _ := registerAndCookie(t, broker.URL, "provider")
	buyerCookie, _ := registerAndCookie(t, broker.URL, "buyer")
	createUpstreamJSON(t, broker.URL, providerCookie, fmt.Sprintf(
		`{"name":"u","base_url":%q,"models":"long","price":0.01,"max_context":131072}`, vendor.URL))
	key := createKey(t, broker.URL, buyerCookie, "上限测试")

	big := `{"model":"long","messages":[{"role":"user","content":"hello"}],"max_tokens":10000}`
	if code, _ := chat(t, broker.URL, key, big); code != 400 {
		t.Fatalf("默认 8192 应拒绝 max_tokens=10000，实际 %d", code)
	}
	s.SetGatewayLimits(65536, 16384)
	if code, body := chat(t, broker.URL, key, big); code != 200 {
		t.Fatalf("放宽后 max_tokens=10000 应通过：HTTP %d %s", code, body)
	}

	// ~40K tokens of prompt: rejected by the old hardcoded 32768, accepted at 65536.
	longBody, _ := json.Marshal(map[string]any{
		"model": "long", "max_tokens": 1024,
		"messages": []any{map[string]any{"role": "user", "content": strings.Repeat("a", 160000)}},
	})
	if code, _ := chat(t, broker.URL, key, string(longBody)); code != 200 {
		t.Fatalf("65536 上限下约 40K tokens 的 prompt 应通过本地校验，实际 %d", code)
	}
	s.SetGatewayLimits(DefaultGatewayMaxPromptTokens, DefaultGatewayMaxTokens)
	if code, _ := chat(t, broker.URL, key, string(longBody)); code != 400 {
		t.Fatalf("默认 32768 上限应拒绝长 prompt，实际 %d", code)
	}
}
