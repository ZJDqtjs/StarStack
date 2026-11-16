import React, { useCallback, useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { usePlatform } from '../platform'
import { f1, f2, points, relTime, ts } from '../api/format'
import { JOB_ST } from '../api/constants'
import { useApp } from '../ctx'
import { mem } from '../session'
import { Badge, Bar, Btn, Card, Empty, Icon, KV, Page } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'
import { INFLIGHT } from './Jobs'

export default function JobDetail({ id }: { id: string }) {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const platform = usePlatform()
  const [logs, setLogs] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const job = app.jobs.find((j) => j.id === id)
  const segs = Array.isArray(job?.segs) ? job.segs : []
  const done = segs.filter((x: any) => x.status === 'done').length
  const failed = segs.filter((x: any) => x.status === 'failed').length
  const pct = job?.status === 'done' ? 100 : segs.length ? Math.round((done / segs.length) * 100) : 0
  const inflight = job ? INFLIGHT.includes(job.status) : false

  const loadLogs = useCallback(async () => {
    try {
      const d = await api.jobLogs(id)
      setLogs(Array.isArray(d?.logs) ? d.logs : [])
    } catch {
      // 无权或网络失败时留空，不打断主信息
    }
  }, [id])

  useEffect(() => {
    loadLogs()
    const t = setInterval(loadLogs, 6000)
    return () => clearInterval(t)
  }, [loadLogs])

  const reload = async () => {
    setRefreshing(true)
    try {
      await Promise.all([app.refresh(), loadLogs()])
    } finally {
      setRefreshing(false)
    }
  }

  const download = async () => {
    if (!job) return
    setBusy(true)
    try {
      await platform.downloadArtifact(
        api.downloadUrl(job.id),
        `starstack-${job.id}.mp4`,
        mem.token ? { Authorization: 'Bearer ' + mem.token } : {},
      )
    } catch (e) {
      Alert.alert('下载失败', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    if (!job) return
    Alert.alert('取消任务', `确定取消 ${job.name || job.id}？已结算的分片不会退回。`, [
      { text: '再想想', style: 'cancel' },
      {
        text: '取消任务',
        style: 'destructive',
        onPress: async () => {
          setBusy(true)
          try {
            await api.cancelJob(job.id)
            await app.refresh()
            app.toast('任务已取消，预扣已退还', 'ok')
          } catch (e) {
            Alert.alert('取消失败', e instanceof Error ? e.message : String(e))
          } finally {
            setBusy(false)
          }
        },
      },
    ])
  }

  if (!job) {
    return (
      <Page refreshing={refreshing} onRefresh={reload}>
        <Card>
          <Empty text="找不到这个任务，可能已被清理。回到任务列表刷新试试。" icon="jobs" />
          <Btn title="返回任务列表" kind="ghost" icon="chevL" onPress={() => app.nav('jobs')} block />
        </Card>
      </Page>
    )
  }

  return (
    <Page refreshing={refreshing} onRefresh={reload} gap={10}>
      <Card>
        <View style={s.head}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.title}>{job.name || job.id}</Text>
            <Text style={s.sub}>
              {job.kind === 'build' ? '编译打包' : job.kind === 'blender' ? 'Blender 渲染' : job.kind === 'pr' ? '时间线渲染' : '视频转码'} ·{' '}
              {job.duration ? `${Math.round(job.duration)} 秒` : `${segs.length} 片`}
            </Text>
          </View>
          <Badge
            text={JOB_ST[job.status] || job.status}
            tone={job.status === 'done' ? 'ok' : job.status === 'failed' ? 'bad' : inflight ? 'warn' : 'neutral'}
          />
        </View>
        <View style={{ gap: 6 }}>
          <Bar pct={pct} color={job.status === 'failed' ? c.bad : job.status === 'done' ? c.ok : c.accent} />
          <View style={s.progressRow}>
            <Text style={s.pct}>
              {done}/{segs.length || '—'} 片完成{failed ? ` · ${failed} 片失败` : ''}
            </Text>
            <Text style={s.pct}>{pct}%</Text>
          </View>
        </View>
        <KV k="任务 ID" v={job.id} />
        <KV k="预扣" v={points(job.credits_hold)} />
        <KV k="已结算" v={points(job.credits_spent)} />
        <KV k="创建时间" v={ts(job.created_at)} />
        {job.err ? <Text style={s.err}>{job.err}</Text> : null}
        <View style={s.row}>
          {job.status === 'done' ? <Btn title="下载产物" icon="download" onPress={download} loading={busy} style={{ flex: 1 }} /> : null}
          {inflight ? <Btn title="取消任务" icon="x" kind="danger" onPress={cancel} loading={busy} style={{ flex: 1 }} /> : null}
          <Btn title="刷新" icon="refresh" kind="ghost" onPress={() => void reload()} style={{ flex: 1 }} />
        </View>
      </Card>

      <Card>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>分片</Text>
          <Text style={s.meta}>
            {done} 完成 · {failed} 失败 · {segs.length} 总片
          </Text>
        </View>
        {segs.length ? (
          segs.map((seg: any, i: number) => (
            <View key={String(seg.id || i)} style={s.segRow}>
              <View style={s.segIndex}>
                <Text style={s.segIndexText}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.segId} numberOfLines={1}>
                  {seg.id || '未派发'}
                </Text>
                <Text style={s.segMeta}>
                  {seg.worker ? `节点 ${String(seg.worker).slice(0, 8)}` : '等待调度'}
                  {seg.bytes ? ` · ${f1(seg.bytes / 1048576)} MB` : ''}
                  {seg.err ? ` · ${seg.err}` : ''}
                </Text>
              </View>
              <Badge
                text={seg.status === 'done' ? '完成' : seg.status === 'failed' ? '失败' : seg.status === 'running' ? '进行' : '待办'}
                tone={seg.status === 'done' ? 'ok' : seg.status === 'failed' ? 'bad' : seg.status === 'running' ? 'warn' : 'neutral'}
              />
            </View>
          ))
        ) : (
          <Empty text="还没有分片记录，任务可能仍在排队" icon="clock" />
        )}
      </Card>

      <Card>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>通讯记录</Text>
          <Text style={s.meta}>买卖双方与节点的关键事件</Text>
        </View>
        {logs.length ? (
          logs.slice(-20).map((l, i) => (
            <View key={String(l.id ?? i)} style={s.logRow}>
              <View style={[s.logDot, { backgroundColor: l.actor === 'buyer' ? c.accent : l.actor === 'seller' ? c.ok : c.faint }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.logEvent}>{l.event}</Text>
                {l.detail ? <Text style={s.logDetail}>{l.detail}</Text> : null}
              </View>
              <Text style={s.logTime}>{relTime(l.ts)}</Text>
            </View>
          ))
        ) : (
          <Empty text="暂无通讯记录" icon="messages" />
        )}
      </Card>

      <Card>
        <View style={s.tipRow}>
          <Icon name="check" size={13} color={c.ok} />
          <Text style={s.tip}>只有「节点自报哈希 == broker 重算哈希」的分片才结算；失败与未派发的预扣会自动退还。</Text>
        </View>
      </Card>
    </Page>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    title: { fontSize: 15, fontWeight: '700', color: c.ink },
    sub: { fontSize: 10.5, color: c.faint },
    progressRow: { flexDirection: 'row', justifyContent: 'space-between' },
    pct: { fontSize: 10.5, color: c.mute },
    err: { fontSize: 11.5, color: c.bad, lineHeight: 17 },
    row: { flexDirection: 'row', gap: 8 },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    cardTitle: { fontSize: 14, fontWeight: '600', color: c.ink },
    meta: { fontSize: 10, color: c.faint },
    segRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hair },
    segIndex: { width: 20, height: 20, borderRadius: 6, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' },
    segIndexText: { fontSize: 10, color: c.mute, fontWeight: '600' },
    segId: { fontSize: 11.5, color: c.ink, fontWeight: '500' },
    segMeta: { fontSize: 10, color: c.faint, marginTop: 1 },
    logRow: { flexDirection: 'row', gap: 8, paddingVertical: 6, alignItems: 'flex-start' },
    logDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
    logEvent: { fontSize: 11.5, color: c.ink, fontWeight: '500' },
    logDetail: { fontSize: 10, color: c.faint, marginTop: 1, lineHeight: 14 },
    logTime: { fontSize: 9.5, color: c.faint },
    tipRow: { flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
    tip: { flex: 1, fontSize: 10.5, color: c.mute, lineHeight: 16 },
  })
