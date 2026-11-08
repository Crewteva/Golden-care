import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { Checkbox, SelectField, TextArea, TextField } from '../Fields'
import { Alert, Avatar, Badge, PageHeader } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import PatientPicker from '../patients/PatientPicker'
import { patientsApi } from '../../api/patients'
import { settingsApi } from '../../api/settings'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtPhone } from '../../lib/format'
import { clock, dayKey, dayLabel } from '../../lib/clinicTime'
import { ageLabel } from '../patients/meta'
import { fmtMoney } from '../settings/shared'
import SlotPicker from './SlotPicker'
import { SOURCES, useAppointments } from './meta'

function Step({ n, title, done, children }) {
  return (
    <section className={`card book-step ${done ? 'done' : ''}`}>
      <div className="card-head">
        <h2><span className="step-no">{done ? <Icon name="check" size={14} /> : n}</span>{title}</h2>
      </div>
      <div className="card-body">{children}</div>
    </section>
  )
}

// Reception books a visit: patient → services → doctor & free time → details.
export default function BookAppointment() {
  const { t, tx, lang, pick, locale } = useI18n()
  const { api, base, can, me } = useAppointments()
  const slug = base.split('/').pop()
  const pApi = useMemo(() => patientsApi(slug), [slug])
  const sApi = useMemo(() => settingsApi(slug), [slug])
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const catalog = useAsync(() => sApi.catalog(), [sApi])
  const [patient, setPatient] = useState(null)
  const [serviceIds, setServiceIds] = useState([])
  const [doctorId, setDoctorId] = useState(params.get('doctor') || '')
  const [slot, setSlot] = useState(null)
  const [source, setSource] = useState('phone')
  const [notes, setNotes] = useState('')
  const [squeeze, setSqueeze] = useState(false)
  const [manual, setManual] = useState({ doctor: '', date: dayKey(), time: '', reason: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [booked, setBooked] = useState(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    const id = params.get('patient')
    if (id) pApi.get(id).then(({ patient: p }) => setPatient(p)).catch(() => {})
  }, [params, pApi])

  const doctors = useAsync(() => (serviceIds.length ? api.doctors(serviceIds) : Promise.resolve([])), [serviceIds.join(','), api])
  useEffect(() => { setSlot(null) }, [serviceIds.join(','), doctorId])

  const services = (catalog.data?.services || []).filter((s) => s.is_active)
  const specialties = (catalog.data?.specialties || []).filter((s) => s.is_active)
  const chosen = serviceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean)
  const minutes = chosen.reduce((sum, s) => sum + s.duration_min, 0)
  const total = chosen.reduce((sum, s) => sum + Number(s.current_price || 0), 0)
  const term = q.trim().toLowerCase()
  const toggle = (id) => setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < 5 ? [...ids, id] : ids))

  const submit = async () => {
    setErrors({})
    setFormError(null)
    const body = { patient_id: patient?.id, service_ids: serviceIds, source, notes: notes.trim() || null }
    if (squeeze) {
      const e = {}
      if (!manual.doctor) e.doctor = t('field.required')
      if (!manual.time) e.time = t('field.required')
      if (manual.reason.trim().length < 5) e.reason = t('field.overbook_reason.too_short')
      if (Object.keys(e).length) { setErrors(e); return }
      Object.assign(body, { doctor_id: manual.doctor, local_date: manual.date, local_time: manual.time, overbook_reason: manual.reason.trim() })
    } else {
      Object.assign(body, { doctor_id: slot.doctorId, starts_at: slot.start })
    }
    setBusy(true)
    try {
      const appt = await api.book(body)
      setBooked(appt)
      toast.success(tx(`تم الحجز (${appt.ref}).`, `Booked (${appt.ref}).`))
    } catch (err) {
      setErrors(fieldErrors(err, t))
      setFormError(errorText(err, t))
      if (['slot_taken', 'room_taken'].includes(err.code)) setSlot(null)
    } finally {
      setBusy(false)
    }
  }

  const reset = () => { setBooked(null); setPatient(null); setServiceIds([]); setDoctorId(''); setSlot(null); setNotes(''); setSqueeze(false) }

  if (booked) {
    return (
      <div className="page reveal">
        <PageHeader eyebrow={tx('المواعيد', 'Appointments')} title={tx('تم الحجز', 'Appointment booked')} />
        <section className="card card-pad booking-done">
          <div className="done-icon"><Icon name="checkCircle" size={34} /></div>
          <h2>{pick(booked, 'patient_name')}</h2>
          <p className="num" style={{ fontSize: '1.1rem' }}>
            {dayLabel(dayKey(booked.starts_at), locale)} · {clock(booked.starts_at, locale)} – {clock(booked.ends_at, locale)}
          </p>
          <p className="muted">{pick(booked, 'doctor_name')} · {booked.services.map((s) => pick(s)).join(' + ')}{booked.room_id && ` · ${pick(booked, 'room_name')}`}</p>
          <p><Badge tone="gold" plain>{booked.ref}</Badge> {tx('السعر المتوقع:', 'Expected price:')} <strong className="num">{fmtMoney(booked.estimated_price, locale)}</strong></p>
          <div className="page-actions" style={{ justifyContent: 'center' }}>
            <Button icon="plus" onClick={reset}>{tx('حجز موعد آخر', 'Book another')}</Button>
            <Link className="btn btn-ghost" to={`${base}/today?date=${dayKey(booked.starts_at)}`}>{tx('عرض اليوم', 'Open that day')}</Link>
          </div>
        </section>
      </div>
    )
  }

  const ready = patient && serviceIds.length && (squeeze ? true : slot)

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المواعيد', 'Appointments')} title={tx('حجز موعد', 'Book an appointment')}
        description={tx('تظهر الأوقات المتاحة فقط: حسب ساعات الطبيب، والإجازات، والعطلات، والمواعيد المحجوزة، والغرف.',
          "Only free times are shown: based on the doctor's hours, leave, holidays, existing bookings and rooms.")} />

      <div className="split book-layout">
        <div className="page" style={{ gap: 18 }}>
          <Step n={1} title={tx('المريض', 'Patient')} done={Boolean(patient)}>
            {patient ? (
              <div className="row-between">
                <div className="person">
                  <Avatar name={pick(patient, 'full_name')} />
                  <div>
                    <strong style={{ fontWeight: 500 }}>{pick(patient, 'full_name')}</strong>
                    <small className="muted" style={{ display: 'block' }}><span className="mrn">{patient.mrn}</span> · {ageLabel(patient.date_of_birth, tx)}{patient.phone && <> · <bdi className="ltr">{fmtPhone(patient.phone)}</bdi></>}</small>
                  </div>
                </div>
                <Button variant="quiet" size="sm" onClick={() => setPatient(null)}>{tx('تغيير', 'Change')}</Button>
              </div>
            ) : (
              <div className="form">
                <PatientPicker api={pApi} label={tx('ابحث عن المريض', 'Find the patient')} onSelect={setPatient} />
                {can('patients.create') && (
                  <Link to={`${base}/patients/new`} className="btn btn-quiet btn-sm" style={{ justifySelf: 'start' }}>
                    <Icon name="userPlus" size={16} />{tx('مريض جديد؟ افتح ملفًا أولًا', 'New patient? Open a file first')}
                  </Link>
                )}
              </div>
            )}
          </Step>

          <Step n={2} title={tx('الخدمات', 'Services')} done={serviceIds.length > 0}>
            <div className="input-wrap" style={{ marginBottom: 14 }}>
              <span className="input-start"><Icon name="search" size={18} /></span>
              <input className="input has-start" value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search')}
                placeholder={tx('ابحث عن خدمة…', 'Search a service…')} />
            </div>
            <div className="service-pick">
              {specialties.map((sp) => {
                const list = services.filter((s) => s.specialty_id === sp.id && (!term || s.name_ar.includes(q.trim()) || s.name_en.toLowerCase().includes(term) || s.code.toLowerCase().includes(term)))
                if (!list.length) return null
                return (
                  <div key={sp.id} className="service-pick-group">
                    <span className="label"><span className="dot-color" style={{ background: sp.color }} />{pick(sp)}</span>
                    <div className="service-chips">
                      {list.map((s) => (
                        <button key={s.id} type="button" aria-pressed={serviceIds.includes(s.id)} onClick={() => toggle(s.id)}>
                          <strong>{pick(s)}</strong>
                          <small className="num">{tx(`${s.duration_min} د`, `${s.duration_min} min`)} · {fmtMoney(s.current_price, locale)}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            {chosen.length > 1 && <p className="muted" style={{ marginTop: 10, fontSize: '.86rem' }}>{tx('الخدمات تُنفّذ متتالية في نفس الزيارة.', 'Services are done back to back in the same visit.')}</p>}
          </Step>

          <Step n={3} title={tx('الطبيب والوقت', 'Doctor & time')} done={Boolean(slot) || squeeze}>
            {!serviceIds.length ? <p className="muted">{tx('اختر الخدمات أولًا.', 'Choose the services first.')}</p> : (
              <div className="form">
                <SelectField label={tx('الطبيب', 'Doctor')} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}
                  options={(doctors.data || []).map((d) => ({ value: d.id, label: pick(d, 'full_name') }))} placeholder={tx('أي طبيب متاح', 'Any available doctor')} />
                {!squeeze && (
                  <SlotPicker selected={slot} onPick={setSlot} deps={[serviceIds.join(','), doctorId]}
                    load={({ on }) => api.slots({ serviceIds, on, doctorId: doctorId || undefined })} />
                )}
                {can('appointments.overbook') && (
                  <Checkbox checked={squeeze} onChange={(e) => { setSqueeze(e.target.checked); setSlot(null) }}
                    label={tx('إضافة موعد خارج الأوقات المتاحة', 'Squeeze in outside the free times')}
                    description={tx('للحالات الطارئة فقط. يُطلب سبب ويُسجّل في السجل.', 'For urgent cases only. A reason is required and logged.')} />
                )}
                {squeeze && (
                  <div className="form-grid">
                    <SelectField label={tx('الطبيب', 'Doctor')} value={manual.doctor} onChange={(e) => setManual({ ...manual, doctor: e.target.value })} error={errors.doctor}
                      options={(doctors.data || []).map((d) => ({ value: d.id, label: pick(d, 'full_name') }))} placeholder={tx('اختر…', 'Choose…')} />
                    <TextField label={tx('اليوم', 'Day')} type="date" value={manual.date} min={dayKey()} onChange={(e) => setManual({ ...manual, date: e.target.value })} />
                    <TextField label={tx('الساعة', 'Time')} type="time" step="300" value={manual.time} onChange={(e) => setManual({ ...manual, time: e.target.value })} error={errors.time} />
                    <TextField label={tx('السبب', 'Reason')} value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} error={errors.reason || errors.overbook_reason}
                      placeholder={tx('مثال: متابعة بعد إجراء، ٥ دقائق', 'e.g. Post-procedure check, 5 minutes')} />
                  </div>
                )}
              </div>
            )}
          </Step>
        </div>

        <aside className="sticky-side">
          <section className="card">
            <div className="card-head"><h2>{tx('ملخص الحجز', 'Booking summary')}</h2></div>
            <div className="card-body form">
              {formError && <Alert tone="danger">{formError}</Alert>}
              <dl className="dl">
                <dt>{tx('المريض', 'Patient')}</dt><dd>{patient ? pick(patient, 'full_name') : <span className="muted">—</span>}</dd>
                <dt>{tx('الخدمات', 'Services')}</dt><dd>{chosen.length ? chosen.map((s) => pick(s)).join(' + ') : <span className="muted">—</span>}</dd>
                <dt>{tx('المدة', 'Duration')}</dt><dd className="num">{minutes ? tx(`${minutes} دقيقة`, `${minutes} min`) : '—'}</dd>
                <dt>{tx('الموعد', 'When')}</dt>
                <dd>{squeeze ? (manual.time ? <span className="num">{dayLabel(manual.date, locale, { weekday: 'short', day: 'numeric', month: 'short' })} · {manual.time}</span> : '—')
                  : slot ? <><span className="num">{dayLabel(dayKey(slot.start), locale, { weekday: 'short', day: 'numeric', month: 'short' })} · {clock(slot.start, locale)}</span><br /><small className="muted">{pick(slot.doctor, 'full_name')}{slot.room_name_en && ` · ${pick(slot, 'room_name')}`}</small></> : <span className="muted">—</span>}</dd>
                <dt>{tx('السعر المتوقع', 'Expected price')}</dt><dd className="num">{chosen.length ? fmtMoney(total, locale) : '—'}</dd>
              </dl>
              <SelectField label={tx('مصدر الحجز', 'Booked via')} value={source} onChange={(e) => setSource(e.target.value)}
                options={Object.entries(SOURCES).filter(([k]) => k !== 'portal').map(([k, v]) => ({ value: k, label: v[lang] }))} />
              <TextArea label={tx('ملاحظات للفريق', 'Notes for the team')} optional value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500}
                placeholder={tx('مثال: أول زيارة، تفضّل ممرضة', 'e.g. First visit, prefers a female nurse')} />
              <Button size="lg" block icon="calendar" loading={busy} disabled={!ready} onClick={submit}>{tx('تأكيد الحجز', 'Book appointment')}</Button>
              <p className="muted" style={{ fontSize: '.78rem', textAlign: 'center' }}>{tx(`يُسجل باسم ${pick(me.user, 'full_name')}`, `Recorded as booked by ${pick(me.user, 'full_name')}`)}</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
