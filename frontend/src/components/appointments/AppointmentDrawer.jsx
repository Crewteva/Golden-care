import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import PageLoader from '../PageLoader'
import { ChoiceGroup, TextArea } from '../Fields'
import { Alert, Avatar, Badge } from '../ui'
import { useToast } from '../Toast'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'
import { fmtDateTime, fmtPhone } from '../../lib/format'
import { clock, dayKey, dayLabel, minutesBetween } from '../../lib/clinicTime'
import { fmtMoney } from '../settings/shared'
import SlotPicker from './SlotPicker'
import { EVENTS, OPEN, SOURCES, STATUS, useAppointments } from './meta'

export function StatusBadge({ status }) {
  const { lang } = useI18n()
  return <Badge tone={STATUS[status].tone}>{STATUS[status][lang]}</Badge>
}

// Everything about one appointment, with the actions the current role may take.
export default function AppointmentDrawer({ id, onClose, onChanged }) {
  const { t, tx, lang, pick, locale } = useI18n()
  const { api, base, can, me } = useAppointments()
  const toast = useToast()
  const [appt, setAppt] = useState(null)
  const [error, setError] = useState(null)
  const [mode, setMode] = useState(null) // 'cancel' | 'move' | 'notes'
  const [busy, setBusy] = useState(null)
  const [reason, setReason] = useState('')
  const [by, setBy] = useState('patient')
  const [notes, setNotes] = useState('')
  const [slot, setSlot] = useState(null)

  useEffect(() => {
    setAppt(null)
    api.get(id).then((a) => { setAppt(a); setNotes(a.notes || '') }).catch(setError)
  }, [id, api])

  const run = async (key, fn, message) => {
    setBusy(key)
    try {
      const next = await fn()
      setAppt(next)
      setMode(null)
      if (message) toast.success(message)
      onChanged?.()
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(null)
    }
  }

  if (error) return <Modal open onClose={onClose} title={tx('الموعد', 'Appointment')}><Alert tone="danger">{errorText(error, t)}</Alert></Modal>
  if (!appt) return <Modal open onClose={onClose} title={tx('الموعد', 'Appointment')}><PageLoader /></Modal>

  const day = dayKey(appt.starts_at)
  const isToday = day === dayKey()
  const started = new Date(appt.starts_at) <= new Date()
  const open = OPEN.includes(appt.status)
  const mine = appt.doctor_id === me.user.id
  const late = open && isToday && minutesBetween(appt.starts_at, new Date()) > 15

  const actions = []
  if (can('appointments.manage')) {
    if (['requested', 'booked'].includes(appt.status)) actions.push(['confirm', 'check', tx('تأكيد', 'Confirm'), () => run('confirm', () => api.confirm(id), tx('تم التأكيد.', 'Confirmed.'))])
    if (open && isToday) actions.push(['arrive', 'logIn', tx('وصل المريض', 'Patient arrived'), () => run('arrive', () => api.arrive(id), tx('تم تسجيل الوصول.', 'Checked in.')), 'gold'])
    if (open) actions.push(['move', 'calendar', tx('تغيير الموعد', 'Reschedule'), () => setMode('move')])
    if (open && started) actions.push(['no_show', 'alert', tx('لم يحضر', 'No-show'), () => run('no_show', () => api.noShow(id), tx('سُجّل عدم الحضور.', 'Marked as no-show.'))])
    if ([...OPEN, 'arrived'].includes(appt.status)) actions.push(['cancel', 'x', tx('إلغاء الموعد', 'Cancel'), () => setMode('cancel'), 'danger-ghost'])
  }
  if (can('appointments.treat') && (mine || can('appointments.manage'))) {
    if (appt.status === 'arrived') actions.push(['call', 'stethoscope', tx('استدعاء للكشف', 'Call in'), () => run('call', () => api.call(id), tx('المريض مع الطبيب الآن.', 'Patient is with the doctor.')), 'primary'])
    if (appt.status === 'in_room') actions.push(['finish', 'checkCircle', tx('إنهاء الزيارة', 'Finish visit'), () => run('finish', () => api.finish(id), tx('انتهت الزيارة.', 'Visit finished.')), 'primary'])
  }

  return (
    <Modal open wide onClose={onClose} busy={Boolean(busy)} title={<span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{tx('موعد', 'Appointment')} <span className="mrn muted" style={{ fontSize: '.9rem' }}>{appt.ref}</span> <StatusBadge status={appt.status} /></span>}
      footer={<Button variant="ghost" onClick={onClose}>{t('close')}</Button>}>
      <div className="form">
        <div className="appt-head">
          <div className="appt-when">
            <strong>{dayLabel(day, locale)}</strong>
            <span className="num">{clock(appt.starts_at, locale)} – {clock(appt.ends_at, locale)}</span>
            {appt.queue_no && <span className="queue-no">#{appt.queue_no}</span>}
          </div>
          <div className="person">
            <Avatar name={pick(appt, 'patient_name')} />
            <div>
              {can('patients.view') ? <Link to={`${base}/patients/${appt.patient_id}`} className="person-name">{pick(appt, 'patient_name')}</Link>
                : <strong>{pick(appt, 'patient_name')}</strong>}
              <small><span className="mrn">{appt.mrn}</span>{appt.patient_phone && <> · <bdi className="ltr">{fmtPhone(appt.patient_phone)}</bdi></>}</small>
            </div>
          </div>
        </div>
        {appt.critical_alert && <Alert tone="danger" icon="alert">{tx('لهذا المريض تنبيه طبي خطير. راجع ملفه قبل الكشف.', 'This patient has a critical medical alert. Check the file before the visit.')}</Alert>}
        {late && <Alert tone="warn" icon="clock">{tx(`متأخر ${minutesBetween(appt.starts_at, new Date())} دقيقة.`, `${minutesBetween(appt.starts_at, new Date())} minutes late.`)}</Alert>}
        {appt.overbooked && <Alert tone="info" icon="plus">{tx('موعد إضافي خارج الأوقات المتاحة:', 'Squeeze-in outside free times:')} {appt.overbook_reason}</Alert>}

        <dl className="dl">
          <dt>{tx('الطبيب', 'Doctor')}</dt><dd>{pick(appt, 'doctor_name')}</dd>
          <dt>{tx('الخدمات', 'Services')}</dt>
          <dd>{appt.services.map((s) => (
            <span key={s.service_id} style={{ display: 'block' }}>{pick(s)} <small className="muted">· {tx(`${s.duration_min} دقيقة`, `${s.duration_min} min`)}{s.price != null && ` · ${fmtMoney(s.price, locale)}`}</small></span>
          ))}</dd>
          <dt>{tx('السعر المتوقع', 'Expected price')}</dt><dd className="num">{fmtMoney(appt.estimated_price, locale)} <small className="muted">{tx('(الفاتورة في خطوة لاحقة)', '(invoice comes later)')}</small></dd>
          <dt>{tx('المكان', 'Where')}</dt><dd>{pick(appt, 'branch_name')}{appt.room_id && ` · ${pick(appt, 'room_name')}`}</dd>
          <dt>{tx('مصدر الحجز', 'Booked via')}</dt><dd>{SOURCES[appt.source][lang]}</dd>
          {appt.status === 'cancelled' && <><dt>{tx('سبب الإلغاء', 'Cancel reason')}</dt><dd>{appt.cancel_reason} <small className="muted">({appt.cancelled_by_kind === 'patient' ? tx('من المريض', 'by patient') : tx('من العيادة', 'by clinic')})</small></dd></>}
          <dt>{tx('ملاحظات', 'Notes')}</dt>
          <dd>
            {mode === 'notes' ? (
              <div className="form">
                <TextArea label={tx('ملاحظات للفريق', 'Notes for the team')} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button size="sm" loading={busy === 'notes'} onClick={() => run('notes', () => api.notes(id, { notes }), tx('تم الحفظ.', 'Saved.'))}>{t('save')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setMode(null)}>{t('cancel')}</Button>
                </div>
              </div>
            ) : (
              <>
                {appt.notes || <span className="muted">—</span>}
                {can('appointments.manage') && <Button variant="quiet" size="sm" icon="edit" onClick={() => setMode('notes')}>{t('edit')}</Button>}
              </>
            )}
          </dd>
        </dl>

        {actions.length > 0 && !mode && (
          <div className="appt-actions">
            {actions.map(([key, icon, label, fn, variant]) => (
              <Button key={key} variant={variant || 'ghost'} icon={icon} loading={busy === key} onClick={fn}>{label}</Button>
            ))}
          </div>
        )}

        {mode === 'cancel' && (
          <section className="card card-pad form">
            <h3 style={{ fontSize: '1rem' }}>{tx('إلغاء الموعد', 'Cancel appointment')}</h3>
            <ChoiceGroup legend={tx('من طلب الإلغاء؟', 'Who cancelled?')} name="by" value={by} onChange={setBy}
              options={[{ value: 'patient', label: tx('المريض', 'Patient') }, { value: 'clinic', label: tx('العيادة', 'Clinic') }]} />
            <TextArea label={tx('السبب', 'Reason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('مثال: المريض مسافر', 'e.g. Patient travelling')} data-autofocus />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="danger" loading={busy === 'cancel'} disabled={reason.trim().length < 3}
                onClick={() => run('cancel', () => api.cancel(id, { reason: reason.trim(), by }), tx('أُلغي الموعد.', 'Appointment cancelled.'))}>{tx('تأكيد الإلغاء', 'Confirm cancel')}</Button>
              <Button variant="ghost" onClick={() => setMode(null)}>{t('back')}</Button>
            </div>
          </section>
        )}

        {mode === 'move' && (
          <section className="card card-pad form">
            <div className="row-between">
              <h3 style={{ fontSize: '1rem' }}>{tx('اختر الوقت الجديد', 'Choose the new time')}</h3>
              <Button variant="ghost" size="sm" onClick={() => { setMode(null); setSlot(null) }}>{t('back')}</Button>
            </div>
            <SlotPicker fromDay={day < dayKey() ? dayKey() : day} selected={slot} onPick={setSlot} deps={[id]}
              load={({ on }) => api.slots({ serviceIds: appt.services.map((s) => s.service_id), on, exclude: id })} />
            {slot && (
              <div className="row-between booking-confirm">
                <span>{pick(slot.doctor, 'full_name')} · <strong className="num">{dayLabel(dayKey(slot.start), locale, { weekday: 'long', day: 'numeric', month: 'short' })} {clock(slot.start, locale)}</strong></span>
                <Button loading={busy === 'move'} icon="check"
                  onClick={() => run('move', () => api.reschedule(id, { starts_at: slot.start, doctor_id: slot.doctorId }), tx('تم تغيير الموعد.', 'Appointment moved.'))}>
                  {tx('نقل الموعد', 'Move appointment')}
                </Button>
              </div>
            )}
          </section>
        )}

        <details className="appt-history">
          <summary>{tx('سجل الموعد', 'Appointment history')} <span className="muted">({appt.events.length})</span></summary>
          <ul className="feed">
            {appt.events.map((e) => (
              <li key={e.id}>
                <span className="dot"><Icon name={STATUS[e.to_status]?.icon || 'clock'} size={15} /></span>
                <span>
                  {EVENTS[e.action]?.[lang] || e.action}
                  {e.action === 'rescheduled' && e.details?.from && <> · <bdi className="num">{clock(e.details.from, locale)} → {clock(e.details.to, locale)}</bdi></>}
                  {e.details?.reason && ` · ${e.details.reason}`}
                  {e.details?.queue_no && ` · #${e.details.queue_no}`}
                  <small>{e.actor_label || tx('المريض / النظام', 'Patient / system')} · <bdi>{fmtDateTime(e.at, locale)}</bdi></small>
                </span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Modal>
  )
}
