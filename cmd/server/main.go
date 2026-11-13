package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"starstack/internal/ffx"
	"starstack/internal/hub"
	"starstack/internal/store"
)

func main() {
	addr := flag.String("addr", ":8787", "listen address")
	data := flag.String("data", "./data", "job/segment storage directory")
	base := flag.String("base-url", "", "public base URL advertised to workers (default: derived from --addr)")
	ffmpeg := flag.String("ffmpeg", "ffmpeg", "ffmpeg binary")
	ffprobe := flag.String("ffprobe", "ffprobe", "ffprobe binary")
	public := flag.Bool("public", false, "internet-facing profile: no broker-local paths, "+
		"no pairing-code list, no self-service recharge, agents must present --agent-token")
	agentToken := flag.String("agent-token", "", "shared secret agents present in X-Agent-Token (required with --public); "+
		"prefer STARSTACK_AGENT_TOKEN in the service environment so the secret does not show up in the process list")
	signupInvite := flag.String("signup-invite", "", "invite code required for new registrations; "+
		"prefer STARSTACK_SIGNUP_INVITE in the service environment")
	openSignup := flag.Bool("open-signup", false, "deliberately allow open registration with --public "+
		"(not recommended; --public otherwise requires an invite code)")
	maxUpload := flag.Int64("max-upload-mb", 0, "request body cap for a job, MiB (0 = profile default)")
	cookiePath := flag.String("cookie-path", "", "Path the session cookie is scoped to, e.g. /starstack/ "+
		"(set this when a reverse proxy mounts the broker under a prefix)")
	trustProxy := flag.Bool("trust-proxy", false, "read the client address from X-Forwarded-For "+
		"(only correct when a proxy you control sets that header)")
	nodeBin := flag.String("node-bin-dir", "", "directory holding starstack-worker-<os>-<arch>[.exe], "+
		"served under /dl/ so the console can hand out a double-click launcher")
	comfyhub := flag.String("comfyhub", "", "ComfyHub base URL to expose under /comfy/ (e.g. http://127.0.0.1:8788); "+
		"prefer STARSTACK_COMFYHUB so the URL stays out of the process list")
	comfyui := flag.String("comfyui", "", "ComfyUI base URL for the 生图/生视频 workflow workbench under "+
		"/comfyui/api/ (default http://127.0.0.1:8188); prefer STARSTACK_COMFYUI")
	allowBuild := flag.Bool("allow-build", false, "expose the compile/packaging job kind; "+
		"a provider agent must also be started with --allow-build")
	buildUsers := flag.String("build-users", "", "comma-separated account names allowed to submit build jobs "+
		"(empty = nobody); prefer STARSTACK_BUILD_USERS")
	flag.Parse()

	ffx.Ffmpeg, ffx.Ffprobe = *ffmpeg, *ffprobe
	if *agentToken == "" {
		*agentToken = os.Getenv("STARSTACK_AGENT_TOKEN")
	}
	if *signupInvite == "" {
		*signupInvite = os.Getenv("STARSTACK_SIGNUP_INVITE")
	}
	if *comfyhub == "" {
		*comfyhub = os.Getenv("STARSTACK_COMFYHUB")
	}
	if *comfyui == "" {
		*comfyui = os.Getenv("STARSTACK_COMFYUI")
	}
	if *comfyui == "" {
		*comfyui = "http://127.0.0.1:8188"
	}
	if *buildUsers == "" {
		*buildUsers = os.Getenv("STARSTACK_BUILD_USERS")
	}
	*data, _ = filepath.Abs(*data)
	os.MkdirAll(*data, 0o700)

	pol := hub.DefaultPolicy()
	if *public {
		pol = hub.PublicPolicy()
		if *agentToken == "" {
			log.Fatal("--public needs an agent token (--agent-token or STARSTACK_AGENT_TOKEN): " +
				"without it anyone can register a fake node and bid for real work")
		}
	}
	pol.AgentToken = *agentToken
	pol.SignupInvite = strings.TrimSpace(*signupInvite)
	if pol.Public && pol.SignupInvite == "" && !*openSignup {
		log.Fatal("--public requires --signup-invite (or STARSTACK_SIGNUP_INVITE); " +
			"pass --open-signup only when deliberately running an open demo")
	}
	pol.TrustProxy = *trustProxy
	if *cookiePath != "" {
		if !strings.HasPrefix(*cookiePath, "/") {
			log.Fatal("--cookie-path must start with /")
		}
		if !strings.HasSuffix(*cookiePath, "/") {
			*cookiePath += "/"
		}
		pol.CookiePath = *cookiePath
		if !pol.TrustProxy {
			log.Printf("note: --cookie-path set but --trust-proxy off; the auth rate limiter "+
				"will count every request as coming from the proxy at %s", *cookiePath)
		}
	}
	if *maxUpload > 0 {
		pol.MaxUploadBytes = *maxUpload << 20
		if pol.MemoryBuffer > pol.MaxUploadBytes {
			pol.MemoryBuffer = pol.MaxUploadBytes / 4
		}
	}
	pol.AllowBuild = *allowBuild
	if *allowBuild {
		for _, name := range strings.Split(*buildUsers, ",") {
			if n := strings.TrimSpace(name); n != "" {
				pol.BuildUsers = append(pol.BuildUsers, n)
			}
		}
		if len(pol.BuildUsers) == 0 {
			log.Printf("警告：--allow-build 未配置 --build-users（或 STARSTACK_BUILD_USERS），编译任务保持关闭")
			pol.AllowBuild = false
		} else {
			log.Printf("build jobs enabled for: %s", strings.Join(pol.BuildUsers, ", "))
		}
	}

	st, err := store.Open(filepath.Join(*data, "starstack.db"))
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	if *base == "" {
		p := *addr
		if i := strings.LastIndex(p, ":"); i >= 0 {
			p = p[i:]
		} else {
			p = ":8787"
		}
		*base = "http://127.0.0.1" + p
		log.Printf("note: --base-url not set, workers on other machines must be able to reach %s", *base)
	}
	log.Printf("starstack broker on %s (data=%s, source URL handed to workers: %s, profile=%s)",
		*addr, *data, *base, map[bool]string{true: "public", false: "demo"}[pol.Public])

	srv := hub.NewServer(*data, *base, st, pol)
	// Gateway ceilings, the daily platform budget and the self-supply seed all
	// come from the service environment. None of them can abort startup.
	srv.SetPlatformAccount(os.Getenv("STARSTACK_PLATFORM_USER"))
	srv.SetGatewayLimits(
		envInt("STARSTACK_GATEWAY_MAX_PROMPT", hub.DefaultGatewayMaxPromptTokens),
		envInt("STARSTACK_GATEWAY_MAX_TOKENS", hub.DefaultGatewayMaxTokens))
	srv.SetGatewayDailyBudget(envFloat("STARSTACK_GATEWAY_DAILY_BUDGET", 0))
	srv.SeedPlatformUpstreams()
	srv.SetNodeBinDir(*nodeBin)
	srv.SetComfyHubURL(*comfyhub)
	if *comfyhub == "" {
		log.Printf("note: --comfyhub not set, /comfy/ AI video share page is disabled")
	}
	srv.SetComfyUIURL(*comfyui)
	log.Printf("comfyui workbench: %s exposed at /comfyui/api/ (session guarded)", *comfyui)
	if *nodeBin == "" {
		log.Printf("note: --node-bin-dir not set, the console's one-click launcher has no " +
			"starstack-worker binary to hand out (put starstack-worker-<os>-<arch>[.exe] in a directory and point at it)")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go srv.RunScheduler(ctx)

	hs := &http.Server{
		Addr: *addr, Handler: srv.Handlers(),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       3 * time.Minute,
		MaxHeaderBytes:    1 << 20,
		// Read/Write stay open: agents long-poll /api/claim for minutes and a job
		// upload is limited by MaxBytesReader, not by a socket deadline.
	}
	go func() {
		<-ctx.Done()
		shutCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		hs.Shutdown(shutCtx)
	}()
	if err := hs.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// envInt/envFloat keep an unset env completely silent (defaults match the
// historical behaviour) and log only when a configured value is unparseable.
func envInt(name string, def int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		log.Printf("%s 不是有效整数，使用默认值 %d", name, def)
		return def
	}
	return n
}

func envFloat(name string, def float64) float64 {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return def
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		log.Printf("%s 不是有效数字，使用默认值 %g", name, def)
		return def
	}
	return v
}
