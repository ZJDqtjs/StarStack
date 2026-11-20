import React, { useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import { Btn, StarMark } from '../ui.jsx'
import { BROKER, f2, href, post } from '../api.js'

// 第三方按钮的图标：内联 SVG，不引外链字体或 CDN。不认识的 provider 用首字母兜底。
function OAuthIcon({ id }) {
  if (id === 'github') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 .8a11.2 11.2 0 0 0-3.5 21.8c.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.3 11.3 0 0 1 6 0C17 4.5 18 4.8 18 4.8c.6 1.6.2 2.8.1 3.1a4.5 4.5 0 0 1 1.2 3.1c0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5A11.2 11.2 0 0 0 12 .8Z" />
      </svg>
    )
  }
  if (id === 'google') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.2c0-.7 0-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.4 3-7.3Z" />
        <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.8V7.6H3.1a10 10 0 0 0 0 8.9L6.4 14Z" />
        <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.6L6.4 10C7.2 7.7 9.4 6 12 6Z" />
      </svg>
    )
  }
  if (id === 'gitee') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.6 6.2-4.2 1.1a1.6 1.6 0 0 0-1.1 1.1l-.5 1.8h4.7c.4 0 .7.4.7.8l-.7 4.2a1.6 1.6 0 0 1-1.6 1.4H7.5c-.4 0-.7-.4-.6-.8l1.3-8.7A2.6 2.6 0 0 1 10.8 6l4.1-.1c.7 0 1.1.8.7 1.3Z" />
      </svg>
    )
  }
  return <span className="oauth-initial">{String(id).slice(0, 1).toUpperCase()}</span>
}

// 登录页的三种模式：登录 / 注册 / 找回口令。第三方登录是独立入口，不占标签页。
export default function Auth() {
  const { policy, login } = useApp()
  const [mode, setMode] = useState('login')
  // 邮箱就是账号：注册不再有自定义用户名，显示名由邮箱前缀自动生成。
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
    if (!email.trim() || !pass) { setMsg('请填写邮箱和口令'); return }
    if (mode === 'reg') {
      if (pass !== pass2) { setMsg('两次口令不一致'); return }
      if (needCode && !code.trim()) { setMsg('请填写邮箱验证码'); return }
    }
    setBusy(true); setMsg('正在计算口令哈希…')
    try {
      const payload = mode === 'reg'
        ? { email: email.trim(), password: pass, code: code.trim(), invite: invite.trim() }
        : { email: email.trim(), password: pass }
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
            : mode === 'reg'
              ? '用邮箱注册：邮箱就是登录账号，不再需要自定义用户名。'
              : '一个账户，既能提交任务，也能把闲置机器接入算力池。'}</p>
        </div>

        {mode !== 'reset' && (
          <div className="tabs" role="tablist">
            <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => switchMode('login')}>登录</button>
            <button type="button" className={mode === 'reg' ? 'on' : ''} onClick={() => switchMode('reg')}>注册</button>
          </div>
        )}

        {sameOrigin && providers.length > 0 && mode !== 'reset' && (
          <>
            <div className="oauth-row">
              {providers.map(p => (
                <button key={p.id} type="button" className="oauth-btn" disabled={busy} onClick={() => go(p.id)}>
                  <OAuthIcon id={p.id} />
                  <span>使用 {p.label} 登录</span>
                </button>
              ))}
            </div>
            <div className="hint" style={{ margin: '8px 0 0' }}>
              {policy && policy.oauth_signup
                ? '首次用第三方账号授权会自动创建星栈账号（邮箱取该账号的已验证邮箱），无需另外注册。'
                : '第三方登录仅用于已有账号；第一次来请先用邮箱注册，再到「设置 → 登录方式」绑定。'}
            </div>
            <div className="oauth-sep"><span>或使用账号口令</span></div>
          </>
        )}

        <label>邮箱{mode === 'reg' ? '（登录账号）' : ''}</label>
        <input value={email} onChange={e => setEmail(e.target.value)} autoComplete="email"
          inputMode="email" placeholder="you@example.com"
          onKeyDown={e => { if (e.key === 'Enter') submit() }} />

        {mode === 'reg' && needCode && email.trim() && (
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
          {'邮箱即账号，登录名不支持自定义；显示名由邮箱前缀自动生成。'}
          {providers.length > 0 && sameOrigin && '第三方登录会自动带上该账号已验证的邮箱并绑定到你名下，平台账号仍是唯一身份，随时可在设置里解绑。'}
          {mode === 'login' && '改造前用用户名注册的老账号，仍可用原用户名登录一次，登录后在「设置 → 登录方式」里绑定邮箱即可。'}
        </div>
      </div>
    </div>
  )
}
