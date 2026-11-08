import { useParams } from 'react-router-dom'
import PageLoader from '../PageLoader'
import { LogoMark } from '../Logo'
import { ErrorState } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtDate, fmtDateTime, fmtPhone } from '../../lib/format'
import { PrintBar } from '../visits/RxSheet'
import { myBillingApi } from '../../api/billing'
import { useAuth } from '../../auth/AuthContext'
import { INSTALLMENT_STATE, METHODS, money, num, useBilling } from './meta'

function Letterhead({ doc, title, refNo, branch }) {
  const { tx, pick } = useI18n()
  return (
    <header className="rx-letterhead">
      <LogoMark size={46} />
      <div className="rx-clinic">
        <strong>{tx('عيادات جولدن كير', 'Golden Care Clinics')}</strong>
        <span>{pick(branch, 'branch_name') || tx('مدينة الشروق', 'Madinat El Shorouk')}</span>
        {pick(branch, 'branch_address') && <small>{pick(branch, 'branch_address')}</small>}
      </div>
      <div className="rx-doctor">
        <strong>{title}</strong>
        {refNo && <span className="mrn">{refNo}</span>}
        {doc && <small><bdi>{doc}</bdi></small>}
      </div>
    </header>
  )
}

// The invoice on the clinic letterhead (A5): lines, discount, VAT, payments and the installment schedule.
export function InvoiceSheet({ inv, lines, installments = [], receipts = [] }) {
  const { tx, lang, pick, locale } = useI18n()
  const isVoid = inv.status === 'void'
  return (
    <article className={`rx-sheet inv-sheet ${isVoid ? 'is-void' : ''}`} aria-label={tx('فاتورة', 'Invoice')}>
      <Letterhead branch={inv} title={tx('فاتورة', 'Invoice')} refNo={inv.ref} doc={fmtDate(inv.issued_at || inv.created_at, locale)} />
      {isVoid && <div className="void-stamp" aria-hidden="true">{tx('ملغاة', 'VOID')}</div>}
      <dl className="rx-patient">
        <div><dt>{tx('المريض', 'Patient')}</dt><dd>{pick(inv, 'patient_name')}</dd></div>
        <div><dt>{tx('رقم الملف', 'File no.')}</dt><dd className="mrn">{inv.mrn}</dd></div>
        <div><dt>{tx('الموبايل', 'Mobile')}</dt><dd><bdi className="ltr">{fmtPhone(inv.patient_phone)}</bdi></dd></div>
        <div><dt>{tx('الحالة', 'Status')}</dt><dd>{isVoid ? tx('ملغاة', 'Void') : num(inv.balance) <= 0 ? tx('مدفوعة', 'Paid') : num(inv.paid_total) > 0 ? tx('مدفوعة جزئيًا', 'Partly paid') : tx('غير مدفوعة', 'Unpaid')}</dd></div>
      </dl>
      <div className="rx-body inv-body">
        <table className="inv-print-table">
          <thead><tr><th>#</th><th>{tx('البيان', 'Description')}</th><th className="num">{tx('الكمية', 'Qty')}</th><th className="num">{tx('السعر', 'Price')}</th><th className="num">{tx('الإجمالي', 'Amount')}</th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="num">{i + 1}</td>
                <td>{l[`name_${lang}`]}{l.doctor_name_en && <small>{pick(l, 'doctor_name')}</small>}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{l.kind === 'package_use' ? tx('مدفوعة', 'prepaid') : money(l.unit_price, locale)}</td>
                <td className="num">{money(num(l.unit_price) * l.qty, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="inv-print-totals">
          <div><dt>{tx('الإجمالي قبل الخصم', 'Subtotal')}</dt><dd className="num">{money(inv.subtotal, locale)}</dd></div>
          {num(inv.discount_amount) > 0 && <div><dt>{tx('خصم', 'Discount')}</dt><dd className="num">− {money(inv.discount_amount, locale)}</dd></div>}
          {num(inv.vat_total) > 0 && <div><dt>{tx('ضريبة القيمة المضافة', 'VAT')}</dt><dd className="num">{money(inv.vat_total, locale)}</dd></div>}
          <div className="grand"><dt>{tx('الإجمالي المستحق', 'Total')}</dt><dd className="num">{money(inv.total, locale)}</dd></div>
          <div><dt>{tx('المدفوع', 'Paid')}</dt><dd className="num">{money(inv.paid_total, locale)}</dd></div>
          {!isVoid && <div className="bal"><dt>{tx('المتبقي', 'Balance')}</dt><dd className="num">{money(inv.balance, locale)}</dd></div>}
        </dl>
        {installments.length > 0 && (
          <>
            <h3 className="inv-print-h">{tx('جدول الأقساط', 'Installment schedule')}</h3>
            <table className="inv-print-table compact">
              <tbody>
                {installments.map((r) => (
                  <tr key={r.seq}>
                    <td>{r.seq === 0 ? tx('مقدم', 'Down payment') : tx(`قسط ${r.seq}`, `Installment ${r.seq}`)}</td>
                    <td><bdi>{fmtDate(r.due_on, locale)}</bdi></td>
                    <td className="num">{money(r.amount, locale)}</td>
                    <td>{INSTALLMENT_STATE[r.state]?.[lang]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {receipts.length > 0 && (
          <p className="inv-print-pay">
            {tx('المدفوعات:', 'Payments:')} {receipts.map((r) => `${r.ref} (${money(r.applied, locale)})`).join(' · ')}
          </p>
        )}
      </div>
      <footer className="rx-foot">
        <div><small>{tx('أصدرها', 'Issued by')}: {pick(inv, 'issued_by') || '—'}</small>{inv.eta_status === 'not_sent' || !inv.eta_status ? null : <small>ETA: {inv.eta_status}</small>}</div>
        <div className="rx-meta">
          <small>{inv.issued_at && <bdi>{fmtDateTime(inv.issued_at, locale)}</bdi>}</small>
          <small>{lang === 'ar' ? 'نرعاك لحياة أفضل' : 'Caring for a better life'}</small>
        </div>
      </footer>
    </article>
  )
}

// The 80 mm thermal receipt.
export function ReceiptSlip({ r, note }) {
  const { tx, lang, pick, locale } = useI18n()
  return (
    <article className="receipt-80" aria-label={tx('إيصال استلام نقدية', 'Payment receipt')}>
      <header>
        <LogoMark size={34} />
        <strong>{tx('عيادات جولدن كير', 'Golden Care Clinics')}</strong>
        <small>{pick(r, 'branch_name')}</small>
        {pick(r, 'branch_address') && <small>{pick(r, 'branch_address')}</small>}
      </header>
      <h1>{tx('إيصال استلام', 'Receipt')}</h1>
      <dl className="r80-meta">
        <div><dt>{tx('رقم', 'No.')}</dt><dd className="mrn">{r.ref}</dd></div>
        <div><dt>{tx('التاريخ', 'Date')}</dt><dd><bdi>{fmtDateTime(r.created_at, locale)}</bdi></dd></div>
        <div><dt>{tx('المريض', 'Patient')}</dt><dd>{pick(r, 'patient_name')}</dd></div>
        <div><dt>{tx('الملف', 'File')}</dt><dd className="mrn">{r.mrn}</dd></div>
        {r.invoice_ref && <div><dt>{tx('الفاتورة', 'Invoice')}</dt><dd className="mrn">{r.invoice_ref}</dd></div>}
      </dl>
      <hr />
      <ul className="r80-pay">
        {r.payments.map((p, i) => (
          <li key={i}><span>{METHODS[p.method]?.[lang] || p.method}{p.reference && <small dir="ltr">#{p.reference}</small>}</span><span className="num">{money(p.amount, locale)}</span></li>
        ))}
      </ul>
      <div className="r80-total"><span>{tx('الإجمالي', 'Total')}</span><strong className="num">{money(r.total, locale)}</strong></div>
      <hr />
      <dl className="r80-meta">
        {r.invoice_ref && <div><dt>{tx('على الفاتورة', 'To invoice')}</dt><dd className="num">{money(r.applied, locale)}</dd></div>}
        {num(r.to_credit) > 0 && <div><dt>{tx('للرصيد', 'To credit')}</dt><dd className="num">{money(r.to_credit, locale)}</dd></div>}
        {r.invoice_ref && <div><dt>{tx('باقي الفاتورة', 'Invoice balance')}</dt><dd className="num">{money(r.invoice_balance, locale)}</dd></div>}
        {r.credit_balance !== undefined && <div><dt>{tx('رصيدك', 'Your credit')}</dt><dd className="num">{money(r.credit_balance, locale)}</dd></div>}
      </dl>
      {r.note && <p className="r80-note">{r.note}</p>}
      <footer>
        {r.received_by_en && <small>{tx('استلم', 'Received by')}: {pick(r, 'received_by')}{r.shift_ref && <> · {r.shift_ref}</>}</small>}
        {note && <p>{note}</p>}
        <small>{lang === 'ar' ? 'نرعاك لحياة أفضل' : 'Caring for a better life'}</small>
      </footer>
    </article>
  )
}

export function InvoicePrint() {
  const { id } = useParams()
  const { tx } = useI18n()
  const { api, bill } = useBilling()
  const { data, error, reload } = useAsync(() => api.invoice(id), [id, api])
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  return (
    <div className="page print-page">
      <PrintBar back={`${bill}/invoices/${id}`} label={tx('الرجوع للفاتورة', 'Back to the invoice')} />
      <InvoiceSheet inv={data.invoice} lines={data.lines} installments={data.installments} receipts={data.receipts} />
    </div>
  )
}

export function ReceiptPrint() {
  const { id } = useParams()
  const { tx } = useI18n()
  const { api, bill } = useBilling()
  const { data, error, reload } = useAsync(() => Promise.all([api.receipt(id), api.rules().catch(() => null)]), [id, api])
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const [r, rules] = data
  const back = r.invoice_id ? `${bill}/invoices/${r.invoice_id}` : `${bill}/patients/${r.patient_id}`
  return (
    <div className="page print-page receipt-page">
      <PrintBar back={back} label={r.invoice_id ? tx('الرجوع للفاتورة', 'Back to the invoice') : tx('حساب المريض', 'Patient account')} />
      <ReceiptSlip r={r} note={rules && (tx(rules.receipt_note_ar, rules.receipt_note_en) || rules.receipt_note_ar || rules.receipt_note_en)} />
    </div>
  )
}

// Patient portal: their own receipts and invoices.
export function MyReceiptPrint() {
  const { id } = useParams()
  const { tx } = useI18n()
  const { data, error, reload } = useAsync(() => myBillingApi.receipt(id), [id])
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  return (
    <div className="page print-page receipt-page">
      <PrintBar back="/dashboard/patient/bills" label={tx('فواتيري', 'My bills')} />
      <ReceiptSlip r={data} />
    </div>
  )
}

export function MyInvoicePrint() {
  const { id } = useParams()
  const { tx } = useI18n()
  const { me } = useAuth()
  const { data, error, reload } = useAsync(() => myBillingApi.overview(), [me?.id])
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const inv = data.invoices.find((i) => String(i.id) === id)
  if (!inv) return <ErrorState error={{ code: 'not_found' }} />
  return (
    <div className="page print-page">
      <PrintBar back="/dashboard/patient/bills" label={tx('فواتيري', 'My bills')} />
      <InvoiceSheet inv={inv} lines={inv.lines} installments={inv.installments} />
    </div>
  )
}
