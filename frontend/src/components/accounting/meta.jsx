import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { Badge } from '../ui'
import { accountingApi } from '../../api/accounting'
import { useAuth } from '../../auth/AuthContext'
import { slugFor } from '../../auth/roles'
import { useI18n } from '../../i18n/I18nContext'
import { dayKey } from '../../lib/clinicTime'
import { money } from '../clinical/meta'

export { money }

export function useAccounting() {
  const { me, can } = useAuth()
  const slug = slugFor(me.active_role)
  return useMemo(() => {
    const dash = `/dashboard/${slug}`
    return {
      slug,
      dash,
      base: `${dash}/accounting`,
      can,
      canPost: can('accounting.post'),
      canApprove: can('accounting.approve'),
      canSetup: can('accounting.setup'),
      api: accountingApi(slug),
    }
  }, [slug, can])
}

export const num = (v) => Number(v || 0)
export const today = () => dayKey()
export const monthStart = (key = today()) => `${key.slice(0, 7)}-01`
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 10)
}
export const monthEnd = (month) => {
  const next = new Date(`${addMonths(month, 1)}T12:00:00Z`)
  next.setUTCDate(0)
  return next.toISOString().slice(0, 10)
}
export function monthLabel(month, locale, short) {
  if (!month) return ''
  return new Intl.DateTimeFormat(locale, { month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month.slice(0, 10)}T12:00:00Z`))
}
export function dayLabelShort(day, locale) {
  if (!day) return ''
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.slice(0, 10)}T12:00:00Z`))
}
// Money typed by people: digits and one dot, at most two decimals.
export const cleanAmount = (v) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').replace(/(\.\d{2})\d+$/, '$1')
// Plain amount without the currency, for tight ledger columns.
export const amt = (v, locale) => (num(v) === 0 ? '—' : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(v)))

export const ACCOUNT_TYPE = {
  asset: { ar: 'أصول', en: 'Assets', one: { ar: 'أصل', en: 'Asset' } },
  liability: { ar: 'التزامات', en: 'Liabilities', one: { ar: 'التزام', en: 'Liability' } },
  equity: { ar: 'حقوق الملكية', en: 'Equity', one: { ar: 'حقوق ملكية', en: 'Equity' } },
  income: { ar: 'إيرادات', en: 'Income', one: { ar: 'إيراد', en: 'Income' } },
  expense: { ar: 'مصروفات', en: 'Expenses', one: { ar: 'مصروف', en: 'Expense' } },
}
export const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense']

// Where an entry came from
export const SOURCE = {
  invoice: { ar: 'فاتورة', en: 'Invoice', icon: 'clipboard', group: 'billing' },
  invoice_void: { ar: 'إلغاء فاتورة', en: 'Invoice voided', icon: 'x', group: 'billing' },
  package_use: { ar: 'جلسة من باقة', en: 'Package session', icon: 'package', group: 'billing' },
  package_use_void: { ar: 'إلغاء جلسة باقة', en: 'Package session voided', icon: 'package', group: 'billing' },
  package_done: { ar: 'باقة اكتملت', en: 'Package used up', icon: 'package', group: 'billing' },
  package_cancel: { ar: 'إلغاء باقة', en: 'Package cancelled', icon: 'package', group: 'billing' },
  receipt: { ar: 'إيصال تحصيل', en: 'Receipt', icon: 'cash', group: 'billing' },
  credit_void: { ar: 'رصيد من فاتورة ملغاة', en: 'Credit from a void', icon: 'award', group: 'billing' },
  refund: { ar: 'استرداد', en: 'Refund', icon: 'refresh', group: 'billing' },
  shift: { ar: 'إقفال وردية', en: 'Shift closed', icon: 'calculator', group: 'billing' },
  lab_case: { ar: 'حالة معمل', en: 'Lab case', icon: 'layers', group: 'labs' },
  expense: { ar: 'مصروف', en: 'Expense', icon: 'briefcase', group: 'expenses' },
  expense_void: { ar: 'إلغاء مصروف', en: 'Expense voided', icon: 'x', group: 'expenses' },
  transfer: { ar: 'تحويل', en: 'Transfer', icon: 'swap', group: 'money' },
  settlement: { ar: 'تسوية بطاقات/تحويلات', en: 'Settlement', icon: 'swap', group: 'money' },
  payout: { ar: 'صرف مستحقات طبيب', en: 'Doctor payout', icon: 'stethoscope', group: 'doctors' },
  lab_payment: { ar: 'دفعة لمعمل', en: 'Lab payment', icon: 'layers', group: 'labs' },
  stock_receipt: { ar: 'استلام بضاعة', en: 'Goods received', icon: 'download', group: 'stock' },
  stock_use: { ar: 'صرف مستهلكات', en: 'Stock used', icon: 'box', group: 'stock' },
  stock_loss: { ar: 'إعدام مخزون', en: 'Stock written off', icon: 'x', group: 'stock' },
  stock_count: { ar: 'فروق جرد', en: 'Count differences', icon: 'clipboard', group: 'stock' },
  transfer_out: { ar: 'تحويل مخزون (إرسال)', en: 'Stock transfer sent', icon: 'truck', group: 'stock' },
  transfer_in: { ar: 'تحويل مخزون (استلام)', en: 'Stock transfer received', icon: 'download', group: 'stock' },
  supplier_return: { ar: 'مرتجع لمورد', en: 'Return to supplier', icon: 'refresh', group: 'stock' },
  supplier_payment: { ar: 'دفعة لمورد', en: 'Supplier payment', icon: 'truck', group: 'stock' },
  maintenance: { ar: 'صيانة جهاز', en: 'Device maintenance', icon: 'wrench', group: 'stock' },
  manual: { ar: 'قيد يدوي', en: 'Manual entry', icon: 'pen', group: 'manual' },
  reversal: { ar: 'قيد عكسي', en: 'Reversal', icon: 'refresh', group: 'manual' },
}
export const GROUPS = {
  '': { ar: 'الكل', en: 'All' },
  billing: { ar: 'الفوترة', en: 'Billing' },
  expenses: { ar: 'المصروفات', en: 'Expenses' },
  money: { ar: 'الخزينة والبنك', en: 'Cash & bank' },
  doctors: { ar: 'الأطباء', en: 'Doctors' },
  labs: { ar: 'المعامل', en: 'Labs' },
  stock: { ar: 'المخازن والموردون', en: 'Stock & suppliers' },
  manual: { ar: 'يدوية', en: 'Manual' },
}

// Entries posted on their own carry an English memo built from a fixed template; say the same thing in Arabic.
// Text people typed (manual entries, reasons, notes, expense descriptions) is shown as written.
const METHOD_AR = { cash: 'نقدًا', card: 'بطاقة', instapay: 'إنستاباي', wallet: 'محفظة', bank_transfer: 'تحويل بنكي' }
const MEMO_AR = [
  [/^Invoice (\S+) issued$/, (m) => `إصدار الفاتورة ${m[1]}`],
  [/^Invoice (\S+) voided$/, (m) => `إلغاء الفاتورة ${m[1]}`],
  [/^Package (\S+): session used \((\S+)\)$/, (m) => `الباقة ${m[1]}: استخدام جلسة (${m[2]})`],
  [/^Session given back: invoice (\S+) voided$/, (m) => `إرجاع جلسة للباقة: أُلغيت الفاتورة ${m[1]}`],
  [/^Package (\S+) fully used$/, (m) => `اكتملت الباقة ${m[1]}`],
  [/^Package (\S+) cancelled$/, (m) => `إلغاء الباقة ${m[1]}`],
  [/^Receipt (\S+) for (\S+)$/, (m) => `الإيصال ${m[1]} عن الفاتورة ${m[2]}`],
  [/^Receipt (\S+) \(deposit to credit\)$/, (m) => `الإيصال ${m[1]} (إيداع في رصيد المريض)`],
  [/^Paid on voided (\S+) kept as credit$/, (m) => `المدفوع على الفاتورة الملغاة ${m[1]} أصبح رصيدًا للمريض`],
  [/^Refund (\S+) paid \((\w+)\)$/, (m) => `صرف الاسترداد ${m[1]} (${METHOD_AR[m[2]] || m[2]})`],
  [/^Shift (\S+): cash (over|short) — ([\s\S]*)$/, (m) => `الوردية ${m[1]}: ${m[2] === 'over' ? 'زيادة' : 'عجز'} نقدية${m[3] ? ` — ${m[3]}` : ''}`],
  [/^Lab work (\S+) received from (.+)$/, (m) => `استلام عمل المعمل ${m[1]} من ${m[2]}`],
  [/^Expense (\S+) voided: ([\s\S]*)$/, (m) => `إلغاء المصروف ${m[1]}: ${m[2]}`],
  [/^Settlement of (\d+) (\w+) payments into .+$/, (m) => `تسوية ${m[1]} دفعة (${METHOD_AR[m[2]] || m[2]}) مع البنك`],
  [/^Doctor payout (\S+) for (\S+)$/, (m) => `صرف مستحقات الطبيب ${m[1]} عن ${m[2]}`],
  [/^Payment to (.+) \(bill (.+)\)$/, (m) => `دفعة إلى ${m[1]} (فاتورة ${m[2]})`],
  [/^Payment to (.+)$/, (m) => `دفعة إلى ${m[1]}`],
  [/^Goods received from (.+)$/, (m) => `استلام بضاعة من ${m[1]}`],
  [/^Stock used: ([\s\S]+)$/, (m) => `صرف مستهلكات: ${m[1]}`],
  [/^Stock written off \(([^)]*)\): ([\s\S]+)$/, (m) => `إعدام مخزون (${m[1]}): ${m[2]}`],
  [/^Stock count (\S+) differences \((.+)\)$/, (m) => `فروق الجرد ${m[1]} (${m[2]})`],
  [/^Maintenance \((\w+)\) of (.+?): ([\s\S]*)$/, (m) => `${m[1] === 'repair' ? 'إصلاح' : 'صيانة دورية'} ${m[2]}: ${m[3]}`],
  [/^Reversal of (\S+): ([\s\S]*)$/, (m) => `عكس القيد ${m[1]}: ${m[2]}`],
]
export function memoText(e, lang) {
  const memo = e?.memo || ''
  if (lang !== 'ar' || e?.source_type === 'manual') return memo
  // "<category>: <description>" and "<from> → <to>: <note>": the accounts are shown beside it, keep what was typed.
  if (e?.source_type === 'expense') return memo.replace(/^[^:]+:\s*/, '')
  if (e?.source_type === 'transfer') {
    const note = memo.match(/^.+? → .+?: ([\s\S]+)$/)
    return note ? `تحويل: ${note[1]}` : 'تحويل بين الحسابات'
  }
  for (const [re, fn] of MEMO_AR) {
    const m = memo.match(re)
    if (m) return fn(m)
  }
  return memo
}

export function SourceChip({ type }) {
  const { lang } = useI18n()
  const s = SOURCE[type]
  return <span className={`src-chip g-${s?.group || 'manual'}`}><Icon name={s?.icon || 'pen'} size={12} />{s?.[lang] || type}</span>
}

export const PAYOUT_STATE = {
  prepared: { ar: 'بانتظار اعتماد الإدارة', en: 'Awaiting approval', tone: 'warn' },
  approved: { ar: 'معتمد — جاهز للصرف', en: 'Approved — ready to pay', tone: 'gold' },
  rejected: { ar: 'مرفوض', en: 'Rejected', tone: 'danger' },
  paid: { ar: 'صُرف', en: 'Paid', tone: 'success' },
}
export const PERIOD_STATE = {
  open: { ar: 'مفتوح', en: 'Open', tone: 'info' },
  close_requested: { ar: 'بانتظار اعتماد الإقفال', en: 'Close requested', tone: 'warn' },
  closed: { ar: 'مُقفل', en: 'Closed', tone: 'success' },
}
export const EXPENSE_STATE = {
  posted: { ar: 'مُسجّل', en: 'Posted', tone: 'success' },
  void: { ar: 'ملغى', en: 'Void', tone: 'danger' },
}

export function State({ state, map }) {
  const { lang } = useI18n()
  const s = map[state]
  return s ? <Badge tone={s.tone}>{s[lang]}</Badge> : null
}

// What to look at before closing a month
export function checkText(c, tx, locale) {
  switch (c.code) {
    case 'open_shifts': return tx(`${c.count} وردية ما زالت مفتوحة — يجب إقفالها أولًا`, `${c.count} cashier shift(s) still open — close them first`)
    case 'earlier_open': return tx(`شهر ${monthLabel(c.month, locale)} لم يُقفل بعد — الأشهر تُقفل بالترتيب`, `${monthLabel(c.month, locale)} isn't closed yet — months close in order`)
    case 'draft_invoices': return tx(`${c.count} فاتورة مسودة أو بانتظار اعتماد`, `${c.count} draft or pending invoice(s)`)
    case 'unsettled': return tx(`${c.count} دفعة بطاقة/تحويل لم تُسوَّ مع البنك (${money(c.amount, locale)})`, `${c.count} card / transfer payment(s) not settled with the bank (${money(c.amount, locale)})`)
    case 'payouts_missing': return tx(`${c.count} طبيب له مستحقات بلا كشف صرف`, `${c.count} doctor(s) with shares but no payout prepared`)
    default: return c.code
  }
}

export function Checks({ checks }) {
  const { tx, locale } = useI18n()
  if (!checks?.length) return <span className="ok-text"><Icon name="checkCircle" size={15} />{tx('لا ملاحظات', 'Nothing to check')}</span>
  return (
    <ul className="close-checks">
      {checks.map((c) => (
        <li key={c.code} className={`lv-${c.level}`}><Icon name={c.level === 'block' ? 'lock' : 'alert'} size={14} />{checkText(c, tx, locale)}</li>
      ))}
    </ul>
  )
}

// Link to the record behind a journal entry
export function SourceLink({ entry }) {
  const { dash, base, can } = useAccounting()
  const link = entry.link
  if (!link) return <span className="mrn">{entry.source_ref}</span>
  const billing = can('billing.view') || can('billing.approve')
  const stock = can('inventory.view')
  const to = {
    invoice: billing && `${dash}/billing/invoices/${link.id}`,
    receipt: billing && `${dash}/billing/receipts/${link.id}/print`,
    shift: billing && `${dash}/billing/shifts/${link.id}`,
    patient: billing && `${dash}/billing/patients/${link.id}`,
    expense: `${base}/expenses?q=${encodeURIComponent(entry.source_ref || '')}`,
    payout: `${base}/payouts/${link.id}`,
    order: stock && `${dash}/inventory/orders/${link.id}`,
    supplier: stock && `${dash}/inventory/suppliers/${link.id}`,
    count: stock && `${dash}/inventory/counts/${link.id}`,
    device: stock && `${dash}/inventory/devices/${link.id}`,
    stock_moves: stock && `${dash}/inventory/moves?q=${encodeURIComponent(entry.source_ref || '')}`,
  }[link.kind]
  return to ? <Link to={to} className="mrn">{entry.source_ref}<Icon name="arrowRight" size={12} /></Link> : <span className="mrn">{entry.source_ref}</span>
}

// Accounts as select options, grouped label "1120 · Bank"
export const accountLabel = (a, pick) => `${a.code} · ${pick(a)}`
// Money that can pay a bill (bank, petty cash): not the cashier's drawer, not money still with the card provider.
export const payingAccounts = (o) => o.accounts.filter((a) => a.is_money && a.is_active && a.system_key !== 'cash_drawer' && !o.clearing.includes(a.system_key))
// Money that can be moved by a transfer: the drawer too.
export const transferAccounts = (o) => o.accounts.filter((a) => a.is_money && a.is_active && !o.clearing.includes(a.system_key))
export const accountOptions = (list, pick) => list.map((a) => ({ value: String(a.id), label: accountLabel(a, pick) }))

// ---------- export ----------
// CSV with a BOM so Excel opens Arabic correctly.
export function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const text = `﻿${rows.map((r) => r.map(esc).join(',')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function MonthPicker({ value, onChange, max, label }) {
  const { tx, locale } = useI18n()
  const atMax = max && value >= max
  return (
    <div className="month-picker" role="group" aria-label={label || tx('الشهر', 'Month')}>
      <button type="button" className="btn btn-quiet btn-icon" onClick={() => onChange(addMonths(value, -1))} aria-label={tx('الشهر السابق', 'Previous month')}>
        <Icon name="chevronLeft" size={18} />
      </button>
      <strong>{monthLabel(value, locale)}</strong>
      <button type="button" className="btn btn-quiet btn-icon" disabled={atMax} onClick={() => onChange(addMonths(value, 1))} aria-label={tx('الشهر التالي', 'Next month')}>
        <Icon name="chevronRight" size={18} />
      </button>
    </div>
  )
}
