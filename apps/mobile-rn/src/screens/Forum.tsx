import React, { useCallback, useEffect, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { relTime, ts } from '../api/format'
import { useApp } from '../ctx'
import { mem } from '../session'
import { Avatar, Badge, Btn, Card, Empty, Field, Icon, Page, PageHead, SearchBox, Sheet } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'

export default function Forum() {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const [posts, setPosts] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState<any>(null)
  const [comment, setComment] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [writeOpen, setWriteOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api.posts()
      setPosts(Array.isArray(d?.posts) ? d.posts : [])
    } catch {
      // 静默
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 12_000)
    return () => clearInterval(t)
  }, [load])

  const open = async (id: string) => {
    try {
      const d = await api.post(id)
      setDetail(d)
    } catch (e) {
      app.toast('打开帖子失败：' + errText(e), 'bad')
    }
  }

  const publish = async () => {
    if (!title.trim()) {
      app.toast('标题不能为空', 'warn')
      return
    }
    setPublishing(true)
    try {
      const fd = new FormData()
      fd.append('title', title.trim())
      fd.append('body', body.trim())
      await api.createPost(fd)
      setTitle('')
      setBody('')
      setWriteOpen(false)
      await load()
      app.toast('帖子已发布', 'ok')
    } catch (e) {
      app.toast('发布失败：' + errText(e), 'bad')
    } finally {
      setPublishing(false)
    }
  }

  const sendComment = async () => {
    if (!detail?.post) return
    if (!comment.trim()) {
      app.toast('写点内容再发送', 'warn')
      return
    }
    setSending(true)
    try {
      const fd = new FormData()
      fd.append('body', comment.trim())
      await api.commentPost(detail.post.id, fd)
      setComment('')
      await open(detail.post.id)
      load()
    } catch (e) {
      app.toast('评论失败：' + errText(e), 'bad')
    } finally {
      setSending(false)
    }
  }

  const filtered = q.trim()
    ? posts.filter((p) => [p.title, p.author, p.body].some((x) => String(x || '').toLowerCase().includes(q.trim().toLowerCase())))
    : posts

  if (detail?.post) {
    const media = Array.isArray(detail.media) ? detail.media : []
    const comments = Array.isArray(detail.comments) ? detail.comments : []
    return (
      <Page gap={10}>
        <Pressable onPress={() => setDetail(null)} style={({ pressed }) => [s.backRow, pressed && { opacity: 0.6 }]}>
          <Icon name="chevL" size={15} color={c.accent} />
          <Text style={s.backText}>返回帖子列表</Text>
        </Pressable>

        <Card>
          <Text style={s.detailTitle}>{detail.post.title}</Text>
          <View style={s.metaRow}>
            <Avatar name={detail.post.author} size={22} />
            <Text style={s.meta}>{detail.post.author}</Text>
            <Text style={s.meta}>· {ts(detail.post.created_at)}</Text>
            <Badge text={`${comments.length} 回复`} tone="neutral" />
          </View>
          {detail.post.body ? <Text style={s.postBody}>{detail.post.body}</Text> : null}
          {media.length ? (
            <View style={s.mediaWrap}>
              {media.map((m: any) => (
                <Image
                  key={m.id}
                  source={{ uri: api.mediaUrl(m.id), headers: mem.token ? { Authorization: 'Bearer ' + mem.token } : {} }}
                  style={s.media}
                  resizeMode="cover"
                />
              ))}
            </View>
          ) : null}
        </Card>

        <Card>
          <Text style={s.cardTitle}>回复</Text>
          {comments.length ? (
            comments.map((cm: any) => (
              <View key={cm.id} style={s.comment}>
                <Avatar name={cm.author} size={24} />
                <View style={{ flex: 1 }}>
                  <Text style={s.commentWho}>
                    {cm.author} · {relTime(cm.created_at)}
                  </Text>
                  <Text style={s.commentBody}>{cm.body}</Text>
                </View>
              </View>
            ))
          ) : (
            <Empty text="还没有回复，抢个沙发" icon="forum" />
          )}
          <View style={s.commentBox}>
            <Field label="回复（纯文本）" value={comment} onChangeText={setComment} multiline placeholder="聊聊工作流、调度策略或交付经验…" />
            <Btn title="发送回复" icon="send" onPress={sendComment} loading={sending} block />
          </View>
        </Card>
      </Page>
    )
  }

  return (
    <Page
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true)
        await load()
        setRefreshing(false)
      }}
      gap={10}
    >
      <PageHead
        eyebrow="Community"
        title="星栈论坛"
        desc="分享工作流、讨论调度策略、展示作品。图片与视频附件请在网页端发，手机端发文字帖与回复。"
        action={<Btn title="发帖" size="sm" icon="plus" onPress={() => setWriteOpen(true)} />}
      />

      <SearchBox value={q} onChange={setQ} placeholder="搜索标题、作者或正文…" />

      {filtered.length ? (
        filtered.map((p) => (
          <Pressable key={p.id} onPress={() => open(p.id)} style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
            <Card style={{ gap: 7 }}>
              <Text style={s.postTitle} numberOfLines={2}>
                {p.title}
              </Text>
              {p.body ? (
                <Text style={s.postExcerpt} numberOfLines={2}>
                  {p.body}
                </Text>
              ) : null}
              <View style={s.metaRow}>
                <Avatar name={p.author} size={20} />
                <Text style={s.meta}>{p.author}</Text>
                <Text style={s.meta}>· {relTime(p.created_at)}</Text>
                {p.comment_count ? <Badge text={`${p.comment_count} 回复`} tone="neutral" /> : null}
                {p.media_count ? <Badge text={`${p.media_count} 附件`} tone="info" /> : null}
              </View>
            </Card>
          </Pressable>
        ))
      ) : (
        <Card>
          <Empty text={posts.length ? '没有匹配的帖子' : '论坛还很安静，发第一帖吧'} icon="forum" />
          <Btn title="写第一帖" icon="plus" onPress={() => setWriteOpen(true)} block />
        </Card>
      )}

      <Sheet open={writeOpen} onClose={() => setWriteOpen(false)} title="发新帖">
        <Field label="标题" value={title} onChangeText={setTitle} placeholder="例如：Blender 分片渲染的踩坑记录" maxLength={80} />
        <Field label="正文" value={body} onChangeText={setBody} multiline placeholder="写下你的工作流、参数或问题…" maxLength={4000} />
        <Btn title="发布" icon="check" onPress={publish} loading={publishing} block />
        <Text style={s.hint}>手机端暂不支持附件；需要带图 / 视频请在网页端发布。</Text>
      </Sheet>
    </Page>
  )
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    postTitle: { fontSize: 13.5, fontWeight: '600', color: c.ink, lineHeight: 19 },
    postExcerpt: { fontSize: 11.5, color: c.mute, lineHeight: 17 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    meta: { fontSize: 10, color: c.faint },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    backText: { fontSize: 12, color: c.accent, fontWeight: '500' },
    detailTitle: { fontSize: 16, fontWeight: '700', color: c.ink, lineHeight: 23 },
    postBody: { fontSize: 12.5, color: c.body, lineHeight: 20 },
    mediaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    media: { width: 96, height: 96, borderRadius: 8, backgroundColor: c.soft },
    cardTitle: { fontSize: 14, fontWeight: '600', color: c.ink },
    comment: { flexDirection: 'row', gap: 9, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hair },
    commentWho: { fontSize: 10, color: c.faint },
    commentBody: { fontSize: 12.5, color: c.ink, lineHeight: 19, marginTop: 2 },
    commentBox: { gap: 8, marginTop: 6 },
    hint: { fontSize: 10.5, color: c.faint, lineHeight: 16 },
  })
