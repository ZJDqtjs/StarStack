// 构建戳由 vite.config.js 的 define 注入端口，与 apps/mobile 同一套约定。
// 两端戳对不上，就说明「web 更新了但桌面/安卓没跟上」。
export const BUILD =
  typeof __BUILD__ === 'undefined' ? { pkg: 'web-react', sha: 'dev', time: '未构建' } : __BUILD__

export const BUILD_LABEL = `${BUILD.sha} · ${BUILD.time}`
