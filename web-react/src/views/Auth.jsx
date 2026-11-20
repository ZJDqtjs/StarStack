import React, { useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import { Btn, StarMark } from '../ui.jsx'
import { BROKER, f2, href, post } from '../api.js'

// 登录页的三种模式：登录 / 注册 / 找回口令。第三方登录是独立入口，不占标签页。
export default function Auth() {
  const { policy, login } = useApp()
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [code, setCode] = useState('')
  const [invite, setInvite] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [codeSent, setCodeSent] = useState(0)
  const inviteRequired = !!(policy && policy.signup_invite_required)
  const needCode = !!(policy && policy.email_verification)
  const providers = (policy && policy.oauth_providers) || []
  // 桌面端 / 鸿蒙端走绝对地址时，授权的回跳会落在 Broker 源上，Cookie 带不回来，
  // 这里干脆不给按钮，免得点了必然失败。
  const sameOrigin = !BROKER

  // 授权失败时回调会带着 ?oauth_error= 回到这里；取出来展示一次后从地址栏抹掉，
  // 免得刷新页面又看到上一条错误。
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const err = q.get('oauth_error')
    if (!err) return
    setMsg(err)
    q.delete('oauth_error')
    const rest = q.toString()
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash)
  }, [])

  const go = id => {
    const next = location.pathname + location.search + location.hash
    window.location.href = href('/api/auth/oauth/' + id + '/start?next=' + encodeURIComponent(next))
  }

  const sendCode = async () => {
    if (!email.trim()) { setMsg('请先填写邮箱'); return }
    setBusy(true)
    try {
      const purpose = mode === 'reg' ? 'register' : 'reset'
      await post('/api/auth/email/code', { email: email.trim(), purpose })
      setCodeSent(Date.now())
      setMsg('验证码已发到 ' + email.trim() + '，10 分钟内有效')
    } catch (e) { setMsg('发送失败：' + e) }
    finally { setBusy(false) }
  }

  const submit = async () => {
    if (mode === 'reset') {
      if (!email.trim() || !code.trim() || !pass) { setMsg('请填写邮箱、验证码和新口令'); return }
      setBusy(true); setMsg('正在提交…')
      try {
        await login('reset', { email: email.trim(), code: code.trim(), password: pass })
        setMsg('口令已重置，请用新口令登录')
        setMode('login'); setCode(''); setPass(''); setPass2('')
      } catch (e) { setMsg('失败：' + e) }
      finally { setBusy(false) }
      return
    }
    if (mode === 'login') {
      if (!name.trim() || !pass) { setMsg('请填写用户名/邮箱和口令'); return }
    } else {
      if ((!name.trim() && !email.trim()) || !pass) { setMsg('请填写用户名或邮箱，以及口令'); return }
      if (pass !== pass2) { setMsg('两次口令不一致'); return }
      if (needCode && email.trim() && !code.trim()) { setMsg('请填写邮箱验证码'); return }
    }
    setBusy(true); setMsg('正在计算口令哈希…')
    try {
      const payload = mode === 'reg'
        ? { name: name.trim(), email: email.trim(), password: pass, code: code.trim(), invite: invite.trim() }
        : { name: name.trim(), password: pass }
      await login(mode, payload)
      setMsg(''); setPass(''); setPass2(''); setCode('')
    } catch (e) { setMsg('失败：' + e) }
    finally { setBusy(false) }
  }

  const switchMode = m => { setMode(m); setMsg(''); setCode('') }

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
          <h1>{mode === 'login' ? '登录你的账户' : mode === 'reg' ? '创建账户' : '找回口令'}</h1>
          <p>{mode === 'reset'
            ? '用注册邮箱接收验证码，重置后所有设备需要重新登录。'
            : '一个账户，既能提交任务，也能把闲置机器接入算力池。'}</p>
        </div>

        {mode !== 'reset' && (
          <div className="tabs" role="tablist">
            <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => switchMode('login')}>登录</button>
            <button type="button" className={mode === 'reg' ? 'on' : ''} onClick={() => switchMode('reg')}>注册</button>
          </div>
        )}

        {sameOrigin && providers.length > 0 && mode === 'login' && (
          <>
            <div className="oauth-row">
              {providers.map(p => (
                <button key={p.id} type="button" className="oauth-btn" disabled={busy} onClick={() => go(p.id)}>
                  使用 {p.label} 继续
                </button>
              ))}
            </div>
            <div className="oauth-sep"><span>或使用账号口令</span></div>
          </>
        )}

        {mode !== 'reset' && (
          <>
            <label>{mode === 'login' ? '用户名或邮箱' : '用户名'}</label>
            <input value={name} onChange={e => setName(e.target.value)}
              autoComplete="username"
              placeholder={mode === 'login' ? '用户名 / 邮箱' : '2-24 个字符，留空则用邮箱前缀'} />
          </>
        )}

        {mode !== 'login' && (
          <>
            <label>邮箱{mode === 'reg' ? '（可选，用于登录与找回口令）' : ''}</label>
            <input value={email} onChange={e => setEmail(e.target.value)} autoComplete="email"
              placeholder="you@example.com"
              onKeyDown={e => { if (e.key === 'Enter' && mode === 'reset') submit() }} />
          </>
        )}

        {mode !== 'login' && needCode && email.trim() && (
          <>
            <label>邮箱验证码</label>
            <div className="code-row">
              <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric"
                autoComplete="one-time-code" placeholder="6 位数字" maxLength={6} />
              <Btn variant="ghost" tiny disabled={busy} onClick={sendCode}>
                {codeSent ? '重新发送' : '发送验证码'}
              </Btn>
            </div>
          </>
        )}

        <label>{mode === 'reset' ? '新口令' : '口令'}</label>
        <input type="password" value={pass} onChange={e => setPass(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="至少 8 位"
          onKeyDown={e => { if (e.key === 'Enter') submit() }} />

        {mode !== 'login' && (
          <>
            <label>确认口令</label>
            <input type="password" value={pass2} onChange={e => setPass2(e.target.value)} autoComplete="new-password" />
          </>
        )}

        {mode === 'reg' && inviteRequired && (
          <><label>邀请码</label><input value={invite} onChange={e => setInvite(e.target.value)} placeholder="向部署者索取" /></>
        )}

        <Btn block style={{ marginTop: 20 }} disabled={busy} onClick={submit}>
          {mode === 'reg' ? '注册并登录' : mode === 'reset' ? '重置口令' : '登录'}
        </Btn>

        <div className="auth-links">
          {mode === 'login' && needCode && (
            <button type="button" className="linkbtn" onClick={() => switchMode('reset')}>忘记口令？</button>
          )}
          {mode === 'reset' && (
            <button type="button" className="linkbtn" onClick={() => switchMode('login')}>返回登录</button>
          )}
        </div>

        <div className="hint" role="alert" style={{ color: msg ? 'var(--bad)' : undefined }}>{msg}</div>
        <div className="security">
          口令以 PBKDF2-HMAC-SHA256（20 万次迭代 + 随机盐）存储，服务端不保存明文；会话为 HttpOnly Cookie，有效期 30 天。
          {policy && policy.signup_credit > 0 && <>新用户注册赠送 <code>{f2(policy.signup_credit)}</code> 算力点{policy.recharge ? '。' : '；本部署关闭自助充值。'}</>}
          {inviteRequired && '本部署注册需要邀请码。'}
          {providers.length > 0 && sameOrigin && '第三方账号只用于证明「你是你」，平台账号仍是唯一身份，随时可在设置里解绑。'}
        </div>
      </div>
    </div>
  )
}
