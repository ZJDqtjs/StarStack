import type { CapacitorConfig } from '@capacitor/cli'

// ⚠ 已废弃（2026-11-15）：手机端唯一形态是 apps/mobile-rn（RN + Kotlin 前台 Service，
// 同时是常驻算力节点）。本工程保留仅作历史参考，不再发布 —— release.yml 已停止
// 构建 Capacitor APK，欢迎页也不再提供旧包。webDir 已改指 web-react/dist，
// 万一有人误跑 apk 脚本，产出的也是当前界面而不是 Capacitor 时代那套。
//
// androidScheme http keeps the WebView origin at http://localhost so the app can
// talk to the broker over plain HTTP on :8787 without hitting mixed-content rules.
// localhost is still a secure context, so clipboard and other web APIs keep working.
const config: CapacitorConfig = {
  appId: 'com.starstack.compute',
  appName: '星栈算力',
  webDir: '../web-react/dist',
  server: { androidScheme: 'http', cleartext: true },
  android: { allowMixedContent: true, backgroundColor: '#f6f8fd' },
}

export default config
