import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useClinical } from '../clinical/meta'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import PageLoader from '../PageLoader'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, Avatar, Badge, ErrorState } from '../ui'
import { useToast } from '../Toast'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'
import { clock, dayLabel, dayKey } from '../../lib/clinicTime'
import { ageLabel, sexLabel, ALERT_KINDS } from '../patients/meta'
import { serviceNames } from '../appointments/meta'
import DiagnosisPicker from './DiagnosisPicker'
import PrescriptionEditor, { itemProblem, itemToBody, rowToItem } from './PrescriptionEditor'
import { VitalsModal, VitalsTiles } from './Vitals'
import { FORMS, VisitBadge, diagnosisName, useVisits } from './meta'

const FOLLOW_UP = [3, 5, 7, 10, 14, 21, 28, 30, 42, 56, 90, 180, 365]

function noteFrom(v) {
  return {
    complaint: v.complaint || '', history: v.history || '', examination: v.examination || '', plan: v.plan || '',
    diagnoses: v.diagnoses || [], follow_up_days: v.follow_up_days ? String(v.follow_up_days) : '',
    follow_up_note: v.follow_up_note || '', patient_summary: v.patient_summary || '',
  }
}

function noteBody(n) {
  return {
    complaint: n.complaint, history: n.history, examination: n.examination, plan: n.plan,
    diagnoses: n.diagnoses.map((d) => ({ diagnosis_id: d.diagnosis_id || null, text: (d.text || '').trim() || null })),
    follow_up_days: n.follow_up_days ? Number(n.follow_up_days) : null, follow_up_note: n.follow_up_note,
    patient_summary: n.patient_summary,
  }
}

function SaveState({ state, at }) {
  const { tx, locale } = useI18n()
  if (state === 'saving') return <span className="save-state"><span className="spinner" aria-hidden="true" /> {tx('جارٍ الحفظ…', 'Saving…')}</span>
  if (state === 'error') return <span className="save-state bad"><Icon name="alert" size={14} /> {tx('لم يُحفظ — سنحاول مجددًا', 'Not saved — will retry')}</span>
  if (state === 'blocked') return <span className="save-state warn"><Icon name="alert" size={14} /> {tx('الروشتة تحتاج استكمال', 'Prescription needs completing')}</span>
  if (at) return <span className="save-state ok"><Icon name="check" size={14} /> {tx('حُفظت المسودة', 'Draft saved')} <bdi className="num">{clock(at, locale)}</bdi></span>
  return null
}

// Read-only rendering of a signed visit (also used for the medical director).
function SignedNote({ visit, rx }) {
  const { tx, lang, pick } = useI18n()
  const block = (label, text) => text && (<><dt>{label}</dt><dd className="prewrap" dir="auto">{text}</dd></>)
  return (
    <>
      <section className="card">
        <div className="card-head"><h2>{tx('ملاحظات الزيارة', 'Visit note')}</h2><Badge tone="neutral"><Icon name="lock" size={12} /> {tx('مقفلة', 'Locked')}</Badge></div>
        <div className="card-body">
          <dl className="dl note-dl">
            {block(tx('الشكوى', 'Complaint'), visit.complaint)}
            {block(tx('التاريخ المرضي', 'History'), visit.history)}
            {block(tx('الفحص', 'Examination'), visit.examination)}
            <dt>{tx('التشخيص', 'Diagnosis')}</dt>
            <dd>
              <ul className="dx-read">
                {visit.diagnoses.map((d, i) => (
                  <li key={i}>{i === 0 && <span className="badge badge-gold badge-plain">{tx('رئيسي', 'Main')}</span>} {diagnosisName(d, pick)} {d.code && <span className="mono muted">{d.code}</span>}</li>
                ))}
              </ul>
            </dd>
            {block(tx('الخطة', 'Plan'), visit.plan)}
            {visit.follow_up_days && (<><dt>{tx('المتابعة', 'Follow-up')}</dt><dd>{tx(`بعد ${visit.follow_up_days} يوم`, `In ${visit.follow_up_days} days`)}{visit.follow_up_note && <span className="muted"> · {visit.follow_up_note}</span>}</dd></>)}
          </dl>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2><Icon name="pill" size={18} /> {tx('الروشتة', 'Prescription')}</h2><span className="muted">{rx.length}</span></div>
        {!rx.length ? <p className="card-body muted">{tx('لم تُوصف أدوية في هذه الزيارة.', 'No drugs were prescribed at this visit.')}</p> : (
          <ol className="rx-read">
            {rx.map((r) => (
              <li key={r.id}>
                <div><bdi dir="ltr"><strong>{r.drug_name}</strong> <small className="muted">{r.generic_name}</small></bdi> <small className="muted">· {FORMS[r.form]?.[lang] || r.form}</small>
                  {r.restricted && <> <span className="badge badge-gold">{tx('مقيّد', 'Restricted')}</span></>}</div>
                <div className="rx-sig"><bdi dir="ltr">{r.dose} · {r.frequency} · {r.duration}</bdi>{r.instructions && <> · <em dir="auto">{r.instructions}</em></>}</div>
                {r.allergy_alert && <small className="rx-note danger"><Icon name="alert" size={13} /> {tx('وُصف رغم حساسية مسجّلة', 'Prescribed despite a recorded allergy')} ({r.allergy_alert}): {r.allergy_reason}</small>}
                {r.restricted && <small className="rx-note"><Icon name="lock" size={13} /> {r.restricted_reason}</small>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}

function ReleasePanel({ data, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useVisits()
  const toast = useToast()
  const v = data.visit
  const [summary, setSummary] = useState(v.patient_summary || '')
  const [busy, setBusy] = useState(false)
  const release = async () => {
    setBusy(true)
    try {
      onDone(await api.release(v.id, summary.trim()))
      toast.success(tx('أصبح الملخص والروشتة متاحين للمريض.', 'The summary and prescription are now visible to the patient.'))
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card release-card">
      <div className="card-head"><h2><Icon name="sparkle" size={18} /> {tx('ما يراه المريض', 'What the patient sees')}</h2>
        {v.released_at ? <Badge tone="success">{tx('مُتاح للمريض', 'Released')}</Badge> : <Badge tone="gold">{tx('لم يُتح بعد', 'Not released')}</Badge>}</div>
      <div className="card-body form">
        {v.released_at ? (
          <>
            <p className="patient-summary prewrap" dir="auto">{v.patient_summary}</p>
            <p className="muted" style={{ fontSize: '.84rem' }}>{tx('أتاحه', 'Released by')} {pick(v, 'released_by')} · <bdi>{fmtDateTime(v.released_at, locale)}</bdi>
              {data.rx.length > 0 && ` · ${tx('مع الروشتة', 'with the prescription')}`}</p>
          </>
        ) : data.can.release ? (
          <>
            <p className="muted" style={{ fontSize: '.88rem' }}>{tx('اكتب للمريض شرحًا مبسطًا. يرى المريض هذا الملخص والروشتة فقط، ولا يرى ملاحظاتك الطبية أبدًا.',
              'Write a simple explanation for the patient. They see only this summary and the prescription, never your medical notes.')}</p>
            <TextArea label={tx('ملخص للمريض', 'Summary for the patient')} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={3000} rows={4}
              placeholder={tx('مثال: عندك إكزيما بسيطة. استخدم الكريم مرة يوميًا لمدة أسبوعين…', 'e.g. You have mild eczema. Use the cream once a day for two weeks…')} />
            <Button icon="sparkle" loading={busy} disabled={summary.trim().length < 10} onClick={release} style={{ justifySelf: 'start' }}>
              {tx('إتاحة للمريض', 'Release to the patient')}
            </Button>
          </>
        ) : <p className="muted">{tx('لم يُتح الطبيب المعالج هذه الزيارة للمريض بعد.', "The treating doctor hasn't released this visit to the patient yet.")}</p>}
      </div>
    </section>
  )
}

function Addenda({ data, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useVisits()
  const toast = useToast()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async () => {
    setBusy(true)
    try {
      onDone(await api.addendum(data.visit.id, body.trim()))
      setBody('')
      toast.success(tx('أُضيفت الملاحظة اللاحقة.', 'Addendum added.'))
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }
  if (!data.addenda.length && !data.can.addendum) return null
  return (
    <section className="card">
      <div className="card-head"><h2>{tx('ملاحظات لاحقة (تصحيحات)', 'Addenda (corrections)')}</h2><span className="muted">{data.addenda.length}</span></div>
      <div className="card-body form">
        {data.addenda.length > 0 && (
          <ul className="addenda">
            {data.addenda.map((a) => (
              <li key={a.id}><p className="prewrap" dir="auto">{a.body}</p><small className="muted">{pick(a, 'author_name')} · <bdi>{fmtDateTime(a.created_at, locale)}</bdi></small></li>
            ))}
          </ul>
        )}
        {data.can.addendum && (
          <>
            <TextArea label={tx('إضافة ملاحظة لاحقة', 'Add an addendum')} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} rows={3}
              hint={tx('الزيارة الأصلية لا تتغير. تُضاف الملاحظة بتاريخها واسمك تحتها.', 'The original visit never changes. The addendum is added below it with the date and your name.')} />
            <Button variant="ghost" icon="plus" loading={busy} disabled={body.trim().length < 5} onClick={add} style={{ justifySelf: 'start' }}>{tx('إضافة', 'Add')}</Button>
          </>
        )}
      </div>
    </section>
  )
}

// Laser and dental services have their own records; open them from the visit.
function ClinicalLinks({ visit, appt }) {
  const { t, tx } = useI18n()
  const { laser, base, can } = useClinical()
  const toast = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const kinds = new Set((appt?.services || []).map((s) => s.clinical_record).filter(Boolean))
  if (!kinds.size) return null
  const startLaser = async () => {
    setBusy(true)
    try {
      const s = await laser.start(appt.id)
      navigate(`${base}/laser/${s.id}`)
    } catch (err) {
      toast.error(errorText(err, t))
      setBusy(false)
    }
  }
  return (
    <section className="card">
      <div className="card-head"><h2>{tx('سجلات هذه الخدمة', 'Records for this service')}</h2></div>
      <div className="card-body form">
        {kinds.has('laser') && can('laser.record') && (
          <Button variant="gold" icon="sparkle" loading={busy} onClick={startLaser} block>{tx('سجل جلسة الليزر', 'Laser session record')}</Button>
        )}
        {kinds.has('dental') && (
          <Link to={`${base}/patients/${visit.patient_id}?tab=dental`} className="btn btn-gold btn-block"><Icon name="layers" size={18} />{tx('خريطة الأسنان وخطة العلاج', 'Tooth chart & treatment plan')}</Link>
        )}
      </div>
    </section>
  )
}

// The visit record: opened when the doctor calls the patient in; signed (and locked) when the visit ends.
export default function VisitWorkspace() {
  const { id } = useParams()
  const { t, tx, lang, pick, locale } = useI18n()
  const { api, base, can } = useVisits()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [items, setItems] = useState([])
  const [save, setSave] = useState({ state: null, at: null })
  const [confirming, setConfirming] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signErrors, setSignErrors] = useState({})
  const [vitalsOpen, setVitalsOpen] = useState(false)
  const dirty = useRef({ note: false, rx: false })
  const timer = useRef(null)
  const latest = useRef({ note: null, items: [] })
  latest.current = { note, items }

  const load = useCallback((d) => {
    setData(d)
    setNote(noteFrom(d.visit))
    setItems(d.rx.map(rowToItem))
    dirty.current = { note: false, rx: false }
  }, [])

  useEffect(() => {
    setData(null)
    api.get(id).then(load).catch(setError)
  }, [id, api, load])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const { note: n, items: list } = latest.current
    if (!n) return true
    const rxReady = list.every((it) => !itemProblem(it))
    if (!dirty.current.note && !(dirty.current.rx && rxReady)) {
      if (dirty.current.rx && !rxReady) setSave({ state: 'blocked', at: null })
      return !dirty.current.rx
    }
    setSave((s) => ({ ...s, state: 'saving' }))
    try {
      if (dirty.current.note) {
        dirty.current.note = false
        await api.save(id, noteBody(n))
      }
      if (dirty.current.rx && rxReady) {
        dirty.current.rx = false
        await api.saveRx(id, list.map(itemToBody))
      }
      setSave({ state: dirty.current.rx ? 'blocked' : null, at: new Date().toISOString() })
      return !dirty.current.rx
    } catch (err) {
      dirty.current = { note: true, rx: true }
      setSave({ state: 'error', at: null })
      if (err.code && !['network', 'server_error'].includes(err.code)) toast.error(errorText(err, t))
      return false
    }
  }, [api, id, t, toast])

  const schedule = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 1200)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    const warn = (e) => { if (dirty.current.note || dirty.current.rx) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  const setField = (key) => (e) => { setNote((n) => ({ ...n, [key]: e.target ? e.target.value : e })); dirty.current.note = true; schedule() }
  const setRx = (next) => { setItems(next); dirty.current.rx = true; schedule() }

  const sign = async () => {
    setSigning(true)
    setSignErrors({})
    try {
      const ok = await flush()
      if (!ok) {
        toast.error(tx('أكمل الروشتة قبل التوقيع.', 'Complete the prescription before signing.'))
        return
      }
      load(await api.sign(id))
      setConfirming(false)
      toast.success(tx('وُقّعت الزيارة وقُفلت، وانتهى الموعد.', 'Visit signed and locked; the appointment is finished.'))
    } catch (err) {
      setSignErrors(err.fields || {})
      toast.error(errorText(err, t))
      setConfirming(false)
    } finally {
      setSigning(false)
    }
  }

  if (error) return <ErrorState error={error} onRetry={() => { setError(null); api.get(id).then(load).catch(setError) }} />
  if (!data || !note) return <PageLoader />

  const v = data.visit
  const appt = data.appointment
  const draft = v.status === 'draft'
  const writable = data.can.write
  const latestVitals = data.vitals[0]
  const critical = data.alerts.filter((a) => a.severity === 'critical')
  const problems = Object.fromEntries(items.map((it, i) => [i, itemProblem(it)]).filter(([, p]) => p))
  const day = appt ? dayKey(appt.starts_at) : dayKey(v.started_at)

  return (
    <div className="page reveal visit-page">
      <Link to={`${base}/${can('visits.view_all') ? 'visits' : 'my-day'}`} className="back-link"><Icon name="arrowLeft" size={16} />{can('visits.view_all') ? tx('الزيارات', 'Visits') : tx('يومي', 'My day')}</Link>
      <header className="card card-pad visit-head">
        <Avatar name={pick(v, 'patient_name')} size="lg" />
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow"><span className="mrn">{v.ref}</span> · {dayLabel(day, locale)}{appt && <> · <bdi className="num">{clock(appt.starts_at, locale)}</bdi></>} <VisitBadge visit={v} /></div>
          <h1>{pick(v, 'patient_name')}</h1>
          <div className="file-facts">
            <span className="chip"><span className="mrn">{v.mrn}</span></span>
            <span className="chip">{ageLabel(v.date_of_birth, tx)} · {sexLabel(v.gender, tx)}</span>
            {appt && <span className="chip"><Icon name="clipboard" size={14} />{serviceNames(appt.services, pick)}</span>}
            <span className="chip"><Icon name="stethoscope" size={14} />{pick(v, 'doctor_name')}</span>
          </div>
        </div>
        <div className="page-actions">
          {draft && writable && <SaveState {...save} />}
          <Link to={`${base}/patients/${v.patient_id}`} className="btn btn-ghost"><Icon name="fileSearch" size={18} />{tx('ملف المريض', 'Patient file')}</Link>
          {!draft && data.rx.length > 0 && <Link to={`${base}/visits/${v.id}/print`} className="btn btn-ghost"><Icon name="printer" size={18} />{tx('طباعة الروشتة', 'Print prescription')}</Link>}
        </div>
      </header>

      {critical.map((a) => (
        <Alert key={a.id} tone="danger" icon="alert" title={`${ALERT_KINDS[a.kind]?.[lang] || a.kind}:`}>{a.description}</Alert>
      ))}

      <div className="visit-grid">
        <div className="visit-main">
          {draft && writable ? (
            <>
              <section className="card">
                <div className="card-head"><h2>{tx('ملاحظات الزيارة', 'Visit note')}</h2><span className="muted" style={{ fontSize: '.8rem' }}>{tx('لا يراها المريض', 'Never shown to the patient')}</span></div>
                <div className="card-body form">
                  <TextArea label={tx('الشكوى', 'Complaint')} value={note.complaint} onChange={setField('complaint')} rows={2} maxLength={4000}
                    error={signErrors.complaint && tx('اكتب الشكوى أو الفحص قبل التوقيع.', 'Write the complaint or examination before signing.')}
                    placeholder={tx('سبب الزيارة بكلمات المريض', "Why the patient came, in their words")} data-autofocus />
                  <TextArea label={tx('التاريخ المرضي', 'History')} optional value={note.history} onChange={setField('history')} rows={2} maxLength={8000} />
                  <TextArea label={tx('الفحص', 'Examination')} value={note.examination} onChange={setField('examination')} rows={3} maxLength={8000} />
                </div>
              </section>
              <section className="card">
                <div className="card-body form">
                  <DiagnosisPicker value={note.diagnoses} onChange={(d) => { setNote((n) => ({ ...n, diagnoses: d })); dirty.current.note = true; schedule() }}
                    error={signErrors.diagnoses && tx('أضف تشخيصًا واحدًا على الأقل قبل التوقيع.', 'Add at least one diagnosis before signing.')} />
                  <TextArea label={tx('الخطة', 'Plan')} value={note.plan} onChange={setField('plan')} rows={3} maxLength={8000}
                    placeholder={tx('العلاج، التحاليل، الإجراءات، التعليمات', 'Treatment, tests, procedures, advice')} />
                  <div className="form-grid">
                    <SelectField label={tx('موعد المتابعة', 'Follow-up')} optional value={note.follow_up_days} onChange={setField('follow_up_days')}
                      placeholder={tx('لا يحتاج متابعة', 'No follow-up needed')}
                      options={FOLLOW_UP.map((d) => ({ value: String(d), label: tx(`بعد ${d} يوم`, `In ${d} days`) }))}
                      hint={tx('يظهر للاستقبال في قائمة "متابعات مطلوبة" ليحجزها.', 'Shows on reception’s “Follow-ups due” list to book.')} />
                    <TextField label={tx('ملاحظة للاستقبال', 'Note for reception')} optional value={note.follow_up_note} onChange={setField('follow_up_note')} maxLength={300}
                      disabled={!note.follow_up_days} placeholder={tx('مثال: يحضر نتيجة التحليل', 'e.g. bring the lab result')} />
                  </div>
                </div>
              </section>
              <section className="card">
                <div className="card-head"><h2><Icon name="pill" size={18} /> {tx('الروشتة', 'Prescription')}</h2><span className="muted">{items.length}</span></div>
                <div className="card-body">
                  <PrescriptionEditor items={items} onChange={setRx} patientId={v.patient_id} canRestricted={data.can.restricted} problems={problems} />
                </div>
              </section>
              <section className="card">
                <div className="card-head"><h2><Icon name="sparkle" size={18} /> {tx('ملخص للمريض', 'Summary for the patient')}</h2><span className="muted" style={{ fontSize: '.8rem' }}>{tx('اختياري الآن', 'Optional now')}</span></div>
                <div className="card-body form">
                  <TextArea label={tx('ما سيقرؤه المريض بعد الإتاحة', 'What the patient will read once released')} optional value={note.patient_summary}
                    onChange={setField('patient_summary')} rows={3} maxLength={3000}
                    hint={tx('بعد التوقيع تُتيح هذا الملخص مع الروشتة للمريض بضغطة واحدة.', 'After signing, you release this summary with the prescription in one click.')} />
                </div>
              </section>
            </>
          ) : (
            <>
              <SignedNote visit={v} rx={data.rx} />
              {!draft && <ReleasePanel data={data} onDone={load} />}
              {!draft && <Addenda data={data} onDone={load} />}
              {draft && !writable && <Alert tone="info">{tx('هذه الزيارة لم يوقّعها الطبيب المعالج بعد.', "The treating doctor hasn't signed this visit yet.")}</Alert>}
            </>
          )}
        </div>

        <aside className="visit-side">
          <ClinicalLinks visit={v} appt={appt} />
          <section className="card">
            <div className="card-head"><h2><Icon name="alert" size={17} /> {tx('التنبيهات الطبية', 'Medical alerts')}</h2></div>
            <div className="card-body">
              {!data.alerts.length ? <p className="muted">{tx('لا توجد تنبيهات مسجّلة.', 'No alerts recorded.')}</p> : (
                <ul className="alert-mini">
                  {data.alerts.map((a) => (
                    <li key={a.id} className={`sev-${a.severity}`}><strong>{ALERT_KINDS[a.kind]?.[lang] || a.kind}</strong><span dir="auto">{a.description}</span></li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <h2><Icon name="thermometer" size={17} /> {tx('العلامات الحيوية', 'Vital signs')}</h2>
              {can('visits.vitals') && draft && <Button size="sm" variant="ghost" icon="plus" onClick={() => setVitalsOpen(true)}>{tx('تسجيل', 'Record')}</Button>}
            </div>
            <div className="card-body">
              {latestVitals ? <VitalsTiles vitals={latestVitals} /> : <p className="muted">{tx('لم تُسجَّل علامات حيوية لهذه الزيارة.', 'No vital signs recorded for this visit.')}</p>}
              {data.vitals.length > 1 && <p className="muted" style={{ fontSize: '.8rem', marginTop: 8 }}>{tx(`${data.vitals.length - 1} قياس سابق في نفس اليوم`, `${data.vitals.length - 1} earlier reading(s) the same day`)}</p>}
            </div>
          </section>
          {draft && writable && (
            <section className="card sign-card">
              <div className="card-body form">
                <h2>{tx('إنهاء الزيارة', 'Finish the visit')}</h2>
                <p className="muted">{tx('التوقيع يقفل الملاحظات والروشتة نهائيًا، وينهي الموعد. أي تصحيح بعدها يُضاف كملاحظة لاحقة مؤرخة.',
                  'Signing locks the note and prescription for good and finishes the appointment. Any correction afterwards is added as a dated addendum.')}</p>
                <Button size="lg" icon="pen" block onClick={() => setConfirming(true)}>{tx('توقيع وإنهاء الزيارة', 'Sign & finish visit')}</Button>
              </div>
            </section>
          )}
          {!draft && (
            <section className="card card-pad signed-stamp">
              <Icon name="shieldCheck" size={22} />
              <div>
                <strong>{tx('وُقّعت', 'Signed')} · <bdi>{fmtDateTime(v.signed_at, locale)}</bdi></strong>
                <small className="muted">{pick(v, 'doctor_name')}{pick(v, 'doctor_title') && ` — ${pick(v, 'doctor_title')}`}</small>
              </div>
            </section>
          )}
        </aside>
      </div>

      {confirming && (
        <Modal open onClose={() => setConfirming(false)} busy={signing} title={tx('توقيع الزيارة؟', 'Sign this visit?')}
          footer={<><Button variant="ghost" onClick={() => setConfirming(false)} disabled={signing}>{t('cancel')}</Button><Button icon="pen" loading={signing} onClick={sign}>{tx('توقيع وإقفال', 'Sign & lock')}</Button></>}>
          <div className="form">
            <p>{tx('بعد التوقيع لن يمكن تعديل الملاحظات أو التشخيص أو الروشتة. التصحيحات تُضاف كملاحظات لاحقة.',
              "After signing, the note, diagnosis and prescription can't be edited. Corrections are added as addenda.")}</p>
            <dl className="dl">
              <dt>{tx('التشخيص', 'Diagnosis')}</dt><dd>{note.diagnoses.length ? note.diagnoses.map((d) => diagnosisName(d, pick)).join('، ') : <span className="field-error">{tx('لا يوجد', 'None')}</span>}</dd>
              <dt>{tx('الروشتة', 'Prescription')}</dt><dd>{items.length ? items.map((i) => i.drug.name).join('، ') : tx('بدون أدوية', 'No drugs')}</dd>
              <dt>{tx('المتابعة', 'Follow-up')}</dt><dd>{note.follow_up_days ? tx(`بعد ${note.follow_up_days} يوم`, `In ${note.follow_up_days} days`) : tx('لا', 'None')}</dd>
            </dl>
            {Object.keys(problems).length > 0 && <Alert tone="danger">{tx('بعض أدوية الروشتة تحتاج استكمال قبل التوقيع.', 'Some prescription lines need completing before signing.')}</Alert>}
          </div>
        </Modal>
      )}
      {vitalsOpen && (
        <VitalsModal appointmentId={v.appointment_id} patientId={v.patient_id} patientName={pick(v, 'patient_name')} onClose={() => setVitalsOpen(false)}
          onSaved={(row) => setData((d) => ({ ...d, vitals: [row, ...d.vitals] }))} />
      )}
    </div>
  )
}
