import React, { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { relTime, f2 } from '../api/format'
import { JOB_ST } from '../api/constants'
import { useApp } from '../ctx'
import { Badge, Bar, Btn, Card, Empty, Icon, Page, PageHead, Segmented } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'

export const INFLIGHT = ['pending', 'queued', 'leased', 'fetching', 'running', 'uploading', 'merging']

type Filter = 'active' | 'done' | 'all'

export default function Jobs() {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const [filter, setFilter] = useState<Filter>('active')
  const [refreshing, setRefreshing] = useState(false)

  const list = useMemo(() => {
    const sorted = [...app.jobs].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    if (filter === 'active') return sorted.filter((j) => INFLIGHT.includes(j.status))
    if (filter === 'done') return sorted.filter((j) => !INFLIGHT.includes(j.status))
    return sorted
  }, [app.jobs, filter])

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await app.refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const counts = {
    active: app.jobs.filter((j) => INFLIGHT.includes(j.status)).length,
    done: app.jobs.filter((j) => !INFLIGHT.includes(j.status)).length,
    all: app.jobs.length,
  }

  return (
    <Page refreshing={refreshing} onRefresh={onRefresh} gap={10}>
      <PageHead eyebrow="My Jobs" title="我的任务" desc="分片派发、实时进度、哈希校验与结算明细；下拉刷新，4 秒自动轮询由总览负责。" />
      <Segmented
        items={[
          { key: 'active' as Filter, label: `进行中 ${counts.active}` },
          { key: 'done' as Filter, label: `已完成 ${counts.done}` },
          { key: 'all' as Filter, label: `全部 ${counts.all}` },
        ]}
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
      />

      {list.length === 0 ? (
        <Card>
          <Empty text={filter === 'active' ? '没有进行中的任务，去「创作」提交一个吧' : '这里还没有任务记录'} icon="jobs" />
          <Btn title="去提交任务" icon="plus" onPress={() => app.nav('create')} block />
        </Card>
      ) : (
        list.map((j) => {
          const segs = Array.isArray(j.segs) ? j.segs : []
          const done = segs.filter((x: any) => x.status === 'done').length
          const failed = segs.filter((x: any) => x.status === 'failed').length
          const pct = j.status === 'done' ? 100 : segs.length ? Math.round((done / segs.length) * 100) : 0
          const inflight = INFLIGHT.includes(j.status)
          return (
            <Pressable key={j.id} onPress={() => app.nav('job', { id: j.id })} style={({ pressed }) => [pressed && { opacity: 0.75 }]}>
              <Card style={{ gap: 10 }}>
                <View style={s.head}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.title} numberOfLines={1}>
                      {j.name || j.id}
                    </Text>
                    <Text style={s.sub}>
                      {j.kind === 'build' ? '编译打包' : j.kind === 'blender' ? 'Blender 渲染' : j.kind === 'pr' ? '时间线渲染' : '视频转码'} ·{' '}
                      {j.duration ? `${Math.round(j.duration)} 秒` : `${segs.length} 片`} · {relTime(j.created_at)}
                    </Text>
                  </View>
                  <Badge
                    text={JOB_ST[j.status] || j.status}
                    tone={j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : inflight ? 'warn' : 'neutral'}
                  />
                </View>

                <View style={{ gap: 5 }}>
                  <Bar pct={pct} color={j.status === 'failed' ? c.bad : j.status === 'done' ? c.ok : c.accent} />
                  <View style={s.progressRow}>
                    <Text style={s.pct}>
                      {done}/{segs.length || '—'} 片 · {pct}%
                    </Text>
                    {failed ? <Text style={[s.pct, { color: c.bad }]}>{failed} 片失败</Text> : null}
                    <Text style={s.pct}>预扣 {f2(j.credits_hold)}</Text>
                  </View>
                </View>

                {j.err ? (
                  <Text style={s.err} numberOfLines={2}>
                    {j.err}
                  </Text>
                ) : null}

                <View style={s.foot}>
                  <Text style={s.link}>查看详情</Text>
                  <Icon name="chevR" size={13} color={c.accent} />
                </View>
              </Card>
            </Pressable>
          )
        })
      )}
    </Page>
  )
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    title: { fontSize: 13.5, fontWeight: '600', color: c.ink },
    sub: { fontSize: 10.5, color: c.faint },
    progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    pct: { fontSize: 10, color: c.mute },
    err: { fontSize: 11, color: c.bad, lineHeight: 16 },
    foot: { flexDirection: 'row', alignItems: 'center', gap: 2, justifyContent: 'flex-end' },
    link: { fontSize: 11.5, color: c.accent, fontWeight: '500' },
  })
