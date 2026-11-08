import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'
import { addDays, clock, dayKey, dayLabel, minutesBetween } from '../../lib/clinicTime'
import AppointmentDrawer, { StatusBadge } from './AppointmentDrawer'
import { OPEN, serviceNames, useAppointments } from './meta'

const FILTERS = {
  all: null,
  waiting: ['requested', 'booked', 'confirmed'],
  inside: ['arrived', 'in_room'],
  done: ['completed'],
  lost: ['cancelled', 'no_show'],
}

export function DateNav({ day, setDay }) {
  const { tx, locale } = useI18n()
  const today = dayKey()
  return (
    <div className="date-nav">
      <Button variant="ghost" size="sm" className="btn-icon" onClick={() => setDay(addDays(day, -1))} aria-label={tx('اليوم السابق', 'Previous day')}><Icon name="chevronLeft" size={18} /></Button>
      <strong>{dayLabel(day, locale)}</strong>
      <Button variant="ghost" size="sm" className="btn-icon" onClick={() => setDay(addDays(day, 1))} aria-label={tx('اليوم التالي', 'Next day')}><Icon name="chevronRight" size={18} /></Button>
      {day !== today && <Button variant="quiet" size="sm" onClick={() => setDay(today)}>{tx('اليوم', 'Today')}</Button>}
      <input type="date" className="input" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label={tx('اختر التاريخ', 'Pick a date')} />
    </div>
  )
}

function Card({ a, onOpen, onArrive, canManage, lateAfter }) {
  const { tx, pick, locale } = useI18n()
  const isToday = dayKey(a.starts_at) === dayKey()
  const lateBy = OPEN.includes(a.status) && isToday ? minutesBetween(a.starts_at, new Date()) : 0
  const late = lateBy > lateAfter
  return (
    <article className={`appt-card status-${a.status} ${late ? 'late' : ''}`} style={{ '--c': a.doctor_color || 'var(--ink-600)' }}>
      <button type="button" className="appt-card-main" onClick={onOpen}>
        <span className="appt-time num">{clock(a.starts_at, locale)}<small>{clock(a.ends_at, locale)}</small></span>
        <span className="appt-body">
          <strong>
            {a.queue_no && <span className="queue-no">#{a.queue_no}</span>}
            {pick(a, 'patient_name')}
            {a.critical_alert && <Icon name="alert" size={15} style={{ color: 'var(--danger)' }} title={tx('تنبيه طبي خطير', 'Critical medical alert')} />}
          </strong>
          <small>{serviceNames(a.services, pick)}{a.room_id && ` · ${pick(a, 'room_name')}`}</small>
          <span className="appt-tags">
            <StatusBadge status={a.status} />
            {late && <span className="badge badge-danger">{tx(`متأخر ${lateBy} د`, `Late ${lateBy} min`)}</span>}
            {a.overbooked && <span className="badge badge-info badge-plain">{tx('إضافي', 'Squeeze-in')}</span>}
            {a.source === 'portal' && <span className="badge badge-neutral badge-plain"><Icon name="smartphone" size={12} /> {tx('أونلاين', 'Online')}</span>}
          </span>
        </span>
      </button>
      {canManage && OPEN.includes(a.status) && isToday && (
        <Button size="sm" variant="gold" icon="logIn" onClick={onArrive}>{tx('وصل', 'Arrived')}</Button>
      )}
    </article>
  )
}

// Reception's day: every doctor's appointments as columns, with arrival in one click.
export default function TodayBoard() {
  const { t, tx, pick, locale } = useI18n()
  const { api, base, can } = useAppointments()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [day, setDayState] = useState(params.get('date') || dayKey())
  const [doctor, setDoctor] = useState('')
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState(params.get('open'))
  const [, tick] = useState(0)
  const rules = useAsync(() => api.rules(), [api])
  const data = useAsync(() => api.day({ on: day }), [day, api])
  const setDay = (d) => { setDayState(d); setParams(d === dayKey() ? {} : { date: d }, { replace: true }) }

  useEffect(() => {
    const timer = setInterval(() => { tick((n) => n + 1); if (day === dayKey()) data.reload() }, 60000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day])

  const arrive = async (a) => {
    try {
      const next = await api.arrive(a.id)
      toast.success(tx(`وصل ${pick(a, 'patient_name')} · رقم الدور ${next.queue_no}`, `${pick(a, 'patient_name')} checked in · queue #${next.queue_no}`))
      data.reload()
    } catch (err) {
      toast.error(errorText(err, t))
    }
  }

  const stats = data.data?.stats || {}
  const lateAfter = rules.data?.late_after_min ?? 15
  const doctors = (data.data?.doctors || []).filter((d) => !doctor || d.id === doctor)
  const visible = (data.data?.appointments || []).filter((a) => !FILTERS[filter] || FILTERS[filter].includes(a.status))
  const chips = [
    ['all', tx('الكل', 'All'), (data.data?.appointments || []).length],
    ['waiting', tx('لم يصل بعد', 'Not arrived'), (stats.requested || 0) + (stats.booked || 0) + (stats.confirmed || 0)],
    ['inside', tx('في العيادة', 'In clinic'), (stats.arrived || 0) + (stats.in_room || 0)],
    ['done', tx('انتهت', 'Done'), stats.completed || 0],
    ['lost', tx('ملغى / لم يحضر', 'Cancelled / no-show'), (stats.cancelled || 0) + (stats.no_show || 0)],
  ]

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المواعيد', 'Appointments')} title={day === dayKey() ? tx('مواعيد اليوم', "Today's appointments") : tx('مواعيد اليوم المختار', 'Appointments')}
        actions={can('appointments.book') && <Link to={`${base}/book`} className="btn btn-gold"><Icon name="plus" size={18} />{tx('حجز موعد', 'Book appointment')}</Link>} />

      <section className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <DateNav day={day} setDay={setDay} />
          {(data.data?.doctors || []).length > 1 && (
            <select className="select" value={doctor} onChange={(e) => setDoctor(e.target.value)} aria-label={tx('الطبيب', 'Doctor')}>
              <option value="">{tx('كل الأطباء', 'All doctors')}</option>
              {data.data.doctors.map((d) => <option key={d.id} value={d.id}>{pick(d, 'full_name')}</option>)}
            </select>
          )}
        </div>
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={t('status')}>
            {chips.map(([key, label, n]) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}>{label} <span className="muted num">({n})</span></button>
            ))}
          </div>
          {stats.requested > 0 && <span className="badge badge-gold">{tx(`${stats.requested} طلب أونلاين بانتظار التأكيد`, `${stats.requested} online request(s) to confirm`)}</span>}
        </div>

        {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : data.loading && !data.data ? <SkeletonRows rows={5} cols={3} /> : !doctors.length ? (
          <EmptyState icon="calendar" title={tx('لا يعمل أي طبيب في هذا اليوم', 'No doctor works this day')}>
            {tx('راجع جدول الأطباء أو اختر يومًا آخر.', 'Check the doctor schedules or pick another day.')}
          </EmptyState>
        ) : (
          <div className="board" style={{ opacity: data.loading ? 0.7 : 1 }}>
            {doctors.map((doc) => {
              const list = visible.filter((a) => a.doctor_id === doc.id)
              return (
                <section key={doc.id} className="board-col" style={{ '--c': doc.color || 'var(--ink-600)' }}>
                  <header>
                    <strong>{pick(doc, 'full_name')}</strong>
                    <small>
                      {doc.off_reason === 'leave' ? tx('في إجازة', 'On leave') : doc.off_reason === 'holiday' ? tx('عطلة', 'Holiday')
                        : doc.blocks.map((b) => `${clock(b.start, locale)} – ${clock(b.end, locale)}${b.room_name_en ? ` · ${pick(b, 'room_name')}` : ''}`).join('، ') || tx('لا يعمل', 'Off')}
                    </small>
                  </header>
                  <div className="board-list">
                    {!list.length ? <p className="muted board-empty">{tx('لا توجد مواعيد', 'No appointments')}</p> : list.map((a) => (
                      <Card key={a.id} a={a} lateAfter={lateAfter} canManage={can('appointments.manage')} onOpen={() => setOpen(a.id)} onArrive={() => arrive(a)} />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </section>
      {open && <AppointmentDrawer id={open} onClose={() => setOpen(null)} onChanged={data.reload} />}
    </div>
  )
}
