import React, { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { api } from '../api'
import { f1, points } from '../api/format'
import { Btn, Card, Field, KV, SectionTitle } from '../ui'
import { C, R } from '../theme'

// 手机端的买方主链是「保底」：传小样、看进度、下载、看账单。
// 高级参数（编码器、分片数、服务端路径、GPU 约束）留给桌面端，这里只留最必要的三项。
const HEIGHTS: { key: string; label: string }[] = [
  { key: '720', label: '720p' },
  { key: '1080', label: '1080p' },
  { key: '0', label: '原样' },
]

type Picked = { uri: string; name: string; size?: number; mimeType?: string }

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function Submit() {
  const [file, setFile] = useState<Picked | null>(null)
  const [duration, setDuration] = useState('')
  const [height, setHeight] = useState('720')
  const [q, setQ] = useState('26')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const pick = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: true })
      if (res.canceled || !res.assets?.length) return
      const a = res.assets[0]
      setFile({ uri: a.uri, name: a.name, size: a.size ?? undefined, mimeType: a.mimeType ?? undefined })
      setMsg('')
    } catch (e) {
      Alert.alert('选取失败', errText(e))
    }
  }

  const estimate = async () => {
    const d = Number(duration)
    if (!(d > 0)) {
      Alert.alert('先填时长', '手机端读不出视频时长，请手动填秒数（例如 60）。预扣按这个值算。')
      return
    }
    setBusy(true)
    try {
      const r = await api.estimate({ duration: d, kind: 'transcode', vcodec: 'libx264', req: {} })
      setMsg(`预估预扣 ${points(r?.hold)}（按最贵可行节点保守预扣，结束退还差额）`)
    } catch (e) {
      setMsg('估算失败：' + errText(e))
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!file) {
      Alert.alert('还没选文件', '先选一个视频小样。大文件建议用桌面端或网页端，手机端没有分片续传。')
      return
    }
    const d = Number(duration)
    if (!(d > 0)) {
      Alert.alert('先填时长', '请手动填视频秒数，后端要用它切分片与估算。')
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.append('req', JSON.stringify({}))
      form.append('segs', '4')
      form.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || 'video/mp4',
      } as unknown as Blob)
      form.append('vcodec', 'libx264')
      form.append('preset', 'fast')
      form.append('q', q)
      form.append('height', height)
      form.append('audio', '1')
      form.append('baseline', '0')
      const r = await api.submitTranscode(form)
      setMsg(`已入队 ${r?.id}，预扣 ${points(r?.hold)} 点。到「任务」页看进度。`)
      setFile(null)
      setDuration('')
    } catch (e) {
      Alert.alert('提交失败', errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <SectionTitle eyebrow="SUBMIT" title="提交转码" />

      <Card>
        <Text style={s.label}>1. 选一个视频</Text>
        <Btn title={file ? '重新选择' : '选择视频文件'} kind="ghost" onPress={pick} />
        {file ? (
          <>
            <KV k="文件" v={file.name} />
            {file.size ? <KV k="大小" v={f1(file.size / 1048576) + ' MB'} /> : null}
          </>
        ) : (
          <Text style={s.hint}>手机端没有分片续传，2 GB 以上的源片会失败，大文件请用桌面端。</Text>
        )}
      </Card>

      <Card>
        <Text style={s.label}>2. 视频时长（秒）</Text>
        <Field
          label="时长"
          value={duration}
          onChangeText={setDuration}
          keyboardType="decimal-pad"
          placeholder="例如 60"
          hint="手机端读不出真实时长，这个值决定预扣与切分片，填错会算错钱。"
        />
        <Text style={s.label}>3. 输出画质</Text>
        <View style={s.chips}>
          {HEIGHTS.map(h => (
            <Pressable
              key={h.key}
              onPress={() => setHeight(h.key)}
              style={[s.chip, height === h.key && s.chipOn]}
            >
              <Text style={[s.chipText, height === h.key && s.chipTextOn]}>{h.label}</Text>
            </Pressable>
          ))}
        </View>
        <Field
          label="质量（CRF，越小越清晰）"
          value={q}
          onChangeText={setQ}
          keyboardType="number-pad"
          placeholder="26"
          hint="默认 26；24 更清晰但更慢，28 更省。"
        />
      </Card>

      <Card>
        <View style={s.row}>
          <Btn title="估算预扣" kind="ghost" onPress={estimate} loading={busy} style={{ flex: 1 }} />
          <Btn title="提交任务" onPress={submit} loading={busy} style={{ flex: 1 }} />
        </View>
        {msg ? <Text style={s.msg}>{msg}</Text> : null}
        <Text style={s.hint}>
          提交后可在「任务」页看分片进度、取消、下载产物。结算按实际视频秒，失败与校验不过的分片不结算。
        </Text>
      </Card>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: '600', color: C.text },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.lineStrong,
    backgroundColor: C.surface,
  },
  chipOn: { backgroundColor: C.soft, borderColor: C.softBorder },
  chipText: { fontSize: 13, color: C.muted },
  chipTextOn: { color: C.primary, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
  msg: { fontSize: 12, color: C.primary, lineHeight: 18 },
  hint: { fontSize: 11, color: C.dim, lineHeight: 16 },
})
