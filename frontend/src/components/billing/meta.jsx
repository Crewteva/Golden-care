import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { Badge } from '../ui'
import { useAsync, useDebounced } from '../useAsync'
import { billingApi } from '../../api/billing'
import { useAuth } from '../../auth/AuthContext'
import { slugFor } from '../../auth/roles'
import { useI18n } from '../../i18n/I18nContext'
import { fmtPhone } from '../../lib/format'
import { money } from '../clinical/meta'

export { money }

export function useBilling() {
  const { me, can } = useAuth()
  const slug = slugFor(me.active_role)
  return useMemo(() => {
    const base = `/dashboard/${slug}`
    return { slug, base, bill: `${base}/billing`, can, me, api: billingApi(slug) }
  }, [slug, can, me])
}

export const num = (v) => Number(v || 0)
// Money typed by people: digits and one dot, at most two decimals.
export const cleanAmount = (v) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').replace(/(\.\d{2})\d+$/, '$1')

export const INVOICE_STATUS = {
  draft: { ar: 'مسودة', en: 'Draft', tone: 'neutral' },
  pending_approval: { ar: 'بانتظار اعتماد الخصم', en: 'Discount awaiting approval', tone: 'warn' },
  issued: { ar: 'صادرة', en: 'Issued', tone: 'info' },
  void: { ar: 'ملغاة', en: 'Void', tone: 'danger' },
  cancelled: { ar: 'مسودة محذوفة', en: 'Draft cancelled', tone: 'neutral' },
}

// Where an issued invoice stands for the patient
export function payState(inv) {
  if (inv.status !== 'issued') return inv.status
  const total = num(inv.total)
  const paid = num(inv.paid_total)
  if (total <= 0 || paid >= total) return 'paid'
  return paid > 0 ? 'partly' : 'unpaid'
}

export const PAY_STATE = {
  unbilled: { ar: 'لم تُفوتر', en: 'Not billed', tone: 'gold' },
  draft: { ar: 'مسودة', en: 'Draft', tone: 'neutral' },
  pending_approval: { ar: 'بانتظار الاعتماد', en: 'Awaiting approval', tone: 'warn' },
  unpaid: { ar: 'غير مدفوعة', en: 'Unpaid', tone: 'danger' },
  partly: { ar: 'مدفوعة جزئيًا', en: 'Partly paid', tone: 'warn' },
  paid: { ar: 'مدفوعة', en: 'Paid', tone: 'success' },
  void: { ar: 'ملغاة', en: 'Void', tone: 'danger' },
  cancelled: { ar: 'محذوفة', en: 'Cancelled', tone: 'neutral' },
}

export function InvoiceBadge({ invoice }) {
  const { lang } = useI18n()
  const s = PAY_STATE[payState(invoice)] || INVOICE_STATUS[invoice.status]
  return <Badge tone={s.tone}>{s[lang]}</Badge>
}

export function StateBadge({ state, map = PAY_STATE }) {
  const { lang } = useI18n()
  const s = map[state]
  return s ? <Badge tone={s.tone}>{s[lang]}</Badge> : null
}

export const METHODS = {
  cash: { ar: 'نقدي', en: 'Cash', icon: 'cash' },
  card: { ar: 'بطاقة', en: 'Card', icon: 'layers' },
  instapay: { ar: 'إنستاباي', en: 'InstaPay', icon: 'smartphone' },
  wallet: { ar: 'محفظة موبايل', en: 'Mobile wallet', icon: 'smartphone' },
  credit: { ar: 'من الرصيد', en: 'From credit', icon: 'award' },
}
export const methodLabel = (m, lang) => METHODS[m]?.[lang] || m

export const INSTALLMENT_STATE = {
  paid: { ar: 'مدفوع', en: 'Paid', tone: 'success' },
  partly: { ar: 'مدفوع جزئيًا', en: 'Partly paid', tone: 'warn' },
  due: { ar: 'مستحق', en: 'Due', tone: 'gold' },
  overdue: { ar: 'متأخر', en: 'Overdue', tone: 'danger' },
  cancelled: { ar: 'ملغى', en: 'Cancelled', tone: 'neutral' },
}

export const PACKAGE_STATE = {
  active: { ar: 'سارية', en: 'Active', tone: 'success' },
  used_up: { ar: 'استُهلكت', en: 'Used up', tone: 'neutral' },
  expired: { ar: 'انتهت صلاحيتها', en: 'Expired', tone: 'warn' },
  cancelled: { ar: 'أُلغيت', en: 'Cancelled', tone: 'danger' },
}

export const REFUND_STATE = {
  requested: { ar: 'بانتظار الاعتماد', en: 'Awaiting approval', tone: 'warn' },
  approved: { ar: 'معتمد — جاهز للصرف', en: 'Approved — ready to pay', tone: 'gold' },
  paid: { ar: 'صُرف', en: 'Paid out', tone: 'success' },
  rejected: { ar: 'مرفوض', en: 'Rejected', tone: 'danger' },
}

export const APPROVAL_KIND = {
  discount: { ar: 'خصم فوق الحد', en: 'Discount above the limit', icon: 'pie' },
  void: { ar: 'إلغاء فاتورة', en: 'Void an invoice', icon: 'x' },
  refund: { ar: 'استرداد مبلغ', en: 'Refund', icon: 'refresh' },
  package_cancel: { ar: 'إلغاء باقة', en: 'Cancel a package', icon: 'package' },
}
export const APPROVAL_STATE = {
  pending: { ar: 'بانتظار القرار', en: 'Pending', tone: 'warn' },
  approved: { ar: 'اعتُمد', en: 'Approved', tone: 'success' },
  rejected: { ar: 'رُفض', en: 'Rejected', tone: 'danger' },
  withdrawn: { ar: 'سُحب', en: 'Withdrawn', tone: 'neutral' },
}

export const CREDIT_REASON = {
  overpayment: { ar: 'دفع زائد', en: 'Overpayment' },
  deposit: { ar: 'إيداع مقدم', en: 'Deposit' },
  used: { ar: 'استُخدم في فاتورة', en: 'Used on an invoice' },
  refund: { ar: 'استرداد', en: 'Refund paid' },
  void: { ar: 'فاتورة ملغاة', en: 'Invoice voided' },
  package_cancel: { ar: 'إلغاء باقة', en: 'Package cancelled' },
}

export const LINE_KIND = {
  service: { ar: 'خدمة', en: 'Service' },
  package_sale: { ar: 'بيع باقة', en: 'Package sale' },
  package_use: { ar: 'جلسة من باقة', en: 'Package session' },
  plan_item: { ar: 'بند خطة علاج', en: 'Treatment plan item' },
}

export function Methods({ payments }) {
  const { lang } = useI18n()
  const list = typeof payments === 'string' ? payments.split(',').map((m) => ({ method: m })) : payments || []
  return (
    <span className="pay-methods">
      {list.map((p, i) => (
        <span key={i} className={`pay-chip m-${p.method}`}>
          <Icon name={METHODS[p.method]?.icon || 'cash'} size={12} />
          {methodLabel(p.method, lang)}
        </span>
      ))}
    </span>
  )
}

// Find a patient by name, file number or phone, then open their account.
export function PatientFinder({ onPick, autoFocus }) {
  const { tx, pick, locale } = useI18n()
  const { api, bill } = useBilling()
  const [q, setQ] = useState('')
  const term = useDebounced(q.trim(), 250)
  const { data, loading } = useAsync(() => (term.length >= 2 ? api.findPatients(term) : Promise.resolve(null)), [term, api])
  return (
    <div className="finder">
      <div className="input-wrap">
        <span className="input-start"><Icon name="search" size={18} /></span>
        <input className="input has-start" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus}
          aria-label={tx('بحث عن مريض', 'Find a patient')} placeholder={tx('اسم المريض، رقم الملف أو الموبايل…', 'Patient name, file no. or mobile…')} />
      </div>
      {term.length >= 2 && (
        <ul className="finder-results" aria-live="polite">
          {loading && !data ? <li className="muted">{tx('جارٍ البحث…', 'Searching…')}</li>
            : !data?.length ? <li className="muted">{tx('لا توجد نتائج.', 'No matches.')}</li>
              : data.map((p) => (
                <li key={p.id}>
                  {onPick ? (
                    <button type="button" onClick={() => onPick(p)}><FinderRow p={p} pick={pick} tx={tx} locale={locale} /></button>
                  ) : (
                    <Link to={`${bill}/patients/${p.id}`}><FinderRow p={p} pick={pick} tx={tx} locale={locale} /></Link>
                  )}
                </li>
              ))}
        </ul>
      )}
    </div>
  )
}

function FinderRow({ p, pick, tx, locale }) {
  return (
    <>
      <span className="finder-name"><strong>{pick(p, 'full_name')}</strong><small><span className="mrn">{p.mrn}</span>{p.phone && <> · <bdi className="ltr">{fmtPhone(p.phone)}</bdi></>}</small></span>
      <span className="finder-money">
        {num(p.owed) > 0 && <Badge tone="danger">{tx('عليه', 'Owes')} {money(p.owed, locale)}</Badge>}
        {num(p.credit) > 0 && <Badge tone="success">{tx('رصيد', 'Credit')} {money(p.credit, locale)}</Badge>}
      </span>
    </>
  )
}

// Mirrors the server's installment schedule so the cashier sees it before issuing.
export function previewSchedule(total, { installments, down_payment, first_due_on }) {
  const n = Number(installments) || 0
  if (!n) return []
  const cents = (v) => Math.round(Number(v || 0) * 100)
  const down = cents(down_payment)
  const rest = cents(total) - down
  if (rest <= 0) return []
  const today = new Date()
  const first = first_due_on ? new Date(`${first_due_on}T12:00:00`) : new Date(today.getTime() + 30 * 864e5)
  const each = Math.floor(rest / n)
  const rows = down > 0 ? [{ seq: 0, due_on: today.toISOString().slice(0, 10), amount: down / 100 }] : []
  for (let k = 0; k < n; k += 1) {
    const amount = k < n - 1 ? each : rest - each * (n - 1)
    const d = new Date(first.getFullYear(), first.getMonth() + k, Math.min(first.getDate(), 28), 12)
    rows.push({ seq: k + 1, due_on: d.toISOString().slice(0, 10), amount: amount / 100 })
  }
  return rows
}
