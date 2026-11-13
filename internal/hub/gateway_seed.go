package hub

// Platform self-supply (对外称「官方供给 / 平台自营节点」).
//
// Nothing here is a second relay: every seeded endpoint becomes an ordinary
// row in the same upstreams table, takes the same route and the same 90/10
// settlement as a provider-contributed endpoint. This file only seeds those
// rows at startup (idempotently, never fatally) and installs the operational
// ceilings configured through the service environment.

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"starstack/internal/auth"
	"starstack/internal/store"
)

const (
	defaultPointYuan  = 0.01 // 1 点 = 0.01 元；只在播种换算时使用
	defaultSeedMarkup = 1.2  // 参考价倍率，自营不做最低价倾销
)

// seedAllowedHosts is the vendor whitelist from the接入约束: official vendor
// endpoints or explicit aggregators only. Loopback is additionally allowed on
// the demo profile so local development and tests can seed a local endpoint.
// Add a new official vendor here when one is contracted; never add a reseller.
var seedAllowedHosts = []string{
	"api.deepseek.com",
	"api.siliconflow.cn",
	"dashscope.aliyuncs.com",
	"dashscope-intl.aliyuncs.com",
	"ark.cn-beijing.volces.com",
	"open.bigmodel.cn",
	"api.moonshot.cn",
	"api.qwen.ai",
	"api.minimaxi.com",
	"api.baichuan-ai.com",
	"api.stepfun.com",
	"openrouter.ai",
	"api.openai.com",
	"api.anthropic.com",
	"generativelanguage.googleapis.com",
	"api.groq.com",
	"api.mistral.ai",
	"api.cohere.com",
	"api.x.ai",
	"api.together.xyz",
	"api.fireworks.ai",
	// 用户确认接入的厂商自营端点。该网关只开放 /v1/chat/completions，
	// 不提供 /v1/models：探测失败按非致命处理，模型 ID 以 chat 响应的
	// model 字段为准，不做别名改写。
	"ai.yun.139.com",
}

func seedHostAllowed(base string, public bool) bool {
	u, err := url.Parse(base)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if !public && (host == "127.0.0.1" || host == "localhost" || host == "::1") {
		return true
	}
	for _, allowed := range seedAllowedHosts {
		if host == allowed || strings.HasSuffix(host, "."+allowed) {
			return true
		}
	}
	return false
}

// SetGatewayLimits installs the two request ceilings. Out-of-range values fall
// back to the historical defaults with a log line; unset env produces no log.
func (s *Server) SetGatewayLimits(maxPrompt, maxTokens int) {
	if maxPrompt <= 0 || maxPrompt > gatewayMaxPromptCeiling {
		log.Printf("gateway: STARSTACK_GATEWAY_MAX_PROMPT=%d 越界，回落到 %d",
			maxPrompt, DefaultGatewayMaxPromptTokens)
		maxPrompt = DefaultGatewayMaxPromptTokens
	}
	if maxTokens <= 0 || maxTokens > gatewayMaxTokensCeiling {
		log.Printf("gateway: STARSTACK_GATEWAY_MAX_TOKENS=%d 越界，回落到 %d",
			maxTokens, DefaultGatewayMaxTokens)
		maxTokens = DefaultGatewayMaxTokens
	}
	s.maxPromptTokens, s.maxTokens = maxPrompt, maxTokens
}

// SetGatewayDailyBudget caps the whole platform's settled model spend per day.
// 0 means unlimited. It never enters the settlement math itself.
func (s *Server) SetGatewayDailyBudget(points float64) {
	if points < 0 || math.IsNaN(points) || math.IsInf(points, 0) {
		log.Printf("gateway: STARSTACK_GATEWAY_DAILY_BUDGET=%g 无效，按不限处理", points)
		points = 0
	}
	s.gatewayDailyBudget = round4(points)
}

// SetPlatformAccount reserves the self-supply owner's name. Seeding resolves
// the id; the name alone is enough to keep that account from being registered
// by somebody else and to gate the reconciliation endpoint before seeding.
func (s *Server) SetPlatformAccount(name string) {
	name = strings.TrimSpace(name)
	if name == "" {
		return
	}
	s.platformOwnerName = name
	// Resolve the id even when STARSTACK_SEED_UPSTREAMS was emptied to pause
	// seeding: existing 官方 rows must keep their badge after a restart.
	if u, err := s.st.UserByName(name); err == nil {
		s.platformOwnerID = u.ID
	}
}

type seedUpstream struct {
	Name        string   `json:"name"`
	BaseURL     string   `json:"base_url"`
	APIKey      string   `json:"api_key"`
	Models      []string `json:"models"`
	Caps        []string `json:"caps"`
	CostIn      float64  `json:"cost_in_yuan_per_1k"`
	CostOut     float64  `json:"cost_out_yuan_per_1k"`
	Price       float64  `json:"price"`
	PriceOut    float64  `json:"price_out"`
	PriceCached float64  `json:"price_cached"`
	Markup      float64  `json:"markup"`
	MaxContext  int      `json:"max_context"`
}

// SeedPlatformUpstreams is called once after NewServer. Every failure — bad
// JSON, missing account/password, DNS, a vendor 4xx — only logs and skips:
// seeding must never prevent the broker from starting.
func (s *Server) SeedPlatformUpstreams() {
	raw := strings.TrimSpace(os.Getenv("STARSTACK_SEED_UPSTREAMS"))
	name := strings.TrimSpace(os.Getenv("STARSTACK_PLATFORM_USER"))
	if name != "" {
		s.platformOwnerName = name
	}
	if raw == "" {
		return // not configured: behaviour is exactly what it was before
	}
	var list []seedUpstream
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		log.Printf("自营上游：STARSTACK_SEED_UPSTREAMS 不是合法 JSON 数组，跳过播种：%v", err)
		return
	}
	if len(list) == 0 {
		return
	}
	if name == "" {
		log.Printf("自营上游：缺少 STARSTACK_PLATFORM_USER，跳过播种（上游 owner 必须是真实账户）")
		return
	}
	owner, err := s.platformAccount(name, os.Getenv("STARSTACK_PLATFORM_PASSWORD"))
	if err != nil {
		log.Printf("自营上游：跳过播种：%v", err)
		return
	}
	s.platformOwnerID = owner.ID

	pointYuan := seedEnvFloat("STARSTACK_POINT_YUAN", defaultPointYuan)
	if pointYuan <= 0 || pointYuan > 100 {
		log.Printf("自营上游：STARSTACK_POINT_YUAN=%g 越界，使用默认 %g", pointYuan, defaultPointYuan)
		pointYuan = defaultPointYuan
	}
	existing, err := s.st.UpstreamsByOwner(owner.ID)
	if err != nil {
		log.Printf("自营上游：读取已有上游失败，跳过播种：%v", err)
		return
	}
	seen := make(map[string]bool, len(existing))
	for _, up := range existing {
		seen[strings.ToLower(up.BaseURL)] = true
	}

	for i, cfg := range list {
		if err := s.seedOne(owner.ID, cfg, pointYuan, seen, i); err != nil {
			log.Printf("自营上游：第 %d 条 %q 跳过：%v", i+1, cfg.Name, redactKey(err.Error(), cfg.APIKey))
			continue
		}
	}
}

func (s *Server) seedOne(ownerID string, cfg seedUpstream, pointYuan float64,
	seen map[string]bool, index int) error {
	base, err := validateUpstreamURL(cfg.BaseURL, s.policy.Public)
	if err != nil {
		return err
	}
	if !seedHostAllowed(base, s.policy.Public) {
		return fmt.Errorf("上游主机不在厂商官方/聚合平台白名单内：%s", base)
	}
	models, err := normalizeModels(strings.Join(cfg.Models, ","))
	if err != nil {
		return err
	}
	caps, err := normalizeCaps(strings.Join(cfg.Caps, ","))
	if err != nil {
		return err
	}
	key := strings.TrimSpace(cfg.APIKey)
	name := strings.TrimSpace(cfg.Name)
	if name == "" {
		name = fmt.Sprintf("官方供给 %d", index+1)
	}
	if seen[strings.ToLower(base)] {
		log.Printf("自营上游 %s 已存在，跳过（不覆盖控制台的价格与开关）", base)
		// Still probe on every start: DNS/vendor model lists change, and a
		// restart is the operator's chance to see a stale registration.
		s.probeSeed(&store.Upstream{Name: name, BaseURL: base, Models: models}, key)
		return nil
	}
	price, priceOut, priceCached, err := seedPrices(cfg, pointYuan)
	if err != nil {
		return err
	}
	maxContext := cfg.MaxContext
	if maxContext == 0 {
		maxContext = 32768
	}
	if maxContext < 1024 || maxContext > gatewayMaxPromptCeiling {
		return fmt.Errorf("max_context=%d 越界（1024 ~ %d）", maxContext, gatewayMaxPromptCeiling)
	}
	enc, err := s.secrets.seal(key)
	if err != nil {
		return fmt.Errorf("加密上游凭据失败：%w", err)
	}
	up := &store.Upstream{
		ID: "m" + newID() + newID(), OwnerID: ownerID, Name: name, BaseURL: base,
		EncKey: enc, Models: models, Price: price, PriceOut: priceOut,
		PriceCached: priceCached, MaxContext: maxContext, Caps: caps,
		Enabled: true, CreatedAt: time.Now().Unix(),
	}
	if err := s.st.CreateUpstream(up); err != nil {
		return err
	}
	seen[strings.ToLower(base)] = true
	log.Printf("自营上游已播种：%s (%s) 模型 %v 输入价 %.4f 输出价 %.4f",
		up.Name, up.ID, up.Models, up.Price, up.PriceOut)
	s.probeSeed(up, key)
	return nil
}

// seedPrices converts a vendor's 元/千 token cost into platform points. An
// explicit price wins; otherwise cost / pointYuan * markup. A missing output
// cost leaves price_out at 0, which the existing三段计价 reads as "same as
// input". No extra 10% is added: when the owner is the platform account both the
// 90% contribution and the 10% matching fee stay on the platform.
func seedPrices(cfg seedUpstream, pointYuan float64) (in, out, cached float64, err error) {
	markup := cfg.Markup
	if markup == 0 {
		markup = defaultSeedMarkup
	}
	if markup < 1 || markup > 100 {
		return 0, 0, 0, fmt.Errorf("markup=%g 需在 1 ~ 100 之间", markup)
	}
	conv := func(cost float64) float64 { return round4(cost / pointYuan * markup) }
	switch {
	case cfg.Price > 0:
		in = round4(cfg.Price)
	case cfg.CostIn > 0:
		in = conv(cfg.CostIn)
	default:
		return 0, 0, 0, errors.New("缺少 price 或 cost_in_yuan_per_1k，无法定价")
	}
	if cfg.PriceOut > 0 {
		out = round4(cfg.PriceOut)
	} else if cfg.CostOut > 0 {
		out = conv(cfg.CostOut)
	}
	cached = round4(cfg.PriceCached)
	if in <= 0 || in > 10000 || out < 0 || out > 10000 || cached < 0 || cached > 10000 {
		return 0, 0, 0, errors.New("换算出的点价越界（0 ~ 10000 点/千 token）")
	}
	return in, out, cached, nil
}

func (s *Server) platformAccount(name, password string) (*store.User, error) {
	if err := auth.ValidName(name); err != nil {
		return nil, err
	}
	if u, err := s.st.UserByName(name); err == nil {
		if password == "" || !auth.Match(password, u.Salt, u.PassHash, u.Iter) {
			return nil, errors.New("平台自营账户已存在，但 STARSTACK_PLATFORM_PASSWORD 与该账户口令不符")
		}
		return u, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	if strings.TrimSpace(password) == "" {
		return nil, errors.New("平台自营账户不存在且未提供 STARSTACK_PLATFORM_PASSWORD，不创建账户、不播种")
	}
	if err := auth.ValidPassword(password); err != nil {
		return nil, err
	}
	salt := auth.NewSalt()
	u := &store.User{
		ID: "u" + newID() + newID(), Name: name,
		PassHash: auth.Hash(password, salt, auth.Iterations),
		Salt:     hex.EncodeToString(salt), Iter: auth.Iterations,
		CreatedAt: time.Now().Unix(),
	}
	if err := s.st.CreateUser(u); err != nil {
		return nil, err
	}
	log.Printf("自营上游：已创建平台自营账户 %s (%s)", u.Name, u.ID)
	return u, nil
}

func (s *Server) probeSeed(up *store.Upstream, key string) {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	models, err := s.probeUpstream(ctx, up.BaseURL, key)
	if err != nil {
		log.Printf("自营上游 %s 模型探测失败（不影响启动，不回显厂商响应）：%s",
			up.Name, probeFailureReason(err, key))
		return
	}
	log.Printf("自营上游 %s 厂商 /v1/models 列表：%s", up.Name, clip(strings.Join(models, ", "), 500))
	for _, want := range up.Models {
		found := false
		for _, got := range models {
			if strings.EqualFold(want, got) {
				found = true
				break
			}
		}
		if !found {
			log.Printf("警告：自营上游 %s 配置的模型 %s 不在厂商模型列表中，保留配置（厂商别名/大小写差异常见）",
				up.Name, want)
		}
	}
}

func redactKey(msg, key string) string {
	if key == "" {
		return msg
	}
	return strings.ReplaceAll(msg, key, "[redacted]")
}

// probeFailureReason keeps a vendor's failure class but drops its body: some
// 401 responses echo the credential (masked or not), and neither the broker log
// nor an HTTP error response may carry it.
func probeFailureReason(err error, key string) string {
	msg := redactKey(err.Error(), key)
	if strings.HasPrefix(msg, "HTTP ") {
		if i := strings.IndexByte(msg, ':'); i > 0 {
			return msg[:i]
		}
	}
	return clip(msg, 160)
}

func seedEnvFloat(name string, def float64) float64 {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return def
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		log.Printf("自营上游：%s 不是有效数字，使用默认 %g", name, def)
		return def
	}
	return v
}
