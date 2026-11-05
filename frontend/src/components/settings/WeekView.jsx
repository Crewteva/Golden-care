import { useMemo, useState } from 'react'
import Button from '../Button'
import Icon from '../Icon'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useAsync } from '../useAsync'
import { useAuth } from '../../auth/AuthContext'
import { useI18n } from '../../i18n/I18nContext'
import { DAY_SHORT, fmtTime, isoDate, useSettings } from './shared'

function saturdayOf(date) {
  const d = new Date(date)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7))
  return d
}

function Cell({ cell, color }) {
  const { tx, pick, locale } = useI18n()
  if (cell.leave) return <div className="wk-leave">{tx('إجازة', 'On leave')}{cell.leave.reason ? <small>{cell.leave.reason}</small> : null}</div>
  if (!cell.blocks.length) return <span className="wk-off" aria-label={tx('لا يعمل', 'Off')}>—</span>
  return cell.blocks.map((b) => (
    <div key={b.id} className={`wk-block ${b.closed_for ? 'closed' : ''}`} style={{ '--c': color || 'var(--ink-600)' }}>
      <bdi>{fmtTime(b.start_time, locale)} – {fmtTime(b.end_time, locale)}</bdi>
      <small>{b.closed_for ? tx(`مغلق: ${b.closed_for_ar}`, `Closed: ${b.closed_for}`) : b.room_id ? pick(b, 'room_name') : ''}</small>
    </div>
  ))
}

// Who works when and where, one week at a time. `selfOnly` shows just the signed-in doctor.
export default function WeekView({ selfOnly = false }) {
  const { me } = useAuth()
  const { tx, lang, pick, locale } = useI18n()
  const { api } = useSettings()
  const [start, setStart] = useState(() => saturdayOf(new Date()))
  const [doctor, setDoctor] = useState('')
  const startIso = isoDate(start)
  const { data, error, loading, reload } = useAsync(
    () => api.week({ start: startIso, doctor_id: selfOnly ? me.user.id : undefined }), [api, startIso, selfOnly],
  )
  const move = (days) => { const d = new Date(start); d.setDate(d.getDate() + days); setStart(d) }
  const todayIso = isoDate(new Date())
  const end = new Date(start); end.setDate(end.getDate() + 6)
  const range = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  const doctors = useMemo(() => (data?.doctors || []).filter((d) => !doctor || d.id === doctor), [data, doctor])

  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={selfOnly ? tx('جدولي', 'My schedule') : tx('الجداول', 'Schedules')}
        title={selfOnly ? tx('أيام وساعات عملي', 'My working days & hours') : tx('جدول الأطباء', 'Doctor schedules')}
        description={selfOnly ? tx('لأي تعديل في أيامك أو إجازاتك تواصل مع المدير الطبي.', 'For changes to your days or leave, contact the medical director.')
          : tx('من يعمل ومتى وفي أي غرفة، مع الإجازات والعطلات.', 'Who works when and in which room, with leave and holidays.')}
      />
      <section className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm" className="btn-icon" onClick={() => move(-7)} aria-label={tx('الأسبوع السابق', 'Previous week')}><Icon name="chevronLeft" size={18} /></Button>
            <strong className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 500, minWidth: 150, textAlign: 'center' }}>
              {range.format(start)} – {range.format(end)}
            </strong>
            <Button variant="ghost" size="sm" className="btn-icon" onClick={() => move(7)} aria-label={tx('الأسبوع التالي', 'Next week')}><Icon name="chevronRight" size={18} /></Button>
            <Button variant="quiet" size="sm" onClick={() => setStart(saturdayOf(new Date()))}>{tx('هذا الأسبوع', 'This week')}</Button>
          </div>
          {!selfOnly && data?.doctors.length > 1 && (
            <>
              <label className="sr-only" htmlFor="wk-doctor">{tx('الطبيب', 'Doctor')}</label>
              <select id="wk-doctor" className="select" value={doctor} onChange={(e) => setDoctor(e.target.value)}>
                <option value="">{tx('كل الأطباء', 'All doctors')}</option>
                {data.doctors.map((d) => <option key={d.id} value={d.id}>{pick(d, 'full_name')}</option>)}
              </select>
            </>
          )}
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={4} cols={7} /> : !doctors.length ? (
          <EmptyState icon="calendar" title={tx('لا توجد جداول', 'No schedules yet')}>
            {tx('أضف ساعات عمل الأطباء من «الأطباء والجداول».', 'Add doctors’ working hours from “Doctors & schedules”.')}
          </EmptyState>
        ) : (
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table className="week-grid">
              <thead>
                <tr>
                  <th scope="col">{tx('الطبيب', 'Doctor')}</th>
                  {data.days.map((d) => (
                    <th key={d.date} scope="col" className={d.date === todayIso ? 'today' : ''}>
                      <span>{DAY_SHORT[lang][d.weekday]}</span>
                      <small className="num">{new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric' }).format(new Date(`${d.date}T12:00`))}</small>
                      {d.holidays.map((h) => <em key={h.id} title={pick(h)}>{pick(h)}</em>)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doctors.map((doc) => (
                  <tr key={doc.id}>
                    <th scope="row">
                      <div className="wk-doc">
                        <span className="dot-color" style={{ background: doc.color || doc.specialty_color || 'var(--ink-300)' }} />
                        <span>
                          {pick(doc, 'full_name')}
                          <small>{pick(doc, 'specialty_name') || pick(doc, 'title')}</small>
                        </span>
                      </div>
                    </th>
                    {doc.days.map((cell) => (
                      <td key={cell.date} className={cell.date === todayIso ? 'today' : ''} data-label={DAY_SHORT[lang][new Date(`${cell.date}T12:00`).getDay()]}>
                        <Cell cell={cell} color={doc.color || doc.specialty_color} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="muted" style={{ fontSize: '.82rem' }}>{tx('يبدأ الأسبوع يوم السبت.', 'Weeks start on Saturday.')}</p>
    </div>
  )
}
