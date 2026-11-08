import { useMemo } from 'react'
import { appointmentsApi } from '../../api/appointments'
import { useAuth } from '../../auth/AuthContext'
import { slugFor } from '../../auth/roles'

export const STATUS = {
  requested: { ar: 'طلب حجز أونلاين', en: 'Online request', tone: 'gold', icon: 'inbox' },
  booked: { ar: 'محجوز', en: 'Booked', tone: 'neutral', icon: 'calendar' },
  confirmed: { ar: 'مؤكد', en: 'Confirmed', tone: 'info', icon: 'check' },
  arrived: { ar: 'وصل', en: 'Arrived', tone: 'gold', icon: 'logIn' },
  in_room: { ar: 'مع الطبيب', en: 'With doctor', tone: 'success', icon: 'stethoscope' },
  completed: { ar: 'انتهت', en: 'Completed', tone: 'success', icon: 'checkCircle' },
  cancelled: { ar: 'أُلغي', en: 'Cancelled', tone: 'danger', icon: 'x' },
  no_show: { ar: 'لم يحضر', en: 'No-show', tone: 'danger', icon: 'alert' },
}

export const OPEN = ['requested', 'booked', 'confirmed']

export const SOURCES = {
  walk_in: { ar: 'حضور مباشر', en: 'Walk-in' },
  phone: { ar: 'هاتف', en: 'Phone' },
  whatsapp: { ar: 'واتساب', en: 'WhatsApp' },
  social: { ar: 'فيسبوك / إنستجرام', en: 'Facebook / Instagram' },
  website: { ar: 'الموقع', en: 'Website' },
  portal: { ar: 'حساب المريض', en: 'Patient account' },
  other: { ar: 'أخرى', en: 'Other' },
}

export const EVENTS = {
  booked: { ar: 'حُجز الموعد', en: 'Booked' },
  confirmed: { ar: 'تأكيد', en: 'Confirmed' },
  arrived: { ar: 'وصل المريض', en: 'Patient arrived' },
  in_room: { ar: 'دخل للطبيب', en: 'Called in' },
  completed: { ar: 'انتهت الزيارة', en: 'Visit finished' },
  cancelled: { ar: 'إلغاء', en: 'Cancelled' },
  no_show: { ar: 'لم يحضر', en: 'Marked no-show' },
  rescheduled: { ar: 'تغيير الموعد', en: 'Rescheduled' },
  notes: { ar: 'تعديل الملاحظات', en: 'Notes edited' },
}

export function useAppointments() {
  const { me, can } = useAuth()
  const slug = slugFor(me.active_role)
  return useMemo(() => ({ api: appointmentsApi(slug), base: `/dashboard/${slug}`, can, me }), [slug, can, me])
}

export const serviceNames = (services, pick) => services.map((s) => pick(s)).join(' + ')
