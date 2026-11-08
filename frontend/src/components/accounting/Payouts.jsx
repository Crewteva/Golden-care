import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'
import { LogoMark } from '../Logo'
import {
  MonthPicker, PAYOUT_STATE, State, accountOptions, addMonths, cleanAmount, dayLabelShort, monthLabel, monthStart, money, num,
  payingAccounts, today, useAccounting,
} from './meta'

// Doctors are paid monthly: the accountant prepares each statement once the month is over, management approves, then it's paid.
export default function Payouts() {
  const { tx } = useI18n()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'doctors'
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الحسابات العامة', 'Accounting')} title={tx('مستحقات الأطباء', 'Doctor payouts')}
        description={tx('كشف شهري لكل طبيب: حصته من الفواتير ناقص نصيبه من تكلفة المعمل. يُعدّه المحاسب، تعتمده الإدارة، ثم يُصرف.', 'A monthly statement per doctor: their share of invoices less their part of lab costs. The accountant prepares it, management approves, then it is paid.')} />
      <div className="tabs page-tabs" role="tablist" aria-label={tx('القسم', 'Section')}>
        <button type="button" role="tab" aria-selected={tab === 'doctors'} onClick={() => setParams({}, { replace: true })}>{tx('الأطباء', 'Doctors')}</button>
        <button type="button" role="tab" aria-selected={tab === 'labs'} onClick={() => setParams({ tab: 'labs' }, { replace: true })}>{tx('المعامل', 'Labs')}</button>
      </div>
      {tab === 'labs' ? <Labs /> : <Doctors />}
    </div>
  )
}

function Doctors() {
  const { tx, pick, locale } = useI18n()
  const { api, base, canPost, canApprove } = useAccounting()
  const current = monthStart()
  const [month, setMonth] = useState(addMonths(current, -1))
  const [preparing, setPreparing] = useState(null)
  const [deciding, setDeciding] = useState(null)
  const [paying, setPaying] = useState(null)
  const { data, error, loading, reload } = useAsync(() => api.payouts({ month }), [month, api])
  const options = useAsync(() => api.options(), [api])
  const ended = month < current
  const byDoctor = Object.fromEntries((data?.items || []).filter((p) => p.status !== 'rejected').map((p) => [p.doctor_id, p]))
  const rejected = (data?.items || []).filter((p) => p.status === 'rejected')
  const totals = (data?.due || []).reduce((s, d) => ({ shares: s.shares + num(d.shares), ded: s.ded + num(d.lab_deduction), net: s.net + num(d.net) }), { shares: 0, ded: 0, net: 0 })

  return (
    <>
      <section className="card">
        <div className="toolbar">
          <MonthPicker value={month} onChange={setMonth} max={current} />
          {data && (
            <div className="toolbar-sums">
              <span><small>{tx('الحصص', 'Shares')}</small><strong className="num">{money(totals.shares, locale)}</strong></span>
              <span><small>{tx('خصم المعامل', 'Lab deduction')}</small><strong className="num">{money(totals.ded, locale)}</strong></span>
              <span><small>{tx('الصافي', 'Net')}</small><strong className="num">{money(totals.net, locale)}</strong></span>
            </div>
          )}
        </div>
        {!ended && <div className="card-body" style={{ paddingBottom: 0 }}><Alert tone="info">{tx('الشهر لم ينتهِ بعد: الأرقام تتغير حتى نهايته، والكشف يُعَدّ بعد انتهائه.', "This month isn't over: the figures keep moving until it ends, and statements are prepared after.")}</Alert></div>}
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={5} cols={6} /> : !data.due.length ? (
          <EmptyState icon="stethoscope" title={tx(`لا مستحقات للأطباء في ${monthLabel(month, locale)}`, `No doctor shares in ${monthLabel(month, locale)}`)}>{tx('تظهر الحصص هنا عندما تصدر فواتير بها خدمات لها نسبة طبيب.', 'Shares show here once invoices with doctor-share services are issued.')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tx('الطبيب', 'Doctor')}</th><th className="num">{tx('الحصص', 'Shares')}</th><th className="num">{tx('خصم المعامل', 'Lab deduction')}</th><th className="num">{tx('الصافي', 'Net')}</th><th>{tx('الكشف', 'Statement')}</th><th><span className="sr-only">{tx('إجراء', 'Action')}</span></th></tr></thead>
              <tbody>
                {data.due.map((d) => {
                  const p = byDoctor[d.doctor_id]
                  return (
                    <tr key={d.doctor_id}>
                      <td><strong className="person-name">{pick(d, 'full_name')}</strong></td>
                      <td className="num">{money(d.shares, locale)}</td>
                      <td className="num">{num(d.lab_deduction) ? <span className="neg">− {money(d.lab_deduction, locale)}</span> : '—'}</td>
                      <td className="num"><strong>{money(d.net, locale)}</strong></td>
                      <td>{p ? <><Link to={`${base}/payouts/${p.id}`} className="mrn">{p.ref}</Link> <State state={p.status} map={PAYOUT_STATE} /></> : <span className="muted">{tx('لم يُعَدّ', 'Not prepared')}</span>}</td>
                      <td className="row-actions">
                        {!p && canPost && ended && <Button size="sm" icon="clipboard" onClick={() => setPreparing(d)}>{tx('إعداد الكشف', 'Prepare')}</Button>}
                        {p?.status === 'prepared' && canApprove && <Button size="sm" icon="shieldCheck" onClick={() => setDeciding(p)}>{tx('مراجعة', 'Review')}</Button>}
                        {p?.status === 'approved' && canPost && <Button size="sm" icon="cash" onClick={() => setPaying(p)} disabled={!options.data}>{tx('صرف', 'Pay')}</Button>}
                        {p && <Link to={`${base}/payouts/${p.id}`} className="btn btn-quiet btn-sm"><Icon name="eye" size={15} />{tx('عرض', 'View')}</Link>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {rejected.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>{tx('كشوف مرفوضة هذا الشهر', 'Rejected this month')}</h2></div>
          <ul className="appr-list">
            {rejected.map((p) => (
              <li key={p.id} className="rej-row">
                <Link to={`${base}/payouts/${p.id}`} className="mrn">{p.ref}</Link>
                <span>{pick(p, 'doctor_name')} · {money(p.net, locale)}</span>
                <span className="appr-reason">{p.decision_note}<small className="muted" style={{ display: 'block' }}>{pick(p, 'decided_by')}</small></span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {preparing && <PrepareModal due={preparing} month={month} onClose={() => setPreparing(null)} onDone={() => { setPreparing(null); reload() }} />}
      {deciding && <DecideModal payout={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); reload() }} />}
      {paying && <PayModal payout={paying} options={options.data} onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload() }} />}
    </>
  )
}

function StatementSummary({ st }) {
  const { tx, pick, locale } = useI18n()
  return (
    <>
      {st.by_service.length > 0 && (
        <table className="table compact-table">
          <thead><tr><th>{tx('الخدمة', 'Service')}</th><th className="num">{tx('العدد', 'Count')}</th><th className="num">{tx('الحصة', 'Share')}</th></tr></thead>
          <tbody>{st.by_service.map((s) => <tr key={s.service_name_en}><td>{pick(s, 'service_name')}</td><td className="num">{s.count}</td><td className="num">{money(s.share, locale)}</td></tr>)}</tbody>
        </table>
      )}
      <dl className="drawer-math">
        <div><dt>{tx('إجمالي الحصص', 'Total shares')}</dt><dd className="num">{money(st.shares, locale)}</dd></div>
        <div><dt>{tx(`خصم المعامل (${st.labs.length} حالة)`, `Lab deduction (${st.labs.length} case(s))`)}</dt><dd className="num neg">− {money(st.lab_deduction, locale)}</dd></div>
        <div className="eq ok"><dt>{tx('الصافي المستحق', 'Net to pay')}</dt><dd className="num">{money(st.net, locale)}</dd></div>
      </dl>
    </>
  )
}

function PrepareModal({ due, month, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const st = useAsync(() => api.statement(due.doctor_id, month), [due.doctor_id, month, api])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.preparePayout({ doctor_id: due.doctor_id, month, note: note.trim() || null })
      toast.success(tx(`أُعدّ الكشف ${row.ref} وأُرسل للإدارة.`, `Statement ${row.ref} prepared and sent to management.`))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('إعداد كشف المستحقات', 'Prepare the statement')}
      description={`${pick(due, 'full_name')} · ${monthLabel(month, locale)}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="check" loading={busy} disabled={!st.data} onClick={submit}>{tx('إرسال للاعتماد', 'Send for approval')}</Button></>}>
      <div className="form">
        {error && <Alert tone="danger">{errorText(error, t)}</Alert>}
        {st.error ? <ErrorState error={st.error} onRetry={st.reload} /> : !st.data ? <SkeletonRows rows={3} cols={3} /> : <StatementSummary st={st.data} />}
        <TextField label={tx('ملاحظة للإدارة', 'Note for management')} value={note} onChange={(e) => setNote(e.target.value)} optional />
      </div>
    </Modal>
  )
}

function DecideModal({ payout, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const decide = async (approve) => {
    setBusy(approve ? 'yes' : 'no')
    setError(null)
    try {
      await api.decidePayout(payout.id, { approve, note: note.trim() || null })
      toast.success(approve ? tx('اعتُمد الكشف وأصبح جاهزًا للصرف.', 'Approved: ready to be paid.') : tx('رُفض الكشف وعاد للمحاسب.', 'Rejected and sent back to the accountant.'))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(null)
    }
  }
  return (
    <Modal open onClose={onClose} busy={!!busy} title={tx('مراجعة كشف طبيب', 'Review a doctor payout')}
      description={<>{pick(payout, 'doctor_name')} · {monthLabel(payout.month, locale)} · <span className="mrn">{payout.ref}</span></>}
      footer={<><Button variant="ghost" icon="x" loading={busy === 'no'} disabled={!!busy || note.trim().length < 5} onClick={() => decide(false)}>{tx('رفض', 'Reject')}</Button>
        <Button icon="check" loading={busy === 'yes'} disabled={!!busy} onClick={() => decide(true)}>{tx(`اعتماد ${money(payout.net, locale)}`, `Approve ${money(payout.net, locale)}`)}</Button></>}>
      <div className="form">
        {error && !error.fields?.note && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <dl className="drawer-math">
          <div><dt>{tx('الحصص', 'Shares')}</dt><dd className="num">{money(payout.shares, locale)}</dd></div>
          <div><dt>{tx('خصم المعامل', 'Lab deduction')}</dt><dd className="num neg">− {money(payout.lab_deduction, locale)}</dd></div>
          <div className="eq ok"><dt>{tx('الصافي', 'Net')}</dt><dd className="num">{money(payout.net, locale)}</dd></div>
        </dl>
        <p className="muted">{tx(`أعدّه ${pick(payout, 'prepared_by')}`, `Prepared by ${pick(payout, 'prepared_by')}`)}{payout.note && <> — “{payout.note}”</>}</p>
        <TextArea label={tx('ملاحظة (مطلوبة عند الرفض)', 'Note (required to reject)')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} error={fieldText('note', error?.fields?.note, t)} />
      </div>
    </Modal>
  )
}

function PayModal({ payout, options, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const sources = payingAccounts(options)
  const earliest = addMonths(payout.month, 1)
  const [f, setF] = useState({ paid_on: today() < earliest ? earliest : today(), paid_from_id: String(sources.find((a) => a.system_key === 'bank')?.id || sources[0]?.id || ''), reference: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.payPayout(payout.id, { ...f, paid_from_id: Number(f.paid_from_id), reference: f.reference.trim() || null })
      toast.success(tx('سُجّل الصرف وأُقفل الكشف.', 'Payment recorded; the statement is settled.'))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('صرف مستحقات طبيب', 'Pay a doctor')}
      description={<>{pick(payout, 'doctor_name')} · {monthLabel(payout.month, locale)} · <span className="mrn">{payout.ref}</span></>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="cash" loading={busy} onClick={submit}>{tx(`صرف ${money(payout.net, locale)}`, `Pay ${money(payout.net, locale)}`)}</Button></>}>
      <div className="form">
        {error && !['paid_on', 'paid_from_id'].some((k) => fe[k]) && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <div className="form-grid">
          <SelectField label={tx('يُصرف من', 'Paid from')} value={f.paid_from_id} onChange={(e) => setF({ ...f, paid_from_id: e.target.value })} options={accountOptions(sources, pick)} error={fieldText('paid_from_id', fe.paid_from_id, t)} />
          <TextField label={tx('تاريخ الصرف', 'Paid on')} type="date" value={f.paid_on} min={earliest} max={today()} onChange={(e) => setF({ ...f, paid_on: e.target.value })} error={fieldText('paid_on', fe.paid_on, t)} />
        </div>
        <TextField label={tx('المرجع (رقم التحويل أو الشيك)', 'Reference (transfer or cheque no.)')} value={f.reference} dir="auto" optional onChange={(e) => setF({ ...f, reference: e.target.value })} />
        <p className="muted foot-note"><Icon name="info" size={14} />{tx('القيد: مدين مستحقات الأطباء بالحصص، دائن البنك بالصافي، ودائن تكلفة المعامل بنصيب الطبيب.', "Posted as: doctors payable debited with the shares, the bank credited with the net, lab costs credited with the doctor's part.")}</p>
      </div>
    </Modal>
  )
}

export function PayoutPage() {
  const { id } = useParams()
  const { tx, pick, locale } = useI18n()
  const { api, base, canPost, canApprove } = useAccounting()
  const [modal, setModal] = useState(null)
  const { data: p, error, loading, reload } = useAsync(() => api.payout(id), [id, api])
  const options = useAsync(() => api.options(), [api])
  const back = <Link to={`${base}/payouts`} className="back-link no-print"><Icon name="arrowLeft" size={16} />{tx('مستحقات الأطباء', 'Doctor payouts')}</Link>
  if (error) return <div className="page">{back}<section className="card"><ErrorState error={error} onRetry={reload} /></section></div>
  if (loading && !p) return <div className="page">{back}<section className="card"><SkeletonRows rows={6} cols={4} /></section></div>
  const st = p.statement
  const done = () => { setModal(null); reload() }
  return (
    <div className="page reveal">
      <div className="print-bar no-print">
        {back}
        <div className="page-actions">
          {p.status === 'prepared' && canApprove && <Button icon="shieldCheck" onClick={() => setModal('decide')}>{tx('مراجعة واعتماد', 'Review & approve')}</Button>}
          {p.status === 'approved' && canPost && <Button icon="cash" onClick={() => setModal('pay')} disabled={!options.data}>{tx('صرف', 'Pay')}</Button>}
          <Button variant="ghost" icon="printer" onClick={() => window.print()}>{tx('طباعة الكشف', 'Print statement')}</Button>
        </div>
      </div>
      <article className="card statement-sheet">
        <header className="st-head">
          <LogoMark size={44} />
          <div>
            <small>{tx('كشف مستحقات طبيب', 'Doctor payout statement')}</small>
            <h1>{pick(p, 'doctor_name')}</h1>
            <p>{monthLabel(p.month, locale)} · <span className="mrn">{p.ref}</span></p>
          </div>
          <State state={p.status} map={PAYOUT_STATE} />
        </header>
        <div className="st-figs">
          <div><small>{tx('الحصص', 'Shares')}</small><strong className="num">{money(p.shares, locale)}</strong></div>
          <div><small>{tx('خصم المعامل', 'Lab deduction')}</small><strong className="num neg">{money(p.lab_deduction, locale)}</strong></div>
          <div className="net"><small>{tx('الصافي', 'Net')}</small><strong className="num">{money(p.net, locale)}</strong></div>
        </div>
        {num(st.shares) !== num(p.shares) && p.status !== 'paid' && (
          <div className="card-body no-print"><Alert tone="warn">{tx(`تغيّرت الأرقام منذ إعداد الكشف (الحصص الآن ${money(st.shares, locale)}). يجب رفضه وإعادة إعداده.`, `The figures changed since this was prepared (shares are now ${money(st.shares, locale)}). Reject it and prepare it again.`)}</Alert></div>
        )}
        <section className="st-sec">
          <h2>{tx('حسب الخدمة', 'By service')}</h2>
          <table className="table compact-table">
            <thead><tr><th>{tx('الخدمة', 'Service')}</th><th className="num">{tx('العدد', 'Count')}</th><th className="num">{tx('الحصة', 'Share')}</th></tr></thead>
            <tbody>{st.by_service.map((s) => <tr key={s.service_name_en}><td>{pick(s, 'service_name')}</td><td className="num">{s.count}</td><td className="num">{money(s.share, locale)}</td></tr>)}</tbody>
          </table>
        </section>
        {st.labs.length > 0 && (
          <section className="st-sec">
            <h2>{tx('حالات المعمل', 'Lab cases')}</h2>
            <table className="table compact-table">
              <thead><tr><th>{tx('الحالة', 'Case')}</th><th>{tx('المريض', 'Patient')}</th><th>{tx('المعمل', 'Lab')}</th><th className="num">{tx('التكلفة', 'Cost')}</th><th className="num">{tx('نصيب الطبيب', "Doctor's part")}</th></tr></thead>
              <tbody>{st.labs.map((c) => <tr key={c.id}><td className="mrn">{c.ref}</td><td>{pick(c, 'full_name')}</td><td>{c.lab_name}</td><td className="num">{money(c.lab_cost, locale)}</td><td className="num">{num(c.doctor_share_pct)}% · {money(c.deduction, locale)}</td></tr>)}</tbody>
            </table>
          </section>
        )}
        <section className="st-sec">
          <h2>{tx(`الفواتير (${st.lines.length})`, `Invoices (${st.lines.length})`)}</h2>
          <div className="table-wrap">
            <table className="table compact-table">
              <thead><tr><th>{tx('التاريخ', 'Date')}</th><th>{tx('الفاتورة', 'Invoice')}</th><th>{tx('الخدمة', 'Service')}</th><th className="num">{tx('الحصة', 'Share')}</th></tr></thead>
              <tbody>{st.lines.map((l, i) => (
                <tr key={i} className={l.source_type === 'invoice_void' ? 'refund-row' : ''}>
                  <td><bdi>{dayLabelShort(l.entry_date, locale)}</bdi></td>
                  <td><Link to={`${base}/journal/${l.entry_id}`} className="mrn">{l.source_ref}</Link>{l.source_type === 'invoice_void' && <small className="neg"> {tx('ملغاة', 'void')}</small>}</td>
                  <td>{pick(l, 'service_name') || l.memo}</td>
                  <td className="num">{money(l.share, locale)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
        <footer className="st-trail">
          <div><small>{tx('أعدّه', 'Prepared by')}</small><strong>{pick(p, 'prepared_by')}</strong><span className="muted"><bdi>{fmtDateTime(p.prepared_at, locale)}</bdi></span>{p.note && <em>“{p.note}”</em>}</div>
          <div><small>{p.status === 'rejected' ? tx('رفضه', 'Rejected by') : tx('اعتمده', 'Approved by')}</small><strong>{pick(p, 'decided_by') || '—'}</strong>{p.decided_at && <span className="muted"><bdi>{fmtDateTime(p.decided_at, locale)}</bdi></span>}{p.decision_note && <em>“{p.decision_note}”</em>}</div>
          <div><small>{tx('الصرف', 'Paid')}</small><strong>{p.paid_on ? `${dayLabelShort(p.paid_on, locale)} · ${pick(p, 'paid_from')}` : '—'}</strong>{p.reference && <span className="muted">#<bdi dir="ltr">{p.reference}</bdi></span>}
            {p.entry_id && <Link to={`${base}/journal/${p.entry_id}`} className="no-print">{tx('القيد', 'Entry')}</Link>}</div>
          <div className="sign"><small>{tx('توقيع الطبيب', "Doctor's signature")}</small><span /></div>
        </footer>
      </article>
      {modal === 'decide' && <DecideModal payout={p} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'pay' && <PayModal payout={p} options={options.data} onClose={() => setModal(null)} onDone={done} />}
    </div>
  )
}

function Labs() {
  const { tx, pick, locale } = useI18n()
  const { api, base, canPost } = useAccounting()
  const [paying, setPaying] = useState(null)
  const { data, error, loading, reload } = useAsync(() => api.labs(), [api])
  const options = useAsync(() => api.options(), [api])
  return (
    <>
      <section className="card">
        <div className="card-head"><h2>{tx('أرصدة المعامل', 'Lab balances')}</h2></div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={3} cols={5} /> : !data.labs.length ? (
          <EmptyState icon="layers" title={tx('لا توجد معامل', 'No labs')}>{tx('تظهر المعامل هنا عند تسجيل حالات معمل.', 'Labs show here once lab cases are recorded.')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tx('المعمل', 'Lab')}</th><th className="num">{tx('الحالات المستلمة', 'Cases received')}</th><th className="num">{tx('التكلفة', 'Cost')}</th><th className="num">{tx('المدفوع', 'Paid')}</th><th className="num">{tx('المتبقي', 'Owed')}</th><th><span className="sr-only">{tx('إجراء', 'Action')}</span></th></tr></thead>
              <tbody>
                {data.labs.map((l) => (
                  <tr key={l.id}>
                    <td><strong>{l.name}</strong>{l.phone && <small className="muted" style={{ display: 'block' }}><bdi dir="ltr">{l.phone}</bdi></small>}</td>
                    <td className="num">{l.cases}</td>
                    <td className="num">{money(l.received, locale)}</td>
                    <td className="num">{money(l.paid, locale)}{l.last_paid_on && <small className="muted" style={{ display: 'block' }}>{dayLabelShort(l.last_paid_on, locale)}</small>}</td>
                    <td className="num">{num(l.balance) > 0 ? <strong className="neg">{money(l.balance, locale)}</strong> : <span className="muted">{money(0, locale)}</span>}</td>
                    <td className="row-actions">{canPost && num(l.balance) > 0 && <Button size="sm" icon="cash" onClick={() => setPaying(l)} disabled={!options.data}>{tx('دفعة', 'Pay')}</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {data?.payments.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>{tx('المدفوعات للمعامل', 'Payments to labs')}</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tx('الرقم', 'No.')}</th><th>{tx('التاريخ', 'Date')}</th><th>{tx('المعمل', 'Lab')}</th><th>{tx('من', 'From')}</th><th className="num">{tx('المبلغ', 'Amount')}</th></tr></thead>
              <tbody>{data.payments.map((p) => (
                <tr key={p.ref}>
                  <td>{p.entry_id ? <Link to={`${base}/journal/${p.entry_id}`} className="mrn">{p.ref}</Link> : <span className="mrn">{p.ref}</span>}</td>
                  <td><bdi>{dayLabelShort(p.paid_on, locale)}</bdi></td>
                  <td>{p.lab_name}{p.note && <small className="muted" style={{ display: 'block' }}>{p.note}</small>}</td>
                  <td>{pick(p, 'paid_from')}{p.reference && <small className="muted" style={{ display: 'block' }}>#<bdi dir="ltr">{p.reference}</bdi></small>}</td>
                  <td className="num">{money(p.amount, locale)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
      {paying && <LabPayModal lab={paying} options={options.data} onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload() }} />}
    </>
  )
}

function LabPayModal({ lab, options, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const sources = payingAccounts(options)
  const [f, setF] = useState({ paid_on: today(), amount: String(num(lab.balance)), paid_from_id: String(sources.find((a) => a.system_key === 'bank')?.id || sources[0]?.id || ''), reference: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.payLab({ lab_id: lab.id, paid_on: f.paid_on, amount: f.amount, paid_from_id: Number(f.paid_from_id), reference: f.reference.trim() || null, note: f.note.trim() || null })
      toast.success(tx(`سُجّلت الدفعة ${row.ref}.`, `Payment ${row.ref} recorded.`))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('دفعة لمعمل', 'Pay a lab')} description={`${lab.name} · ${tx('المتبقي', 'owed')} ${money(lab.balance, locale)}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="cash" loading={busy} disabled={!num(f.amount) || num(f.amount) > num(lab.balance)} onClick={submit}>{tx('تسجيل الدفعة', 'Record payment')}</Button></>}>
      <div className="form">
        {error && !['paid_on', 'amount', 'paid_from_id'].some((k) => fe[k]) && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <div className="form-grid">
          <TextField label={tx('المبلغ (ج.م)', 'Amount (EGP)')} inputMode="decimal" dir="ltr" value={f.amount} onChange={(e) => setF({ ...f, amount: cleanAmount(e.target.value) })} data-autofocus error={fieldText('amount', fe.amount, t)} />
          <TextField label={tx('التاريخ', 'Date')} type="date" value={f.paid_on} max={today()} onChange={(e) => setF({ ...f, paid_on: e.target.value })} error={fieldText('paid_on', fe.paid_on, t)} />
          <SelectField label={tx('يُدفع من', 'Paid from')} value={f.paid_from_id} onChange={(e) => setF({ ...f, paid_from_id: e.target.value })} options={accountOptions(sources, pick)} error={fieldText('paid_from_id', fe.paid_from_id, t)} />
          <TextField label={tx('المرجع', 'Reference')} value={f.reference} dir="auto" optional onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </div>
        <TextField label={tx('ملاحظة', 'Note')} value={f.note} optional onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
    </Modal>
  )
}
