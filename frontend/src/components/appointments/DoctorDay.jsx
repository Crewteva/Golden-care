import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { Avatar, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'
import { ageLabel, sexLabel } from '../patients/meta'
import { clock, dayKey, minutesBetween } from '../../lib/clinicTime'
import AppointmentDrawer, { StatusBadge } from './AppointmentDrawer'
import { serviceNames, useAppointments } from './meta'
import { DateNav } from './TodayBoard'

// The doctor's day: who is inside, who is waiting (by queue number), who comes later.
export default function DoctorDay() {
  const { t, tx, pick, locale } = useI18n()
  const { api, base } = useAppointments()
  const toast = useToast()
  const [day, setDay] = useState(dayKey())
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(null)
  const data = useAsync(() => api.day({ on: day }), [day, api])

  useEffect(() => {
    const timer = setInterval(() => day === dayKey() && data.reload(), 30000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day])

  const run = async (a, action, message) => {
    setBusy(a.id)
    try {
      await api[action](a.id)
      toast.success(message)
      data.reload()
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(null)
    }
  }

  const all = data.data?.appointments || []
  const inside = all.find((a) => a.status === 'in_room')
  const waiting = all.filter((a) => a.status === 'arrived').sort((a, b) => a.queue_no - b.queue_no)
  const later = all.filter((a) => ['requested', 'booked', 'confirmed'].includes(a.status))
  const done = all.filter((a) => ['completed', 'no_show', 'cancelled'].includes(a.status))
  const isToday = day === dayKey()

  const Row = ({ a, action }) => (
    <li className="dd-row">
      <span className="appt-time num">{clock(a.starts_at, locale)}</span>
      <button type="button" className="dd-who" onClick={() => setOpen(a.id)}>
        <strong>{a.queue_no && <span className="queue-no">#{a.queue_no}</span>}{pick(a, 'patient_name')}
          {a.critical_alert && <Icon name="alert" size={15} style={{ color: 'var(--danger)' }} />}</strong>
        <small>{ageLabel(a.date_of_birth, tx)} · {sexLabel(a.gender, tx)} · {serviceNames(a.services, pick)}</small>
      </button>
      <StatusBadge status={a.status} />
      {action}
    </li>
  )

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('عيادتي', 'My clinic')} title={isToday ? tx('يومي', 'My day') : tx('مواعيدي', 'My appointments')} />
      <section className="card"><div className="toolbar"><DateNav day={day} setDay={setDay} /></div></section>
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : data.loading && !data.data ? <section className="card"><SkeletonRows rows={5} cols={3} /></section> : (
        <>
          {isToday && (
            <section className={`card now-card ${inside ? 'busy' : ''}`}>
              {inside ? (
                <div className="now-inner">
                  <span className="now-label">{tx('معك الآن', 'With you now')} · {tx(`منذ ${Math.max(0, minutesBetween(inside.in_room_at || inside.starts_at, new Date()))} دقيقة`, `${Math.max(0, minutesBetween(inside.in_room_at || inside.starts_at, new Date()))} min`)}</span>
                  <div className="person">
                    <Avatar name={pick(inside, 'patient_name')} size="lg" />
                    <div>
                      <h2>{pick(inside, 'patient_name')}</h2>
                      <p className="muted">{ageLabel(inside.date_of_birth, tx)} · {sexLabel(inside.gender, tx)} · {serviceNames(inside.services, pick)}</p>
                      {inside.critical_alert && <p style={{ color: 'var(--danger)' }}><Icon name="alert" size={15} /> {tx('تنبيه طبي خطير — راجع الملف', 'Critical medical alert — check the file')}</p>}
                    </div>
                  </div>
                  <div className="page-actions">
                    <Link to={`${base}/patients/${inside.patient_id}`} className="btn btn-ghost"><Icon name="fileSearch" size={18} />{tx('فتح الملف', 'Open file')}</Link>
                    <Button icon="checkCircle" loading={busy === inside.id} onClick={() => run(inside, 'finish', tx('انتهت الزيارة.', 'Visit finished.'))}>{tx('إنهاء الزيارة', 'Finish visit')}</Button>
                  </div>
                </div>
              ) : (
                <div className="now-inner idle">
                  <span className="now-label">{tx('لا يوجد مريض معك الآن', 'No patient with you right now')}</span>
                  {waiting[0] ? (
                    <Button size="lg" variant="gold" icon="stethoscope" loading={busy === waiting[0].id}
                      onClick={() => run(waiting[0], 'call', tx(`تم استدعاء ${pick(waiting[0], 'patient_name')}`, `${pick(waiting[0], 'patient_name')} called in`))}>
                      {tx(`استدعاء التالي: ${pick(waiting[0], 'patient_name')} (#${waiting[0].queue_no})`, `Call next: ${pick(waiting[0], 'patient_name')} (#${waiting[0].queue_no})`)}
                    </Button>
                  ) : <p className="muted">{tx('لا أحد في الانتظار. سيظهر المريض هنا عند تسجيل وصوله في الاستقبال.', 'Nobody waiting. Patients appear here when reception checks them in.')}</p>}
                </div>
              )}
            </section>
          )}

          <div className="grid-2">
            <section className="card">
              <div className="card-head"><h2>{tx('في الانتظار', 'Waiting')}</h2><span className="badge badge-gold badge-plain">{waiting.length}</span></div>
              {!waiting.length ? <EmptyState icon="clock" title={tx('لا أحد في الانتظار', 'Nobody waiting')} /> : (
                <ul className="dd-list">{waiting.map((a) => (
                  <Row key={a.id} a={a} action={!inside && <Button size="sm" loading={busy === a.id} onClick={() => run(a, 'call', tx('تم الاستدعاء.', 'Called in.'))}>{tx('استدعاء', 'Call in')}</Button>} />
                ))}</ul>
              )}
            </section>
            <section className="card">
              <div className="card-head"><h2>{isToday ? tx('لاحقًا اليوم', 'Later today') : tx('المواعيد', 'Appointments')}</h2><span className="badge badge-neutral badge-plain">{later.length}</span></div>
              {!later.length ? <EmptyState icon="calendar" title={tx('لا مواعيد قادمة', 'Nothing coming up')} /> : (
                <ul className="dd-list">{later.map((a) => <Row key={a.id} a={a} />)}</ul>
              )}
            </section>
          </div>
          {done.length > 0 && (
            <section className="card">
              <details>
                <summary className="card-head" style={{ cursor: 'pointer' }}><h2>{tx('انتهت / لم يحضر / أُلغي', 'Done / no-show / cancelled')} <span className="muted">({done.length})</span></h2></summary>
                <ul className="dd-list">{done.map((a) => <Row key={a.id} a={a} />)}</ul>
              </details>
            </section>
          )}
        </>
      )}
      {open && <AppointmentDrawer id={open} onClose={() => setOpen(null)} onChanged={data.reload} />}
    </div>
  )
}
