# 桌面原生模块契约（StarStackDesktop）

`src/platform-win.tsx` 只依赖 `NativeModules.StarStackDesktop` 的五个方法和一个事件。
`windows/` 由 `scripts/init-windows.ps1` 在节点 84 生成后，把模块加到生成的 C++ 工程里。

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

## C++/WinRT 实现要点

- 用 `REACT_MODULE(StarStackDesktop)` + `REACT_INIT` 保存 `ReactContext`，`REACT_METHOD` 暴露上述方法。
- 文件选择：`winrt::Windows::Storage::Pickers::FileOpenPicker`，先对 picker 取
  `IInitializeWithWindow` 并绑定 RNW 顶层窗口句柄，否则 Win32 应用会直接抛异常。
- 保存下载：`FileSavePicker` 选路径，`Windows::Web::Http::HttpClient` 带
  `Authorization: Bearer <token>` 拉字节流写文件。
- 节点进程：`CreateProcessW` 启动
  ```
  starstack-worker.exe --server <baseUrl> --id <nodeId> --launch <launchCode> \
    --name desktop-node --price <price> --slots <slots> \
    --work %LOCALAPPDATA%\StarStack\node\<nodeId>
  ```
  二进制查找顺序：环境变量 `STARSTACK_WORKER` → exe 同目录 → 从
  `/dl/starstack-worker-windows-amd64.exe` 下载并按 `/dl/...sha256` 校验后缓存。
- 状态：`GetExitCodeProcess` 判断是否存活；stdout/stderr 用匿名管道读取，
  通过 `reactContext.EmitJSEvent("RCTDeviceEventEmitter", "StarStackNodeStatus", payload)` 推送。
- 退出：`TerminateProcess` + `TerminateJobObject`，避免 worker 的子进程残留。

## 注册

生成的 `windows/StarStackDesktop` 工程里：

1. 把本目录的模块源文件加入 `.vcxproj`；
2. 在 `ReactPackageProvider` 里 `AddAttributedModules`（或把模块实例加入 package 列表）；
3. `npx react-native run-windows`。

> 这一段必须在节点 84 的 VS2022 + Windows SDK 环境里写/编译；本机没有 .NET/VS 工具链，
> 因此仓库只保留契约与生成脚本，避免提交一份从未编译过的 C++ 代码。
