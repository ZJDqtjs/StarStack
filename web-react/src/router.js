import { useEffect, useState } from 'react'

export const ROUTES = {
  home: '总览', image: '生图', video: '生视频', render: '渲染', build: '任务编排',
  api: '模型 API', market: '服务市场', sell: '我的发布', messages: '消息', nodes: '我的节点',
  pool: '算力市场', jobs: '我的任务', wallet: '钱包账单', forum: '论坛', settings: '设置',
  admin: '管理总览', 'admin-nodes': '节点监控', 'admin-pool': 'API 池部署', 'admin-alloc': '算力调拨',
}
export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '')
  const [v, q] = h.split('?')
  const tab = q ? new URLSearchParams(q).get('tab') : null
  return { view: ROUTES[v] ? v : 'home', tab }
}
export function nav(view, tab) {
  const want = '#/' + view + (tab ? '?tab=' + tab : '')
  if (location.hash !== want) location.hash = want
}
export function useHashRoute() {
  const [r, setR] = useState(parseHash)
  useEffect(() => {
    const h = () => setR(parseHash())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return r
}