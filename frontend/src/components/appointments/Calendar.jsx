import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { addDays, clock, dayKey, dayLabel, minuteOfDay, saturdayOf, weekdayOf } from '../../lib/clinicTime'
import { DAY_SHORT } from '../settings/shared'
import AppointmentDrawer from './AppointmentDrawer'
import { STATUS, serviceNames, useAppointments } from './meta'
import { DateNav } from './TodayBoard'

const PX = 1.5 // pixels per minute

function DayGrid({ data, onOpen }) {
  const { tx, lang, pick, locale } = useI18n()
  const appts = data.appointments
  const docs = data.doctors
  const minutes = [
    ...docs.flatMap((d) => d.blocks.flatMap((b) => [minuteOfDay(b.start), minuteOfDay(b.end)])),
    ...appts.flatMap((a) => [minuteOfDay(a.starts_at), minuteOfDay(a.ends_at)]),
  ]
  if (!minutes.length) return <EmptyState icon="calendar" title={tx('لا توجد مواعيد أو ساعات عمل', 'No appointments or working hours')} />
  const from = Math.floor(Math.min(...minutes) / 60) * 60
  const to = Math.ceil(Math.max(...minutes) / 60) * 60
  const hours = Array.from({ length: (to - from) / 60 }, (_, i) => from + i * 60)
  const nowMin = dayKey() === data.date ? minuteOfDay(new Date()) : null

  return (
    <div className="table-wrap">
      <div className="cal" style={{ '--cols': docs.length, minWidth: 90 + docs.length * 190 }}>
        <div className="cal-head">
          <span />
          {docs.map((d) => <strong key={d.id} style={{ '--c': d.color || 'var(--ink-600)' }}>{pick(d, 'full_name')}</strong>)}
        </div>
        <div className="cal-body" style={{ height: (to - from) * PX }}>
          <div className="cal-hours">
            {hours.map((h) => (
              <span key={h} style={{ top: (h - from) * PX }} className="num">
                {new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: true }).format(new Date(2000, 0, 1, h / 60))}
              </span>
            ))}
          </div>
          {docs.map((d) => (
            <div key={d.id} className={`cal-col ${d.off_reason ? 'off' : ''}`}>
              {hours.map((h) => <i key={h} className="cal-line" style={{ top: (h - from) * PX }} />)}
              {d.blocks.map((b, i) => (
                <div key={i} className="cal-work" style={{ top: (minuteOfDay(b.start) - from) * PX, height: (minuteOfDay(b.end) - minuteOfDay(b.start)) * PX }} />
              ))}
              {d.off_reason === 'leave' && <div className="cal-off">{tx('إجازة', 'On leave')}</div>}
              {appts.filter((a) => a.doctor_id === d.id).map((a) => {
                const top = (minuteOfDay(a.starts_at) - from) * PX
                const height = Math.max(22, (minuteOfDay(a.ends_at) - minuteOfDay(a.starts_at)) * PX - 2)
                return (
                  <button key={a.id} type="button" className={`cal-appt status-${a.status}`} style={{ top, height, '--c': d.color || 'var(--ink-600)' }}
                    onClick={() => onOpen(a.id)} title={`${pick(a, 'patient_name')} · ${STATUS[a.status][lang]}`}>
                    <strong>{clock(a.starts_at, locale)} {pick(a, 'patient_name')}</strong>
                    {height > 34 && <small>{serviceNames(a.services, pick)}</small>}
                  </button>
                )
              })}
              {nowMin !== null && nowMin >= from && nowMin <= to && <i className="cal-now" style={{ top: (nowMin - from) * PX }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function WeekGrid({ start, counts, doctors, onPickDay }) {
  const { tx, lang, pick, locale } = useI18n()
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return (
    <div className="table-wrap">
      <table className="week-grid" style={{ minWidth: 700 }}>
        <thead>
          <tr>
            <th>{tx('الطبيب', 'Doctor')}</th>
            {days.map((d) => (
              <th key={d} className={d === dayKey() ? 'today' : ''}>
                <button type="button" className="link-btn" onClick={() => onPickDay(d)}>{DAY_SHORT[lang][weekdayOf(d)]}</button>
                <small>{dayLabel(d, locale, { day: 'numeric', month: 'numeric' })}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doctors.map((doc) => (
            <tr key={doc.id}>
              <th scope="row"><div className="wk-doc"><span className="dot-color" style={{ background: doc.color || 'var(--ink-300)' }} /><span>{pick(doc, 'full_name')}</span></div></th>
              {days.map((d) => {
                const c = counts.find((x) => x.doctor_id === doc.id && x.day === d)
                return (
                  <td key={d} className={d === dayKey() ? 'today' : ''}>
                    {c ? (
                      <button type="button" className="wk-count" onClick={() => onPickDay(d)}>
                        <strong className="num">{c.active}</strong>
                        <small>{c.completed ? tx(`${c.completed} انتهت`, `${c.completed} done`) : tx('موعد', 'booked')}{c.lost ? ` · ${c.lost} ✕` : ''}</small>
                      </button>
                    ) : <span className="wk-off">—</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Calendar: one day as a timeline per doctor, or the week as counts per doctor.
export default function Calendar() {
  const { tx } = useI18n()
  const { api, base, can } = useAppointments()
  const [mode, setMode] = useState('day')
  const [day, setDay] = useState(dayKey())
  const [open, setOpen] = useState(null)
  const data = useAsync(() => api.day({ on: day }), [day, api])
  const weekStart = saturdayOf(day)
  const week = useAsync(() => (mode === 'week' ? api.week(weekStart) : Promise.resolve(null)), [mode, weekStart, api])

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المواعيد', 'Appointments')} title={tx('التقويم', 'Calendar')}
        actions={can('appointments.book') && <Link to={`${base}/book`} className="btn btn-gold"><Icon name="plus" size={18} />{tx('حجز موعد', 'Book appointment')}</Link>} />
      <section className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          {mode === 'day' ? <DateNav day={day} setDay={setDay} /> : (
            <div className="date-nav">
              <Button variant="ghost" size="sm" className="btn-icon" onClick={() => setDay(addDays(day, -7))} aria-label={tx('الأسبوع السابق', 'Previous week')}><Icon name="chevronLeft" size={18} /></Button>
              <strong>{tx('أسبوع يبدأ', 'Week of')} {weekStart}</strong>
              <Button variant="ghost" size="sm" className="btn-icon" onClick={() => setDay(addDays(day, 7))} aria-label={tx('الأسبوع التالي', 'Next week')}><Icon name="chevronRight" size={18} /></Button>
            </div>
          )}
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'day'} onClick={() => setMode('day')}>{tx('يوم', 'Day')}</button>
            <button type="button" role="tab" aria-selected={mode === 'week'} onClick={() => setMode('week')}>{tx('أسبوع', 'Week')}</button>
          </div>
        </div>
        {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : !data.data ? <SkeletonRows rows={6} cols={3} /> : mode === 'day' ? (
          <DayGrid data={data.data} onOpen={setOpen} />
        ) : week.data ? (
          <WeekGrid start={weekStart} counts={week.data.counts} doctors={data.data.doctors} onPickDay={(d) => { setDay(d); setMode('day') }} />
        ) : <SkeletonRows rows={3} cols={7} />}
      </section>
      {open && <AppointmentDrawer id={open} onClose={() => setOpen(null)} onChanged={data.reload} />}
    </div>
  )
}
