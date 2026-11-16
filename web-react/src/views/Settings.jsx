import React, { useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Btn, Card, Stat, Tag } from '../ui.jsx'
import { api, f2, getBroker, setBroker, BROKER } from '../api.js'
import { BUILD, BUILD_LABEL } from '../build.js'

export default function Settings() {
  const { me, workers, jobs, advanced, setAdvanced, toast } = useApp()
  const [vmCount, setVmCount] = useState(0)
  const [brokerIn, setBrokerIn] = useState(getBroker())
  // exe 里不能把前端切到绝对地址：同源反代由 WPF 主进程负责，前端只管通知它换目标。
  const inWebView2 = typeof window !== 'undefined' && !!window.chrome?.webview
  useEffect(() => { api('/api/vm/instances').then(d => setVmCount((d.instances || []).length)).catch(() => {}) }, [])
  const saveBroker = () => {
    const v = brokerIn.trim().replace(/\/+$/, '')
    if (inWebView2) {
      try { window.chrome.webview.postMessage({ kind: 'broker', base: v }) } catch (e) {}
      setBroker('') // 前端继续走同源，由主进程反代
    } else {
      setBroker(v)
    }
    location.reload()
  }
  const toggle = async e => {
    const on = e.target.checked
    try { await setAdvanced(on); toast(on ? '高级选项已开启' : '已回到简洁模式', 'ok') } catch (err) { toast(String(err), 'bad', '保存失败') }
  }
  const links = [['jobs', '我的任务', '进度、分片与结算明细'], ['market', '服务市场', '租用云主机与购买服务'], ['nodes', '我的节点', '接入机器、单价与收益'], ['wallet', '钱包账单', '账户流水与节点收益'], ['pool', '算力市场', '在线节点与可调度切片'], ['sell', '我的发布', '管理已发布的服务']]
  return (
    <div>
      <div className="phead"><div className="phead-txt"><span className="eyebrow">Settings</span><h1>设置</h1><p>账户概览、界面偏好与安全说明。</p></div></div>
      <Card kicker="Account" title="账户概览" side={<Tag tone="mine">{me ? me.name : ''}</Tag>}>
        <div className="stats" style={{ marginTop: 6 }}>
          <Stat v={f2(me ? me.credits : 0)} l="算力点余额" />
          <Stat v={jobs.length} l="我的任务" />
          <Stat v={workers.filter(w => w.mine && w.online).length} l="我的在线节点" />
          <Stat v={vmCount} l="我的云主机" />
        </div>
        <div className="me-links" style={{ marginTop: 16 }}>
          {links.map(([v, t, d]) => <button key={v} className="me-link" onClick={() => nav(v)}><b>{t}</b><span>{d}</span></button>)}
        </div>
      </Card>
      <Card kicker="Preferences" title="界面设置">
        <label className="check" style={{ marginTop: 0 }}>
          <input type="checkbox" checked={advanced} onChange={toggle} style={{ width: 'auto' }} />
          <span><b>显示高级选项</b><br />编码器、硬件要求、分片数、服务端路径、ComfyUI 工作台</span>
        </label>
        <div className="hint">{advanced ? '高级选项已显示：任务提交页可展开编码参数，生图 / 生视频页会显示 ComfyUI 工作台与算力池。' : '简洁模式只保留必要参数：生图 / 生视频直接在本页出结果，任务提交页只留文件、类型和画质。'}</div>
        <div className="hint" style={{ marginTop: 8 }}>深色 / 浅色主题、侧边栏展开状态都可以通过左下角按钮随时切换，偏好保存在本机。</div>
      </Card>
      <Card kicker="Security" title="安全说明">
        <div className="hint" style={{ marginTop: 0 }}>口令以 PBKDF2-HMAC-SHA256（20 万次迭代 + 随机盐）存储，服务端不保存明文；会话为 HttpOnly Cookie，有效期 30 天。API Key 只在创建时显示一次，服务端只保存 SHA-256 哈希；模型上游密钥用本地 gateway.key 加密后入库。</div>
      </Card>
      <Card kicker="Connection" title="服务器地址">
        <div className="hint" style={{ marginTop: 0 }}>
          当前生效：<b>{BROKER || '同源（跟随当前页面地址）'}</b>
          {inWebView2
            ? ' · 桌面端由主进程同源反代，这里只改反代目标，浏览器侧不产生跨域请求。'
            : ' · 留空表示跟随当前页面地址（线上部署或反代子路径都适用）。'}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input
            className="in"
            style={{ flex: 1, minWidth: 220 }}
            value={brokerIn}
            onChange={e => setBrokerIn(e.target.value)}
            placeholder="https://starstack.run"
          />
          <Btn variant="ghost" tiny onClick={saveBroker}>保存并重载</Btn>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          鸿蒙端（rawfile 内嵌）没有同源后端，必须填绝对地址；安卓节点端在登录页单独设置。
        </div>
      </Card>
      <Card kicker="Build" title="关于构建">
        <div className="hint" style={{ marginTop: 0 }}>
          当前网页版本：<b>{BUILD_LABEL}</b>（{BUILD.pkg}）。
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          桌面 exe / Android APK / 鸿蒙壳内嵌的是构建期快照。打开它们「我的 → About」对比这串戳：
          戳更旧，说明壳里的网页没有跟上这次发布，需要重新构建发版，而不是以为它自动同步了。
        </div>
      </Card>
    </div>
  )
}