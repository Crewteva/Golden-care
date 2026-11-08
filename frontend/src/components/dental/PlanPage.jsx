import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import PageLoader from '../PageLoader'
import { Checkbox, SelectField, TextArea, TextField } from '../Fields'
import { Alert, Avatar, Badge, ErrorState } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { ageLabel, sexLabel } from '../patients/meta'
import { useSettings } from '../settings/shared'
import { CONDITIONS, LabBadge, PlanBadge, SURFACES, WORK_TYPES, money, useClinical } from '../clinical/meta'
import { ARCHES } from './Odontogram'
import { NewLabCaseModal } from './DentalTab'

const TEETH = [...ARCHES.permanent.flat(), ...ARCHES.primary.flat()]
const WORK_FOR = { crown: 'zirconia_crown', bridge: 'bridge', veneer: 'veneer', implant: 'implant_crown' }

function AddItem({ plan, onAdded }) {
  const { t, tx, lang, pick, locale } = useI18n()
  const { dental } = useClinical()
  const { api: sApi } = useSettings()
  const toast = useToast()
  const catalog = useAsync(() => sApi.catalog(), [sApi])
  const [form, setForm] = useState({ service_id: '', tooth: '', surfaces: [], phase: '1', note: '' })
  const [busy, setBusy] = useState(false)
  const services = (catalog.data?.services || []).filter((s) => s.is_active)
    .sort((a, b) => (b.clinical_record === 'dental') - (a.clinical_record === 'dental') || a.sort_order - b.sort_order)
  const chosen = services.find((s) => String(s.id) === form.service_id)
  const add = async () => {
    setBusy(true)
    try {
      onAdded(await dental.addItem(plan.id, { service_id: Number(form.service_id), tooth: form.tooth ? Number(form.tooth) : null, surfaces: form.surfaces, phase: Number(form.phase), note: form.note || null }))
      setForm({ ...form, tooth: '', surfaces: [], note: '' })
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="add-item">
      <SelectField label={tx('الخدمة', 'Service')} value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })} placeholder={tx('اختر…', 'Choose…')}
        options={services.map((s) => ({ value: String(s.id), label: `${pick(s)}${s.current_price ? ` — ${money(s.current_price, locale)}` : ''}` }))} />
      <SelectField label={tx('السن', 'Tooth')} optional value={form.tooth} onChange={(e) => setForm({ ...form, tooth: e.target.value })} placeholder={tx('كل الفم / بدون سن', 'Whole mouth / none')}
        options={TEETH.map((n) => ({ value: String(n), label: `${n}${n >= 51 ? ` (${tx('لبني', 'primary')})` : ''}` }))} />
      <div className="field">
        <span className="field-label">{tx('الأسطح', 'Surfaces')} <span className="opt">({t('optional')})</span></span>
        <div className="surface-picks">
          {Object.keys(SURFACES).map((s) => (
            <button key={s} type="button" disabled={!form.tooth} aria-pressed={form.surfaces.includes(s)} title={SURFACES[s][lang]}
              onClick={() => setForm({ ...form, surfaces: form.surfaces.includes(s) ? form.surfaces.filter((x) => x !== s) : [...form.surfaces, s] })}>{s}</button>
          ))}
        </div>
      </div>
      <SelectField label={tx('المرحلة', 'Phase')} value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })}
        options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: tx(`المرحلة ${n}`, `Phase ${n}`) }))} />
      <Button icon="plus" loading={busy} disabled={!form.service_id} onClick={add}>{tx('إضافة', 'Add')}</Button>
      {chosen?.dental_result && form.tooth && <small className="muted add-hint">{tx('عند التنفيذ يظهر على الخريطة:', 'When done, the chart shows:')} {CONDITIONS[chosen.dental_result][lang]}</small>}
    </div>
  )
}

function ActionModal({ kind, plan, onClose, onDone }) {
  const { t, tx } = useI18n()
  const { dental } = useClinical()
  const toast = useToast()
  const [days, setDays] = useState('30')
  const [reason, setReason] = useState('')
  const [signed, setSigned] = useState(false)
  const [busy, setBusy] = useState(false)
  const conf = {
    quote: { title: tx('إصدار عرض السعر', 'Issue the quotation'), go: tx('إصدار', 'Issue'), run: () => dental.quote(plan.id, Number(days)), ok: tx('صدر عرض السعر.', 'Quotation issued.') },
    revise: { title: tx('تعديل الخطة؟', 'Revise the plan?'), go: tx('رجوع للمسودة', 'Back to draft'), run: () => dental.revise(plan.id), ok: tx('الخطة مسودة الآن.', 'The plan is a draft again.') },
    accept: { title: tx('تسجيل موافقة المريض', "Record the patient's acceptance"), go: tx('تسجيل الموافقة', 'Record acceptance'), run: () => dental.accept(plan.id), ok: tx('سُجّلت الموافقة وجدول الأقساط.', 'Acceptance and installments recorded.'), disabled: !signed },
    decline: { title: tx('المريض رفض الخطة', 'Patient declined'), go: tx('تسجيل الرفض', 'Record decline'), run: () => dental.decline(plan.id, reason.trim()), ok: tx('سُجّل الرفض.', 'Decline recorded.'), disabled: reason.trim().length < 3, danger: true },
    cancel: { title: tx('إلغاء الخطة', 'Cancel the plan'), go: tx('إلغاء الخطة', 'Cancel plan'), run: () => dental.cancel(plan.id, reason.trim()), ok: tx('أُلغيت الخطة.', 'Plan cancelled.'), disabled: reason.trim().length < 3, danger: true },
  }[kind]
  const go = async () => {
    setBusy(true)
    try {
      onDone(await conf.run())
      toast.success(conf.ok)
      onClose()
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={conf.title}
      footer={<><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button><Button variant={conf.danger ? 'danger' : 'primary'} loading={busy} disabled={conf.disabled} onClick={go}>{conf.go}</Button></>}>
      <div className="form">
        {kind === 'quote' && (
          <>
            <p>{tx('تُحدَّث الأسعار من قائمة الأسعار الحالية ثم تُثبَّت. لا يمكن تعديل البنود بعدها إلا بإعادة الخطة لمسودة وإصدار عرض جديد.',
              "Prices are refreshed from today's price list, then frozen. Items can only change by sending the plan back to draft and issuing a new quotation.")}</p>
            <SelectField label={tx('العرض صالح لمدة', 'Valid for')} value={days} onChange={(e) => setDays(e.target.value)}
              options={[7, 14, 30, 60, 90].map((d) => ({ value: String(d), label: tx(`${d} يوم`, `${d} days`) }))} />
          </>
        )}
        {kind === 'revise' && <p>{tx('يعود العرض مسودة لتعديل البنود. يجب إصدار عرض سعر جديد ليوافق عليه المريض.', 'The quotation goes back to draft so items can change. A new quotation must be issued for the patient to accept.')}</p>}
        {kind === 'accept' && (
          <>
            <p>{tx('يمكن للمريض الموافقة بنفسه من حسابه. استخدم هذا عندما يوافق في العيادة.', 'Patients can accept from their own account. Use this when they accept at the clinic.')}</p>
            <Checkbox checked={signed} onChange={(e) => setSigned(e.target.checked)} label={tx('وقّع المريض على عرض السعر المطبوع', 'The patient signed the printed quotation')} />
          </>
        )}
        {['decline', 'cancel'].includes(kind) && <TextArea label={tx('السبب', 'Reason')} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />}
      </div>
    </Modal>
  )
}

// A treatment plan: items by tooth from the price list, the quotation, acceptance, installments and the work as it's done.
export default function PlanPage() {
  const { id } = useParams()
  const { t, tx, lang, pick, locale } = useI18n()
  const { dental, base } = useClinical()
  const toast = useToast()
  const { data, error, reload, setData } = useAsync(() => dental.plan(id), [id, dental])
  const [action, setAction] = useState(null)
  const [itemAction, setItemAction] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(null)
  const [terms, setTerms] = useState(null)
  const [labFor, setLabFor] = useState(null)

  useEffect(() => {
    if (data?.plan) setTerms({ title: data.plan.title, notes: data.plan.notes || '', patient_note: data.plan.patient_note || '', down_payment: String(Number(data.plan.down_payment)), installments_count: String(data.plan.installments_count) })
  }, [data?.plan?.id, data?.plan?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data || !terms) return <PageLoader />
  const p = data.plan
  const can = data.can
  const phases = [...new Set(data.items.map((i) => i.phase))].sort()

  const run = async (key, fn, ok) => {
    setBusy(key)
    try {
      setData(await fn())
      if (ok) toast.success(ok)
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(null)
    }
  }
  const saveTerms = () => run('terms', () => dental.editPlan(p.id, { ...terms, down_payment: Number(terms.down_payment) || 0, installments_count: Number(terms.installments_count) || 0 }), tx('تم الحفظ.', 'Saved.'))
  const total = Number(p.status === 'draft' ? p.items_total : p.quote_total ?? p.items_total)

  return (
    <div className="page reveal visit-page">
      <Link to={`${base}/patients/${p.patient_id}?tab=dental`} className="back-link"><Icon name="arrowLeft" size={16} />{tx('ملف المريض', 'Patient file')}</Link>
      <header className="card card-pad visit-head">
        <Avatar name={pick(p, 'patient_name')} size="lg" />
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow"><span className="mrn">{p.ref}</span> · {pick(p, 'doctor_name')} <PlanBadge state={p.state} /></div>
          <h1>{p.title}</h1>
          <div className="file-facts">
            <span className="chip"><strong>{pick(p, 'patient_name')}</strong></span>
            <span className="chip"><span className="mrn">{p.mrn}</span></span>
            <span className="chip">{ageLabel(p.date_of_birth, tx)} · {sexLabel(p.gender, tx)}</span>
            {p.valid_until && p.status === 'quoted' && <span className="chip"><Icon name="clock" size={14} />{tx('صالح حتى', 'Valid until')} <bdi>{fmtDate(p.valid_until, locale)}</bdi></span>}
          </div>
        </div>
        <div className="page-actions">
          {p.status !== 'draft' && <Link to={`${base}/plans/${p.id}/print`} className="btn btn-ghost"><Icon name="printer" size={18} />{tx('طباعة عرض السعر', 'Print quotation')}</Link>}
          {can.quote && <Button icon="sparkle" disabled={!data.items.length} onClick={() => setAction('quote')}>{tx('إصدار عرض السعر', 'Issue quotation')}</Button>}
          {can.accept && <Button variant="gold" icon="check" onClick={() => setAction('accept')}>{tx('موافقة المريض', 'Patient accepts')}</Button>}
          {can.decline && <Button variant="ghost" onClick={() => setAction('decline')}>{tx('رفض', 'Declined')}</Button>}
          {can.revise && <Button variant="ghost" icon="edit" onClick={() => setAction('revise')}>{tx('تعديل', 'Revise')}</Button>}
          {can.cancel && <Button variant="quiet" icon="x" onClick={() => setAction('cancel')}>{tx('إلغاء', 'Cancel')}</Button>}
        </div>
      </header>
      {p.state === 'expired' && <Alert tone="danger">{tx('انتهت صلاحية عرض السعر. اضغط "تعديل" ثم أصدر عرضًا جديدًا بأسعار اليوم.', "The quotation has expired. Click 'Revise', then issue a new quotation at today's prices.")}</Alert>}
      {p.status === 'declined' && <Alert tone="warn" title={tx('سبب الرفض:', 'Reason:')}>{p.decline_reason}</Alert>}
      {p.status === 'cancelled' && <Alert tone="warn" title={tx('أُلغيت:', 'Cancelled:')}>{p.cancel_reason}</Alert>}

      <div className="plan-totals">
        <div><small>{tx('إجمالي الخطة', 'Plan total')}</small><strong className="num">{money(total, locale)}</strong></div>
        <div><small>{tx('تم تنفيذه', 'Done')}</small><strong className="num">{money(p.done_total, locale)}</strong><span className="muted num">{p.done_count}/{p.items_count}</span></div>
        <div className={Number(p.to_bill_total) ? 'attention' : ''}><small>{tx('جاهز للفوترة', 'Ready to bill')}</small><strong className="num">{money(p.to_bill_total, locale)}</strong>
          <span className="muted">{tx('الفواتير في المرحلة ٥', 'Invoices come in step 5')}</span></div>
        <div><small>{tx('المتبقي', 'Remaining')}</small><strong className="num">{money(Math.max(0, total - Number(p.done_total)), locale)}</strong></div>
      </div>

      <div className="visit-grid">
        <div className="visit-main">
          <section className="card">
            <div className="card-head"><h2>{tx('بنود الخطة', 'Plan items')}</h2>{p.status !== 'draft' && <Badge tone="neutral"><Icon name="lock" size={12} /> {tx('الأسعار مثبتة', 'Prices frozen')}</Badge>}</div>
            {!data.items.length ? <p className="card-body muted">{tx('أضف أول بند بالأسفل. السعر يُؤخذ من قائمة الأسعار تلقائيًا.', 'Add the first item below. The price comes from the price list automatically.')}</p> : (
              <div className="table-wrap">
                <table className="table plan-table">
                  <thead><tr><th>{tx('السن', 'Tooth')}</th><th>{tx('الخدمة', 'Service')}</th><th>{tx('السعر', 'Price')}</th><th>{tx('الحالة', 'Status')}</th><th><span className="sr-only">{tx('إجراءات', 'Actions')}</span></th></tr></thead>
                  {phases.map((ph) => (
                    <tbody key={ph}>
                      {phases.length > 1 && <tr className="phase-row"><td colSpan={5}>{tx(`المرحلة ${ph}`, `Phase ${ph}`)}</td></tr>}
                      {data.items.filter((i) => i.phase === ph).map((i) => {
                        const lab = data.lab_cases.find((c) => c.plan_item_id === i.id)
                        return (
                          <tr key={i.id} className={i.status === 'cancelled' ? 'muted-row' : ''}>
                            <td>{i.tooth ? <span className="tooth-tag">{i.tooth}{i.surfaces.length > 0 && <small>{i.surfaces.join('')}</small>}</span> : <span className="muted">{tx('كل الفم', 'Whole mouth')}</span>}</td>
                            <td><strong>{pick(i, 'service_name')}</strong>{i.condition && <small className="muted" style={{ display: 'block' }}>→ {CONDITIONS[i.condition][lang]}</small>}
                              {i.note && <small className="muted" style={{ display: 'block' }} dir="auto">{i.note}</small>}
                              {lab && <small style={{ display: 'block' }}><Link to={`${base}/lab-cases?open=${lab.id}`}>{lab.ref}</Link> · {WORK_TYPES[lab.work_type][lang]} · <LabBadge status={lab.status} /></small>}</td>
                            <td className="num">{money(i.price, locale)}</td>
                            <td>
                              {i.status === 'done' ? <><Badge tone="success">{tx('تم', 'Done')}</Badge><small className="muted" style={{ display: 'block' }}><bdi>{fmtDate(i.done_at, locale)}</bdi></small></>
                                : i.status === 'cancelled' ? <Badge tone="neutral">{tx('أُلغي', 'Cancelled')}</Badge> : <Badge tone="gold">{tx('مخطط', 'Planned')}</Badge>}
                              {i.billing_status === 'to_bill' && <small className="bill-flag">{tx('جاهز للفوترة', 'Ready to bill')}</small>}
                            </td>
                            <td className="actions">
                              {can.edit && <Button size="sm" variant="quiet" icon="x" loading={busy === `rm${i.id}`} aria-label={tx('حذف', 'Remove')} onClick={() => run(`rm${i.id}`, () => dental.removeItem(p.id, i.id))} />}
                              {can.work && i.status === 'planned' && (
                                <>
                                  <Button size="sm" icon="check" loading={busy === `done${i.id}`} onClick={() => run(`done${i.id}`, () => dental.itemDone(p.id, i.id, {}), tx('سُجّل التنفيذ وأُضيف للخريطة.', 'Marked done and added to the chart.'))}>{tx('تم التنفيذ', 'Done')}</Button>
                                  {!lab && WORK_FOR[i.condition] && <Button size="sm" variant="ghost" icon="package" onClick={() => setLabFor(i)}>{tx('للمعمل', 'To lab')}</Button>}
                                  <Button size="sm" variant="quiet" onClick={() => { setItemAction(i); setReason('') }}>{tx('إلغاء', 'Cancel')}</Button>
                                </>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  ))}
                </table>
              </div>
            )}
            {can.edit && <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}><AddItem plan={p} onAdded={setData} /></div>}
          </section>

          <section className="card">
            <div className="card-head"><h2>{tx('خطة الدفع', 'Payment plan')}</h2></div>
            <div className="card-body form">
              {can.edit ? (
                <>
                  <div className="form-grid">
                    <TextField label={tx('الدفعة المقدمة (ج.م)', 'Down payment (EGP)')} value={terms.down_payment} onChange={(e) => setTerms({ ...terms, down_payment: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" dir="ltr" />
                    <SelectField label={tx('عدد الأقساط الشهرية', 'Monthly installments')} value={terms.installments_count} onChange={(e) => setTerms({ ...terms, installments_count: e.target.value })}
                      options={[0, 2, 3, 4, 5, 6, 9, 12, 18, 24].map((n) => ({ value: String(n), label: n ? tx(`${n} أقساط`, `${n} installments`) : tx('الدفع مع كل مرحلة', 'Pay as the work is done') }))} />
                  </div>
                  <TextArea label={tx('ملاحظة تظهر للمريض على العرض', 'Note for the patient (printed on the quotation)')} optional value={terms.patient_note} onChange={(e) => setTerms({ ...terms, patient_note: e.target.value })} rows={2} />
                  <TextArea label={tx('ملاحظات داخلية', 'Internal notes')} optional value={terms.notes} onChange={(e) => setTerms({ ...terms, notes: e.target.value })} rows={2} />
                  <Button variant="ghost" icon="check" loading={busy === 'terms'} onClick={saveTerms} style={{ justifySelf: 'start' }}>{t('save')}</Button>
                </>
              ) : (
                <dl className="dl">
                  <dt>{tx('الدفعة المقدمة', 'Down payment')}</dt><dd className="num">{money(p.down_payment, locale)}</dd>
                  <dt>{tx('الأقساط', 'Installments')}</dt><dd>{p.installments_count ? tx(`${p.installments_count} أقساط شهرية`, `${p.installments_count} monthly`) : tx('الدفع مع كل مرحلة', 'Pay as the work is done')}</dd>
                  {p.patient_note && <><dt>{tx('ملاحظة للمريض', 'Note for patient')}</dt><dd dir="auto">{p.patient_note}</dd></>}
                  {p.notes && <><dt>{tx('ملاحظات داخلية', 'Internal notes')}</dt><dd dir="auto">{p.notes}</dd></>}
                </dl>
              )}
              <Schedule rows={data.installments.length ? data.installments : data.schedule_preview} preview={!data.installments.length} />
            </div>
          </section>
        </div>

        <aside className="visit-side">
          <section className="card">
            <div className="card-head"><h2>{tx('مراحل الخطة', 'Plan timeline')}</h2></div>
            <div className="card-body">
              <ul className="plan-timeline">
                <li className="done"><span>{tx('أُنشئت', 'Created')}</span><bdi>{fmtDateTime(p.created_at, locale)}</bdi></li>
                {p.quoted_at && <li className="done"><span>{tx('صدر عرض السعر', 'Quotation issued')}</span><bdi>{fmtDateTime(p.quoted_at, locale)}</bdi></li>}
                {p.accepted_at && <li className="done"><span>{p.accepted_via === 'portal' ? tx('وافق المريض من حسابه', 'Patient accepted online') : tx('وافق المريض في العيادة', 'Patient accepted at the clinic')}</span><bdi>{fmtDateTime(p.accepted_at, locale)}</bdi></li>}
                {p.declined_at && <li className="bad"><span>{tx('رفض المريض', 'Patient declined')}</span><bdi>{fmtDateTime(p.declined_at, locale)}</bdi></li>}
                {p.completed_at && <li className="done"><span>{tx('اكتملت', 'Completed')}</span><bdi>{fmtDateTime(p.completed_at, locale)}</bdi></li>}
                {p.cancelled_at && <li className="bad"><span>{tx('أُلغيت', 'Cancelled')}</span><bdi>{fmtDateTime(p.cancelled_at, locale)}</bdi></li>}
              </ul>
            </div>
          </section>
        </aside>
      </div>

      {action && <ActionModal kind={action} plan={p} onClose={() => setAction(null)} onDone={setData} />}
      {itemAction && (
        <Modal open onClose={() => setItemAction(null)} title={tx('إلغاء بند من الخطة', 'Cancel a plan item')}
          footer={<><Button variant="ghost" onClick={() => setItemAction(null)}>{t('cancel')}</Button>
            <Button variant="danger" loading={busy === 'icancel'} disabled={reason.trim().length < 3} onClick={() => run('icancel', () => dental.itemCancel(p.id, itemAction.id, reason.trim()), tx('أُلغي البند.', 'Item cancelled.')).then(() => setItemAction(null))}>{tx('إلغاء البند', 'Cancel item')}</Button></>}>
          <TextArea label={tx('السبب', 'Reason')} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
        </Modal>
      )}
      {labFor && <NewLabCaseModal patientId={p.patient_id} planItem={labFor.id} defaults={{ work_type: WORK_FOR[labFor.condition], teeth: labFor.tooth ? String(labFor.tooth) : '' }}
        onClose={() => setLabFor(null)} onCreated={() => reload()} />}
    </div>
  )
}

export function Schedule({ rows, preview }) {
  const { tx, locale } = useI18n()
  if (!rows?.length) return <p className="muted">{tx('لا يوجد جدول أقساط: يُدفع الباقي مع تنفيذ كل مرحلة.', 'No installment schedule: the rest is paid as each part is done.')}</p>
  return (
    <div>
      <h3 className="schedule-title">{preview ? tx('جدول الأقساط المقترح (يبدأ من يوم الموافقة)', 'Proposed installments (start on the day of acceptance)') : tx('جدول الأقساط', 'Installment schedule')}</h3>
      <ol className="schedule">
        {rows.map((r) => (
          <li key={r.seq} className={r.status === 'paid' ? 'paid' : ''}>
            <span>{r.seq === 0 ? tx('دفعة مقدمة', 'Down payment') : tx(`قسط ${r.seq}`, `Installment ${r.seq}`)}</span>
            <bdi>{fmtDate(r.due_on, locale)}</bdi>
            <strong className="num">{money(r.amount, locale)}</strong>
            {r.status && <Badge tone={r.status === 'paid' ? 'success' : r.status === 'cancelled' ? 'neutral' : 'gold'}>{r.status === 'paid' ? tx('مدفوع', 'Paid') : r.status === 'cancelled' ? tx('ملغى', 'Cancelled') : tx('مستحق', 'Due')}</Badge>}
          </li>
        ))}
      </ol>
    </div>
  )
}
