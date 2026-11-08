import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtDate } from '../../lib/format'
import { ageOf } from '../patients/meta'
import { useSettings } from '../settings/shared'
import { CONDITIONS, LabBadge, PlanBadge, SURFACES, WORK_TYPES, money, useClinical } from '../clinical/meta'
import Odontogram, { ChartLegend, toothLayout } from './Odontogram'

function ToothPanel({ tooth, chart, onChanged }) {
  const { t, tx, lang, pick, locale } = useI18n()
  const { dental } = useClinical()
  const toast = useToast()
  const [form, setForm] = useState({ condition: 'caries', surfaces: [], status: 'existing', note: '' })
  const [busy, setBusy] = useState(false)
  const [voiding, setVoiding] = useState(null)
  const [reason, setReason] = useState('')
  const entries = chart.entries.filter((e) => e.tooth === tooth).reverse()
  const planned = chart.planned.filter((p) => p.tooth === tooth)
  const lay = toothLayout(tooth)
  const surfaceOrder = [lay.left, lay.top, lay.center, lay.bottom, lay.right].filter((s, i, arr) => arr.indexOf(s) === i)
  const wholeTooth = !['caries', 'filling', 'sealant', 'fracture', 'veneer'].includes(form.condition)

  const add = async () => {
    setBusy(true)
    try {
      onChanged(await dental.addEntry(chart.patient.id, { ...form, tooth, surfaces: wholeTooth ? [] : form.surfaces, note: form.note.trim() || null }))
      setForm({ ...form, surfaces: [], note: '' })
      toast.success(tx('سُجّلت على الخريطة.', 'Added to the chart.'))
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }
  const voidIt = async () => {
    setBusy(true)
    try {
      onChanged(await dental.voidEntry(chart.patient.id, voiding.id, reason.trim()))
      setVoiding(null)
      setReason('')
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tooth-panel">
      <div className="row-between"><h3>{tx(`السن ${tooth}`, `Tooth ${tooth}`)}</h3>{tooth >= 51 && <Badge tone="neutral">{tx('سن لبني', 'Primary tooth')}</Badge>}</div>
      {planned.length > 0 && (
        <ul className="tooth-planned">
          {planned.map((p) => <li key={p.id}><Icon name="clipboard" size={14} /> {pick(p, 'service_name')} <small className="muted">· {p.plan_ref}</small></li>)}
        </ul>
      )}
      {!entries.length ? <p className="muted">{tx('لا توجد ملاحظات مسجّلة على هذا السن.', 'Nothing recorded on this tooth.')}</p> : (
        <ul className="tooth-history">
          {entries.map((e) => (
            <li key={e.id} className={e.voided_at ? 'voided' : ''}>
              <i style={{ background: CONDITIONS[e.condition].color }} />
              <div>
                <strong>{CONDITIONS[e.condition][lang]}</strong>{e.surfaces.length > 0 && <span className="mono"> {e.surfaces.join('')}</span>}
                {' '}<span className="badge badge-plain badge-neutral">{e.status === 'done' ? tx('تم هنا', 'Done here') : tx('موجود', 'Found')}</span>
                {e.note && <small dir="auto">{e.note}</small>}
                <small className="muted">{pick(e, 'recorded_by')} · <bdi>{fmtDate(e.recorded_at, locale)}</bdi></small>
                {e.voided_at && <small className="danger-text">{tx('أُلغيت:', 'Voided:')} {e.void_reason}</small>}
              </div>
              {chart.can.record && !e.voided_at && (
                <button type="button" className="btn btn-quiet btn-icon btn-sm" aria-label={tx('إلغاء هذا السطر', 'Void this entry')} onClick={() => setVoiding(e)}><Icon name="x" size={15} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {chart.can.record && (
        <div className="tooth-add form">
          <SelectField label={tx('تسجيل', 'Record')} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}
            options={Object.entries(CONDITIONS).map(([value, c]) => ({ value, label: c[lang] }))} />
          {!wholeTooth && (
            <div className="field">
              <span className="field-label">{tx('الأسطح', 'Surfaces')}</span>
              <div className="surface-picks">
                {surfaceOrder.map((s) => (
                  <button key={s} type="button" aria-pressed={form.surfaces.includes(s)} title={SURFACES[s][lang]}
                    onClick={() => setForm({ ...form, surfaces: form.surfaces.includes(s) ? form.surfaces.filter((x) => x !== s) : [...form.surfaces, s] })}>{s}</button>
                ))}
              </div>
            </div>
          )}
          <div className="choice-group">
            {[['existing', tx('موجود عند الفحص', 'Found on exam')], ['done', tx('تم هنا', 'Done here')]].map(([v, l]) => (
              <label key={v} className="choice"><input type="radio" name={`st-${tooth}`} checked={form.status === v} onChange={() => setForm({ ...form, status: v })} /><span>{l}</span></label>
            ))}
          </div>
          <TextField label={tx('ملاحظة', 'Note')} optional value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} />
          <Button icon="plus" loading={busy} disabled={!wholeTooth && !form.surfaces.length} onClick={add}>{tx('إضافة للخريطة', 'Add to chart')}</Button>
        </div>
      )}
      {voiding && (
        <Modal open onClose={() => setVoiding(null)} busy={busy} title={tx('إلغاء سطر من الخريطة؟', 'Void a chart entry?')}
          footer={<><Button variant="ghost" onClick={() => setVoiding(null)}>{t('cancel')}</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={voidIt}>{tx('إلغاء السطر', 'Void entry')}</Button></>}>
          <div className="form">
            <p>{tx('السطر لا يُحذف: يبقى في السجل مشطوبًا مع السبب.', "The entry isn't deleted: it stays in the history, struck through, with the reason.")}</p>
            <TextArea label={tx('السبب', 'Reason')} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus placeholder={tx('مثال: سُجّل على السن الخطأ', 'e.g. recorded on the wrong tooth')} />
          </div>
        </Modal>
      )}
    </div>
  )
}

export function NewPlanModal({ patientId, onClose }) {
  const { t, tx } = useI18n()
  const { dental, base } = useClinical()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const plan = await dental.createPlan({ patient_id: patientId, title: title.trim() })
      navigate(`${base}/plans/${plan.id}`)
    } catch (err) {
      setError(errorText(err, t))
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('خطة علاج جديدة', 'New treatment plan')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button><Button type="submit" form="new-plan" loading={busy} disabled={title.trim().length < 2}>{tx('إنشاء', 'Create')}</Button></>}>
      <form id="new-plan" className="form" onSubmit={submit}>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField label={tx('عنوان الخطة', 'Plan title')} value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus
          placeholder={tx('مثال: علاج عصب وتاج للضرس ٤٦', 'e.g. Root canal and crown 46')} maxLength={120} />
      </form>
    </Modal>
  )
}

export function NewLabCaseModal({ patientId, planItem, defaults = {}, onClose, onCreated }) {
  const { t, tx, lang, pick } = useI18n()
  const { dental, me } = useClinical()
  const toast = useToast()
  const labs = useAsync(() => dental.labs(), [dental])
  const [form, setForm] = useState({ lab_id: '', work_type: defaults.work_type || 'zirconia_crown', teeth: defaults.teeth || '', shade: '', instructions: '', due_on: '', lab_cost: '', doctor_share_pct: '0', doctor_id: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const isDoctor = me.active_role === 'doctor'
  const { api: sApi } = useSettings()
  const doctors = useAsync(() => (isDoctor ? Promise.resolve([]) : sApi.doctors()), [isDoctor, sApi])
  useEffect(() => { if (labs.data?.length && !form.lab_id) setForm((f) => ({ ...f, lab_id: String(labs.data[0].id) })) }, [labs.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const c = await dental.createCase({
        patient_id: patientId, lab_id: Number(form.lab_id), work_type: form.work_type, teeth: form.teeth || null, shade: form.shade || null,
        instructions: form.instructions || null, due_on: form.due_on || null, lab_cost: form.lab_cost === '' ? null : Number(form.lab_cost),
        doctor_share_pct: Number(form.doctor_share_pct) || 0, plan_item_id: planItem || null, doctor_id: isDoctor ? null : form.doctor_id || null,
      })
      toast.success(tx(`سُجّلت حالة المعمل ${c.case.ref}.`, `Lab case ${c.case.ref} created.`))
      onCreated?.(c)
      onClose()
    } catch (err) {
      setErrors({ ...fieldErrors(err, t), form: errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open wide onClose={onClose} busy={busy} title={tx('حالة معمل جديدة', 'New lab case')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button><Button type="submit" form="new-case" loading={busy}>{tx('تسجيل الطلب', 'Create case')}</Button></>}>
      <form id="new-case" className="form" onSubmit={submit} noValidate>
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <div className="form-grid">
          <SelectField label={tx('المعمل', 'Lab')} value={form.lab_id} onChange={set('lab_id')} error={errors.lab_id}
            options={(labs.data || []).map((l) => ({ value: String(l.id), label: l.name }))} />
          <SelectField label={tx('نوع العمل', 'Work')} value={form.work_type} onChange={set('work_type')}
            options={Object.entries(WORK_TYPES).map(([value, w]) => ({ value, label: w[lang] }))} />
          <TextField label={tx('الأسنان', 'Teeth')} value={form.teeth} onChange={set('teeth')} placeholder="46" dir="ltr" />
          <TextField label={tx('اللون (Shade)', 'Shade')} optional value={form.shade} onChange={set('shade')} placeholder="A2" dir="ltr" />
          <TextField label={tx('موعد الرجوع المتوقع', 'Expected back on')} type="date" value={form.due_on} onChange={set('due_on')} error={errors.due_on} />
          <TextField label={tx('تكلفة المعمل (ج.م)', 'Lab cost (EGP)')} optional value={form.lab_cost} onChange={set('lab_cost')} inputMode="decimal" dir="ltr"
            hint={tx('مبلغ مستحق للمعمل؛ يُربط بالحسابات لاحقًا.', 'Owed to the lab; linked to accounting later.')} />
          <TextField label={tx('نصيب الطبيب من التكلفة %', "Doctor's share of the cost %")} value={form.doctor_share_pct} onChange={set('doctor_share_pct')} inputMode="decimal" dir="ltr"
            hint={tx('يُخصم من كشف حساب الطبيب الشهري.', "Deducted from the doctor's monthly statement.")} />
          {!isDoctor && (
            <SelectField label={tx('الطبيب الذي طلب العمل', 'Ordering doctor')} value={form.doctor_id} onChange={set('doctor_id')} error={errors.doctor_id}
              placeholder={tx('اختر…', 'Choose…')} options={(doctors.data || []).map((d) => ({ value: d.id, label: pick(d, 'full_name') }))} />
          )}
        </div>
        <TextArea label={tx('تعليمات للمعمل', 'Instructions for the lab')} optional value={form.instructions} onChange={set('instructions')} rows={2} />
      </form>
    </Modal>
  )
}

// Patient file → Dental: tooth chart, treatment plans and lab work.
export default function DentalTab({ patient }) {
  const { tx, lang, pick, locale } = useI18n()
  const { dental, base, can } = useClinical()
  const age = ageOf(patient.date_of_birth)
  const [set, setSet] = useState(age < 12 ? 'primary' : 'permanent')
  const [tooth, setTooth] = useState(null)
  const [newPlan, setNewPlan] = useState(false)
  const [newCase, setNewCase] = useState(false)
  const chart = useAsync(() => (can('dental.chart') || can('dental.plans') || can('visits.view_all') ? dental.chart(patient.id) : Promise.resolve(null)), [patient.id, dental])
  const plans = useAsync(() => (can('dental.plans') || can('dental.plans_view') || can('visits.view_all') ? dental.patientPlans(patient.id) : Promise.resolve(null)), [patient.id, dental])
  const cases = useAsync(() => (can('dental.lab') || can('visits.view_all') ? dental.cases({ patient_id: patient.id }) : Promise.resolve(null)), [patient.id, dental])

  return (
    <div className="page" style={{ gap: 20 }}>
      {chart.data !== null && (
        <section className="card">
          <div className="card-head">
            <h2>{tx('خريطة الأسنان', 'Tooth chart')}</h2>
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={set === 'permanent'} onClick={() => setSet('permanent')}>{tx('دائمة', 'Permanent')}</button>
              <button type="button" role="tab" aria-selected={set === 'primary'} onClick={() => setSet('primary')}>{tx('لبنية', 'Primary')}</button>
            </div>
          </div>
          {chart.error ? <ErrorState error={chart.error} onRetry={chart.reload} /> : !chart.data ? <SkeletonRows rows={3} cols={4} /> : (
            <div className="chart-layout">
              <div>
                <Odontogram entries={chart.data.entries} planned={chart.data.planned} set={set} selected={tooth} onSelect={setTooth} />
                <ChartLegend />
              </div>
              {tooth ? <ToothPanel tooth={tooth} chart={chart.data} onChanged={chart.setData} /> : (
                <div className="tooth-panel empty"><Icon name="search" size={22} /><p className="muted">{tx('اضغط على سن لعرض تاريخه وتسجيل ملاحظة.', 'Click a tooth to see its history and record a finding.')}</p></div>
              )}
            </div>
          )}
        </section>
      )}

      {plans.data !== null && (
        <section className="card">
          <div className="card-head">
            <h2>{tx('خطط العلاج', 'Treatment plans')}</h2>
            {can('dental.plans') && <Button size="sm" icon="plus" onClick={() => setNewPlan(true)}>{tx('خطة جديدة', 'New plan')}</Button>}
          </div>
          {plans.error ? <ErrorState error={plans.error} onRetry={plans.reload} /> : !plans.data ? <SkeletonRows rows={2} cols={4} /> : !plans.data.length ? (
            <EmptyState icon="clipboard" title={tx('لا توجد خطط علاج', 'No treatment plans')} />
          ) : (
            <ul className="plan-rows">
              {plans.data.map((p) => (
                <li key={p.id}>
                  <div><strong>{p.title}</strong><small className="muted"><span className="mrn">{p.ref}</span> · {pick(p, 'doctor_name')} · <bdi>{fmtDate(p.created_at, locale)}</bdi></small></div>
                  <span className="num">{money(p.quote_total ?? p.items_total, locale)}</span>
                  <span className="muted num">{p.done_count}/{p.items_count}</span>
                  <PlanBadge state={p.state} />
                  {p.readable ? <Link to={`${base}/plans/${p.id}`} className="btn btn-ghost btn-sm">{tx('فتح', 'Open')}</Link> : <span className="muted">—</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {cases.data !== null && (
        <section className="card">
          <div className="card-head">
            <h2>{tx('أعمال المعمل', 'Lab work')}</h2>
            {can('dental.lab') && <Button size="sm" variant="ghost" icon="plus" onClick={() => setNewCase(true)}>{tx('حالة معمل', 'Lab case')}</Button>}
          </div>
          {cases.error ? <ErrorState error={cases.error} onRetry={cases.reload} /> : !cases.data ? <SkeletonRows rows={2} cols={4} /> : !cases.data.length ? (
            <EmptyState icon="package" title={tx('لا توجد أعمال معمل', 'No lab work')} />
          ) : (
            <ul className="plan-rows">
              {cases.data.map((c) => (
                <li key={c.id}>
                  <div><strong>{WORK_TYPES[c.work_type][lang]}{c.teeth && <span className="mono"> · {c.teeth}</span>}</strong>
                    <small className="muted"><span className="mrn">{c.ref}</span> · {c.lab_name}{c.due_on && <> · {tx('موعد الرجوع', 'due')} <bdi>{fmtDate(c.due_on, locale)}</bdi></>}</small></div>
                  <span className="num">{money(c.lab_cost, locale)}</span>
                  <span />
                  <LabBadge status={c.status} overdue={c.overdue} />
                  <Link to={`${base}/lab-cases?open=${c.id}`} className="btn btn-ghost btn-sm">{tx('فتح', 'Open')}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {newPlan && <NewPlanModal patientId={patient.id} onClose={() => setNewPlan(false)} />}
      {newCase && <NewLabCaseModal patientId={patient.id} onClose={() => setNewCase(false)} onCreated={() => cases.reload()} />}
    </div>
  )
}
