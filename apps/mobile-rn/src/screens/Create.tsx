import React, { useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { api } from '../api'
import { f1, points } from '../api/format'
import { useApp, type RouteParams } from '../ctx'
import { Badge, Btn, Card, Chip, Field, Icon, Page, PageHead, Segmented } from '../ui'
import { useStyles, useTheme, type Palette } from '../theme'

type Kind = 'transcode' | 'blender' | 'build'
type Picked = { uri: string; name: string; size?: number; mimeType?: string }

const KIND_TIPS: Record<Kind, { drop: string; hint: string }> = {
  transcode: { drop: '选择一个视频小样（手机端无分片续传，2 GB 以上会失败）', hint: '大文件请用网页端「渲染 / 转码」，手机适合 1080p 短片与验收。' },
  blender: { drop: '选择 .blend 场景，或含贴图 / 缓存的 zip', hint: '帧范围决定计价单位：按帧数预扣，未渲染的帧会退还。' },
  build: { drop: '选择源码 zip（解压目录即工作目录）', hint: '编译会在节点容器里跑你写的命令，产物按 output 路径回传。' },
}

const QUALITY = [
  { label: '高（慢）', q: '20' },
  { label: '均衡', q: '26' },
  { label: '省（快）', q: '28' },
]

const ENGINES = [
  { key: 'CYCLES', label: 'Cycles' },
  { key: 'BLENDER_EEVEE', label: 'EEVEE' },
]

export default function Create({ params }: { params?: RouteParams }) {
  const app = useApp()
  const s = useStyles(makeStyles)
  const { c } = useTheme()
  const [kind, setKind] = useState<Kind>(params?.kind || 'transcode')
  const [file, setFile] = useState<Picked | null>(null)
  const [duration, setDuration] = useState('')
  const [height, setHeight] = useState('720')
  const [q, setQ] = useState('26')
  const [segs, setSegs] = useState('4')
  const [engine, setEngine] = useState('CYCLES')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('120')
  const [samples, setSamples] = useState('64')
  const [command, setCommand] = useState('')
  const [output, setOutput] = useState('')
  const [timeout, setTimeoutSec] = useState('1800')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [shared, setShared] = useState('')

  // 市场「立即使用」会把卖家的场景模板带过来：编译填命令、渲染填帧范围与采样。
  useEffect(() => {
    const pre = app.prefill
    if (!pre) return
    if (pre.kind) setKind(pre.kind)
    const tpl = pre.tpl || {}
    if (pre.kind === 'build') {
      const cmd = tpl.command || tpl.scene || ''
      if (cmd) setCommand(String(cmd))
      if (tpl.output) setOutput(String(tpl.output))
      if (tpl.timeout) setTimeoutSec(String(tpl.timeout))
    } else if (pre.kind === 'blender') {
      if (tpl.from) setFrom(String(tpl.from))
      if (tpl.to) setTo(String(tpl.to))
      if (tpl.samples) setSamples(String(tpl.samples))
      if (tpl.engine) setEngine(String(tpl.engine).toUpperCase())
    }
    setShared(tpl.scene || tpl.command || '卖家共享的场景参数已预填')
    app.setPrefill(null)
  }, [app])

  const pick = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: kind === 'transcode' ? 'video/*' : ['application/zip', 'application/octet-stream', 'application/x-zip-compressed', '*/*'],
        copyToCacheDirectory: true,
      })
      if (res.canceled || !res.assets?.length) return
      const a = res.assets[0]
      setFile({ uri: a.uri, name: a.name, size: a.size ?? undefined, mimeType: a.mimeType ?? undefined })
      setMsg('')
    } catch (e) {
      Alert.alert('选取失败', errText(e))
    }
  }

  const estimate = async () => {
    if (kind === 'build') {
      setMsg('编译任务按节点实际占用时长结算，提交后以账本为准，这里不做预扣估算。')
      return
    }
    const units = kind === 'blender' ? Number(to) - Number(from) + 1 : Number(duration)
    if (!(units > 0)) {
      Alert.alert('参数不全', kind === 'blender' ? '先填起止帧，按帧数估算。' : '手机端读不出视频时长，请手动填秒数。')
      return
    }
    setBusy(true)
    try {
      const r = await api.estimate({ duration: units, kind, vcodec: 'libx264', req: {} })
      setMsg(`预估预扣 ${points(r?.hold)}（按最贵可行节点保守预扣，结束退还差额）`)
    } catch (e) {
      setMsg('估算失败：' + errText(e))
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!file) {
      Alert.alert('还没选文件', KIND_TIPS[kind].drop)
      return
    }
    if (kind === 'transcode' && !(Number(duration) > 0)) {
      Alert.alert('先填时长', '后端要用秒数切分片与预扣。')
      return
    }
    if (kind === 'build' && !command.trim()) {
      Alert.alert('先写编译命令', '例如 npm install && npm run build。')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const fd = new FormData()
      fd.append('req', JSON.stringify({}))
      fd.append('segs', segs || '4')
      fd.append('file', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' } as unknown as Blob)
      let r: any
      if (kind === 'transcode') {
        fd.append('duration', duration)
        fd.append('vcodec', 'libx264')
        fd.append('preset', 'fast')
        fd.append('q', q)
        fd.append('height', height)
        fd.append('audio', '1')
        fd.append('baseline', '0')
        r = await api.submitTranscode(fd)
      } else if (kind === 'blender') {
        fd.append('kind', 'blender')
        fd.append('scene', file.name)
        fd.append('engine', engine)
        fd.append('samples', samples)
        fd.append('from', from)
        fd.append('to', to)
        fd.append('fps', '24')
        fd.append('percent', '0')
        r = await api.submitRender(fd)
      } else {
        fd.append('command', command.trim())
        if (output.trim()) fd.append('output', output.trim())
        fd.append('timeout', timeout || '1800')
        r = await api.submitBuild(fd)
      }
      setMsg(`已入队 ${r?.id || ''}，预扣 ${points(r?.hold)} 点。`)
      app.toast('任务已提交，去「任务」看进度', 'ok')
      setFile(null)
      setDuration('')
      app.refresh().catch(() => {})
    } catch (e) {
      Alert.alert('提交失败', errText(e))
    } finally {
      setBusy(false)
    }
  }

  const segPct = kind === 'transcode' ? '转码' : kind === 'blender' ? '渲染' : '编译'

  return (
    <Page>
      <PageHead eyebrow="Create" title="创作工作台" desc="手机端保留最必要的参数：选文件、定价单位、提交，进度与结算在任务页看。" />

      <Segmented
        items={[
          { key: 'transcode' as Kind, label: '视频转码' },
          { key: 'blender' as Kind, label: 'Blender 渲染' },
          { key: 'build' as Kind, label: '编译打包' },
        ]}
        value={kind}
        onChange={(k) => {
          setKind(k)
          setFile(null)
          setMsg('')
          setShared('')
        }}
      />

      {shared ? (
        <View style={s.shared}>
          <Icon name="check" size={13} color={c.ok} />
          <Text style={s.sharedText} numberOfLines={2}>
            {shared}
          </Text>
        </View>
      ) : null}

      <Card>
        <View style={s.stepRow}>
          <Text style={s.stepNo}>01</Text>
          <Text style={s.stepTitle}>{KIND_TIPS[kind].drop}</Text>
        </View>
        <Pressable onPress={pick} style={({ pressed }) => [s.drop, pressed && { opacity: 0.75 }]}>
          <View style={s.dropIcon}>
            <Icon name={file ? 'file' : 'upload'} size={18} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.dropTitle} numberOfLines={1}>
              {file ? file.name : '点击选择文件'}
            </Text>
            <Text style={s.dropSub}>
              {file ? `${file.size ? f1(file.size / 1048576) + ' MB · ' : ''}点击可重新选择` : '手机文件管理器 / 相册里的视频'}
            </Text>
          </View>
          {file ? <Badge text="已选择" tone="ok" /> : <Icon name="chevR" size={14} color={c.faint} />}
        </Pressable>
        <Text style={s.hint}>{KIND_TIPS[kind].hint}</Text>
      </Card>

      {kind === 'transcode' ? (
        <Card>
          <View style={s.stepRow}>
            <Text style={s.stepNo}>02</Text>
            <Text style={s.stepTitle}>画质与时长</Text>
          </View>
          <Field
            label="视频时长（秒）"
            value={duration}
            onChangeText={setDuration}
            keyboardType="decimal-pad"
            placeholder="例如 60"
            hint="手机读不出真实时长，这个值决定预扣与切分片。"
          />
          <View style={s.fieldBlock}>
            <Text style={s.label}>输出高度</Text>
            <View style={s.chips}>
              {[
                { key: '720', label: '720p' },
                { key: '1080', label: '1080p' },
                { key: '0', label: '原样' },
              ].map((h) => (
                <Chip key={h.key} label={h.label} on={height === h.key} onPress={() => setHeight(h.key)} />
              ))}
            </View>
          </View>
          <View style={s.fieldBlock}>
            <Text style={s.label}>质量（CRF，越小越清晰）</Text>
            <View style={s.chips}>
              {QUALITY.map((it) => (
                <Chip key={it.q} label={`${it.label} · ${it.q}`} on={q === it.q} onPress={() => setQ(it.q)} />
              ))}
            </View>
          </View>
          <Field label="分片数" value={segs} onChangeText={setSegs} keyboardType="number-pad" hint="分片越多并行越快，默认 4。" />
        </Card>
      ) : null}

      {kind === 'blender' ? (
        <Card>
          <View style={s.stepRow}>
            <Text style={s.stepNo}>02</Text>
            <Text style={s.stepTitle}>帧范围与渲染器</Text>
          </View>
          <View style={s.two}>
            <View style={{ flex: 1 }}>
              <Field label="起始帧" value={from} onChangeText={setFrom} keyboardType="number-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="结束帧" value={to} onChangeText={setTo} keyboardType="number-pad" />
            </View>
          </View>
          <View style={s.two}>
            <View style={{ flex: 1 }}>
              <Field label="采样数" value={samples} onChangeText={setSamples} keyboardType="number-pad" hint="0 = 用场景设置" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="并发分片" value={segs} onChangeText={setSegs} keyboardType="number-pad" />
            </View>
          </View>
          <View style={s.fieldBlock}>
            <Text style={s.label}>渲染器</Text>
            <View style={s.chips}>
              {ENGINES.map((e) => (
                <Chip key={e.key} label={e.label} on={engine === e.key} onPress={() => setEngine(e.key)} />
              ))}
            </View>
          </View>
        </Card>
      ) : null}

      {kind === 'build' ? (
        <Card>
          <View style={s.stepRow}>
            <Text style={s.stepNo}>02</Text>
            <Text style={s.stepTitle}>编译命令</Text>
          </View>
          <View style={s.chips}>
            {['npm install && npm run build', 'go build -o out/app ./...', 'cmake -B build && cmake --build build'].map((cmd) => (
              <Chip key={cmd} label={cmd.split(' ')[0]} on={command === cmd} onPress={() => setCommand(cmd)} />
            ))}
          </View>
          <Field label="命令" value={command} onChangeText={setCommand} multiline placeholder="例如 npm install && npm run build" />
          <View style={s.two}>
            <View style={{ flex: 1 }}>
              <Field label="产物路径（可选）" value={output} onChangeText={setOutput} placeholder="dist / out/app" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="超时（秒）" value={timeout} onChangeText={setTimeoutSec} keyboardType="number-pad" />
            </View>
          </View>
        </Card>
      ) : null}

      <Card>
        <View style={s.summary}>
          <View>
            <Text style={s.summaryK}>任务类型</Text>
            <Text style={s.summaryV}>{segPct}</Text>
          </View>
          <View>
            <Text style={s.summaryK}>文件</Text>
            <Text style={s.summaryV} numberOfLines={1}>
              {file ? file.name : '未选择'}
            </Text>
          </View>
        </View>
        <View style={s.row}>
          <Btn title="估算预扣" kind="ghost" icon="trend" onPress={estimate} loading={busy} style={{ flex: 1 }} />
          <Btn title="提交任务" icon="upload" onPress={submit} loading={busy} style={{ flex: 1 }} />
        </View>
        {msg ? <Text style={s.msg}>{msg}</Text> : null}
        <Text style={s.hint}>结算按实际用量，失败与哈希校验不通过的分片不结算；提交后在「任务」页看分片进度与产物。</Text>
      </Card>

      <Card>
        <Text style={s.cardTitle}>还不能在手机端做？</Text>
        <Text style={s.hint}>
          生图 / 生视频需要在网页端打开 ComfyUI 工作台；这台手机如果你也想贡献算力，去「我的节点」或总览里一键启动常驻节点。
        </Text>
        <View style={s.row}>
          <Btn title="算力池" kind="ghost" icon="pool" onPress={() => app.nav('pool')} style={{ flex: 1 }} />
          <Btn title="我的节点" kind="ghost" icon="nodes" onPress={() => app.nav('nodes')} style={{ flex: 1 }} />
        </View>
      </Card>
    </Page>
  )
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepNo: { fontSize: 10, fontWeight: '700', color: c.accent, letterSpacing: 0.8 },
    stepTitle: { flex: 1, fontSize: 13.5, fontWeight: '600', color: c.ink },
    drop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      borderWidth: 1,
      borderColor: c.hair2,
      borderStyle: 'dashed',
      borderRadius: 10,
      padding: 12,
    },
    dropIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
    dropTitle: { fontSize: 13, fontWeight: '600', color: c.ink },
    dropSub: { fontSize: 10.5, color: c.faint, marginTop: 2 },
    hint: { fontSize: 11, color: c.faint, lineHeight: 17 },
    fieldBlock: { gap: 6 },
    label: { fontSize: 11.5, color: c.mute, fontWeight: '500' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    two: { flexDirection: 'row', gap: 10 },
    summary: { flexDirection: 'row', gap: 20, backgroundColor: c.inset, borderRadius: 10, padding: 12 },
    summaryK: { fontSize: 10, color: c.mute },
    summaryV: { fontSize: 12.5, color: c.ink, fontWeight: '600', marginTop: 2, maxWidth: 150 },
    row: { flexDirection: 'row', gap: 8 },
    msg: { fontSize: 11.5, color: c.accent, lineHeight: 17 },
    cardTitle: { fontSize: 13.5, fontWeight: '600', color: c.ink },
    shared: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: c.okSoft, borderRadius: 9, padding: 10 },
    sharedText: { flex: 1, fontSize: 11.5, color: c.ok, lineHeight: 17 },
  })
