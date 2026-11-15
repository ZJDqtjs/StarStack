import React from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native'
import { C, R, card } from '../theme'

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>
}

export function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View style={s.section}>
      <Text style={s.eyebrow}>{eyebrow}</Text>
      <Text style={s.h1}>{title}</Text>
    </View>
  )
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
      {sub ? <Text style={s.statSub}>{sub}</Text> : null}
    </View>
  )
}

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'ok' ? C.success : tone === 'warn' ? C.amber : tone === 'bad' ? C.danger : C.muted
  return (
    <View style={[s.badge, { borderColor: color }]}>
      <Text style={[s.badgeText, { color }]}>{text}</Text>
    </View>
  )
}

export function Field({
  label,
  hint,
  ...rest
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={C.dim}
        style={s.input}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  )
}

export function Btn({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string
  onPress: () => void
  kind?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const isPrimary = kind === 'primary'
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        isPrimary ? s.btnPrimary : kind === 'danger' ? s.btnDanger : s.btnGhost,
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.82 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#fff' : C.primary} />
      ) : (
        <Text style={[s.btnText, { color: isPrimary ? '#fff' : kind === 'danger' ? C.danger : C.primary }]}>
          {title}
        </Text>
      )}
    </Pressable>
  )
}

export function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.kvK}>{k}</Text>
      <Text style={s.kvV}>{v}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  card: { ...card, padding: 16, gap: 12 },
  section: { marginBottom: 14 },
  eyebrow: { fontSize: 11, color: C.primary, letterSpacing: 1.2, marginBottom: 6, fontWeight: '500' },
  h1: { fontSize: 22, fontWeight: '600', color: C.text },
  stat: { flex: 1, minWidth: 96 },
  statValue: { fontSize: 24, fontWeight: '600', color: C.text },
  statLabel: { fontSize: 12, color: C.muted, marginTop: 2 },
  statSub: { fontSize: 11, color: C.dim, marginTop: 2 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '500' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, color: C.muted, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: C.lineStrong,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: C.text,
    backgroundColor: C.surface,
  },
  hint: { fontSize: 11, color: C.dim, lineHeight: 16 },
  btn: {
    borderRadius: R.sm,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnPrimary: { backgroundColor: C.primary },
  btnGhost: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.lineStrong },
  btnDanger: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  btnText: { fontSize: 14, fontWeight: '600' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  kvK: { fontSize: 13, color: C.muted },
  kvV: { fontSize: 13, color: C.text, fontWeight: '500' },
})
