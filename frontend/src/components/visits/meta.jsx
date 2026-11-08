import { useMemo } from 'react'
import { visitsApi } from '../../api/visits'
import { useAuth } from '../../auth/AuthContext'
import { slugFor } from '../../auth/roles'
import { useI18n } from '../../i18n/I18nContext'
import { Badge } from '../ui'

export function useVisits() {
  const { me, can } = useAuth()
  const slug = slugFor(me.active_role)
  return useMemo(() => ({ api: visitsApi(slug), base: `/dashboard/${slug}`, can, me }), [slug, can, me])
}

// What a visit's state means, in the order the doctor goes through it.
export function visitState(v) {
  if (v.status === 'draft') return 'draft'
  return v.released_at ? 'released' : 'signed'
}

const STATES = {
  draft: { ar: 'مسودة — لم تُوقَّع', en: 'Draft — not signed', tone: 'gold' },
  signed: { ar: 'موقّعة — لم تُتح للمريض', en: 'Signed — not released', tone: 'info' },
  released: { ar: 'موقّعة ومُتاحة للمريض', en: 'Signed & released', tone: 'success' },
}

export function VisitBadge({ visit }) {
  const { lang } = useI18n()
  const s = STATES[visitState(visit)]
  return <Badge tone={s.tone}>{s[lang]}</Badge>
}

export const diagnosisName = (d, pick) => (d.name_en ? pick(d) : d.text) + (d.name_en && d.text ? ` — ${d.text}` : '')

export const VITALS = [
  { key: 'bp', ar: 'الضغط', en: 'Blood pressure', unit: 'mmHg' },
  { key: 'pulse', ar: 'النبض', en: 'Pulse', unit: '/min' },
  { key: 'temperature', ar: 'الحرارة', en: 'Temperature', unit: '°C' },
  { key: 'spo2', ar: 'الأكسجين', en: 'SpO₂', unit: '%' },
  { key: 'resp_rate', ar: 'التنفس', en: 'Breathing', unit: '/min' },
  { key: 'weight_kg', ar: 'الوزن', en: 'Weight', unit: 'kg' },
  { key: 'height_cm', ar: 'الطول', en: 'Height', unit: 'cm' },
]

export function vitalValue(v, key) {
  if (key === 'bp') return v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : null
  const value = v[key]
  return value === null || value === undefined ? null : String(Number(value))
}

export function bmi(v) {
  if (!v.weight_kg || !v.height_cm) return null
  const m = Number(v.height_cm) / 100
  return (Number(v.weight_kg) / (m * m)).toFixed(1)
}

// Values outside the usual adult range are shown in red, so nothing abnormal is missed.
export function vitalFlag(v, key) {
  const n = (x) => Number(x)
  switch (key) {
    case 'bp': return v.bp_systolic && (n(v.bp_systolic) >= 140 || n(v.bp_diastolic) >= 90 || n(v.bp_systolic) < 90)
    case 'pulse': return v.pulse && (n(v.pulse) > 100 || n(v.pulse) < 50)
    case 'temperature': return v.temperature && n(v.temperature) >= 37.8
    case 'spo2': return v.spo2 && n(v.spo2) < 94
    case 'resp_rate': return v.resp_rate && (n(v.resp_rate) > 22 || n(v.resp_rate) < 10)
    default: return false
  }
}

export const FORMS = {
  tablet: { ar: 'أقراص', en: 'Tablet' },
  capsule: { ar: 'كبسولات', en: 'Capsule' },
  syrup: { ar: 'شراب', en: 'Syrup' },
  suspension: { ar: 'معلق', en: 'Suspension' },
  drops: { ar: 'نقط', en: 'Drops' },
  cream: { ar: 'كريم', en: 'Cream' },
  gel: { ar: 'جل', en: 'Gel' },
  ointment: { ar: 'مرهم', en: 'Ointment' },
  lotion: { ar: 'لوشن', en: 'Lotion' },
  solution: { ar: 'محلول', en: 'Solution' },
  shampoo: { ar: 'شامبو', en: 'Shampoo' },
  spray: { ar: 'بخاخ', en: 'Spray' },
  mouthwash: { ar: 'غسول فم', en: 'Mouthwash' },
  injection: { ar: 'حقن', en: 'Injection' },
  vaginal: { ar: 'مهبلي', en: 'Vaginal' },
  sachet: { ar: 'أكياس', en: 'Sachet' },
  other: { ar: 'أخرى', en: 'Other' },
}
