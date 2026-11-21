#pragma once

#include "pch.h"
#include <NativeModules.h>

#include <atomic>
#include <mutex>
#include <string>
#include <thread>

namespace StarStackDesktop {

REACT_MODULE(StarStackDesktop)
struct StarStackDesktop {
  ~StarStackDesktop();

  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &reactContext) noexcept;

  // 文件选择：返回 {uri,name,size,mimeType} JSON，取消返回 null。
  REACT_METHOD(PickFile, L"pickFile")
  void PickFile(
      std::string typesJson,
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept;

  // 带 Bearer 下载并让用户选择保存路径。
  REACT_METHOD(Download, L"download")
  void Download(
      std::string url,
      std::string filename,
      std::string headersJson,
      winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept;

  // 启动/停止 starstack-worker.exe。
  REACT_METHOD(NodeStart, L"nodeStart")
  void NodeStart(
      std::string baseUrl,
      std::string launchCode,
      std::string nodeId,
      double slots,
      double price,
      winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept;

  REACT_METHOD(NodeStop, L"nodeStop")
  void NodeStop(winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept;

  REACT_METHOD(NodeStatus, L"nodeStatus")
  void NodeStatus(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept;

 private:
  bool IsRunning() const noexcept;
  winrt::Microsoft::ReactNative::JSValue StatusValue() noexcept;
  void EmitStatus() noexcept;

  // worker 的日志走 stderr；起一条线程边读边解析，页面上才有真实的
  // 相位 / 分片号 / 编码器 / 已完成片数，而不是永远停在 "polling, 0 片"。
  void StartPump(void *readPipe) noexcept;
  void StopPump() noexcept;
  void PumpLoop() noexcept;
  void HandleLine(std::string const &line) noexcept;
  void PostEmit() noexcept;

  winrt::Microsoft::ReactNative::ReactContext m_context;
  HANDLE m_job{nullptr};
  HANDLE m_process{nullptr};
  DWORD m_pid{0};
  std::wstring m_nodeId;
  std::wstring m_lastError;

  std::thread m_pump;
  std::atomic<bool> m_stopping{false};
  std::atomic<bool> m_pumpRunning{false};
  HANDLE m_readPipe{nullptr};
  mutable std::mutex m_mutex;
  std::string m_phase{"idle"};
  std::string m_segId;
  std::string m_encoder;
  std::string m_lastLine;
  double m_served{0};
  double m_earned{0};
};

} // namespace StarStackDesktop
