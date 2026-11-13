import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../store.jsx'
import { nav } from '../App.jsx'
import { Card, Btn, Tag, Empty, Avatar } from '../ui.jsx'
import { api, post, relTime, apiTS } from '../api.js'

export default function Messages() {
  const { toast } = useApp()
  const [convs, setConvs] = useState([])
  const [cid, setCid] = useState(null)
  const [offer, setOffer] = useState(null)
  const [peer, setPeer] = useState('')
  const [msgs, setMsgs] = useState([])
  const [body, setBody] = useState('')
  const [msg, setMsg] = useState('')
  const listRef = useRef(null)

  const loadConvs = useCallback(async () => { try { const d = await api('/api/offers/conversations'); setConvs(d.conversations || []) } catch (e) {} }, [])
  useEffect(() => { loadConvs(); const iv = setInterval(loadConvs, 5000); return () => clearInterval(iv) }, [loadConvs])
  const openConv = useCallback(async id => {
    setCid(id); setMsgs([])
    try {
      const d = await api('/api/offers/conversations/' + encodeURIComponent(id))
      setOffer(d.offer || null); setPeer((d.conversation && d.conversation.peer) || '对方'); setMsgs(d.messages || [])
    } catch (e) { toast(String(e), 'bad', '打开会话失败') }
  }, [toast])
  const refresh = useCallback(async () => {
    if (!cid) return
    try { const d = await api('/api/offers/conversations/' + encodeURIComponent(cid)); setMsgs(d.messages || []); if (d.conversation) setPeer(d.conversation.peer || '对方') } catch (e) {}
  }, [cid])
  useEffect(() => { if (!cid) return; const iv = setInterval(refresh, 3000); return () => clearInterval(iv) }, [cid, refresh])
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [msgs])
  const send = async () => {
    if (!cid) return
    const text = body.trim()
    if (!text) { setMsg('写点内容再发送'); return }
    setMsg('发送中…')
    try { await post('/api/offers/conversations/' + encodeURIComponent(cid), { body: text }); setBody(''); setMsg(''); await refresh(); loadConvs() }
    catch (e) { setMsg('发送失败：' + e) }
  }

  return (
    <div>
      <div className="phead">
        <div className="phead-txt"><span className="eyebrow">Messages</span><h1>买卖会话</h1><p>与卖家或买家沟通交付时间、模型、配置与售后；自动共享的服务无需沟通即可直接使用。</p></div>
        <div className="phead-actions"><Btn ghost onClick={() => { loadConvs(); refresh() }}>刷新</Btn></div>
      </div>
      <div className="msg-layout">
        <Card kicker="Threads" title="会话列表">
          <div className="conv-list">
            {convs.length ? convs.map(c => (
              <button key={c.id} className={'conv-item' + (c.id === cid ? ' on' : '')} onClick={() => openConv(c.id)}>
                <span className="conv-top"><b>{c.title || c.offer_id}</b><Tag>{c.peer}</Tag></span>
                <span className="conv-last">{c.last_body || '还没有消息'} · {relTime(c.updated_at)}</span>
              </button>
            )) : <Empty>还没有会话。去服务市场点开一条挂牌，选择「联系卖家」发起对话。</Empty>}
          </div>
        </Card>
        <Card className="chat-pane">
          {!cid ? (
            <Empty inline>选择左侧会话开始沟通<br />或在服务市场点开一条挂牌，选择「联系卖家」</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div className="chat-head">
                <b>{offer ? offer.title : '共享'} · 会话</b><Tag>{'与 ' + peer + ' 沟通'}</Tag>
                {offer && <Btn ghost tiny style={{ marginLeft: 'auto' }} onClick={() => nav('market')}>查看挂牌</Btn>}
              </div>
              <div className="chat-list" ref={listRef}>
                {msgs.length ? msgs.map((m, i) => (
                  <div key={i} className={'bubble' + (m.mine ? ' me' : '')}>
                    <span className="who-line">{m.sender} · {apiTS(m.created_at)}</span>{m.body}
                  </div>
                )) : <Empty inline>还没有消息，先打个招呼吧</Empty>}
              </div>
              <div className="composer">
                <textarea rows={2} maxLength={1000} value={body} onChange={e => setBody(e.target.value)} placeholder="问问交付时间、模型、配置或售后…"
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }} />
                <div className="composer-row"><Btn sm onClick={send}>发送</Btn><Btn ghost tiny onClick={refresh}>刷新</Btn><span className="hint" style={{ margin: 0 }}>{msg}</span></div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}