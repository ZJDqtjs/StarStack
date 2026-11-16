# 桌面原生模块（StarStackDesktop）

`src/platform-win.tsx` 只依赖 `NativeModules.StarStackDesktop` 的五个方法和一个事件。
`windows/` 由 `scripts/init-windows.ps1` 在节点 84 生成；脚本会自动调用
`scripts/apply-native.ps1`，把本目录的 `.h/.cpp` 加进生成的 `.vcxproj`。

实现文件：

- `StarStackDesktopModule.h` / `.cpp`：文件选择（`GetOpenFileNameW`）、另存下载（WinHTTP）、
  `starstack-worker.exe` 子进程（JobObject 整树回收）、状态事件。
- RNW 0.84 的 C++ 模板已经用 `CompReactPackageProvider` + `AddAttributedModules` 注册工程内模块，
  所以不需要改 `App.cpp`。

## JS 侧调用

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `pickFile(typesJson)` | MIME/扩展名数组的 JSON | `Promise<string \| null>` | JSON `{uri,name,size,mimeType}`；取消返回 null |
| `download(url, filename, headersJson)` | 带 Bearer 的下载地址、文件名、headers JSON | `Promise<void>` | 保存到用户选择的路径（或 Downloads） |
| `nodeStart(baseUrl, launchCode, nodeId, slots, price)` | Broker 地址、一次性启动码、节点 ID、槽位、单价 | `Promise<void>` | 启动 `starstack-worker.exe` 子进程 |
| `nodeStop()` | — | `Promise<void>` | 终止子进程树 |
| `nodeStatus()` | — | `Promise<string>` | JSON：`{running,nodeId,phase,segId,pct,lastError,served,earned,encoder}` |

事件：`RCTDeviceEventEmitter` 上的 `StarStackNodeStatus`，payload 与 `nodeStatus()` 同结构。
`src/platform-win.tsx` 用 `NativeEventEmitter(StarStackDesktop)` 订阅。

## C++/WinRT 实现

- `REACT_MODULE(StarStackDesktop)` + `REACT_INIT` 保存 `ReactContext`；
  `REACT_METHOD` 暴露 `pickFile / download / nodeStart / nodeStop / nodeStatus`。
- 文件选择：Win32 `GetOpenFileNameW`（不依赖 WinRT picker，少一层窗口句柄问题）。
- 保存下载：`GetSaveFileNameW` + WinHTTP（`WinHttpCrackUrl` / `WinHttpSendRequest` /
  `WinHttpReadData`），headers 从 JS 传入的 JSON 解析，Bearer 不落盘。
- 节点进程：`CreateProcessW` 启动
  ```
  starstack-worker.exe --server <baseUrl> --id <nodeId> --launch <launchCode> \
    --name desktop-node --price <price> --slots <slots> \
    --work %LOCALAPPDATA%\StarStack\node\<nodeId>
  ```
  二进制查找顺序：环境变量 `STARSTACK_WORKER` → exe 同目录。
  用 JobObject（`KILL_ON_JOB_CLOSE`）回收整棵进程树。
- 状态：`GetExitCodeProcess` 判断存活；通过
  `ReactContext::EmitJSEvent(L"RCTDeviceEventEmitter", L"StarStackNodeStatus", payload)` 推送。
- 注册：RNW 0.84 的 C++ 模板自带 `CompReactPackageProvider` + `AddAttributedModules`，
  新增 `.h/.cpp` 后不需要改 `App.cpp`。

## 生成后自动接入

`scripts/init-windows.ps1` 在 `init-windows` 之后自动调用 `scripts/apply-native.ps1`：

- 复制 `StarStackDesktopModule.{h,cpp}` 到生成的工程目录；
- 往 `.vcxproj` 插入 `ClCompile` / `ClInclude`；
- 补 `winhttp.lib;comdlg32.lib;` 链接项。

> 本机没有 VS2022 / Windows SDK，无法编译验证；C++ 代码在节点 84 上编译，
> 若 RNW 0.84 的 `ReactPromise`/`JSValue` 细节有版本差异，按报错微调即可。
