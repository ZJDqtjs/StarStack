#include "StarStackDesktopModule.h"

#include <winrt/Windows.Data.Json.h>

#include <commdlg.h>
#include <shellapi.h>
#include <winhttp.h>

#include <filesystem>
#include <fstream>
#include <sstream>
#include <vector>

#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "comdlg32.lib")
#pragma comment(lib, "shell32.lib")

namespace StarStackDesktop {

namespace {

std::wstring ToWide(std::string const &s) {
  if (s.empty()) return {};
  int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), nullptr, 0);
  std::wstring out(static_cast<size_t>(n), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), out.data(), n);
  return out;
}

std::string ToUtf8(std::wstring const &s) {
  if (s.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), nullptr, 0, nullptr, nullptr);
  std::string out(static_cast<size_t>(n), '\0');
  WideCharToMultiByte(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), out.data(), n, nullptr, nullptr);
  return out;
}

std::wstring ExeDir() {
  wchar_t buf[MAX_PATH]{};
  GetModuleFileNameW(nullptr, buf, MAX_PATH);
  return std::filesystem::path(buf).parent_path().wstring();
}

std::wstring EnvOrEmpty(wchar_t const *name) {
  DWORD n = GetEnvironmentVariableW(name, nullptr, 0);
  if (n == 0) return {};
  std::wstring out(n, L'\0');
  GetEnvironmentVariableW(name, out.data(), n);
  while (!out.empty() && out.back() == L'\0') out.pop_back();
  return out;
}

std::wstring Quote(std::wstring const &v) {
  std::wstring out = L"\"";
  for (wchar_t c : v) {
    if (c == L'"') out += L'\\';
    out += c;
  }
  out += L'"';
  return out;
}

std::string BadArg(std::string const &v) {
  if (v.find('"') != std::string::npos || v.find('\r') != std::string::npos || v.find('\n') != std::string::npos) {
    return "参数包含非法字符";
  }
  return {};
}

std::wstring HeaderBlock(std::string const &headersJson) {
  std::wstring headers;
  if (headersJson.empty() || headersJson == "{}") return L"Accept: */*\r\n";
  try {
    auto obj = winrt::Windows::Data::Json::JsonObject::Parse(ToWide(headersJson));
    for (auto const &pair : obj) {
      if (pair.Value().ValueType() != winrt::Windows::Data::Json::JsonValueType::String) continue;
      headers += pair.Key().c_str();
      headers += L": ";
      headers += pair.Value().GetString().c_str();
      headers += L"\r\n";
    }
  } catch (...) {
    // 非法 header JSON 不阻断下载，至少保留默认头
  }
  headers += L"Accept: */*\r\n";
  return headers;
}

} // namespace

void StarStackDesktop::Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept {
  m_context = reactContext;
}

void StarStackDesktop::PickFile(
    std::string typesJson,
    winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
  (void)typesJson;
  wchar_t file[MAX_PATH]{};
  OPENFILENAMEW ofn{};
  ofn.lStructSize = sizeof(ofn);
  ofn.hwndOwner = GetActiveWindow();
  ofn.lpstrFile = file;
  ofn.nMaxFile = MAX_PATH;
  ofn.lpstrFilter = L"All Files\0*.*\0\0";
  ofn.nFilterIndex = 1;
  ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;

  if (!GetOpenFileNameW(&ofn)) {
    promise.Resolve(winrt::Microsoft::ReactNative::JSValue(nullptr));
    return;
  }

  try {
    std::filesystem::path p(file);
    React::JSValueObject obj;
    obj["uri"] = ToUtf8(p.wstring());
    obj["name"] = ToUtf8(p.filename().wstring());
    obj["size"] = static_cast<double>(std::filesystem::file_size(p));
    obj["mimeType"] = "application/octet-stream";
    promise.Resolve(React::JSValue(std::move(obj)));
  } catch (std::exception const &e) {
    promise.Reject(e.what());
  }
}

void StarStackDesktop::Download(
    std::string url,
    std::string filename,
    std::string headersJson,
    winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
  wchar_t save[MAX_PATH]{};
  std::wstring defaultName = ToWide(filename);
  if (defaultName.empty()) defaultName = L"starstack-artifact.bin";
  wcsncpy_s(save, defaultName.c_str(), _TRUNCATE);

  OPENFILENAMEW ofn{};
  ofn.lStructSize = sizeof(ofn);
  ofn.hwndOwner = GetActiveWindow();
  ofn.lpstrFile = save;
  ofn.nMaxFile = MAX_PATH;
  ofn.lpstrFilter = L"All Files\0*.*\0\0";
  ofn.nFilterIndex = 1;
  ofn.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
  if (!GetSaveFileNameW(&ofn)) {
    promise.Resolve();
    return;
  }

  std::wstring wideUrl = ToWide(url);
  URL_COMPONENTS uc{};
  uc.dwStructSize = sizeof(uc);
  wchar_t host[512]{};
  wchar_t path[4096]{};
  uc.lpszHostName = host;
  uc.dwHostNameLength = _countof(host);
  uc.lpszUrlPath = path;
  uc.dwUrlPathLength = _countof(path);
  if (!WinHttpCrackUrl(wideUrl.c_str(), 0, 0, &uc)) {
    promise.Reject("下载地址不合法");
    return;
  }

  HINTERNET session = WinHttpOpen(L"StarStackDesktop/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                  WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  HINTERNET connect = session ? WinHttpConnect(session, host, uc.nPort, 0) : nullptr;
  DWORD flags = uc.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0;
  HINTERNET request = connect ? WinHttpOpenRequest(connect, L"GET", path, nullptr, WINHTTP_NO_REFERER,
                                                   WINHTTP_DEFAULT_ACCEPT_TYPES, flags)
                              : nullptr;

  auto fail = [&](char const *msg) {
    if (request) WinHttpCloseHandle(request);
    if (connect) WinHttpCloseHandle(connect);
    if (session) WinHttpCloseHandle(session);
    promise.Reject(msg);
  };

  if (!session || !connect || !request) {
    fail("无法建立下载连接");
    return;
  }

  std::wstring headers = HeaderBlock(headersJson);
  WinHttpAddRequestHeaders(request, headers.c_str(), static_cast<DWORD>(-1),
                           WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE);
  if (!WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
      !WinHttpReceiveResponse(request, nullptr)) {
    fail("下载请求失败");
    return;
  }

  DWORD status = 0;
  DWORD statusSize = sizeof(status);
  WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                      WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusSize, WINHTTP_NO_HEADER_INDEX);
  if (status < 200 || status >= 300) {
    fail("下载返回非 2xx");
    return;
  }

  HANDLE file = CreateFileW(save, GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    fail("无法写入目标文件");
    return;
  }

  bool ok = true;
  DWORD available = 0;
  do {
    if (!WinHttpQueryDataAvailable(request, &available)) {
      ok = false;
      break;
    }
    if (available == 0) break;
    std::vector<char> buf(available);
    DWORD read = 0;
    if (!WinHttpReadData(request, buf.data(), available, &read) || read == 0) {
      ok = false;
      break;
    }
    DWORD written = 0;
    if (!WriteFile(file, buf.data(), read, &written, nullptr) || written != read) {
      ok = false;
      break;
    }
  } while (available > 0);

  CloseHandle(file);
  WinHttpCloseHandle(request);
  WinHttpCloseHandle(connect);
  WinHttpCloseHandle(session);

  if (!ok) {
    DeleteFileW(save);
    promise.Reject("下载中断");
    return;
  }
  promise.Resolve();
}

void StarStackDesktop::NodeStart(
    std::string baseUrl,
    std::string launchCode,
    std::string nodeId,
    double slots,
    double price,
    winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
  if (IsRunning()) {
    promise.Reject("本机节点已在运行");
    return;
  }
  for (auto const &v : {baseUrl, launchCode, nodeId}) {
    auto why = BadArg(v);
    if (!why.empty()) {
      promise.Reject(why.c_str());
      return;
    }
  }

  std::wstring worker = EnvOrEmpty(L"STARSTACK_WORKER");
  if (worker.empty() || !std::filesystem::exists(worker)) {
    auto local = std::filesystem::path(ExeDir()) / L"starstack-worker.exe";
    if (std::filesystem::exists(local)) worker = local.wstring();
  }
  if (worker.empty() || !std::filesystem::exists(worker)) {
    promise.Reject("找不到 starstack-worker.exe：放到 exe 同目录或设置 STARSTACK_WORKER");
    return;
  }

  std::wstring id = ToWide(nodeId);
  std::filesystem::path work = std::filesystem::path(EnvOrEmpty(L"LOCALAPPDATA")) / L"StarStack" / L"node" / id;
  std::error_code ec;
  std::filesystem::create_directories(work, ec);
  if (ec) {
    promise.Reject("无法创建节点工作目录");
    return;
  }

  std::wstring cmd = Quote(worker) + L" --server " + Quote(ToWide(baseUrl)) + L" --id " + Quote(id) +
                     L" --launch " + Quote(ToWide(launchCode)) + L" --name " + Quote(L"desktop-node") +
                     L" --price " + std::to_wstring(price) + L" --slots " + std::to_wstring(static_cast<int>(slots)) +
                     L" --work " + Quote(work.wstring());

  // worker 的统计与相位都在 stderr 上（Go 的 log 默认走 stderr），
  // 起进程时把 stderr 接进管道，后台线程解析后推给页面。
  SECURITY_ATTRIBUTES sa{};
  sa.nLength = sizeof(sa);
  sa.bInheritHandle = TRUE;
  HANDLE readPipe = nullptr;
  HANDLE writePipe = nullptr;
  if (!CreatePipe(&readPipe, &writePipe, &sa, 0)) {
    promise.Reject("无法创建节点日志管道");
    return;
  }
  SetHandleInformation(readPipe, HANDLE_FLAG_INHERIT, 0);

  STARTUPINFOW si{};
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdOutput = writePipe;
  si.hStdError = writePipe;
  si.hStdInput = nullptr;

  PROCESS_INFORMATION pi{};
  DWORD createFlags = CREATE_NO_WINDOW | CREATE_SUSPENDED;
  std::vector<wchar_t> mutableCmd(cmd.begin(), cmd.end());
  mutableCmd.push_back(L'\0');
  if (!CreateProcessW(nullptr, mutableCmd.data(), nullptr, nullptr, TRUE, createFlags, nullptr, work.c_str(), &si, &pi)) {
    CloseHandle(readPipe);
    CloseHandle(writePipe);
    promise.Reject("启动 starstack-worker 失败");
    return;
  }
  CloseHandle(writePipe); // 父进程留着写端会让 ReadFile 永远等不到 EOF

  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (job) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION info{};
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info, sizeof(info));
    AssignProcessToJobObject(job, pi.hProcess);
  }

  m_job = job;
  m_process = pi.hProcess;
  m_pid = pi.dwProcessId;
  m_nodeId = id;
  m_stopping = false;
  {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_lastError.clear();
    m_phase = "registering";
    m_segId.clear();
    m_encoder.clear();
    m_lastLine.clear();
    m_served = 0;
    m_earned = 0;
  }
  ResumeThread(pi.hThread);
  CloseHandle(pi.hThread);
  StartPump(readPipe);
  EmitStatus();
  promise.Resolve();
}

void StarStackDesktop::NodeStop(winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
  m_stopping = true;
  StopPump();
  if (m_job) {
    TerminateJobObject(m_job, 0);
    CloseHandle(m_job);
    m_job = nullptr;
  } else if (m_process) {
    TerminateProcess(m_process, 0);
  }
  if (m_process) {
    CloseHandle(m_process);
    m_process = nullptr;
  }
  m_pid = 0;
  m_nodeId.clear();
  {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_phase = "idle";
    m_segId.clear();
  }
  EmitStatus();
  promise.Resolve();
}

void StarStackDesktop::NodeStatus(
    winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
  promise.Resolve(StatusValue());
}

StarStackDesktop::~StarStackDesktop() {
  // 模块析构时泵线程必须停掉，否则 std::thread 在 joinable 状态下析构会 std::terminate
  m_stopping = true;
  StopPump();
}

void StarStackDesktop::StartPump(void *readPipe) noexcept {
  StopPump();
  m_readPipe = static_cast<HANDLE>(readPipe);
  m_pumpRunning = true;
  m_pump = std::thread([this]() { PumpLoop(); });
}

void StarStackDesktop::StopPump() noexcept {
  // 注意：这里不碰 m_stopping。标志由调用方决定（NodeStop/析构 = 主动停；
  // NodeStart 重启前先清掉，否则新线程一进循环就退出）。
  if (m_readPipe) {
    // 关掉读端让阻塞中的 ReadFile 立刻返回，线程才能退出
    CloseHandle(m_readPipe);
    m_readPipe = nullptr;
  }
  if (m_pump.joinable()) {
    m_pump.join();
  }
  m_pumpRunning = false;
}

void StarStackDesktop::PumpLoop() noexcept {
  char buf[4096];
  std::string pending;
  HANDLE pipe = m_readPipe;
  while (pipe && !m_stopping.load()) {
    DWORD read = 0;
    if (!ReadFile(pipe, buf, sizeof(buf), &read, nullptr) || read == 0) break;
    pending.append(buf, read);
    size_t pos = 0;
    while ((pos = pending.find('\n')) != std::string::npos) {
      std::string line = pending.substr(0, pos);
      pending.erase(0, pos + 1);
      if (!line.empty() && line.back() == '\r') line.pop_back();
      HandleLine(line);
    }
  }
  if (!pending.empty()) HandleLine(pending);

  m_pumpRunning = false;
  // 不是页面点「停止」而是进程自己退出的，把退出码带回去，别让卡片一直显示运行中
  if (!m_stopping.load()) {
    DWORD code = 0;
    bool exited = m_process && GetExitCodeProcess(m_process, &code) && code != STILL_ACTIVE;
    std::lock_guard<std::mutex> lock(m_mutex);
    if (exited && m_lastError.empty()) {
      m_lastError = L"节点进程已退出（exit code " + std::to_wstring(code) + L"）";
      m_phase = "error";
    } else if (m_phase != "error") {
      m_phase = "idle";
    }
    m_segId.clear();
  }
  PostEmit();
}

void StarStackDesktop::HandleLine(std::string const &line) noexcept {
  if (line.empty()) return;
  bool changed = false;
  {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_lastLine = line;

    if (line.rfind("node ", 0) == 0 && line.find(" online:") != std::string::npos) {
      // node <id> online: os/arch cpus=.. mem=..MB gpus=[..] slots=.. price=.. encoders=[a b c]
      m_phase = "polling";
      m_lastError.clear();
      auto at = line.find("encoders=[");
      if (at != std::string::npos) {
        auto end = line.find(']', at);
        if (end != std::string::npos) m_encoder = line.substr(at + 10, end - at - 10);
      }
      changed = true;
    } else if (line.rfind("seg ", 0) == 0 && line.find(" done in ") != std::string::npos) {
      m_served += 1;
      m_phase = "polling";
      m_segId.clear();
      changed = true;
    } else if (line.rfind("seg ", 0) == 0 && line.find(" FAILED: ") != std::string::npos) {
      m_phase = "error";
      m_lastError = ToWide(line.substr(line.find(" FAILED: ") + 9));
      changed = true;
    } else if (line.rfind("seg ", 0) == 0 && line.find(" -> ") != std::string::npos) {
      // seg <id> (job <job> #<n>) 1.5-4.5s -> libx264
      auto sp = line.find(' ', 4);
      m_segId = line.substr(4, sp == std::string::npos ? std::string::npos : sp - 4);
      m_phase = "transcoding";
      m_encoder = line.substr(line.find(" -> ") + 4);
      m_lastError.clear();
      changed = true;
    } else if (line.find("claim failed:") != std::string::npos ||
               line.find("claim error ") != std::string::npos ||
               line.find("re-register:") != std::string::npos) {
      m_phase = "error";
      m_lastError = ToWide(line);
      changed = true;
    }
  }
  if (changed) PostEmit();
}

void StarStackDesktop::PostEmit() noexcept {
  try {
    m_context.UIDispatcher().Post([this]() { EmitStatus(); });
  } catch (...) {
    // 页面已销毁 / 上下文失效：丢掉一次状态更新无害
  }
}

bool StarStackDesktop::IsRunning() const noexcept {
  if (!m_process) return false;
  DWORD code = 0;
  if (!GetExitCodeProcess(m_process, &code)) return false;
  return code == STILL_ACTIVE;
}

winrt::Microsoft::ReactNative::JSValue StarStackDesktop::StatusValue() noexcept {
  React::JSValueObject obj;
  bool running = IsRunning();
  std::lock_guard<std::mutex> lock(m_mutex);
  obj["running"] = running;
  obj["nodeId"] = ToUtf8(m_nodeId);
  obj["phase"] = running ? m_phase : (m_phase == "error" ? "error" : "idle");
  obj["segId"] = m_segId;
  obj["pct"] = 0.0;
  obj["lastError"] = ToUtf8(m_lastError);
  obj["served"] = m_served;
  obj["earned"] = m_earned;
  obj["encoder"] = m_encoder;
  return React::JSValue(std::move(obj));
}

void StarStackDesktop::EmitStatus() noexcept {
  try {
    m_context.EmitJSEvent(L"RCTDeviceEventEmitter", L"StarStackNodeStatus", StatusValue());
  } catch (...) {
    // 页面关闭/重载时丢弃一次状态无害
  }
}

} // namespace StarStackDesktop
