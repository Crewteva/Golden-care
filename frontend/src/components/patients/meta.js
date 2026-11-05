// Labels for patient-file values, in both languages.
export const ALERT_KINDS = {
  allergy: { ar: 'حساسية', en: 'Allergy', icon: 'alert' },
  chronic: { ar: 'مرض مزمن', en: 'Chronic condition', icon: 'heart' },
  medication: { ar: 'دواء مهم', en: 'Key medication', icon: 'plusSquare' },
  pregnancy: { ar: 'حمل', en: 'Pregnancy', icon: 'heart' },
  implant: { ar: 'جهاز مزروع', en: 'Implant / device', icon: 'activity' },
  other: { ar: 'ملاحظة طبية', en: 'Other', icon: 'info' },
}

export const SEVERITY = {
  critical: { ar: 'خطير', en: 'Critical', tone: 'danger' },
  warning: { ar: 'تنبيه', en: 'Warning', tone: 'warn' },
  info: { ar: 'للعلم', en: 'For info', tone: 'info' },
}

export const CATEGORIES = {
  lab_result: { ar: 'نتيجة تحليل', en: 'Lab result', icon: 'activity', admin: false },
  report: { ar: 'تقرير / أشعة', en: 'Report / imaging', icon: 'fileSearch', admin: false },
  photo: { ar: 'صورة طبية', en: 'Clinical photo', icon: 'eye', admin: false },
  consent: { ar: 'إقرار موقّع', en: 'Signed consent', icon: 'edit', admin: true },
  id_copy: { ar: 'صورة الهوية', en: 'ID copy', icon: 'user', admin: true },
  other: { ar: 'مستند آخر', en: 'Other document', icon: 'clipboard', admin: false },
}

export const RELATIONSHIPS = {
  parent: { ar: 'والد / والدة', en: 'Parent' },
  child: { ar: 'ابن / ابنة', en: 'Child' },
  spouse: { ar: 'زوج / زوجة', en: 'Spouse' },
  sibling: { ar: 'أخ / أخت', en: 'Sibling' },
  other: { ar: 'قريب', en: 'Relative' },
}

export const NEEDS_REVIEW = ['lab_result', 'report']
export const RELEASABLE = ['lab_result', 'report', 'photo', 'other']

export function ageOf(dob) {
  if (!dob) return null
  const born = new Date(dob)
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  const m = now.getMonth() - born.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age -= 1
  return age
}

export function ageLabel(dob, tx) {
  const age = ageOf(dob)
  if (age === null) return ''
  if (age < 2) {
    const born = new Date(dob)
    const now = new Date()
    const months = (now.getFullYear() - born.getFullYear()) * 12 + now.getMonth() - born.getMonth()
    return tx(`${months} شهر`, `${months} mo`)
  }
  return tx(`${age} سنة`, `${age} y`)
}

export function sexLabel(gender, tx) {
  return gender === 'female' ? tx('أنثى', 'Female') : tx('ذكر', 'Male')
}

export function fileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
