import React, { useCallback, useEffect, useState } from 'react'
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { api } from '../api'
import { mem } from '../session'
import { points, ts } from '../api/format'
import { JOB_ST } from '../api/constants'
import { Badge, Btn, Card, KV, SectionTitle } from '../ui'
import { C, R } from '../theme'

const INFLIGHT = new Set(['pending', 'queued', 'leased', 'fetching', 'running', 'uploading'])

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function Jobs() {
  const [list, setList] = useState<any[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await api.jobs()
      setList(Array.isArray(d?.jobs) ? d.jobs : [])
    } catch {
      // 轮询失败保持上一次结果，避免列表闪成空
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 4000)
    return () => clearInterval(timer)
  }, [load])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const cancel = (j: any) => {
    Alert.alert('取消任务', `确定取消 ${j.name || j.id}？已结算的分片不会退回。`, [
      { text: '再想想', style: 'cancel' },
      {
        text: '取消任务',
        style: 'destructive',
        onPress: async () => {
          setBusyId(j.id)
          try {
            await api.cancelJob(j.id)
            await load()
          } catch (e) {
            Alert.alert('取消失败', errText(e))
          } finally {
            setBusyId('')
          }
        },
      },
    ])
  }

  // 手机没有「另存为」，直接用系统分享面板把文件交给保存/其它 App。
  // 关键点：下载要带 Bearer，所以不能交给浏览器式跳转，必须走带 headers 的请求。
  const download = async (j: any) => {
    setBusyId(j.id)
    try {
      const url = api.downloadUrl(j.id)
      const target = `${FileSystem.cacheDirectory}starstack-${j.id}.mp4`
      const res = await FileSystem.downloadAsync(url, target, {
        headers: mem.token ? { Authorization: `Bearer ${mem.token}` } : {},
      })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(res.uri, { mimeType: 'video/mp4', dialogTitle: '保存产物' })
      } else {
        Alert.alert('已下载到缓存', res.uri)
      }
    } catch (e) {
      Alert.alert('下载失败', errText(e))
    } finally {
      setBusyId('')
    }
  }

  return (
    <ScrollView
      contentContainerStyle={s.wrap}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      <SectionTitle eyebrow="MY JOBS" title="我的任务" />

      {list.length === 0 ? (
        <Card>
          <Text style={s.empty}>还没有任务。到「提交」页传一个小样，或者用网页端提交大文件。</Text>
        </Card>
      ) : (
        list.map(j => {
          const segs = Array.isArray(j.segs) ? j.segs : []
          const done = segs.filter((x: any) => x.status === 'done').length
          const pct = j.status === 'done' ? 100 : segs.length ? Math.round((done / segs.length) * 100) : 0
          const inflight = INFLIGHT.has(j.status)
          return (
            <Card key={j.id}>
              <View style={s.head}>
                <View style={{ flex: 1 }}>
                  <Text style={s.title} numberOfLines={1}>
                    {j.name || j.id}
                  </Text>
                  <Text style={s.sub}>
                    {j.kind === 'build' ? '编译打包' : j.kind === 'blender' ? 'Blender 渲染' : '视频转码'} ·{' '}
                    {j.duration ? `${Math.round(j.duration)} 秒` : `${segs.length} 片`}
                  </Text>
                </View>
                <Badge
                  text={JOB_ST[j.status] || j.status}
                  tone={j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : inflight ? 'warn' : 'neutral'}
                />
              </View>

              <View style={s.track}>
                <View style={[s.fill, { width: `${Math.max(2, Math.min(100, pct))}%` }]} />
              </View>
              <Text style={s.pct}>
                {done}/{segs.length || '—'} 片 · {pct}%
              </Text>

              <KV k="预扣" v={points(j.credits_hold)} />
              <KV k="已结算" v={points(j.credits_spent)} />
              {j.err ? <Text style={s.err}>{j.err}</Text> : null}

              <View style={s.actions}>
                {j.status === 'done' ? (
                  <Btn title="下载产物" onPress={() => download(j)} loading={busyId === j.id} />
                ) : null}
                {inflight ? (
                  <Btn title="取消任务" kind="danger" onPress={() => cancel(j)} loading={busyId === j.id} />
                ) : null}
              </View>
              <Text style={s.hint}>创建于 {ts(j.created_at)}</Text>
            </Card>
          )
        })
      )}
    </ScrollView>
  )
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 15, fontWeight: '600', color: C.text },
  sub: { fontSize: 12, color: C.muted, marginTop: 3 },
  track: { height: 6, backgroundColor: C.line, borderRadius: R.sm, overflow: 'hidden', marginTop: 4 },
  fill: { height: 6, backgroundColor: C.primary, borderRadius: R.sm },
  pct: { fontSize: 11, color: C.dim },
  err: { fontSize: 12, color: C.danger, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  hint: { fontSize: 11, color: C.dim },
  empty: { fontSize: 13, color: C.muted, lineHeight: 20 },
})
