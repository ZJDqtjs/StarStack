using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;

namespace StarStack.Desktop;

public partial class MainWindow : Window
{
    private readonly AssetServer _server = new();
    private string _baseUrl = string.Empty;

    // 内嵌的控制台（web-react）接口走同源相对路径，而本地静态服务器上没有后端。
    // 这些前缀由主进程反代到 Broker：同源转发顺带绕开 CORS 与 Cookie Domain 的问题。
    private static readonly string[] ProxyPrefixes = { "api/", "v1/", "download/", "dl/", "launch/", "comfy/" };
    private const string DefaultBroker = "https://starstack.run";

    private CoreWebView2Environment? _env;
    private string _brokerBase = DefaultBroker;

    private static string BrokerFile => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "StarStack", "broker.txt");

    // The console page can lend this machine's compute without the downloaded
    // node package: the worker is started as a child process (from next to this
    // exe, or fetched once and cached), so closing the console stops sharing and
    // no second window is involved.
    private static readonly Regex NodeIdPattern = new("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$", RegexOptions.Compiled);
    private static readonly Regex LaunchCodePattern = new("^[0-9a-f]{16,64}$", RegexOptions.Compiled);

    private readonly Queue<string> _workerLog = new();
    private Process? _worker;
    private string _workerNodeId = "";
    private string? _workerWorkDir;
    private bool _starting;
    private CancellationTokenSource? _startCts;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(10) };

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Closing += OnClosing;
        PreviewKeyDown += OnKeyDown;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        ApplySavedBounds();
        try
        {
            var port = _server.Start();
            _baseUrl = $"http://127.0.0.1:{port}/";
            await InitWebViewAsync();
        }
        catch (Exception ex)
        {
            ShowError("桌面端启动失败：" + ex.Message);
        }
    }

    private async Task InitWebViewAsync()
    {
        var dataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "StarStack", "WebView2");
        Directory.CreateDirectory(dataFolder);

        var environment = await CoreWebView2Environment.CreateAsync(null, dataFolder);
        await Web.EnsureCoreWebView2Async(environment);
        _env = environment;
        _brokerBase = LoadBrokerBase();

        var core = Web.CoreWebView2;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDevToolsEnabled = true;
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.Settings.AreBrowserAcceleratorKeysEnabled = true;

        // 把 /api、/v1、/download 等前缀接到 Broker，页面本身还是同源的本地资源。
        foreach (var prefix in ProxyPrefixes)
        {
            core.AddWebResourceRequestedFilter(_baseUrl + prefix + "*", CoreWebView2WebResourceContext.All);
        }
        core.WebResourceRequested += OnProxyRequest;

        core.WebMessageReceived += (_, args) => OnWebMessage(args);

        // Downloads and "open in new window" links belong to the system browser,
        // not to a second chrome-less window inside the app.
        core.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            OpenExternal(args.Uri);
        };

        core.NavigationStarting += (_, args) =>
        {
            if (!args.Uri.StartsWith(_baseUrl, StringComparison.OrdinalIgnoreCase))
            {
                args.Cancel = true;
                OpenExternal(args.Uri);
            }
        };

        core.NavigationCompleted += (_, args) =>
        {
            if (args.IsSuccess)
            {
                Overlay.Visibility = Visibility.Collapsed;
            }
            else
            {
                ShowError("页面加载失败：" + args.WebErrorStatus);
            }
        };

        // Save artifacts straight to the user's Downloads folder. Without this the
        // WebView shows its own download flyout, which looks like a browser bolted
        // onto a desktop app.
        core.DownloadStarting += (_, args) =>
        {
            try
            {
                var downloads = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
                Directory.CreateDirectory(downloads);
                args.ResultFilePath = Path.Combine(downloads, Path.GetFileName(args.ResultFilePath));
                args.Handled = true;
            }
            catch
            {
                // fall back to the WebView's own download UI
            }
        };

        core.Navigate(_baseUrl);
    }

    private static string NodeRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "StarStack", "node");

    private void OnWebMessage(CoreWebView2WebMessageReceivedEventArgs e)
    {
        // Only the embedded console may drive the local worker. External pages are
        // never navigated in this WebView, but the check keeps that explicit.
        if (!e.Source.StartsWith(_baseUrl, StringComparison.OrdinalIgnoreCase)) return;
        if (e.WebMessageAsJson.Length > 64 * 1024) return;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return;
            switch (GetString(root, "kind"))
            {
                case "broker":
                    SetBrokerBase(GetString(root, "base"));
                    break;
                case "node.state":
                    PostState();
                    break;
                case "node.stop":
                    StopWorker("已在本机停止节点");
                    break;
                case "node.run":
                    // The page mints the launch ticket (it holds the session token)
                    // and hands over everything the worker needs to join.
                    if (root.TryGetProperty("payload", out var payload) && payload.ValueKind == JsonValueKind.Object)
                    {
                        _ = StartWorkerAsync(payload);
                    }
                    break;
            }
        }
        catch (JsonException)
        {
            // a malformed message is not a command
        }
    }

    /// <summary>
    /// 把控制台发往 /api、/v1、/download 的请求转发给 Broker。
    /// 页面与反代同源，所以浏览器侧既不触发 CORS 预检，也不必为不同 origin 维护 Cookie；
    /// 认证走页面自带的 Authorization: Bearer（后端同时支持 Cookie 与 Bearer）。
    /// </summary>
    private async void OnProxyRequest(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var env = _env;
        if (env is null) return;

        var deferral = e.GetDeferral();
        try
        {
            var uri = new Uri(e.Request.Uri);
            var target = new Uri(new Uri(_brokerBase), uri.PathAndQuery);
            using var request = new HttpRequestMessage(new HttpMethod(e.Request.Method), target);

            var contentHeaders = new List<KeyValuePair<string, string>>();
            foreach (var header in e.Request.Headers)
            {
                if (IsHopByHop(header.Key)) continue;
                // Content-Length 交给 StreamContent 算，透传反而容易和实际长度打架
                if (header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
                if (!request.Headers.TryAddWithoutValidation(header.Key, header.Value))
                {
                    contentHeaders.Add(new KeyValuePair<string, string>(header.Key, header.Value));
                }
            }

            if (e.Request.Content is { } body)
            {
                var content = new StreamContent(body);
                foreach (var kv in contentHeaders) content.Headers.TryAddWithoutValidation(kv.Key, kv.Value);
                if (body.CanSeek) content.Headers.ContentLength = body.Length;
                request.Content = content;
            }

            // ResponseHeadersRead：视频产物动辄几百 MB，不能整包读进内存。
            // 不能用 using 释放 response —— body 流要留给 WebView 读完，
            // 方法一返回就 Dispose 会把下载/上传直接截断。
            var response = await Http
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead)
                .ConfigureAwait(true);
            var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(true);

            var headers = new StringBuilder();
            foreach (var h in response.Headers)
            {
                if (IsHopByHop(h.Key)) continue;
                headers.Append(h.Key).Append(": ").Append(string.Join(", ", h.Value)).Append("\r\n");
            }
            foreach (var h in response.Content.Headers)
            {
                if (h.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
                headers.Append(h.Key).Append(": ").Append(string.Join(", ", h.Value)).Append("\r\n");
            }
            // 长度单独补：下载几百 MB 的产物时，没有 Content-Length 页面就画不出进度，
            // 也容易在流结束时被判成截断。
            if (response.Content.Headers.ContentLength is { } length)
            {
                headers.Append("Content-Length: ").Append(length).Append("\r\n");
            }

            // 注意：这里的 stream 不能提前释放，WebView 会在事件返回后继续读。
            e.Response = env.CreateWebResourceResponse(
                stream, (int)response.StatusCode, response.ReasonPhrase ?? string.Empty, headers.ToString());
        }
        catch (Exception ex)
        {
            try
            {
                e.Response = env.CreateWebResourceResponse(
                    new MemoryStream(Encoding.UTF8.GetBytes("反代失败：" + ex.Message)),
                    502, "Bad Gateway", "Content-Type: text/plain; charset=utf-8\r\n");
            }
            catch
            {
                // 连错误响应都写不进去，只能让页面自己超时
            }
        }
        finally
        {
            deferral.Complete();
        }
    }

    private static bool IsHopByHop(string name) =>
        name.Equals("Connection", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("Keep-Alive", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("Upgrade", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("Proxy-Connection", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("TE", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("Trailer", StringComparison.OrdinalIgnoreCase);

    private static string LoadBrokerBase()
    {
        try
        {
            if (File.Exists(BrokerFile))
            {
                var text = File.ReadAllText(BrokerFile).Trim().TrimEnd('/');
                if (Uri.TryCreate(text, UriKind.Absolute, out var uri) &&
                    (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
                {
                    return text;
                }
            }
        }
        catch
        {
            // 配置读不出来就用默认值，不能因为这个起不来
        }
        return DefaultBroker;
    }

    private void SetBrokerBase(string raw)
    {
        var text = (raw ?? string.Empty).Trim().TrimEnd('/');
        if (text.Length == 0) text = DefaultBroker;
        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            MessageBox.Show("服务器地址不合法，保持当前设置：" + _brokerBase, "星栈算力",
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        _brokerBase = text;
        try
        {
            var dir = Path.GetDirectoryName(BrokerFile);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(BrokerFile, text);
        }
        catch
        {
            // 写不进去只影响下次启动的默认值，本次运行用的仍是新地址
        }
    }

    private async Task StartWorkerAsync(JsonElement payload)
    {
        if (_starting)
        {
            PostLog("正在准备节点程序，稍等…");
            return;
        }
        if (_worker is { HasExited: false })
        {
            PostLog("本机节点已经在运行，先停止再重新开始");
            PostState();
            return;
        }

        // 页面只知道自己的同源地址（127.0.0.1 的自助服务），反代目标在主进程这边，
        // 所以 server 允许留空，用主进程的 Broker 地址补齐。
        var server = GetString(payload, "server").Trim().TrimEnd('/');
        if (server.Length == 0) server = _brokerBase;
        var nodeId = GetString(payload, "nodeId").Trim();
        var launch = GetString(payload, "launch").Trim();
        var name = CleanName(GetString(payload, "name"));
        var price = GetNumber(payload, "price");
        var slots = (int)GetNumber(payload, "slots");
        // The provider ticked "接受编译任务" on the page and the broker confirmed
        // it; without that, the worker must not advertise a build runtime.
        var allowBuild = GetBool(payload, "allowBuild");

        // These values end up as process arguments, so validate rather than trust:
        // the launch code is a capability and the node id names a cache directory.
        if (!Uri.TryCreate(server, UriKind.Absolute, out var serverUri) ||
            (serverUri!.Scheme != Uri.UriSchemeHttp && serverUri.Scheme != Uri.UriSchemeHttps))
        {
            PostLog("平台地址不合法，无法启动节点");
            return;
        }
        if (!NodeIdPattern.IsMatch(nodeId) || !LaunchCodePattern.IsMatch(launch))
        {
            PostLog("启动参数不合法：节点编号或启动码格式不对");
            return;
        }
        if (price < 0.05 || price > 1000 || slots < 1 || slots > 64)
        {
            PostLog("单价或并发槽超出允许范围");
            return;
        }
        if (name.Length == 0) name = "桌面节点";

        var work = Path.Combine(NodeRoot, nodeId);
        _starting = true;
        _startCts?.Dispose();
        _startCts = new CancellationTokenSource();
        var ct = _startCts.Token;
        ClearLog();
        PostLog($"正在准备本机节点 {nodeId}…");
        PostState();
        try
        {
            Directory.CreateDirectory(work);
            // The worker may already sit next to the app (build.ps1 packages it);
            // a single-file build fetches it once from the broker and caches it by
            // checksum, so later starts are offline.
            var worker = FindLocalWorker() ?? await EnsureWorkerAsync(server, ct);
            ct.ThrowIfCancellationRequested();
            LaunchWorker(worker, server, nodeId, name, price, slots, launch, work, allowBuild);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            PostLog("已取消启动本机节点");
        }
        catch (OperationCanceledException)
        {
            PostLog("启动本机节点超时，请检查网络后重试");
        }
        catch (Exception ex)
        {
            PostLog("无法准备节点程序：" + ex.Message);
        }
        finally
        {
            _starting = false;
            _startCts?.Dispose();
            _startCts = null;
            PostState();
        }
    }

    private void LaunchWorker(string worker, string server, string nodeId, string name,
        double price, int slots, string launch, string work, bool allowBuild)
    {
        var psi = new ProcessStartInfo(worker)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = work,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        // ArgumentList quotes each value itself, so a Chinese name or a path with
        // spaces never reaches the worker as several arguments.
        void Arg(string flag, string value)
        {
            psi.ArgumentList.Add(flag);
            psi.ArgumentList.Add(value);
        }
        Arg("--server", server);
        Arg("--id", nodeId);
        Arg("--launch", launch);
        Arg("--name", name);
        Arg("--price", price.ToString("0.##", CultureInfo.InvariantCulture));
        Arg("--slots", slots.ToString(CultureInfo.InvariantCulture));
        Arg("--work", work);
        if (allowBuild)
        {
            // Same pairing the downloaded launcher uses: consenting to run buyer
            // commands is also consenting to provision the missing toolchain,
            // which beats a first compile failing on "dotnet not found".
            psi.ArgumentList.Add("--allow-build");
            psi.ArgumentList.Add("--auto-provision");
        }

        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        proc.OutputDataReceived += (_, ev) => { if (ev.Data is not null) OnWorkerLine(ev.Data); };
        proc.ErrorDataReceived += (_, ev) => { if (ev.Data is not null) OnWorkerLine(ev.Data); };
        proc.Exited += (_, _) => Dispatcher.BeginInvoke(new Action(() => OnWorkerExited(proc)));

        try
        {
            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            proc.Dispose();
            PostLog("启动本机节点失败：" + ex.Message);
            return;
        }

        _worker = proc;
        _workerNodeId = nodeId;
        _workerWorkDir = work;
        PostLog($"已启动本机节点（PID {proc.Id}）");
    }

    private void StopWorker(string reason)
    {
        if (_starting)
        {
            _startCts?.Cancel();
            PostLog("正在取消启动…");
            return;
        }
        if (_worker is not { HasExited: false } proc)
        {
            PostState();
            return;
        }
        PostLog(reason);
        try
        {
            proc.Kill(entireProcessTree: true);
        }
        catch (Exception ex)
        {
            PostLog("停止失败：" + ex.Message);
        }
        // OnWorkerExited resets the state once Windows reaps the process.
    }

    private void OnWorkerLine(string line)
    {
        // stdout/stderr arrive on pool threads; the log queue belongs to the UI thread.
        Dispatcher.BeginInvoke(new Action(() => PostLog(line)));
    }

    private void OnWorkerExited(Process proc)
    {
        if (!ReferenceEquals(_worker, proc))
        {
            proc.Dispose();
            return;
        }
        var code = -1;
        try { code = proc.ExitCode; } catch { /* already gone */ }
        _worker = null;
        _workerNodeId = "";
        _workerWorkDir = null;
        PostLog($"本机节点已退出（exit={code}）");
        PostState();
        proc.Dispose();
    }

    private void ClearLog()
    {
        _workerLog.Clear();
    }

    private void PostLog(string line)
    {
        _workerLog.Enqueue(line);
        while (_workerLog.Count > 300) _workerLog.Dequeue();
        PostToPage(new { kind = "node.log", line });
    }

    private void PostState()
    {
        var running = _worker is { HasExited: false };
        var pid = 0;
        if (running)
        {
            try { pid = _worker?.Id ?? 0; } catch { /* exited between checks */ }
        }
        PostToPage(new
        {
            kind = "node.state",
            running,
            starting = _starting,
            nodeId = running ? _workerNodeId : "",
            pid,
            workDir = running ? _workerWorkDir : null,
            tail = _workerLog.ToArray(),
        });
    }

    private void PostToPage(object payload)
    {
        try
        {
            Web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(payload));
        }
        catch (Exception)
        {
            // the page is closing or navigating; a dropped status is harmless
        }
    }

    private static string WorkerCacheDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "StarStack", "worker");

    private static string? FindLocalWorker()
    {
        var overridePath = Environment.GetEnvironmentVariable("STARSTACK_WORKER");
        if (!string.IsNullOrWhiteSpace(overridePath) && File.Exists(overridePath)) return overridePath;
        var bundled = Path.Combine(AppContext.BaseDirectory, "starstack-worker.exe");
        return File.Exists(bundled) ? bundled : null;
    }

    // Single-file builds have no worker next to the exe. The broker already
    // serves the matching binary with a checksum, so fetch it once and cache it
    // by hash: a broker update lands on the next start without a manual download.
    private async Task<string> EnsureWorkerAsync(string server, CancellationToken ct)
    {
        const string name = "starstack-worker-windows-amd64.exe";
        string want;
        try
        {
            want = (await Http.GetStringAsync(server + "/dl/" + name + ".sha256", ct)).Trim().ToLowerInvariant();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            throw new InvalidOperationException("获取节点程序校验和超时，请检查网络后重试");
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                "平台没有提供节点程序（/dl/" + name + "），请让运维在 --node-bin-dir 放好 worker：" + ex.Message, ex);
        }
        if (!Regex.IsMatch(want, "^[0-9a-f]{64}$"))
        {
            throw new InvalidOperationException("平台返回的节点程序校验和格式不对");
        }

        Directory.CreateDirectory(WorkerCacheDir);
        var cached = Path.Combine(WorkerCacheDir, "starstack-worker-" + want[..12] + ".exe");
        if (File.Exists(cached) && await Sha256Async(cached, ct) == want) return cached;

        PostLog("正在从平台获取节点程序（约 10 MB，仅首次或平台更新时需要）…");
        var bytes = await Http.GetByteArrayAsync(server + "/dl/" + name, ct);
        var got = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        if (got != want)
        {
            throw new InvalidOperationException("节点程序校验失败，已放弃运行");
        }
        var tmp = cached + ".tmp";
        await File.WriteAllBytesAsync(tmp, bytes, ct);
        File.Move(tmp, cached, overwrite: true);
        PostLog("节点程序已就绪");
        return cached;
    }

    private static async Task<string> Sha256Async(string path, CancellationToken ct)
    {
        await using var stream = File.OpenRead(path);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream, ct)).ToLowerInvariant();
    }

    private static string GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private static double GetNumber(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d) ? d : 0;

    // Only a literal true counts: the page echoes back what the broker decided,
    // and a missing or malformed field must never be read as consent to run
    // buyer-supplied commands.
    private static bool GetBool(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    // Mirrors the broker's ticket-name sanitiser so the two never disagree about
    // what is a legal display name.
    private static string CleanName(string raw)
    {
        var sb = new StringBuilder();
        var n = 0;
        foreach (var r in raw.Trim())
        {
            if (n == 40) break;
            sb.Append(char.IsLetterOrDigit(r) || r == '_' || r == '-' || char.IsWhiteSpace(r) ? r : ' ');
            n++;
        }
        return string.Join(' ', sb.ToString().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }

    private static void OpenExternal(string uri)
    {
        try
        {
            Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
        }
        catch
        {
            // no default browser registered; nothing useful to do here
        }
    }

    private void ShowError(string message)
    {
        ErrorText.Text = message;
        Overlay.Visibility = Visibility.Visible;
    }

    private void OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.F5)
        {
            Web.CoreWebView2?.Reload();
            e.Handled = true;
        }
        else if (e.Key == Key.F12)
        {
            Web.CoreWebView2?.OpenDevToolsWindow();
            e.Handled = true;
        }
    }

    private void Reload_Click(object sender, RoutedEventArgs e) => Web.CoreWebView2?.Reload();

    private void DevTools_Click(object sender, RoutedEventArgs e) => Web.CoreWebView2?.OpenDevToolsWindow();

    private void ResetZoom_Click(object sender, RoutedEventArgs e) => Web.ZoomFactor = 1.0;

    private void OpenWeb_Click(object sender, RoutedEventArgs e)
    {
        if (_baseUrl.Length > 0) OpenExternal(_baseUrl);
    }

    private void Exit_Click(object sender, RoutedEventArgs e) => Close();

    private void About_Click(object sender, RoutedEventArgs e)
    {
        MessageBox.Show(
            "星栈算力 桌面端 v1.1\n\n" +
            "React + WPF WebView2，控制台资源内嵌在程序里，不依赖远程网页。\n" +
            WebBuildLine() + "\n\n" +
            "这枚戳比网页端「设置 → 关于构建」旧，就说明 exe 内嵌的还是旧快照，\n" +
            "需要重新发布，不会自动同步。\n\n" +
            $"平台地址：{_brokerBase}\n" +
            $"本地控制台：{(_baseUrl.Length > 0 ? _baseUrl : "—")}",
            "关于星栈算力",
            MessageBoxButton.OK,
            MessageBoxImage.Information);
    }

    /// <summary>
    /// The embedded web build carries a build.json stamp (see apps/vite.config.ts).
    /// Surfacing it here is the whole point: without it nobody can tell whether an
    /// installed exe is a week behind the web console.
    /// </summary>
    private string WebBuildLine()
    {
        var raw = _server.ReadText("build.json");
        if (string.IsNullOrWhiteSpace(raw))
        {
            return "内嵌网页版本：未知（产物未带 build.json，几乎可以确定是旧构建）";
        }
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            string Field(string name) =>
                root.TryGetProperty(name, out var v) ? v.GetString() ?? "?" : "?";
            return $"内嵌网页版本：{Field("sha")} · {Field("time")}（{Field("pkg")}）";
        }
        catch (JsonException)
        {
            return "内嵌网页版本：build.json 无法解析";
        }
    }

    private static string BoundsPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "StarStack", "window.json");

    public sealed class WindowBounds
    {
        public double Left { get; set; }
        public double Top { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }
        public bool Maximized { get; set; }
    }

    private void ApplySavedBounds()
    {
        try
        {
            if (!File.Exists(BoundsPath)) return;
            var saved = JsonSerializer.Deserialize<WindowBounds>(File.ReadAllText(BoundsPath));
            if (saved is null) return;

            var virtualLeft = SystemParameters.VirtualScreenLeft;
            var virtualTop = SystemParameters.VirtualScreenTop;
            var virtualRight = virtualLeft + SystemParameters.VirtualScreenWidth;
            var virtualBottom = virtualTop + SystemParameters.VirtualScreenHeight;
            var visible = saved.Left < virtualRight - 80 && saved.Top < virtualBottom - 80
                          && saved.Left + saved.Width > virtualLeft + 80 && saved.Top + saved.Height > virtualTop + 80;
            if (visible && saved.Width >= MinWidth && saved.Height >= MinHeight)
            {
                Left = saved.Left;
                Top = saved.Top;
                Width = saved.Width;
                Height = saved.Height;
            }
            if (saved.Maximized) WindowState = WindowState.Maximized;
        }
        catch
        {
            // a corrupt bounds file must never block startup
        }
    }

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        try
        {
            var bounds = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
            Directory.CreateDirectory(Path.GetDirectoryName(BoundsPath)!);
            var saved = new WindowBounds
            {
                Left = bounds.Left,
                Top = bounds.Top,
                Width = bounds.Width,
                Height = bounds.Height,
                Maximized = WindowState == WindowState.Maximized,
            };
            File.WriteAllText(BoundsPath, JsonSerializer.Serialize(saved));
        }
        catch
        {
            // preference persistence is best-effort
        }

        try
        {
            // Closing the console stops lending this machine, matching what the
            // downloaded launcher promises when its window is closed.
            if (_worker is { HasExited: false } worker) worker.Kill(entireProcessTree: true);
        }
        catch
        {
            // shutting down is best-effort
        }

        _ = _server.DisposeAsync();
    }
}
