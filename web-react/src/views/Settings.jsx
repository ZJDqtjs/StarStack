import React, { useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Card, Stat, Tag } from '../ui.jsx'
import { api, f2 } from '../api.js'

export default function Settings() {
  const { me, workers, jobs, advanced, setAdvanced, toast } = useApp()
  const [vmCount, setVmCount] = useState(0)
  useEffect(() => { api('/api/vm/instances').then(d => setVmCount((d.instances || []).length)).catch(() => {}) }, [])
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
          <span><b>显示高级选项</b><br />编码器、硬件要求、分片数、服务端路径</span>
        </label>
        <div className="hint">{advanced ? '高级选项已显示在提交任务页。' : '简洁模式只保留文件、任务类型和画质；渲染任务仍会展开必要参数。'}</div>
        <div className="hint" style={{ marginTop: 8 }}>深色 / 浅色主题、侧边栏展开状态都可以通过左下角按钮随时切换，偏好保存在本机。</div>
      </Card>
      <Card kicker="Security" title="安全说明">
        <div className="hint" style={{ marginTop: 0 }}>口令以 PBKDF2-HMAC-SHA256（20 万次迭代 + 随机盐）存储，服务端不保存明文；会话为 HttpOnly Cookie，有效期 30 天。API Key 只在创建时显示一次，服务端只保存 SHA-256 哈希；模型上游密钥用本地 gateway.key 加密后入库。</div>
      </Card>
    </div>
  )
}