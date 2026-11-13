import React, { useState } from 'react'
import { useApp } from '../store.jsx'
import { Btn, StarMark } from '../ui.jsx'
import { f2 } from '../api.js'

export default function Auth() {
  const { policy, login } = useApp()
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [invite, setInvite] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const inviteRequired = !!(policy && policy.signup_invite_required)

  const submit = async () => {
    if (!name.trim() || !pass) { setMsg('请填写用户名和密码'); return }
    if (mode === 'reg' && pass !== pass2) { setMsg('两次密码不一致'); return }
    setBusy(true); setMsg('正在计算口令哈希…')
    try {
      await login(name.trim(), pass, invite.trim(), mode)
      setMsg(''); setPass(''); setPass2('')
    } catch (e) { setMsg('失败：' + e) }
    finally { setBusy(false) }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-art">
        <div className="auth-brand"><div className="mark"><StarMark size={16} /></div><b>星栈算力</b></div>
        <h2>让每一份闲置算力<br />都变成生产力</h2>
        <p>分布式转码、渲染与模型推理，按实测用量结算；接一台机器进来，也能成为算力供给方。</p>
        <div className="auth-tags"><span>分布式调度</span><span>哈希校验</span><span>按量结算</span><span>OpenAI 兼容</span></div>
      </div>
      <div className="card auth-form">
        <div className="auth-head">
          <span className="eyebrow">Welcome</span>
          <h1>{mode === 'login' ? '登录你的账户' : '创建账户'}</h1>
          <p>一个账户，既能提交任务，也能把闲置机器接入算力池。</p>
        </div>
        <div className="tabs" role="tablist">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setMsg('') }}>登录</button>
          <button type="button" className={mode === 'reg' ? 'on' : ''} onClick={() => { setMode('reg'); setMsg('') }}>注册</button>
        </div>
        <label>用户名</label>
        <input value={name} onChange={e => setName(e.target.value)} autoComplete="username" placeholder="2-24 个字符" />
        <label>密码</label>
        <input type="password" value={pass} onChange={e => setPass(e.target.value)} autoComplete="current-password" placeholder="至少 8 位"
          onKeyDown={e => { if (e.key === 'Enter' && mode === 'login') submit() }} />
        {mode === 'reg' && (
          <div>
            <label>确认密码</label>
            <input type="password" value={pass2} onChange={e => setPass2(e.target.value)} autoComplete="new-password" />
            {inviteRequired && (<div><label>邀请码</label><input value={invite} onChange={e => setInvite(e.target.value)} placeholder="向部署者索取" /></div>)}
          </div>
        )}
        <Btn block style={{ marginTop: 20 }} disabled={busy} onClick={submit}>{mode === 'reg' ? '注册并登录' : '登录'}</Btn>
        <div className="hint" role="alert" style={{ color: msg ? 'var(--bad)' : undefined }}>{msg}</div>
        <div className="security">
          口令以 PBKDF2-HMAC-SHA256（20 万次迭代 + 随机盐）存储，服务端不保存明文；会话为 HttpOnly Cookie，有效期 30 天。
          {policy && policy.signup_credit > 0 && <>新用户注册赠送 <code>{f2(policy.signup_credit)}</code> 算力点{policy.recharge ? '。' : '；本部署关闭自助充值。'}</>}
          {inviteRequired && '本部署注册需要邀请码。'}
        </div>
      </div>
    </div>
  )
}