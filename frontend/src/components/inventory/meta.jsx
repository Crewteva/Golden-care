import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { inventoryApi } from '../../api/inventory'
import { useAuth } from '../../auth/AuthContext'
import { slugFor } from '../../auth/roles'
import { useI18n } from '../../i18n/I18nContext'
import { State, cleanAmount, dayLabelShort, downloadCsv, money, num, today } from '../accounting/meta'

export { State, cleanAmount, dayLabelShort, downloadCsv, money, num, today }

export function useInventory() {
  const { me, can } = useAuth()
  const slug = slugFor(me.active_role)
  return useMemo(() => {
    const dash = `/dashboard/${slug}`
    return {
      slug,
      dash,
      userId: me.user?.id,
      base: `${dash}/inventory`,
      can,
      canView: can('inventory.view'),
      canManage: can('inventory.manage'),
      canUse: can('inventory.use'),
      canApprove: can('inventory.approve'),
      canPay: can('purchasing.pay'),
      canDevices: can('devices.manage'),
      canReport: can('devices.report'),
      api: inventoryApi(slug),
    }
  }, [slug, can, me.user?.id])
}

// Quantities: whole numbers stay whole, up to two decimals otherwise.
export const qty = (v, locale) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(num(v))
export const cleanQty = cleanAmount
export const unitOf = (row, pick) => pick(row, 'unit') || ''

export const STOCK_STATE = {
  ok: { ar: 'متوفر', en: 'In stock', tone: 'success' },
  below_min: { ar: 'تحت الحد الأدنى', en: 'Below minimum', tone: 'warn' },
  expiring: { ar: 'ينتهي قريبًا', en: 'Expiring soon', tone: 'gold' },
  expired: { ar: 'به كمية منتهية', en: 'Has expired stock', tone: 'danger' },
}
export const PO_STATE = {
  pending_approval: { ar: 'بانتظار الاعتماد', en: 'Awaiting approval', tone: 'warn' },
  approved: { ar: 'معتمد — بانتظار الاستلام', en: 'Approved — to receive', tone: 'info' },
  partial: { ar: 'استلام جزئي', en: 'Partly received', tone: 'gold' },
  received: { ar: 'استُلم بالكامل', en: 'Received', tone: 'success' },
  rejected: { ar: 'مرفوض', en: 'Rejected', tone: 'danger' },
  cancelled: { ar: 'ملغى', en: 'Cancelled', tone: 'neutral' },
}
export const COUNT_STATE = {
  counting: { ar: 'جارٍ العد', en: 'Counting', tone: 'info' },
  submitted: { ar: 'بانتظار اعتماد الفروق', en: 'Awaiting approval', tone: 'warn' },
  approved: { ar: 'معتمد — رُحّلت الفروق', en: 'Approved — posted', tone: 'success' },
  rejected: { ar: 'مرفوض', en: 'Rejected', tone: 'danger' },
}
export const DEVICE_STATE = {
  working: { ar: 'يعمل', en: 'Working', tone: 'success' },
  maintenance: { ar: 'تحت الصيانة', en: 'Under maintenance', tone: 'warn' },
  out_of_service: { ar: 'خارج الخدمة', en: 'Out of service', tone: 'danger' },
}
export const FAULT_STATE = {
  open: { ar: 'مفتوح', en: 'Open', tone: 'danger' },
  fixed: { ar: 'تم الإصلاح', en: 'Fixed', tone: 'success' },
}
export const MOVE_KIND = {
  receive: { ar: 'استلام', en: 'Received', icon: 'download', tone: 'in' },
  use: { ar: 'صرف', en: 'Used', icon: 'activity', tone: 'out' },
  write_off: { ar: 'إعدام', en: 'Written off', icon: 'x', tone: 'loss' },
  count: { ar: 'تسوية جرد', en: 'Count adjustment', icon: 'clipboard', tone: 'adj' },
  transfer_out: { ar: 'تحويل صادر', en: 'Sent to store', icon: 'truck', tone: 'move' },
  transfer_in: { ar: 'تحويل وارد', en: 'From another store', icon: 'download', tone: 'move' },
  return: { ar: 'مرتجع لمورد', en: 'Returned to supplier', icon: 'refresh', tone: 'loss' },
}
export const TRANSFER_STATE = {
  requested: { ar: 'مطلوب — بانتظار الإرسال', en: 'Requested — to send', tone: 'warn' },
  dispatched: { ar: 'في الطريق', en: 'In transit', tone: 'info' },
  received: { ar: 'استُلم', en: 'Received', tone: 'success' },
  cancelled: { ar: 'ملغى', en: 'Cancelled', tone: 'neutral' },
}
export const RETURN_STATE = {
  pending: { ar: 'بانتظار الاعتماد', en: 'Awaiting approval', tone: 'warn' },
  approved: { ar: 'معتمد — خرج للمورد', en: 'Approved — returned', tone: 'success' },
  rejected: { ar: 'مرفوض', en: 'Rejected', tone: 'danger' },
}
export const PAYMENT_STATE = {
  prepared: { ar: 'بانتظار اعتماد شخص ثانٍ', en: 'Awaiting a second approver', tone: 'warn' },
  approved: { ar: 'معتمد — قُيّد', en: 'Approved — posted', tone: 'success' },
  rejected: { ar: 'مرفوض', en: 'Rejected', tone: 'danger' },
}
export const ROLE_LABEL = {
  nurse: { ar: 'تمريض', en: 'Nurse' },
  doctor: { ar: 'طبيب', en: 'Doctor' },
  inventory: { ar: 'المخازن', en: 'Inventory' },
  management: { ar: 'الإدارة', en: 'Management' },
}

export function MoveChip({ kind }) {
  const { lang } = useI18n()
  const k = MOVE_KIND[kind]
  return <span className={`mv-chip mv-${k?.tone || 'adj'}`}><Icon name={k?.icon || 'layers'} size={12} />{k?.[lang] || kind}</span>
}

// "in 12 days" / "today" / "3 days ago"
export function daysText(days, tx) {
  if (days === null || days === undefined) return ''
  if (days === 0) return tx('اليوم', 'today')
  if (days > 0) return tx(`بعد ${days} يوم`, `in ${days} day${days === 1 ? '' : 's'}`)
  return tx(`منذ ${-days} يوم`, `${-days} day${days === -1 ? '' : 's'} ago`)
}

export function daysBetween(from, to) {
  if (!from || !to) return null
  return Math.round((new Date(`${to.slice(0, 10)}T12:00:00Z`) - new Date(`${from.slice(0, 10)}T12:00:00Z`)) / 86400000)
}

export function BackLink({ to, children }) {
  return <Link to={to} className="back-link"><Icon name="arrowLeft" size={16} />{children}</Link>
}

// On-hand against the minimum, as a small gauge.
export function Level({ onHand, min }) {
  const max = Math.max(num(min) * 2, num(onHand), 1)
  const pct = Math.min(100, (num(onHand) / max) * 100)
  const minPct = num(min) ? Math.min(100, (num(min) / max) * 100) : null
  const low = num(min) && num(onHand) < num(min)
  return (
    <span className={`level ${low ? 'low' : ''}`} aria-hidden="true">
      <i style={{ '--w': `${pct}%` }} />
      {minPct !== null && <b style={{ '--m': `${minPct}%` }} />}
    </span>
  )
}

// Field error for one line of a lines table: "lines.<n>.<field>"
export const lineErr = (fe, i, field) => fe[`lines.${i}.${field}`]
