import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import PageLoader from '../PageLoader'
import TempPasswordNotice from '../TempPasswordNotice'
import { TextArea } from '../Fields'
import { Alert, Avatar, Badge, ErrorState } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { actionMeta } from '../../lib/activity'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtDate, fmtDateTime, fmtPhone } from '../../lib/format'
import PatientAppointments from '../appointments/PatientAppointments'
import AlertsStrip from './AlertsStrip'
import Documents from './Documents'
import FamilyCard from './FamilyCard'
import PatientForm, { SENSITIVE, formToBody, patientToForm, validatePatient } from './PatientForm'
import { ageLabel, sexLabel } from './meta'
import { useWorkspace } from './useWorkspace'

function EditModal({ data, onClose, onSaved }) {
  const { t, tx } = useI18n()
  const { api } = useWorkspace()
  const toast = useToast()
  const original = patientToForm(data.patient)
  const [form, setForm] = useState(original)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const hasGuardian = data.family.some((f) => f.manages_this_patient)
  const sensitive = SENSITIVE.some((k) => String(form[k] ?? '').trim() !== String(original[k] ?? '').trim())

  const submit = async (event) => {
    event.preventDefault()
    const e = validatePatient(form, t, { phoneOptional: hasGuardian })
    if (sensitive && reason.trim().length < 3) e.change_reason = t('field.change_reason.required')
    setErrors(e)
    setFormError(null)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      onSaved(await api.update(data.patient.id, { ...formToBody(form), change_reason: reason.trim() || null }))
      toast.success(tx('تم حفظ التعديلات وتسجيلها في السجل.', 'Changes saved and recorded in the history.'))
      onClose()
    } catch (err) {
      setErrors(fieldErrors(err, t))
      setFormError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open wide onClose={onClose} busy={busy} title={tx('تعديل بيانات المريض', 'Edit patient details')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="edit-patient" loading={busy}>{t('save_changes')}</Button></>}>
      <form id="edit-patient" className="form" onSubmit={submit} noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <PatientForm value={form} onChange={setForm} errors={errors} phoneOptional={hasGuardian} />
        {sensitive && (
          <TextArea label={tx('سبب تغيير بيانات الهوية', 'Reason for changing identity details')} value={reason} onChange={(e) => setReason(e.target.value)}
            error={errors.change_reason} placeholder={tx('مثال: تصحيح الاسم حسب البطاقة', 'e.g. Name corrected to match the ID card')} />
        )}
      </form>
    </Modal>
  )
}

function PortalCard({ patient, onGiven }) {
  const { t, tx, locale } = useI18n()
  const { api, can } = useWorkspace()
  const toast = useToast()
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  const give = async () => {
    setBusy(true)
    try {
      setResult(await api.portalAccess(patient.id))
      onGiven()
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{tx('حساب المريض', 'Patient account')}</h2>
        {patient.has_portal ? <Badge tone="success">{tx('مفعّل', 'Active')}</Badge> : <Badge tone="neutral">{tx('لا يوجد', 'None')}</Badge>}
      </div>
      <div className="card-body" style={{ display: 'grid', gap: 12 }}>
        {patient.has_portal ? (
          <p className="muted" style={{ fontSize: '.9rem' }}>
            {patient.portal_pending
              ? tx('لم يغيّر المريض كلمة المرور المؤقتة بعد.', "The patient hasn't changed the temporary password yet.")
              : patient.portal_last_login
                ? <>{tx('آخر دخول:', 'Last sign-in:')} <bdi>{fmtDateTime(patient.portal_last_login, locale)}</bdi></>
                : tx('لم يسجّل الدخول بعد.', 'Has not signed in yet.')}
          </p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: '.9rem' }}>
              {tx('يتابع المريض نتائجه المعتمدة ومستنداته من حسابه. يسجّل الدخول برقم موبايله.', 'The patient follows released results and documents from their account, signing in with their mobile.')}
            </p>
            {can('patients.portal_access') && (
              <Button variant="ghost" icon="key" loading={busy} onClick={give} style={{ justifySelf: 'start' }}>
                {tx('إنشاء حساب للمريض', 'Create patient account')}
              </Button>
            )}
          </>
        )}
      </div>
      <Modal open={Boolean(result)} onClose={() => setResult(null)} title={tx('تم إنشاء حساب المريض', 'Patient account created')}
        footer={<Button onClick={() => setResult(null)}>{tx('تم', 'Done')}</Button>}>
        {result && <TempPasswordNotice password={result.temp_password} name={patient.full_name_ar} identifier={fmtPhone(result.phone)} />}
      </Modal>
    </section>
  )
}

function History({ patientId }) {
  const { tx, lang, locale } = useI18n()
  const { api } = useWorkspace()
  const [page, setPage] = useState(1)
  const [items, setItems] = useState([])
  const { data, error, loading, reload } = useAsync(() => api.history(patientId, page), [patientId, page, api])
  useEffect(() => {
    if (data) setItems((prev) => (page === 1 ? data.items : [...prev, ...data.items]))
  }, [data, page])

  if (error) return <ErrorState error={error} onRetry={reload} />
  return (
    <section className="card">
      <div className="card-head">
        <h2>{tx('سجل الملف', 'File history')}</h2>
        <span className="muted" style={{ fontSize: '.82rem' }}>{tx('كل تعديل وكل فتح لمستند', 'Every change and every document opened')}</span>
      </div>
      <div className="card-body" style={{ paddingBlock: 6 }}>
        <ul className="feed">
          {items.map((row) => {
            const meta = actionMeta(row.action)
            const changes = row.details?.changes
            return (
              <li key={row.id}>
                <span className={`dot ${meta.tone || ''}`}><Icon name={meta.icon} size={16} /></span>
                <span>
                  {meta[lang]}{row.details?.title ? `: ${row.details.title}` : ''}{row.details?.description ? `: ${row.details.description}` : ''}
                  <small>{row.actor_label || tx('النظام', 'System')} · <bdi>{fmtDateTime(row.at, locale)}</bdi></small>
                  {changes && (
                    <small style={{ marginTop: 4 }}>
                      {Object.entries(changes).map(([k, [from, to]]) => (
                        <span key={k} style={{ display: 'block' }}>
                          <span className="mono">{k}</span>: <bdi>{String(from ?? '—')}</bdi> → <bdi>{String(to ?? '—')}</bdi>
                        </span>
                      ))}
                    </small>
                  )}
                  {(row.details?.reason || row.details?.duplicate_override) && (
                    <small>{tx('السبب:', 'Reason:')} {row.details.reason || row.details.duplicate_override}</small>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
        {data && items.length < data.total && (
          <div style={{ padding: '12px 0' }}>
            <Button variant="ghost" size="sm" loading={loading} onClick={() => setPage((p) => p + 1)}>{tx('عرض المزيد', 'Show more')}</Button>
          </div>
        )}
      </div>
    </section>
  )
}

// The patient file page, shared by reception, doctors, nurses and the medical director.
export default function PatientFile() {
  const { id } = useParams()
  const { tx, lang, pick, locale } = useI18n()
  const { api, patientsBase, can } = useWorkspace()
  const { data, error, loading, reload, setData } = useAsync(() => api.get(id), [id, api])
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'overview'
  const setTab = (value) => setParams(value === 'overview' ? {} : { tab: value }, { replace: true })
  const [editing, setEditing] = useState(false)
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (loading && !data) return <PageLoader />

  const p = data.patient
  const name = pick(p, 'full_name')
  const other = lang === 'ar' ? p.full_name_en : p.full_name_ar
  const canSeeDocs = can('patient_files.view_admin') || can('patient_files.view_clinical')
  const tabs = [
    ['overview', tx('نظرة عامة', 'Overview')],
    ...(can('appointments.view') ? [['appointments', tx('المواعيد', 'Appointments')]] : []),
    ...(canSeeDocs ? [['documents', tx('المستندات', 'Documents'), data.counts.documents, data.counts.pending_review]] : []),
    ['history', tx('السجل', 'History')],
  ]
  const val = (v) => v || <span className="muted">—</span>

  return (
    <div className="page reveal">
      <Link to={patientsBase} className="back-link"><Icon name="arrowLeft" size={16} />{tx('ملفات المرضى', 'Patient files')}</Link>
      <header className="card card-pad file-head">
        <Avatar name={name} size="lg" />
        <div style={{ minWidth: 0 }}>
          <h1>{name}</h1>
          {other && <div className="sub">{other}</div>}
          <div className="file-facts">
            <span className="chip"><Icon name="fileSearch" size={14} /><span className="mrn">{p.mrn}</span></span>
            <span className="chip">{ageLabel(p.date_of_birth, tx)} · {sexLabel(p.gender, tx)}</span>
            {p.phone ? <span className="chip"><Icon name="smartphone" size={14} /><bdi className="ltr">{fmtPhone(p.phone)}</bdi></span>
              : <span className="chip">{tx('التواصل عبر ولي الأمر', 'Contact via guardian')}</span>}
            {p.has_portal && <Badge tone="success">{tx('له حساب على البوابة', 'Has portal account')}</Badge>}
          </div>
        </div>
        <div className="page-actions">
          {can('appointments.book') && (
            <Link to={`${patientsBase.replace(/\/patients$/, '')}/book?patient=${p.id}`} className="btn btn-gold"><Icon name="calendar" size={18} />{tx('حجز موعد', 'Book appointment')}</Link>
          )}
          {can('patients.edit') && <Button variant="ghost" icon="edit" onClick={() => setEditing(true)}>{tx('تعديل البيانات', 'Edit details')}</Button>}
        </div>
      </header>

      <AlertsStrip patientId={p.id} alerts={data.alerts} onChange={(alerts) => setData({ ...data, alerts })} />

      <div className="tabs" role="tablist" aria-label={tx('أقسام الملف', 'File sections')}>
        {tabs.map(([key, label, count, pending]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
            {count > 0 && <span className="muted"> ({count})</span>}
            {pending > 0 && <span className="badge badge-gold badge-plain" style={{ marginInlineStart: 6 }}>{pending}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="split">
          <div className="page" style={{ gap: 20 }}>
            <section className="card">
              <div className="card-head"><h2>{tx('البيانات الشخصية', 'Personal details')}</h2></div>
              <div className="card-body">
                <dl className="dl">
                  <dt>{tx('تاريخ الميلاد', 'Date of birth')}</dt><dd>{fmtDate(p.date_of_birth, locale)} · {ageLabel(p.date_of_birth, tx)}</dd>
                  <dt>{tx('النوع', 'Sex')}</dt><dd>{sexLabel(p.gender, tx)}</dd>
                  <dt>{tx('الرقم القومي', 'National ID')}</dt><dd>{p.national_id ? <><bdi className="ltr mono">{p.national_id}</bdi>{p.governorate && <span className="muted"> · {p.governorate}</span>}</> : val(null)}</dd>
                  <dt>{tx('جواز السفر', 'Passport')}</dt><dd>{val(p.passport_no)}</dd>
                  <dt>{tx('الجنسية', 'Nationality')}</dt><dd>{p.nationality === 'EG' ? tx('مصري', 'Egyptian') : p.nationality}</dd>
                </dl>
              </div>
            </section>
            <section className="card">
              <div className="card-head"><h2>{tx('التواصل والطوارئ', 'Contact & emergency')}</h2></div>
              <div className="card-body">
                <dl className="dl">
                  <dt>{tx('الموبايل', 'Mobile')}</dt><dd>{p.phone ? <bdi className="ltr">{fmtPhone(p.phone)}</bdi> : tx('عبر ولي الأمر', 'Via guardian')}</dd>
                  <dt>{tx('موبايل آخر', 'Second mobile')}</dt><dd>{p.phone2 ? <bdi className="ltr">{fmtPhone(p.phone2)}</bdi> : val(null)}</dd>
                  <dt>{tx('البريد', 'E-mail')}</dt><dd>{p.email ? <bdi className="ltr">{p.email}</bdi> : val(null)}</dd>
                  <dt>{tx('العنوان', 'Address')}</dt><dd>{val([p.area, p.address].filter(Boolean).join('، '))}</dd>
                  <dt>{tx('التذكيرات', 'Reminders')}</dt><dd>{p.consent_messages ? tx('موافق (واتساب/رسائل)', 'Agreed (WhatsApp/SMS)') : tx('غير موافق', 'Not agreed')}</dd>
                  <dt>{tx('للطوارئ', 'Emergency')}</dt>
                  <dd>{p.emergency_name ? <>{p.emergency_name}{p.emergency_relation && ` (${p.emergency_relation})`}{p.emergency_phone && <> · <bdi className="ltr">{fmtPhone(p.emergency_phone)}</bdi></>}</> : val(null)}</dd>
                </dl>
              </div>
            </section>
          </div>
          <div className="page" style={{ gap: 20 }}>
            <FamilyCard patient={p} family={data.family} onChange={(family) => setData({ ...data, family })} />
            <PortalCard patient={p} onGiven={reload} />
            <section className="card">
              <div className="card-head"><h2>{tx('بيانات الملف', 'File record')}</h2></div>
              <div className="card-body">
                <dl className="dl">
                  <dt>{tx('فُتح', 'Opened')}</dt>
                  <dd>{fmtDateTime(p.created_at, locale)}<br /><span className="muted">{p.registered_via === 'self' ? tx('تسجيل أونلاين', 'Online registration') : pick(p, 'created_by') || tx('الاستقبال', 'Reception')}</span></dd>
                  {p.branch_name_ar && <><dt>{tx('الفرع', 'Branch')}</dt><dd>{pick(p, 'branch_name')}</dd></>}
                  <dt>{tx('آخر تعديل', 'Last change')}</dt><dd>{fmtDateTime(p.updated_at, locale)}{p.updated_by_en && <span className="muted"> · {pick(p, 'updated_by')}</span>}</dd>
                </dl>
              </div>
            </section>
          </div>
        </div>
      )}
      {tab === 'appointments' && <PatientAppointments patientId={p.id} />}
      {tab === 'documents' && <Documents patientId={p.id} onCounts={reload} />}
      {tab === 'history' && <History patientId={p.id} />}

      {editing && <EditModal data={data} onClose={() => setEditing(false)} onSaved={setData} />}
    </div>
  )
}
