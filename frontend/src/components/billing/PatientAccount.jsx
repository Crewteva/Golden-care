import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import PageLoader from '../PageLoader'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, EmptyState, ErrorState, PageHeader } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { fmtDate, fmtDateTime, fmtPhone } from '../../lib/format'
import PaymentModal from './PaymentModal'
import {
  CREDIT_REASON, InvoiceBadge, METHODS, Methods, PACKAGE_STATE, REFUND_STATE, StateBadge, cleanAmount, money, num, useBilling,
} from './meta'

const TABS = ['invoices', 'packages', 'credit', 'receipts']

// A patient's money in one place: what they owe, their credit, packages and everything waiting to be billed.
export default function PatientAccount() {
  const { id } = useParams()
  const { t, tx, lang, pick, locale } = useI18n()
  const { api, bill } = useBilling()
  const toast = useToast()
  const navigate = useNavigate()
  const { data, error, reload } = useAsync(() => api.account(id), [id, api])
  const [tab, setTab] = useState('invoices')
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(null)

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const { patient: p, can } = data
  const activePk = data.packages.filter((k) => k.state === 'active')
  const openRefunds = data.refunds.filter((r) => ['requested', 'approved'].includes(r.status))

  const newInvoice = async (appointmentId) => {
    setBusy(appointmentId || 'new')
    try {
      const res = await api.createInvoice({ patient_id: p.id, appointment_id: appointmentId || null })
      navigate(`${bill}/invoices/${res.invoice.id}`)
    } catch (err) {
      if (err.code === 'already_invoiced' && err.data?.invoice_id) navigate(`${bill}/invoices/${err.data.invoice_id}`)
      else toast.error(errorText(err, t))
      setBusy(null)
    }
  }

  return (
    <div className="page reveal">
      <PageHeader eyebrow={<><span className="mrn">{p.mrn}</span>{p.phone && <> · <bdi className="ltr">{fmtPhone(p.phone)}</bdi></>}</>}
        title={pick(p, 'full_name')} description={tx('الحساب المالي للمريض', "The patient's account")}
        actions={<>
          {can.collect && <Button variant="ghost" icon="plus" onClick={() => setModal('deposit')}>{tx('إيداع مقدم', 'Deposit')}</Button>}
          {can.invoice && <Button icon="plusSquare" loading={busy === 'new'} onClick={() => newInvoice(null)}>{tx('فاتورة جديدة', 'New invoice')}</Button>}
        </>} />

      <div className="acct-stats">
        <div className={`acct-stat ${num(data.owed) > 0 ? 'owed' : ''}`}>
          <small>{tx('مستحق على المريض', 'Owed')}</small><strong className="num">{money(data.owed, locale)}</strong>
          <span className="muted">{tx(`${data.invoices.filter((i) => i.status === 'issued' && num(i.balance) > 0).length} فواتير مفتوحة`, `${data.invoices.filter((i) => i.status === 'issued' && num(i.balance) > 0).length} open invoices`)}</span>
        </div>
        <div className={`acct-stat ${num(data.credit_balance) > 0 ? 'credit' : ''}`}>
          <small>{tx('رصيد دائن', 'Credit')}</small><strong className="num">{money(data.credit_balance, locale)}</strong>
          {num(data.credit_balance) > 0 && (can.collect || can.approve)
            ? <button type="button" className="link-btn" onClick={() => setModal('refund')}>{tx('طلب استرداد', 'Request a refund')}</button>
            : <span className="muted">{tx('يُستخدم في أي فاتورة', 'Usable on any invoice')}</span>}
        </div>
        <div className="acct-stat">
          <small>{tx('باقات سارية', 'Active packages')}</small><strong className="num">{activePk.length}</strong>
          <span className="muted">{tx(`${activePk.reduce((s, k) => s + k.remaining, 0)} جلسة متبقية`, `${activePk.reduce((s, k) => s + k.remaining, 0)} sessions left`)}</span>
        </div>
      </div>

      {openRefunds.length > 0 && (
        <Alert tone="info" title={tx('استرداد قيد التنفيذ', 'Refund in progress')}>
          {openRefunds.map((r) => <span key={r.id} style={{ display: 'block' }}><span className="mrn">{r.ref}</span> · {money(r.amount, locale)} · {METHODS[r.method][lang]} — {REFUND_STATE[r.status][lang]}</span>)}
        </Alert>
      )}

      {(data.unbilled.length > 0 || data.to_bill.length > 0) && (
        <section className="card to-bill">
          <div className="card-head"><div><h2>{tx('بانتظار الفوترة', 'Waiting to be billed')}</h2>
            <p className="muted" style={{ fontSize: '.86rem' }}>{tx('زيارات حضرها المريض وبنود خطط علاج تمت ولم تُفوتر بعد.', 'Visits the patient attended and treatment plan items done but not billed yet.')}</p></div></div>
          <ul className="desk-list">
            {data.unbilled.map((a) => (
              <li key={a.id} className="desk-row bill-unbilled">
                <span className="desk-time"><bdi className="num">{fmtDate(a.starts_at, locale)}</bdi><small className="mrn">{a.ref}</small></span>
                <div className="desk-who"><strong>{pick(a, 'doctor_name')}</strong>
                  <small className="desk-services">{a.services.map((s) => s[`name_${lang}`]).join(' · ') || tx('بدون خدمات محددة', 'No services booked')}</small></div>
                <div className="desk-money"><strong className="num muted-num">{money(a.booked_total, locale)}</strong><small className="muted">{tx('حسب الحجز', 'as booked')}</small></div>
                <span />
                <div className="desk-act">{can.invoice && <Button size="sm" icon="plus" loading={busy === a.id} onClick={() => newInvoice(a.id)}>{tx('فاتورة', 'Invoice')}</Button>}</div>
              </li>
            ))}
            {data.to_bill.map((i) => (
              <li key={`p${i.id}`} className="desk-row bill-unbilled">
                <span className="desk-time"><bdi className="num">{fmtDate(i.done_at, locale)}</bdi><small className="mrn">{i.plan_ref}</small></span>
                <div className="desk-who"><strong>{i[`name_${lang}`]}{i.tooth ? ` #${i.tooth}` : ''}</strong><small className="muted">{i.plan_title}</small></div>
                <div className="desk-money"><strong className="num">{money(i.price, locale)}</strong><small className="muted">{tx('بند خطة', 'plan item')}</small></div>
                <span /><span className="muted desk-act" style={{ fontSize: '.8rem' }}>{tx('يُضاف تلقائيًا لأي فاتورة جديدة', 'Added to the next new invoice')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('أقسام الحساب', 'Account sections')}>
            {TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {{ invoices: tx('الفواتير', 'Invoices'), packages: tx('الباقات', 'Packages'), credit: tx('حركة الرصيد', 'Credit ledger'), receipts: tx('الإيصالات', 'Receipts') }[k]}
                <span className="tab-count num">{{ invoices: data.invoices.length, packages: data.packages.length, credit: data.credit.length, receipts: data.receipts.length }[k]}</span>
              </button>
            ))}
          </div>
        </div>

        {tab === 'invoices' && (!data.invoices.length ? <EmptyState icon="clipboard" title={tx('لا توجد فواتير', 'No invoices yet')} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tx('الفاتورة', 'Invoice')}</th><th>{tx('التاريخ', 'Date')}</th><th>{tx('الحالة', 'Status')}</th><th className="num">{tx('الإجمالي', 'Total')}</th><th className="num">{tx('المتبقي', 'Balance')}</th></tr></thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id}>
                    <td><Link to={`${bill}/invoices/${i.id}`} className="mrn">{i.ref || tx('مسودة', 'Draft')}</Link></td>
                    <td><bdi>{fmtDate(i.issued_at || i.created_at, locale)}</bdi></td>
                    <td><InvoiceBadge invoice={i} /></td>
                    <td className="num">{money(i.total, locale)}</td>
                    <td className="num">{i.status === 'issued' ? <span className={num(i.balance) > 0 ? 'neg' : ''}>{money(i.balance, locale)}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {tab === 'packages' && (!data.packages.length ? <EmptyState icon="package" title={tx('لم يشترِ المريض باقات', 'No packages bought')}>{tx('تُباع الباقة كبند في أي فاتورة.', 'A package is sold as a line on any invoice.')}</EmptyState> : (
          <ul className="pk-list">
            {data.packages.map((k) => (
              <li key={k.id} className={`pk-item s-${k.state}`}>
                <div className="pk-main">
                  <strong>{k[`name_${lang}`]}</strong>
                  <small className="muted"><span className="mrn">{k.ref}</span> · {k[`service_name_${lang}`]} · <Link to={`${bill}/invoices/${k.invoice_id}`}>{k.invoice_ref}</Link></small>
                  <div className="pk-meter" role="img" aria-label={tx(`استُخدم ${k.used} من ${k.sessions_total}`, `${k.used} of ${k.sessions_total} used`)}>
                    {Array.from({ length: k.sessions_total }, (_, n) => <span key={n} className={n < k.used ? 'used' : ''} />)}
                  </div>
                  <small className="muted">{tx(`استُخدم ${k.used} من ${k.sessions_total}`, `${k.used} of ${k.sessions_total} used`)}{k.expires_on && <> · {tx('حتى', 'valid until')} <bdi>{fmtDate(k.expires_on, locale)}</bdi></>}</small>
                </div>
                <div className="pk-side">
                  <StateBadge state={k.state} map={PACKAGE_STATE} />
                  <span className="num">{money(k.price_paid, locale)}</span>
                  {k.state === 'active' && (can.invoice || can.approve) && <Button variant="quiet" size="sm" onClick={() => setModal({ cancelPk: k })}>{tx('إلغاء الباقة', 'Cancel package')}</Button>}
                </div>
              </li>
            ))}
          </ul>
        ))}

        {tab === 'credit' && (!data.credit.length ? <EmptyState icon="award" title={tx('لا توجد حركة رصيد', 'No credit movements')}>{tx('الدفع الزائد والإيداعات تُضاف هنا.', 'Overpayments and deposits are added here.')}</EmptyState> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tx('التاريخ', 'Date')}</th><th>{tx('الحركة', 'Movement')}</th><th>{tx('بواسطة', 'By')}</th><th className="num">{tx('المبلغ', 'Amount')}</th></tr></thead>
              <tbody>
                {data.credit.map((c) => (
                  <tr key={c.id}>
                    <td><bdi>{fmtDateTime(c.created_at, locale)}</bdi></td>
                    <td>{CREDIT_REASON[c.reason]?.[lang] || c.reason}{c.note && <small className="muted" style={{ display: 'block' }}>{c.note}</small>}</td>
                    <td>{pick(c, 'by')}</td>
                    <td className={`num ${num(c.amount) < 0 ? 'neg' : 'pos'}`}>{num(c.amount) > 0 ? '+' : ''}{money(c.amount, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {tab === 'receipts' && (!data.receipts.length ? <EmptyState icon="cash" title={tx('لا توجد إيصالات', 'No receipts')} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tx('الإيصال', 'Receipt')}</th><th>{tx('التاريخ', 'Date')}</th><th>{tx('الطريقة', 'Method')}</th><th className="num">{tx('المبلغ', 'Amount')}</th><th><span className="sr-only">{tx('طباعة', 'Print')}</span></th></tr></thead>
              <tbody>
                {data.receipts.map((r) => (
                  <tr key={r.id}>
                    <td><span className="mrn">{r.ref}</span><small className="muted" style={{ display: 'block' }}>{r.invoice_ref || tx('إيداع', 'Deposit')}</small></td>
                    <td><bdi>{fmtDateTime(r.created_at, locale)}</bdi></td>
                    <td><Methods payments={r.methods || ''} /></td>
                    <td className="num">{money(r.total, locale)}</td>
                    <td><Link className="btn btn-quiet btn-sm" to={`${bill}/receipts/${r.id}/print`} aria-label={tx(`طباعة ${r.ref}`, `Print ${r.ref}`)}><Icon name="printer" size={16} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      {modal === 'deposit' && <PaymentModal patient={p} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'refund' && <RefundModal patient={p} credit={data.credit_balance} reserved={openRefunds.reduce((s, r) => s + num(r.amount), 0)} canApprove={can.approve}
        onClose={() => setModal(null)} onDone={reload} />}
      {modal?.cancelPk && <CancelPackageModal pk={modal.cancelPk} canApprove={can.approve} onClose={() => setModal(null)} onDone={reload} />}
    </div>
  )
}

function RefundModal({ patient, credit, reserved, canApprove, onClose, onDone }) {
  const { t, tx, lang, pick, locale } = useI18n()
  const { api } = useBilling()
  const toast = useToast()
  const available = Math.max(0, Math.round((num(credit) - reserved) * 100) / 100)
  const [form, setForm] = useState({ amount: String(available), method: 'cash', reason: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: k === 'amount' ? cleanAmount(e.target.value) : e.target.value })
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.requestRefund({ patient_id: patient.id, amount: num(form.amount), method: form.method, reason: form.reason.trim() })
      toast.success(res.status === 'approved' ? tx('اعتُمد الاسترداد وجاهز للصرف من الخزينة.', 'Refund approved and ready to pay at the cashier.') : tx('أُرسل الطلب للإدارة.', 'Request sent to management.'))
      onDone()
      onClose()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const f = error?.fields || {}
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('استرداد من رصيد المريض', 'Refund from patient credit')}
      description={<>{pick(patient, 'full_name')} · {tx('المتاح', 'available')} <span className="num">{money(available, locale)}</span></>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="check" loading={busy} disabled={!num(form.amount) || form.reason.trim().length < 5} onClick={submit}>{canApprove ? tx('اعتماد الاسترداد', 'Approve refund') : tx('إرسال للاعتماد', 'Send for approval')}</Button></>}>
      <div className="form">
        {error && !Object.keys(f).length && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <div className="form-grid">
          <TextField label={tx('المبلغ (ج.م)', 'Amount (EGP)')} value={form.amount} onChange={set('amount')} inputMode="decimal" dir="ltr" inputClassName="num" data-autofocus
            error={fieldText('amount', f.amount, t)} />
          <SelectField label={tx('طريقة الصرف', 'Pay out by')} value={form.method} onChange={set('method')}
            options={['cash', 'card', 'instapay', 'wallet'].map((m) => ({ value: m, label: METHODS[m][lang] }))} />
        </div>
        <TextArea label={tx('السبب', 'Reason')} rows={2} value={form.reason} onChange={set('reason')} error={fieldText('reason', f.reason, t)}
          hint={canApprove ? tx('أنت تعتمد مباشرة؛ يصرفه الكاشير من ورديته.', 'You approve it directly; the cashier pays it from their shift.') : tx('يعتمده المدير ثم يُصرف من الخزينة.', 'A manager approves it, then the cashier pays it out.')} />
      </div>
    </Modal>
  )
}

function CancelPackageModal({ pk, canApprove, onClose, onDone }) {
  const { t, tx, lang, locale } = useI18n()
  const { api } = useBilling()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [refund, setRefund] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const back = Math.max(0, Math.round((num(pk.price_paid) - num(pk.full_price) * pk.used) * 100) / 100)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.cancelPackage(pk.id, { reason: reason.trim(), refund_method: refund || null })
      toast.success(res.status === 'cancelled' ? tx('أُلغيت الباقة.', 'Package cancelled.') : tx('أُرسل الطلب للإدارة.', 'Request sent to management.'))
      onDone()
      onClose()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={canApprove ? tx('إلغاء الباقة', 'Cancel the package') : tx('طلب إلغاء الباقة', 'Ask to cancel the package')}
      description={<>{pk[`name_${lang}`]} · <span className="mrn">{pk.ref}</span></>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={submit}>{canApprove ? tx('إلغاء الباقة', 'Cancel package') : tx('إرسال الطلب', 'Send request')}</Button></>}>
      <div className="form">
        {error && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <dl className="dl calc-dl">
          <dt>{tx('المدفوع في الباقة', 'Paid for the package')}</dt><dd className="num">{money(pk.price_paid, locale)}</dd>
          <dt>{tx(`${pk.used} جلسة مستخدمة × سعر الجلسة المنفردة`, `${pk.used} sessions used × single-session price`)}</dt><dd className="num">− {money(num(pk.full_price) * pk.used, locale)}</dd>
          <dt><strong>{tx('يعود لرصيد المريض', 'Back to patient credit')}</strong></dt><dd className="num"><strong>{money(back, locale)}</strong></dd>
        </dl>
        <TextArea label={tx('السبب', 'Reason')} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
        {back > 0 && (
          <SelectField label={tx('صرف المبلغ للمريض؟', 'Pay it out to the patient?')} value={refund} onChange={(e) => setRefund(e.target.value)}
            options={[{ value: '', label: tx('لا — يبقى رصيدًا', 'No — keep as credit') }, ...['cash', 'card', 'instapay', 'wallet'].map((m) => ({ value: m, label: METHODS[m][lang] }))]} />
        )}
      </div>
    </Modal>
  )
}
