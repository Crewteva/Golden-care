import { useState } from 'react'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { SelectField, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtDate } from '../../lib/format'
import { ConfirmDelete, isoDate, useSettings } from './shared'

export function LeaveModal({ leave, doctors, fixedDoctor, onClose, onSaved }) {
  const { t, tx, pick } = useI18n()
  const { api } = useSettings()
  const today = isoDate(new Date())
  const [form, setForm] = useState(leave
    ? { doctor_id: leave.doctor_id, starts_on: leave.starts_on, ends_on: leave.ends_on, reason: leave.reason || '' }
    : { doctor_id: fixedDoctor || '', starts_on: today, ends_on: today, reason: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (!form.doctor_id) e.doctor_id = t('field.required')
    if (!form.starts_on) e.starts_on = t('field.required')
    if (!form.ends_on || form.ends_on < form.starts_on) e.ends_on = t('field.before_start')
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const body = { ...form, reason: form.reason || null }
      leave ? await api.leave.edit(leave.id, body) : await api.leave.add(body)
      onSaved()
    } catch (err) {
      setErrors({ ...fieldErrors(err, t), form: errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={leave ? tx('تعديل الإجازة', 'Edit leave') : tx('إجازة طبيب', 'Doctor leave')}
      description={tx('لا يمكن حجز مواعيد مع الطبيب خلال الإجازة.', "Appointments can't be booked with the doctor during leave.")}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="leave-form" loading={busy}>{t('save')}</Button></>}>
      <form id="leave-form" className="form" onSubmit={submit} noValidate>
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <SelectField label={tx('الطبيب', 'Doctor')} value={form.doctor_id} onChange={(e) => setForm({ ...form, doctor_id: e.target.value })}
          error={errors.doctor_id} disabled={Boolean(fixedDoctor)} options={doctors.map((d) => ({ value: d.id, label: pick(d, 'full_name') }))}
          placeholder={tx('اختر…', 'Choose…')} />
        <div className="form-grid">
          <TextField label={tx('من', 'From')} type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value, ends_on: form.ends_on < e.target.value ? e.target.value : form.ends_on })} error={errors.starts_on} />
          <TextField label={tx('إلى (شامل)', 'To (inclusive)')} type="date" value={form.ends_on} min={form.starts_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} error={errors.ends_on} />
        </div>
        <TextField label={tx('السبب', 'Reason')} optional value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
          placeholder={tx('مثال: مؤتمر طبي', 'e.g. Medical conference')} />
      </form>
    </Modal>
  )
}

function HolidayModal({ holiday, branches, onClose, onSaved }) {
  const { t, tx, pick } = useI18n()
  const { api } = useSettings()
  const [form, setForm] = useState(holiday
    ? { branch_id: holiday.branch_id ?? '', on_date: holiday.on_date, name_ar: holiday.name_ar, name_en: holiday.name_en }
    : { branch_id: '', on_date: isoDate(new Date()), name_ar: '', name_en: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (!form.on_date) e.on_date = t('field.required')
    if (form.name_ar.trim().length < 2) e.name_ar = t('field.required')
    if (form.name_en.trim().length < 2) e.name_en = t('field.required')
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const body = { ...form, branch_id: form.branch_id ? Number(form.branch_id) : null }
      holiday ? await api.holidays.edit(holiday.id, body) : await api.holidays.add(body)
      onSaved()
    } catch (err) {
      const fields = fieldErrors(err, t)
      if (err.fields?.on_date === 'taken') fields.on_date = tx('توجد عطلة في هذا اليوم بالفعل.', 'There is already a holiday on this day.')
      setErrors({ ...fields, form: Object.keys(fields).length ? null : errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={holiday ? tx('تعديل العطلة', 'Edit holiday') : tx('عطلة جديدة', 'New holiday')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="holiday-form" loading={busy}>{t('save')}</Button></>}>
      <form id="holiday-form" className="form" onSubmit={submit} noValidate>
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <div className="form-grid">
          <TextField label={tx('التاريخ', 'Date')} type="date" value={form.on_date} onChange={(e) => setForm({ ...form, on_date: e.target.value })} error={errors.on_date} />
          <SelectField label={tx('الفرع', 'Branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
            options={branches.map((b) => ({ value: b.id, label: pick(b) }))} placeholder={t('all_branches')} />
          <TextField label={tx('الاسم بالعربية', 'Name in Arabic')} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} error={errors.name_ar} dir="rtl" placeholder="عيد الفطر" />
          <TextField label={tx('الاسم بالإنجليزية', 'Name in English')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} error={errors.name_en} dir="ltr" placeholder="Eid al-Fitr" />
        </div>
      </form>
    </Modal>
  )
}

// Doctor leave and clinic holidays: both block booking on those days.
export default function LeaveHolidays() {
  const { t, tx, pick, locale } = useI18n()
  const { api, can } = useSettings()
  const toast = useToast()
  const leave = useAsync(() => api.leave.list(), [api])
  const holidays = useAsync(() => api.holidays.list(), [api])
  const doctors = useAsync(() => api.doctors(), [api])
  const rooms = useAsync(() => api.rooms.list(), [api])
  const [leaveForm, setLeaveForm] = useState(null)
  const [holidayForm, setHolidayForm] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const editable = can('settings.schedules')
  const today = isoDate(new Date())
  const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('إعداد العيادة', 'Clinic setup')} title={tx('الإجازات والعطلات', 'Leave & holidays')}
        description={tx('أيام لا يمكن فيها الحجز: إجازات الأطباء، وعطلات العيادة الرسمية. الأعياد الهجرية تُضاف كل عام حسب تاريخها.',
          'Days that can’t be booked: doctors’ leave and the clinic’s official holidays. Lunar holidays (Eid…) are added each year on their dates.')} />
      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>{tx('إجازات الأطباء', 'Doctor leave')}</h2>
            {editable && <Button size="sm" icon="plus" onClick={() => setLeaveForm('new')}>{tx('إضافة', 'Add')}</Button>}
          </div>
          {leave.error ? <ErrorState error={leave.error} onRetry={leave.reload} /> : leave.loading && !leave.data ? <SkeletonRows rows={3} cols={2} /> : !leave.data.length ? (
            <EmptyState icon="calendar" title={tx('لا توجد إجازات', 'No leave recorded')} />
          ) : (
            <div className="card-body" style={{ paddingBlock: 4 }}>
              <ul className="list">
                {leave.data.map((lv) => (
                  <li key={lv.id} className="row-between" style={lv.ends_on < today ? { opacity: 0.55 } : undefined}>
                    <span>
                      <strong style={{ fontWeight: 500 }}>{pick(lv, 'doctor_name')}</strong>
                      <small className="muted" style={{ display: 'block' }}>
                        <bdi>{fmtDate(lv.starts_on, locale)} → {fmtDate(lv.ends_on, locale)}</bdi> · {tx(`${days(lv.starts_on, lv.ends_on)} يوم`, `${days(lv.starts_on, lv.ends_on)} day(s)`)}{lv.reason && ` · ${lv.reason}`}
                      </small>
                    </span>
                    {editable && (
                      <span style={{ whiteSpace: 'nowrap' }}>
                        <Button variant="quiet" size="sm" className="btn-icon" aria-label={t('edit')} onClick={() => setLeaveForm(lv)}><Icon name="edit" size={15} /></Button>
                        <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('حذف', 'Delete')} onClick={() => setDeleting({ kind: 'leave', item: lv })}><Icon name="x" size={15} /></Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>{tx('عطلات العيادة', 'Clinic holidays')}</h2>
            {editable && <Button size="sm" icon="plus" onClick={() => setHolidayForm('new')}>{tx('إضافة', 'Add')}</Button>}
          </div>
          {holidays.error ? <ErrorState error={holidays.error} onRetry={holidays.reload} /> : holidays.loading && !holidays.data ? <SkeletonRows rows={3} cols={2} /> : !holidays.data.length ? (
            <EmptyState icon="calendar" title={tx('لا توجد عطلات', 'No holidays')} />
          ) : (
            <div className="card-body" style={{ paddingBlock: 4 }}>
              <ul className="list">
                {holidays.data.map((h) => (
                  <li key={h.id} className="row-between" style={h.on_date < today ? { opacity: 0.55 } : undefined}>
                    <span>
                      <strong style={{ fontWeight: 500 }}>{pick(h)}</strong>
                      <small className="muted" style={{ display: 'block' }}>
                        {new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${h.on_date}T12:00`))}
                      </small>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Badge tone="neutral" plain>{h.branch_id ? pick(h, 'branch_name') : t('all_branches')}</Badge>
                      {editable && (
                        <>
                          <Button variant="quiet" size="sm" className="btn-icon" aria-label={t('edit')} onClick={() => setHolidayForm(h)}><Icon name="edit" size={15} /></Button>
                          <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('حذف', 'Delete')} onClick={() => setDeleting({ kind: 'holiday', item: h })}><Icon name="x" size={15} /></Button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {leaveForm && doctors.data && (
        <LeaveModal leave={leaveForm === 'new' ? null : leaveForm} doctors={doctors.data} onClose={() => setLeaveForm(null)}
          onSaved={() => { setLeaveForm(null); toast.success(tx('تم حفظ الإجازة.', 'Leave saved.')); leave.reload() }} />
      )}
      {holidayForm && (
        <HolidayModal holiday={holidayForm === 'new' ? null : holidayForm} branches={rooms.data?.branches || []} onClose={() => setHolidayForm(null)}
          onSaved={() => { setHolidayForm(null); toast.success(tx('تم حفظ العطلة.', 'Holiday saved.')); holidays.reload() }} />
      )}
      <ConfirmDelete open={Boolean(deleting)} onClose={() => setDeleting(null)}
        title={deleting?.kind === 'leave' ? tx('حذف الإجازة', 'Delete leave') : tx('حذف العطلة', 'Delete holiday')}
        onConfirm={async () => {
          if (deleting.kind === 'leave') { await api.leave.remove(deleting.item.id); leave.reload() }
          else { await api.holidays.remove(deleting.item.id); holidays.reload() }
        }}>
        {deleting?.kind === 'leave' && `${pick(deleting.item, 'doctor_name')} · ${fmtDate(deleting.item.starts_on, locale)} → ${fmtDate(deleting.item.ends_on, locale)}`}
        {deleting?.kind === 'holiday' && `${pick(deleting.item)} · ${fmtDate(deleting.item.on_date, locale)}`}
      </ConfirmDelete>
    </div>
  )
}
