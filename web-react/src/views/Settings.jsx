import React, { useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Btn, Card, Stat, Tag } from '../ui.jsx'
import { api, f2, getBroker, setBroker, post, href, BROKER } from '../api.js'
import { BUILD, BUILD_LABEL } from '../build.js'

export default function Settings() {
  const { me, workers, jobs, advanced, setAdvanced, toast, confirm } = useApp()
  const [vmCount, setVmCount] = useState(0)
  const [brokerIn, setBrokerIn] = useState(getBroker())
  // 登录方式：邮箱 / 口令 / 已绑定的第三方。只在进入设置页时取一次。
  const [ids, setIds] = useState(null)
  const [emailIn, setEmailIn] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [pwOld, setPwOld] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [busy, setBusy] = useState(false)
  const loadIds = () => api('/api/me/identities').then(setIds).catch(() => {})
  useEffect(() => { loadIds() }, [])
  const saveEmail = async () => {
    if (!emailIn.trim()) { toast('请填写邮箱', 'bad'); return }
    setBusy(true)
    try {
      const r = await post('/api/me/email', { email: emailIn.trim(), code: emailCode.trim() })
      if (r && r.need_code) {
        setCodeSent(true); toast('验证码已发送到 ' + emailIn.trim(), 'ok'); return
      }
      setCodeSent(false); setEmailCode(''); setEmailIn(''); loadIds()
      toast(r && r.email_verified ? '邮箱已绑定并验证' : '邮箱已绑定（本部署未开启验证）', 'ok')
    } catch (e) { toast(String(e), 'bad', '绑定失败') } finally { setBusy(false) }
  }
  const dropEmail = async () => {
    try {
      await api('/api/me/email', { method: 'DELETE' }); loadIds(); toast('邮箱已解绑', 'ok')
    } catch (e) { toast(String(e), 'bad', '解绑失败') }
  }
  const bindProvider = p => {
    const next = encodeURIComponent('/#/settings')
    window.location.href = href('/api/auth/oauth/' + p.id + '/start?bind=1&next=' + next)
  }
  const unbindProvider = async p => {
    if (!(await confirm(`解绑 ${p.label}？之后只能用其它方式登录。`))) return
    try {
      await api('/api/me/identities/' + p.id, { method: 'DELETE' }); loadIds(); toast('已解绑', 'ok')
    } catch (e) { toast(String(e), 'bad', '解绑失败') }
  }
  const savePassword = async () => {
    if (!pwNew) { toast('请填写新口令', 'bad'); return }
    setBusy(true)
    try {
      await post('/api/me/password', { old: pwOld, new: pwNew })
      setPwOld(''); setPwNew(''); loadIds(); toast('口令已保存', 'ok')
    } catch (e) { toast(String(e), 'bad', '保存失败') } finally { setBusy(false) }
  }
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
      <Card kicker="Sign-in" title="登录方式" side={<Tag>{ids ? (ids.providers || []).filter(p => p.bound).length + ' 个第三方' : '—'}</Tag>}>
        {!ids ? <div className="hint" style={{ marginTop: 0 }}>正在读取…</div> : (
          <>
            <div className="login-methods">
              <div className="login-row">
                <div className="lr-main">
                  <b>邮箱</b>
                  <span>{ids.email ? ids.email + (ids.email_verified ? ' · 已验证' : ' · 未验证（本部署未开启邮件验证）') : '未绑定：绑定后可用邮箱登录、找回口令'}</span>
                </div>
                <div className="lr-actions">
                  {ids.email && <Btn variant="ghost" tiny onClick={dropEmail}>解绑</Btn>}
                </div>
              </div>
              <div className="login-row">
                <div className="lr-main">
                  <b>账号口令</b>
                  <span>{ids.has_password ? '已设置。修改需要原口令' : '未设置：第三方登录创建的账号需要先设一个口令才能解绑唯一登录方式'}</span>
                </div>
              </div>
              {(ids.providers || []).map(p => (
                <div className="login-row" key={p.id}>
                  <div className="lr-main">
                    <b>{p.label}</b>
                    <span>{p.bound ? '已绑定' + (p.login ? '：' + p.login : '') : '未绑定'}</span>
                  </div>
                  <div className="lr-actions">
                    {p.bound
                      ? <Btn variant="ghost" tiny onClick={() => unbindProvider(p)}>解绑</Btn>
                      : <Btn variant="ghost" tiny onClick={() => bindProvider(p)}>绑定</Btn>}
                  </div>
                </div>
              ))}
            </div>

            <div className="login-form">
              <input className="in" value={emailIn} onChange={e => setEmailIn(e.target.value)}
                placeholder={ids.email ? '换绑到新邮箱 you@example.com' : '绑定邮箱 you@example.com'} />
              {codeSent && (
                <input className="in" style={{ maxWidth: 130 }} value={emailCode} inputMode="numeric" maxLength={6}
                  onChange={e => setEmailCode(e.target.value)} placeholder="验证码" />
              )}
              <Btn tiny disabled={busy} onClick={saveEmail}>{codeSent ? '提交验证码' : '绑定邮箱'}</Btn>
            </div>

            <div className="login-form">
              {ids.has_password && (
                <input className="in" type="password" value={pwOld} onChange={e => setPwOld(e.target.value)}
                  autoComplete="current-password" placeholder="原口令" />
              )}
              <input className="in" type="password" value={pwNew} onChange={e => setPwNew(e.target.value)}
                autoComplete="new-password" placeholder={ids.has_password ? '新口令（至少 8 位）' : '设置口令（至少 8 位）'} />
              <Btn tiny disabled={busy} onClick={savePassword}>{ids.has_password ? '修改口令' : '设置口令'}</Btn>
            </div>
            <div className="hint">
              邮箱与第三方账号都是登录方式，平台账号本身不变：余额、节点和任务不会因为解绑而丢失。
              至少保留一种可用的登录方式，服务端会拒绝把最后一种也解绑掉。
            </div>
          </>
        )}
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