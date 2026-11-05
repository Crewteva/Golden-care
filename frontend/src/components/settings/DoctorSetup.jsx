import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import PageLoader from '../PageLoader'
import { SelectField, TextField } from '../Fields'
import { Alert, Avatar, Badge, ErrorState } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtDate } from '../../lib/format'
import { LeaveModal } from './LeaveHolidays'
import { ColorField, ConfirmDelete, DAY_NAMES, WEEK_ORDER, fmtTime, useSettings } from './shared'

function ScheduleModal({ doctor, block, rooms, branches, onClose, onSaved }) {
  const { t, tx, lang, pick } = useI18n()
  const { api } = useSettings()
  const [form, setForm] = useState(block
    ? { days: [block.weekday], start_time: block.start_time.slice(0, 5), end_time: block.end_time.slice(0, 5), branch_id: block.branch_id,
        room_id: block.room_id ?? '', valid_from: block.valid_from, valid_to: block.valid_to || '' }
    : { days: [], start_time: '16:00', end_time: '21:00', branch_id: branches[0]?.id || '', room_id: '', valid_from: '', valid_to: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const toggleDay = (wd) => setForm({ ...form, days: block ? [wd] : form.days.includes(wd) ? form.days.filter((d) => d !== wd) : [...form.days, wd] })
  const branchRooms = rooms.filter((r) => r.branch_id === Number(form.branch_id) && r.is_active)

  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (!form.days.length) e.days = tx('اختر يومًا واحدًا على الأقل.', 'Choose at least one day.')
    if (!form.start_time || !form.end_time || form.end_time <= form.start_time) e.end_time = t('field.before_start')
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    let done = 0
    try {
      for (const wd of form.days) {
        const body = { weekday: wd, start_time: form.start_time, end_time: form.end_time, branch_id: Number(form.branch_id),
          room_id: form.room_id ? Number(form.room_id) : null, valid_from: form.valid_from || null, valid_to: form.valid_to || null }
        block ? await api.schedule.edit(doctor.id, block.id, body) : await api.schedule.add(doctor.id, body)
        done += 1
      }
      onSaved()
    } catch (err) {
      const msg = err.code === 'room_busy'
        ? tx(`الغرفة محجوزة في هذا الوقت لـ ${err.data.doctor_ar}.`, `The room is taken at that time by ${err.data.doctor_en}.`)
        : errorText(err, t)
      setErrors({ ...fieldErrors(err, t), form: done ? `${tx(`حُفظت ${done} أيام. `, `${done} day(s) saved. `)}${msg}` : msg })
      if (done) onSaved(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open wide onClose={onClose} busy={busy} title={block ? tx('تعديل ساعات العمل', 'Edit working hours') : tx('إضافة ساعات عمل', 'Add working hours')}
      description={pick(doctor, 'full_name')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="sched-form" loading={busy}>{t('save')}</Button></>}>
      <form id="sched-form" className="form" onSubmit={submit} noValidate>
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label" style={{ marginBottom: 8 }}>{block ? tx('اليوم', 'Day') : tx('الأيام', 'Days')}</legend>
          <div className="day-picker">
            {WEEK_ORDER.map((wd) => (
              <button key={wd} type="button" aria-pressed={form.days.includes(wd)} onClick={() => toggleDay(wd)}>{DAY_NAMES[lang][wd]}</button>
            ))}
          </div>
          {errors.days && <p className="field-error" role="alert"><Icon name="alert" size={14} />{errors.days}</p>}
        </fieldset>
        <div className="form-grid">
          <TextField label={tx('من الساعة', 'From')} type="time" step="300" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          <TextField label={tx('إلى الساعة', 'Until')} type="time" step="300" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} error={errors.end_time} />
          <SelectField label={tx('الفرع', 'Branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value, room_id: '' })}
            options={branches.map((b) => ({ value: b.id, label: pick(b) }))} />
          <SelectField label={tx('الغرفة', 'Room')} value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })}
            options={branchRooms.map((r) => ({ value: r.id, label: pick(r) }))} placeholder={tx('بدون غرفة ثابتة', 'No fixed room')} error={errors.room_id} />
          <TextField label={tx('يبدأ من', 'Starts on')} optional type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
            hint={tx('فارغ = من اليوم', 'Empty = from today')} />
          <TextField label={tx('ينتهي في', 'Ends on')} optional type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })}
            hint={tx('فارغ = مستمر', 'Empty = until further notice')} error={errors.valid_to} />
        </div>
      </form>
    </Modal>
  )
}

export default function DoctorSetup() {
  const { id } = useParams()
  const { t, tx, lang, pick, locale } = useI18n()
  const { api, base, can } = useSettings()
  const toast = useToast()
  const doctors = useAsync(() => api.doctors(), [api])
  const catalog = useAsync(() => api.catalog(), [api])
  const roomData = useAsync(() => api.rooms.list(), [api])
  const [profile, setProfile] = useState(null)
  const [services, setServices] = useState(null)
  const [busy, setBusy] = useState(null)
  const [editingBlock, setEditingBlock] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [leaveForm, setLeaveForm] = useState(null)
  const editable = can('settings.schedules')
  const doctor = doctors.data?.find((d) => d.id === id)

  useEffect(() => {
    if (!doctor) return
    setProfile({ specialty_id: doctor.specialty_id ?? '', title_ar: doctor.title_ar || '', title_en: doctor.title_en || '', color: doctor.color || '' })
    setServices(new Set(doctor.service_ids))
  }, [doctor])

  if (doctors.error) return <ErrorState error={doctors.error} onRetry={doctors.reload} />
  if (doctors.loading && !doctors.data) return <PageLoader />
  if (!doctor) return <ErrorState error={{ code: 'not_found' }} />
  if (!profile || !services || !catalog.data) return <PageLoader />

  const run = async (key, fn, message) => {
    setBusy(key)
    try {
      await fn()
      toast.success(message)
      doctors.reload()
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(null)
    }
  }
  const saveProfile = () => run('profile', () => api.saveProfile(id, {
    specialty_id: profile.specialty_id ? Number(profile.specialty_id) : null, title_ar: profile.title_ar || null,
    title_en: profile.title_en || null, color: profile.color || null,
  }), tx('تم حفظ الملف.', 'Profile saved.'))
  const saveServices = () => run('services', () => api.saveServices(id, [...services]), tx('تم حفظ الخدمات.', 'Services saved.'))
  const toggle = (sid) => { const next = new Set(services); next.has(sid) ? next.delete(sid) : next.add(sid); setServices(next) }
  const servicesDirty = [...services].sort().join() !== [...doctor.service_ids].sort().join()
  const name = pick(doctor, 'full_name')

  return (
    <div className="page reveal">
      <Link to={`${base}/doctors`} className="back-link"><Icon name="arrowLeft" size={16} />{tx('الأطباء والجداول', 'Doctors & schedules')}</Link>
      <header className="card card-pad file-head">
        <Avatar name={name} size="lg" />
        <div>
          <h1>{name}</h1>
          <div className="sub">{pick(doctor, 'title') || doctor.email}</div>
          <div className="file-facts">
            {doctor.specialty_id && <span className="chip"><span className="dot-color" style={{ background: doctor.specialty_color }} />{pick(doctor, 'specialty_name')}</span>}
            <span className="chip"><Icon name="clock" size={14} />{tx(`${doctor.weekly_hours} ساعة أسبوعيًا`, `${doctor.weekly_hours} h / week`)}</span>
          </div>
        </div>
      </header>

      <section className="card">
        <div className="card-head">
          <h2>{tx('أيام وساعات العمل', 'Working days & hours')}</h2>
          {editable && <Button size="sm" icon="plus" onClick={() => setEditingBlock('new')}>{tx('إضافة ساعات', 'Add hours')}</Button>}
        </div>
        <div className="week-editor">
          {WEEK_ORDER.map((wd) => {
            const blocks = doctor.schedule.filter((s) => s.weekday === wd)
            return (
              <div key={wd} className={`week-row ${blocks.length ? '' : 'off'}`}>
                <strong>{DAY_NAMES[lang][wd]}</strong>
                <div className="blocks">
                  {!blocks.length ? <span className="muted">{tx('لا يعمل', 'Off')}</span> : blocks.map((b) => (
                    <span key={b.id} className="block-pill">
                      <bdi>{fmtTime(b.start_time, locale)} – {fmtTime(b.end_time, locale)}</bdi>
                      <small>{b.room_id ? pick(b, 'room_name') : tx('بدون غرفة', 'No room')}</small>
                      {(b.valid_from > new Date().toISOString().slice(0, 10) || b.valid_to) && (
                        <small>{b.valid_from > new Date().toISOString().slice(0, 10) && `${tx('من', 'from')} ${fmtDate(b.valid_from, locale)} `}{b.valid_to && `${tx('حتى', 'until')} ${fmtDate(b.valid_to, locale)}`}</small>
                      )}
                      {editable && (
                        <span className="pill-actions">
                          <button type="button" onClick={() => setEditingBlock(b)} aria-label={t('edit')}><Icon name="edit" size={13} /></button>
                          <button type="button" onClick={() => setDeleting({ kind: 'block', item: b })} aria-label={tx('حذف', 'Delete')}><Icon name="x" size={13} /></button>
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>{tx('الملف المهني', 'Professional profile')}</h2></div>
          <div className="card-body form">
            <SelectField label={tx('التخصص', 'Specialty')} value={profile.specialty_id} disabled={!editable}
              onChange={(e) => setProfile({ ...profile, specialty_id: e.target.value })}
              options={catalog.data.specialties.map((s) => ({ value: s.id, label: pick(s) }))} placeholder={tx('اختر…', 'Choose…')} />
            <div className="form-grid">
              <TextField label={tx('اللقب بالعربية', 'Title in Arabic')} value={profile.title_ar} disabled={!editable} dir="rtl"
                onChange={(e) => setProfile({ ...profile, title_ar: e.target.value })} placeholder="استشاري الجلدية" />
              <TextField label={tx('اللقب بالإنجليزية', 'Title in English')} value={profile.title_en} disabled={!editable} dir="ltr"
                onChange={(e) => setProfile({ ...profile, title_en: e.target.value })} placeholder="Consultant dermatologist" />
            </div>
            <ColorField label={tx('لون الطبيب في الجداول (اختياري)', 'Colour in schedules (optional)')} value={profile.color} onChange={(color) => editable && setProfile({ ...profile, color })} />
            {editable && <div><Button loading={busy === 'profile'} onClick={saveProfile}>{t('save')}</Button></div>}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>{tx('الإجازات القادمة', 'Upcoming leave')}</h2>
            {editable && <Button variant="quiet" size="sm" icon="plus" onClick={() => setLeaveForm({ doctor_id: id })}>{tx('إضافة إجازة', 'Add leave')}</Button>}
          </div>
          <div className="card-body" style={{ paddingBlock: 4 }}>
            {!doctor.leave.length ? <p className="muted" style={{ padding: '12px 0' }}>{tx('لا توجد إجازات مسجّلة.', 'No leave recorded.')}</p> : (
              <ul className="list">
                {doctor.leave.map((lv) => (
                  <li key={lv.id} className="row-between">
                    <span>
                      <bdi>{fmtDate(lv.starts_on, locale)} → {fmtDate(lv.ends_on, locale)}</bdi>
                      <small className="muted" style={{ display: 'block' }}>{lv.reason || '—'}</small>
                    </span>
                    {editable && (
                      <span>
                        <Button variant="quiet" size="sm" className="btn-icon" aria-label={t('edit')} onClick={() => setLeaveForm(lv)}><Icon name="edit" size={15} /></Button>
                        <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('حذف', 'Delete')} onClick={() => setDeleting({ kind: 'leave', item: lv })}><Icon name="x" size={15} /></Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>{tx('الخدمات التي يقدمها', 'Services they perform')}</h2>
            <p className="muted" style={{ fontSize: '.84rem' }}>{tx('يحجز الاستقبال هذه الخدمات فقط مع هذا الطبيب.', 'Reception can only book these services with this doctor.')}</p>
          </div>
          {editable && servicesDirty && <Button size="sm" loading={busy === 'services'} onClick={saveServices}>{tx('حفظ الخدمات', 'Save services')}</Button>}
        </div>
        <div className="card-body service-groups">
          {catalog.data.specialties.map((sp) => {
            const list = catalog.data.services.filter((s) => s.specialty_id === sp.id)
            if (!list.length) return null
            const all = list.every((s) => services.has(s.id))
            return (
              <fieldset key={sp.id} className="service-group">
                <legend>
                  <span className="dot-color" style={{ background: sp.color }} />{pick(sp)}
                  {editable && (
                    <button type="button" className="link-btn" onClick={() => {
                      const next = new Set(services); list.forEach((s) => (all ? next.delete(s.id) : next.add(s.id))); setServices(next)
                    }}>{all ? tx('إلغاء الكل', 'Clear all') : tx('تحديد الكل', 'Select all')}</button>
                  )}
                </legend>
                {list.map((s) => (
                  <label key={s.id} className="check">
                    <input type="checkbox" checked={services.has(s.id)} onChange={() => toggle(s.id)} disabled={!editable} />
                    <span>{pick(s)} <small>{tx(`${s.duration_min} دقيقة`, `${s.duration_min} min`)}</small></span>
                  </label>
                ))}
              </fieldset>
            )
          })}
        </div>
      </section>

      {editingBlock && roomData.data && (
        <ScheduleModal doctor={doctor} block={editingBlock === 'new' ? null : editingBlock} rooms={roomData.data.rooms}
          branches={roomData.data.branches.filter((b) => b.is_active)}
          onClose={() => setEditingBlock(null)}
          onSaved={(partial) => { if (!partial) { setEditingBlock(null); toast.success(tx('تم حفظ الساعات.', 'Hours saved.')) } doctors.reload() }} />
      )}
      {leaveForm && (
        <LeaveModal leave={leaveForm.id ? leaveForm : null} doctors={doctors.data} fixedDoctor={id}
          onClose={() => setLeaveForm(null)} onSaved={() => { setLeaveForm(null); toast.success(tx('تم حفظ الإجازة.', 'Leave saved.')); doctors.reload() }} />
      )}
      <ConfirmDelete open={Boolean(deleting)} onClose={() => setDeleting(null)}
        title={deleting?.kind === 'leave' ? tx('حذف الإجازة', 'Delete leave') : tx('حذف ساعات العمل', 'Delete working hours')}
        onConfirm={async () => {
          if (deleting.kind === 'leave') await api.leave.remove(deleting.item.id)
          else await api.schedule.remove(id, deleting.item.id)
          doctors.reload()
        }}>
        {deleting?.kind === 'block' && `${DAY_NAMES[lang][deleting.item.weekday]} · ${fmtTime(deleting.item.start_time, locale)} – ${fmtTime(deleting.item.end_time, locale)}`}
        {deleting?.kind === 'leave' && `${fmtDate(deleting.item.starts_on, locale)} → ${fmtDate(deleting.item.ends_on, locale)}`}
      </ConfirmDelete>
    </div>
  )
}
