import { useMemo } from 'react'
import { complaintsApi, dentalApi, laserApi } from '../../api/clinical'
import { useAuth } from '../../auth/AuthContext'
import { slugFor } from '../../auth/roles'
import { useI18n } from '../../i18n/I18nContext'
import { Badge } from '../ui'

export function useClinical() {
  const { me, can } = useAuth()
  const slug = slugFor(me.active_role)
  return useMemo(() => ({
    slug, base: `/dashboard/${slug}`, can, me,
    laser: laserApi(slug), dental: dentalApi(slug), complaints: complaintsApi(slug),
  }), [slug, can, me])
}

// ---------- laser ----------

export const CHECKLIST = {
  pregnant: { ar: 'حامل أو مرضع؟', en: 'Pregnant or breastfeeding?' },
  isotretinoin: { ar: 'تناول إيزوتريتينوين (روأكيوتان) خلال آخر ٦ شهور؟', en: 'Isotretinoin (Roaccutane) in the last 6 months?' },
  photosensitive_meds: { ar: 'أدوية تزيد الحساسية للضوء (مضادات حيوية، ريتينويد…)؟', en: 'Medicines that cause light sensitivity (antibiotics, retinoids…)?' },
  recent_tan: { ar: 'تعرّض للشمس أو تسمير خلال أسبوعين؟', en: 'Sun tan or tanning in the last 2 weeks?' },
  active_infection: { ar: 'التهاب أو جرح نشط في المنطقة؟', en: 'Active infection or wound in the area?' },
  herpes_history: { ar: 'تاريخ إصابة بالهربس في المنطقة؟', en: 'History of cold sores (herpes) in the area?' },
  tattoo_in_area: { ar: 'وشم أو تاتو في المنطقة؟', en: 'Tattoo in the area?' },
  epilepsy_light: { ar: 'صرع يتأثر بالضوء؟', en: 'Light-triggered epilepsy?' },
  keloid: { ar: 'ميل لتكوّن الجدرة (كيلويد)؟', en: 'Tendency to keloid scars?' },
  consent_signed: { ar: 'وقّع المريض الإقرار؟', en: 'Patient signed the consent?' },
  patch_test: { ar: 'تم عمل اختبار جلدي (للجلسة الأولى)؟', en: 'Patch test done (first session)?' },
}

export const SKIN_TYPES = ['I', 'II', 'III', 'IV', 'V', 'VI']
export const BODY_AREAS = ['Full legs', 'Lower legs', 'Thighs', 'Arms', 'Underarms', 'Bikini', 'Back', 'Chest', 'Abdomen',
  'Upper lip', 'Chin', 'Cheeks', 'Full face', 'Neck', 'Full face (fractional)']

// ---------- dental ----------

export const CONDITIONS = {
  caries: { ar: 'تسوس', en: 'Caries', color: '#C2412D' },
  filling: { ar: 'حشو', en: 'Filling', color: '#2D5D8A' },
  crown: { ar: 'تاج / تركيبة', en: 'Crown', color: '#B7862F' },
  root_canal: { ar: 'علاج عصب', en: 'Root canal', color: '#6B4FA0' },
  missing: { ar: 'مفقود', en: 'Missing', color: '#8A8F8C' },
  extracted: { ar: 'خُلع', en: 'Extracted', color: '#8A8F8C' },
  implant: { ar: 'زرعة', en: 'Implant', color: '#1A6B5A' },
  bridge: { ar: 'جسر', en: 'Bridge', color: '#9B6B2F' },
  fracture: { ar: 'كسر', en: 'Fracture', color: '#A3241A' },
  sealant: { ar: 'سد شقوق', en: 'Sealant', color: '#3F7D3A' },
  veneer: { ar: 'فينير', en: 'Veneer', color: '#C9A86A' },
  watch: { ar: 'متابعة', en: 'Watch', color: '#D29B1E' },
}
export const RESULTS = ['filling', 'crown', 'root_canal', 'extracted', 'implant', 'bridge', 'sealant', 'veneer']
export const SURFACES = {
  M: { ar: 'إنسي', en: 'Mesial' },
  O: { ar: 'إطباقي', en: 'Occlusal' },
  D: { ar: 'وحشي', en: 'Distal' },
  B: { ar: 'شدقي', en: 'Buccal' },
  L: { ar: 'لساني', en: 'Lingual' },
  I: { ar: 'قاطع', en: 'Incisal' },
}

export const PLAN_STATE = {
  draft: { ar: 'مسودة', en: 'Draft', tone: 'neutral' },
  quoted: { ar: 'عرض سعر بانتظار الموافقة', en: 'Quoted — awaiting answer', tone: 'gold' },
  expired: { ar: 'انتهت صلاحية العرض', en: 'Quotation expired', tone: 'danger' },
  accepted: { ar: 'موافق عليها — جارٍ التنفيذ', en: 'Accepted — in progress', tone: 'info' },
  declined: { ar: 'رفضها المريض', en: 'Declined', tone: 'danger' },
  completed: { ar: 'اكتملت', en: 'Completed', tone: 'success' },
  cancelled: { ar: 'أُلغيت', en: 'Cancelled', tone: 'neutral' },
}

export function PlanBadge({ state }) {
  const { lang } = useI18n()
  const s = PLAN_STATE[state] || PLAN_STATE.draft
  return <Badge tone={s.tone}>{s[lang]}</Badge>
}

export const WORK_TYPES = {
  zirconia_crown: { ar: 'تاج زيركون', en: 'Zirconia crown' },
  pfm_crown: { ar: 'تاج بورسلين على معدن', en: 'PFM crown' },
  emax_crown: { ar: 'تاج إي ماكس', en: 'E.max crown' },
  bridge: { ar: 'جسر', en: 'Bridge' },
  veneer: { ar: 'فينير', en: 'Veneer' },
  implant_crown: { ar: 'تاج على زرعة', en: 'Implant crown' },
  full_denture: { ar: 'طقم كامل', en: 'Full denture' },
  partial_denture: { ar: 'طقم جزئي', en: 'Partial denture' },
  night_guard: { ar: 'واقي ليلي', en: 'Night guard' },
  retainer: { ar: 'مثبت تقويم', en: 'Retainer' },
  other: { ar: 'أخرى', en: 'Other' },
}

export const LAB_STATUS = {
  ordered: { ar: 'تم الطلب', en: 'Ordered', tone: 'neutral', icon: 'clipboard' },
  sent: { ar: 'في المعمل', en: 'At the lab', tone: 'info', icon: 'package' },
  returned: { ar: 'رجع — جاهز للتسليم', en: 'Back — ready to fit', tone: 'gold', icon: 'inbox' },
  remake: { ar: 'إعادة عمل', en: 'Remake', tone: 'danger', icon: 'refresh' },
  delivered: { ar: 'سُلّم للمريض', en: 'Delivered', tone: 'success', icon: 'checkCircle' },
  cancelled: { ar: 'أُلغي', en: 'Cancelled', tone: 'neutral', icon: 'x' },
}
export const LAB_MOVES = {
  sent: { ar: 'أُرسل للمعمل', en: 'Sent to lab', icon: 'package' },
  returned: { ar: 'رجع من المعمل', en: 'Back from lab', icon: 'inbox' },
  delivered: { ar: 'سُلّم للمريض', en: 'Delivered to patient', icon: 'checkCircle' },
  remake: { ar: 'يحتاج إعادة عمل', en: 'Needs a remake', icon: 'refresh' },
  cancelled: { ar: 'إلغاء', en: 'Cancel', icon: 'x' },
}

export function LabBadge({ status, overdue }) {
  const { lang, tx } = useI18n()
  const s = LAB_STATUS[status]
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      <Badge tone={s.tone}>{s[lang]}</Badge>
      {overdue && <Badge tone="danger">{tx('متأخر', 'Overdue')}</Badge>}
    </span>
  )
}

// ---------- complaints ----------

export const TICKET_KIND = {
  complaint: { ar: 'شكوى', en: 'Complaint', icon: 'alert' },
  request: { ar: 'طلب', en: 'Request', icon: 'inbox' },
  suggestion: { ar: 'اقتراح', en: 'Suggestion', icon: 'sparkle' },
  compliment: { ar: 'شكر', en: 'Compliment', icon: 'heart' },
}
export const TICKET_STATUS = {
  open: { ar: 'جديدة', en: 'Open', tone: 'gold' },
  in_progress: { ar: 'قيد المتابعة', en: 'In progress', tone: 'info' },
  resolved: { ar: 'تم الحل', en: 'Resolved', tone: 'success' },
  closed: { ar: 'مغلقة', en: 'Closed', tone: 'neutral' },
}
export const PRIORITY = {
  urgent: { ar: 'عاجل (٤ ساعات)', en: 'Urgent (4 h)', tone: 'danger' },
  high: { ar: 'مرتفع (٢٤ ساعة)', en: 'High (24 h)', tone: 'warn' },
  normal: { ar: 'عادي (٤٨ ساعة)', en: 'Normal (48 h)', tone: 'neutral' },
  low: { ar: 'منخفض (٧٢ ساعة)', en: 'Low (72 h)', tone: 'neutral' },
}
export const CATEGORY = {
  waiting: { ar: 'وقت الانتظار', en: 'Waiting time' },
  staff: { ar: 'تعامل الموظفين', en: 'Staff' },
  doctor: { ar: 'الطبيب', en: 'Doctor' },
  treatment: { ar: 'العلاج', en: 'Treatment' },
  billing: { ar: 'الحساب والدفع', en: 'Billing' },
  booking: { ar: 'الحجز', en: 'Booking' },
  cleanliness: { ar: 'النظافة', en: 'Cleanliness' },
  results: { ar: 'النتائج', en: 'Results' },
  other: { ar: 'أخرى', en: 'Other' },
}
export const CHANNEL = {
  in_person: { ar: 'في العيادة', en: 'In person' },
  phone: { ar: 'تليفون', en: 'Phone' },
  whatsapp: { ar: 'واتساب', en: 'WhatsApp' },
  portal: { ar: 'حساب المريض', en: 'Patient account' },
  website: { ar: 'الموقع', en: 'Website' },
  social: { ar: 'السوشيال ميديا', en: 'Social media' },
  other: { ar: 'أخرى', en: 'Other' },
}

export function TicketBadge({ status }) {
  const { lang } = useI18n()
  const s = TICKET_STATUS[status]
  return <Badge tone={s.tone}>{s[lang]}</Badge>
}

export const money = (value, locale) =>
  value === null || value === undefined ? '—'
    : new Intl.NumberFormat(locale, { style: 'currency', currency: 'EGP', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value))
