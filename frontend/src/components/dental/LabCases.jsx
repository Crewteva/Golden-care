import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import PageLoader from '../PageLoader'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync, useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'
import { fmtDate, fmtDateTime, fmtPhone } from '../../lib/format'
import { LAB_MOVES, LAB_STATUS, LabBadge, WORK_TYPES, money, useClinical } from '../clinical/meta'

function CaseModal({ id, onClose, onChanged }) {
  const { t, tx, lang, pick, locale } = useI18n()
  const { dental, base, can } = useClinical()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [move, setMove] = useState(null)
  const [note, setNote] = useState('')
  const [due, setDue] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { dental.getCase(id).then(setData).catch(setError) }, [id, dental])

  const run = async (fn, ok) => {
    setBusy(true)
    try {
      setData(await fn())
      toast.success(ok)
      setMove(null)
      setEditing(false)
      setNote('')
      onChanged()
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  if (error) return <Modal open onClose={onClose} title={tx('حالة معمل', 'Lab case')}><Alert tone="danger">{errorText(error, t)}</Alert></Modal>
  if (!data) return <Modal open onClose={onClose} title={tx('حالة معمل', 'Lab case')}><PageLoader /></Modal>
  const c = data.case
  const writable = can('dental.lab') && !['delivered', 'cancelled'].includes(c.status)
  const needsNote = ['remake', 'cancelled'].includes(move)
  const startEdit = () => { setForm({ lab_id: String(c.lab_id), work_type: c.work_type, teeth: c.teeth || '', shade: c.shade || '', instructions: c.instructions || '', due_on: c.due_on || '', lab_cost: c.lab_cost ?? '', doctor_share_pct: String(Number(c.doctor_share_pct)) }); setEditing(true) }

  return (
    <Modal open wide onClose={onClose} busy={busy}
      title={<span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{WORK_TYPES[c.work_type][lang]} <span className="mrn muted" style={{ fontSize: '.9rem' }}>{c.ref}</span> <LabBadge status={c.status} overdue={c.overdue} /></span>}
      footer={<Button variant="ghost" onClick={onClose}>{t('close')}</Button>}>
      <div className="form">
        <dl className="dl">
          <dt>{tx('المريض', 'Patient')}</dt><dd><Link to={`${base}/patients/${c.patient_id}?tab=dental`} className="person-name">{pick(c, 'patient_name')}</Link> <span className="mrn muted">{c.mrn}</span></dd>
          <dt>{tx('الطبيب', 'Doctor')}</dt><dd>{pick(c, 'doctor_name')}</dd>
          <dt>{tx('المعمل', 'Lab')}</dt><dd>{c.lab_name}{c.lab_phone && <> · <bdi className="ltr">{fmtPhone(c.lab_phone)}</bdi></>}</dd>
          <dt>{tx('الأسنان / اللون', 'Teeth / shade')}</dt><dd className="mono">{c.teeth || '—'}{c.shade && ` · ${c.shade}`}</dd>
          <dt>{tx('موعد الرجوع', 'Due back')}</dt><dd>{c.due_on ? <bdi>{fmtDate(c.due_on, locale)}</bdi> : '—'}{c.remake_count > 0 && <span className="muted"> · {tx(`أُعيد ${c.remake_count} مرة`, `remade ${c.remake_count}×`)}</span>}</dd>
          <dt>{tx('تكلفة المعمل', 'Lab cost')}</dt><dd className="num">{money(c.lab_cost, locale)}{Number(c.doctor_share_pct) > 0 && <span className="muted"> · {tx('نصيب الطبيب', "doctor's share")} {Number(c.doctor_share_pct)}% = {money(c.doctor_share, locale)}</span>}</dd>
          {c.plan_ref && <><dt>{tx('خطة العلاج', 'Plan')}</dt><dd><Link to={`${base}/plans/${c.plan_id}`}>{c.plan_ref}</Link></dd></>}
          {c.instructions && <><dt>{tx('تعليمات', 'Instructions')}</dt><dd dir="auto">{c.instructions}</dd></>}
        </dl>

        {writable && !move && !editing && (
          <div className="appt-actions">
            {data.moves.map((m) => (
              <Button key={m} variant={m === 'cancelled' ? 'quiet' : m === 'remake' ? 'ghost' : 'primary'} icon={LAB_MOVES[m].icon}
                onClick={() => { setMove(m); setDue(m === 'sent' ? c.due_on || '' : '') }}>{LAB_MOVES[m][lang]}</Button>
            ))}
            <Button variant="ghost" icon="edit" onClick={startEdit}>{t('edit')}</Button>
          </div>
        )}
        {move && (
          <section className="card card-pad form">
            <h3 style={{ fontSize: '1rem' }}>{LAB_MOVES[move][lang]}</h3>
            {move === 'sent' && <TextField label={tx('موعد الرجوع المتوقع', 'Expected back on')} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
            <TextArea label={needsNote ? tx('السبب', 'Reason') : tx('ملاحظة', 'Note')} optional={!needsNote} value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder={move === 'remake' ? tx('مثال: العضة عالية من الناحية اليسرى', 'e.g. bite too high on the left') : ''} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button loading={busy} disabled={(needsNote && note.trim().length < 3) || (move === 'sent' && !due)}
                onClick={() => run(() => dental.moveCase(c.id, { to: move, note: note.trim() || null, due_on: due || null }), tx('تم التحديث.', 'Updated.'))}>{t('save')}</Button>
              <Button variant="ghost" onClick={() => setMove(null)}>{t('back')}</Button>
            </div>
          </section>
        )}
        {editing && form && (
          <section className="card card-pad form">
            <div className="form-grid">
              <TextField label={tx('الأسنان', 'Teeth')} value={form.teeth} onChange={(e) => setForm({ ...form, teeth: e.target.value })} dir="ltr" />
              <TextField label={tx('اللون', 'Shade')} value={form.shade} onChange={(e) => setForm({ ...form, shade: e.target.value })} dir="ltr" />
              <TextField label={tx('موعد الرجوع', 'Due back')} type="date" value={form.due_on} onChange={(e) => setForm({ ...form, due_on: e.target.value })} />
              <TextField label={tx('تكلفة المعمل', 'Lab cost')} value={form.lab_cost} onChange={(e) => setForm({ ...form, lab_cost: e.target.value })} inputMode="decimal" dir="ltr" />
              <TextField label={tx('نصيب الطبيب %', "Doctor's share %")} value={form.doctor_share_pct} onChange={(e) => setForm({ ...form, doctor_share_pct: e.target.value })} inputMode="decimal" dir="ltr" />
              <SelectField label={tx('نوع العمل', 'Work')} value={form.work_type} onChange={(e) => setForm({ ...form, work_type: e.target.value })} options={Object.entries(WORK_TYPES).map(([value, w]) => ({ value, label: w[lang] }))} />
            </div>
            <TextArea label={tx('تعليمات', 'Instructions')} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} rows={2} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button loading={busy} onClick={() => run(() => dental.editCase(c.id, { ...form, lab_id: Number(form.lab_id), due_on: form.due_on || null, lab_cost: form.lab_cost === '' ? null : Number(form.lab_cost), doctor_share_pct: Number(form.doctor_share_pct) || 0, teeth: form.teeth || null, shade: form.shade || null, instructions: form.instructions || null }), tx('تم الحفظ.', 'Saved.'))}>{t('save')}</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>{t('back')}</Button>
            </div>
          </section>
        )}

        <div>
          <h3 className="schedule-title">{tx('مسار الحالة', 'Case history')}</h3>
          <ul className="feed">
            {data.events.map((e) => (
              <li key={e.id}>
                <span className="dot"><Icon name={LAB_STATUS[e.to_status]?.icon || 'edit'} size={15} /></span>
                <span>{e.action === 'edited' ? tx('تعديل البيانات', 'Details edited') : LAB_STATUS[e.to_status]?.[lang] || e.action}{e.note && <> · <span dir="auto">{e.note}</span></>}
                  <small>{e.actor_label} · <bdi>{fmtDateTime(e.at, locale)}</bdi></small></span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  )
}

// Lab work: every case from ordered to delivered, with overdue ones and those waiting to be fitted on top.
export default function LabCases() {
  const { tx, lang, pick, locale } = useI18n()
  const { dental } = useClinical()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState('open')
  const [lab, setLab] = useState('')
  const [q, setQ] = useState('')
  const term = useDebounced(q, 300)
  const open = params.get('open')
  const labs = useAsync(() => dental.labs(), [dental])
  const { data, error, loading, reload } = useAsync(() => dental.cases({ state, lab_id: lab, q: term }), [state, lab, term, dental])
  const tabs = [['open', tx('مفتوحة', 'Open')], ['overdue', tx('متأخرة', 'Overdue')], ['ready', tx('جاهزة للتسليم', 'Ready to fit')], ['delivered', tx('سُلّمت', 'Delivered')], ['', tx('الكل', 'All')]]

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الأسنان', 'Dental')} title={tx('أعمال المعمل', 'Lab work')}
        description={tx('من الطلب حتى التسليم للمريض. لإنشاء حالة جديدة افتح ملف المريض (تبويب الأسنان) أو بند في خطة العلاج.',
          "From order to delivery to the patient. To create a case, open the patient's file (Dental tab) or an item in a treatment plan.")} />
      {labs.data?.length > 0 && (
        <div className="device-strip">
          {labs.data.map((l) => (
            <button key={l.id} type="button" className={`device-pill ${String(l.id) === lab ? 'on' : ''}`} onClick={() => setLab(String(l.id) === lab ? '' : String(l.id))}>
              <Icon name="package" size={16} />
              <span><strong>{l.name}</strong><small className="muted">{tx(`${l.open_cases} حالة مفتوحة`, `${l.open_cases} open`)}</small></span>
              <span className="num device-counter" title={tx('تكلفة الأعمال المستلمة (مستحقة للمعمل)', 'Cost of work received (owed to the lab)')}>{money(l.cost_total, locale)}</span>
            </button>
          ))}
        </div>
      )}
      <section className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={state === k} onClick={() => setState(k)}>{l}</button>)}</div>
          <div className="input-wrap" style={{ minWidth: 220 }}>
            <span className="input-start"><Icon name="search" size={18} /></span>
            <input className="input has-start" value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx('بحث', 'Search')} placeholder={tx('مريض، رقم حالة، سن…', 'Patient, case no., tooth…')} />
          </div>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={5} cols={5} /> : !data.length ? (
          <EmptyState icon="package" title={tx('لا توجد حالات هنا', 'No cases here')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tx('العمل', 'Work')}</th><th>{tx('المريض', 'Patient')}</th><th>{tx('المعمل', 'Lab')}</th><th>{tx('موعد الرجوع', 'Due back')}</th><th>{tx('الحالة', 'Status')}</th></tr></thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id} className="row-link" onClick={() => setParams({ open: c.id })}>
                    <td><button type="button" className="link-btn person-name" onClick={(e) => { e.stopPropagation(); setParams({ open: c.id }) }}>{WORK_TYPES[c.work_type][lang]}</button>
                      <small className="muted" style={{ display: 'block' }}><span className="mrn">{c.ref}</span>{c.teeth && <> · <span className="mono">{c.teeth}</span></>}{c.shade && ` · ${c.shade}`}</small></td>
                    <td><strong>{pick(c, 'patient_name')}</strong><small className="muted" style={{ display: 'block' }}>{pick(c, 'doctor_name')}</small></td>
                    <td>{c.lab_name}</td>
                    <td>{c.due_on ? <bdi>{fmtDate(c.due_on, locale)}</bdi> : '—'}</td>
                    <td><LabBadge status={c.status} overdue={c.overdue} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open && <CaseModal id={open} onClose={() => setParams({})} onChanged={reload} />}
    </div>
  )
}
