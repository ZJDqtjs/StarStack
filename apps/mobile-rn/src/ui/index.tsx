// 基础组件：与 web-react 的 .card / .btn / .chip / .tag / .tabs 对齐。
// 所有组件都从 useTheme() 取色，所以明暗主题切换时无需重启页面。
import React from 'react'
import {
  ActivityIndicator,
  Modal as RNModal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native'
import { R, useStyles, useTheme, type Palette } from '../theme'
import { Icon, StarMark, type IconName } from './icon'

export { Icon, StarMark }
export type { IconName }

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'accent'

function toneColors(c: Palette, tone: Tone) {
  switch (tone) {
    case 'ok':
      return { fg: c.ok, bg: c.okSoft }
    case 'warn':
      return { fg: c.warn, bg: c.warnSoft }
    case 'bad':
      return { fg: c.bad, bg: c.badSoft }
    case 'info':
      return { fg: c.info, bg: c.infoSoft }
    case 'accent':
      return { fg: c.accent, bg: c.accentSoft }
    default:
      return { fg: c.mute, bg: c.soft }
  }
}

export function Card({
  children,
  style,
  pad = true,
}: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  pad?: boolean
}) {
  const s = useStyles(makeCardStyles)
  return <View style={[s.card, !pad && { padding: 0 }, style]}>{children}</View>
}

export function Page({
  children,
  refreshing,
  onRefresh,
  gap = 12,
  bottom = 28,
}: {
  children: React.ReactNode
  refreshing?: boolean
  onRefresh?: () => void
  gap?: number
  bottom?: number
}) {
  const { c } = useTheme()
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 14, gap, paddingBottom: bottom }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.accent} colors={[c.accent]} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  )
}

export function PageHead({
  eyebrow,
  title,
  desc,
  action,
}: {
  eyebrow?: string
  title: string
  desc?: string
  action?: React.ReactNode
}) {
  const s = useStyles(makeHeadStyles)
  return (
    <View style={s.head}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Text style={s.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
        <Text style={s.title}>{title}</Text>
        {desc ? <Text style={s.desc}>{desc}</Text> : null}
      </View>
      {action}
    </View>
  )
}

export function SectionHead({ label, title, side }: { label?: string; title: string; side?: React.ReactNode }) {
  const s = useStyles(makeHeadStyles)
  return (
    <View style={s.sec}>
      <View style={{ flex: 1 }}>
        {label ? <Text style={s.eyebrow}>{label.toUpperCase()}</Text> : null}
        <Text style={s.secTitle}>{title}</Text>
      </View>
      {side}
    </View>
  )
}

export function Btn({
  title,
  onPress,
  kind = 'primary',
  size = 'md',
  icon,
  disabled,
  loading,
  block,
  style,
}: {
  title?: string
  onPress: () => void
  kind?: 'primary' | 'ghost' | 'soft' | 'danger'
  size?: 'md' | 'sm' | 'xs'
  icon?: IconName
  disabled?: boolean
  loading?: boolean
  block?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const { c } = useTheme()
  const s = useStyles(makeBtnStyles)
  const fg = kind === 'primary' ? c.accentInk : kind === 'danger' ? c.bad : kind === 'soft' ? c.accent : c.ink
  const pad = size === 'xs' ? s.xs : size === 'sm' ? s.sm : s.md
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.base,
        pad,
        kind === 'primary' && s.primary,
        kind === 'ghost' && s.ghost,
        kind === 'soft' && s.soft,
        kind === 'danger' && s.danger,
        block && { alignSelf: 'stretch' },
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.82 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <View style={s.inner}>
          {icon ? <Icon name={icon} size={size === 'xs' ? 13 : 15} color={fg} /> : null}
          {title ? (
            <Text style={[s.text, size === 'xs' && { fontSize: 12 }, size === 'sm' && { fontSize: 13 }, { color: fg }]}>
              {title}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  )
}

export function IconBtn({
  name,
  onPress,
  size = 18,
  tone = 'default',
  style,
}: {
  name: IconName
  onPress: () => void
  size?: number
  tone?: 'default' | 'accent'
  style?: StyleProp<ViewStyle>
}) {
  const { c } = useTheme()
  const s = useStyles(makeIconBtnStyles)
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.btn, pressed && { opacity: 0.6 }, style]}>
      <Icon name={name} size={size} color={tone === 'accent' ? c.accent : c.body} />
    </Pressable>
  )
}

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: Tone }) {
  const { c } = useTheme()
  const t = toneColors(c, tone)
  const s = useStyles(makeBadgeStyles)
  return (
    <View style={[s.badge, { backgroundColor: t.bg }]}>
      <Text style={[s.text, { color: t.fg }]}>{text}</Text>
    </View>
  )
}

export function Tag({ text, tone = 'neutral' }: { text: string; tone?: Tone }) {
  return <Badge text={text} tone={tone} />
}

export function Dot({ color }: { color: string }) {
  return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
}

export function Chip({
  label,
  on,
  onPress,
  color,
}: {
  label: string
  on?: boolean
  onPress: () => void
  color?: string
}) {
  const { c } = useTheme()
  const s = useStyles(makeChipStyles)
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.chip, on && s.on, pressed && { opacity: 0.7 }]}>
      {color ? <Dot color={color} /> : null}
      <Text style={[s.text, on && { color: c.accent, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  )
}

export function Segmented<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  const s = useStyles(makeSegStyles)
  return (
    <View style={s.wrap}>
      {items.map((it) => {
        const on = it.key === value
        return (
          <Pressable key={it.key} onPress={() => onChange(it.key)} style={[s.item, on && s.on]}>
            <Text style={[s.text, on && s.textOn]} numberOfLines={1}>
              {it.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function Field({
  label,
  hint,
  multiline,
  ...rest
}: TextInputProps & { label?: string; hint?: string }) {
  const { c } = useTheme()
  const s = useStyles(makeFieldStyles)
  return (
    <View style={s.wrap}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.faint}
        style={[s.input, multiline && s.area]}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  )
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { c } = useTheme()
  const s = useStyles(makeFieldStyles)
  return (
    <View style={s.search}>
      <Icon name="search" size={15} color={c.faint} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.faint}
        style={s.searchInput}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  )
}

export function KV({ k, v, tone }: { k: string; v: string; tone?: string }) {
  const s = useStyles(makeKvStyles)
  return (
    <View style={s.row}>
      <Text style={s.k}>{k}</Text>
      <Text style={[s.v, tone ? { color: tone } : null]} numberOfLines={2}>
        {v}
      </Text>
    </View>
  )
}

export function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: IconName }) {
  const { c } = useTheme()
  const s = useStyles(makeStatStyles)
  return (
    <View style={s.stat}>
      <View style={s.labelRow}>
        <Text style={s.label}>{label}</Text>
        {icon ? <Icon name={icon} size={13} color={c.faint} /> : null}
      </View>
      <Text style={s.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? <Text style={s.sub}>{sub}</Text> : null}
    </View>
  )
}

export function Bar({ pct, color }: { pct: number; color?: string }) {
  const { c } = useTheme()
  const s = useStyles(makeBarStyles)
  const w = Math.max(0, Math.min(100, pct))
  return (
    <View style={s.track}>
      <View style={[s.fill, { width: `${w}%`, backgroundColor: color || c.accent }]} />
    </View>
  )
}

export function Avatar({ name, size = 34 }: { name?: string; size?: number }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: c.accent, fontWeight: '700', fontSize: size * 0.4 }}>
        {String(name || '?').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  )
}

export function Empty({ text, icon = 'box' }: { text: string; icon?: IconName }) {
  const { c } = useTheme()
  const s = useStyles(makeEmptyStyles)
  return (
    <View style={s.wrap}>
      <Icon name={icon} size={22} color={c.faint} />
      <Text style={s.text}>{text}</Text>
    </View>
  )
}

export function Loading({ text = '载入中…' }: { text?: string }) {
  const { c } = useTheme()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
      <ActivityIndicator color={c.accent} />
      <Text style={{ color: c.mute, fontSize: 12 }}>{text}</Text>
    </View>
  )
}

// 从底部弹出的面板：移动端用它替代网页的 Modal，更符合手机手势。
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}) {
  const { c } = useTheme()
  const s = useStyles(makeSheetStyles)
  return (
    <RNModal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[s.mask, { backgroundColor: c.overlay }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.handle} />
          {title ? (
            <View style={s.head}>
              <Text style={s.title}>{title}</Text>
              <IconBtn name="x" onPress={onClose} size={16} />
            </View>
          ) : null}
          <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </RNModal>
  )
}

export function Toast({ msg, tone }: { msg: string; tone?: 'ok' | 'bad' | 'warn' }) {
  const { c } = useTheme()
  const t = toneColors(c, (tone as Tone) || 'neutral')
  return (
    <View style={{ paddingHorizontal: 14, width: '100%' }}>
      <View
        style={{
          backgroundColor: c.ink,
          borderRadius: R.card,
          paddingHorizontal: 14,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.fg }} />
        <Text style={{ color: c.surface, fontSize: 13, flex: 1 }}>{msg}</Text>
      </View>
    </View>
  )
}

const makeCardStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hair,
      borderRadius: R.card,
      padding: 16,
      gap: 12,
    },
  })

const makeHeadStyles = (c: Palette) =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingBottom: 2 },
    eyebrow: { fontSize: 10.5, letterSpacing: 1.1, color: c.accent, fontWeight: '600', marginBottom: 4 },
    title: { fontSize: 21, fontWeight: '700', color: c.ink, letterSpacing: -0.3 },
    desc: { fontSize: 12.5, color: c.mute, lineHeight: 18, marginTop: 4 },
    sec: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    secTitle: { fontSize: 15.5, fontWeight: '600', color: c.ink },
  })

const makeBtnStyles = (c: Palette) =>
  StyleSheet.create({
    base: { borderRadius: R.ctl, alignItems: 'center', justifyContent: 'center' },
    md: { minHeight: 42, paddingHorizontal: 16, paddingVertical: 10 },
    sm: { minHeight: 34, paddingHorizontal: 12, paddingVertical: 7 },
    xs: { minHeight: 27, paddingHorizontal: 10, paddingVertical: 4 },
    inner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    primary: { backgroundColor: c.accent },
    ghost: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.hair2 },
    soft: { backgroundColor: c.accentSoft },
    danger: { backgroundColor: c.badSoft, borderWidth: 1, borderColor: c.bad + '55' },
    text: { fontSize: 14, fontWeight: '600' },
  })

const makeIconBtnStyles = (c: Palette) =>
  StyleSheet.create({
    btn: {
      width: 34,
      height: 34,
      borderRadius: R.ctl,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.soft,
    },
  })

const makeBadgeStyles = (c: Palette) =>
  StyleSheet.create({
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill, alignSelf: 'flex-start' },
    text: { fontSize: 10.5, fontWeight: '600' },
  })

const makeChipStyles = (c: Palette) =>
  StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      height: 30,
      paddingHorizontal: 11,
      borderRadius: R.pill,
      borderWidth: 1,
      borderColor: c.hair2,
      backgroundColor: c.surface,
    },
    on: { borderColor: c.accent, backgroundColor: c.accentSoft },
    text: { fontSize: 12, color: c.body },
  })

const makeSegStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { flexDirection: 'row', backgroundColor: c.soft, borderRadius: R.ctl, padding: 3, gap: 3 },
    item: { flex: 1, paddingVertical: 7, borderRadius: R.ctl - 1, alignItems: 'center' },
    on: {
      backgroundColor: c.surface,
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    text: { fontSize: 12.5, color: c.mute, fontWeight: '500' },
    textOn: { color: c.ink, fontWeight: '600' },
  })

const makeFieldStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { gap: 6 },
    label: { fontSize: 11.5, color: c.mute, fontWeight: '500' },
    input: {
      borderWidth: 1,
      borderColor: c.hair2,
      borderRadius: R.ctl,
      paddingHorizontal: 12,
      paddingVertical: 10,
      minHeight: 42,
      fontSize: 14,
      color: c.ink,
      backgroundColor: c.surface,
    },
    area: { minHeight: 88, paddingTop: 10 },
    hint: { fontSize: 11, color: c.faint, lineHeight: 16 },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: 38,
      paddingHorizontal: 11,
      borderRadius: R.ctl,
      borderWidth: 1,
      borderColor: c.hair2,
      backgroundColor: c.surface,
    },
    searchInput: { flex: 1, fontSize: 13, color: c.ink, padding: 0 },
  })

const makeKvStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 3 },
    k: { fontSize: 12, color: c.mute },
    v: { fontSize: 12.5, color: c.ink, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  })

const makeStatStyles = (c: Palette) =>
  StyleSheet.create({
    stat: { flex: 1, gap: 2 },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    label: { fontSize: 11.5, color: c.mute },
    value: { fontSize: 22, fontWeight: '700', color: c.ink, letterSpacing: -0.4 },
    sub: { fontSize: 10.5, color: c.faint },
  })

const makeBarStyles = (c: Palette) =>
  StyleSheet.create({
    track: { height: 5, borderRadius: 3, backgroundColor: c.soft, overflow: 'hidden' },
    fill: { height: 5, borderRadius: 3 },
  })

const makeEmptyStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 26, paddingHorizontal: 12 },
    text: { fontSize: 12.5, color: c.faint, textAlign: 'center', lineHeight: 18 },
  })

const makeSheetStyles = (c: Palette) =>
  StyleSheet.create({
    mask: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      maxHeight: '86%',
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: c.hair,
    },
    handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: c.hair2 },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 4,
    },
    title: { fontSize: 16, fontWeight: '600', color: c.ink, flex: 1 },
  })
