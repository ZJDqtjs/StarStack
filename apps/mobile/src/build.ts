// 构建戳由 vite.config.ts 的 define 注入端口。桌面端 exe、Android APK、
// 鸿蒙壳内嵌的都是构建期快照，这枚戳就是判断「壳里的网页是哪一版」的唯一依据。
declare const __BUILD__: { pkg: string; sha: string; time: string }

export type BuildStamp = { pkg: string; sha: string; time: string }

export const BUILD: BuildStamp =
  typeof __BUILD__ === 'undefined' ? { pkg: 'apps/mobile', sha: 'dev', time: '未构建' } : __BUILD__

export const BUILD_LABEL = `${BUILD.sha} · ${BUILD.time}`
