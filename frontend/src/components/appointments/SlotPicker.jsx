import { useEffect, useState } from 'react'
import Button from '../Button'
import Icon from '../Icon'
import { EmptyState, ErrorState, SkeletonRows } from '../ui'
import { useI18n } from '../../i18n/I18nContext'
import { addDays, clock, dayKey, dayLabel, weekdayOf } from '../../lib/clinicTime'
import { DAY_SHORT } from '../settings/shared'

const REASONS = {
  leave: { ar: 'في إجازة', en: 'On leave' },
  holiday: { ar: 'عطلة', en: 'Holiday' },
  off: { ar: 'لا يعمل هذا اليوم', en: 'Not working this day' },
  past: { ar: 'يوم مضى', en: 'Past day' },
}

function period(iso) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)))
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}
const PERIODS = { morning: { ar: 'صباحًا', en: 'Morning' }, afternoon: { ar: 'ظهرًا', en: 'Afternoon' }, evening: { ar: 'مساءً', en: 'Evening' } }

/**
 * Pick a day, then a free time. `load({ on })` returns [{ id, full_name_*, slots: [{start, end, room_name_*}], reason }].
 * Shows every doctor returned (or the chosen one), grouped into morning / afternoon / evening.
 */
export default function SlotPicker({ load, deps = [], selected, onPick, days = 14, fromDay }) {
  const { tx, lang, pick, locale } = useI18n()
  const today = dayKey()
  const [start, setStart] = useState(fromDay || today)
  const [day, setDay] = useState(fromDay || today)
  const [state, setState] = useState({ loading: true, data: null, error: null })

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    load({ on: day })
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error }))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, ...deps])

  const strip = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const canBack = start > today
  const lastDay = addDays(today, days)

  return (
    <div className="slot-picker">
      <div className="day-strip" role="tablist" aria-label={tx('اختر اليوم', 'Choose a day')}>
        <Button variant="ghost" size="sm" className="btn-icon" disabled={!canBack} onClick={() => setStart(addDays(start, -7))} aria-label={tx('الأيام السابقة', 'Earlier days')}>
          <Icon name="chevronLeft" size={18} />
        </Button>
        {strip.map((key) => (
          <button key={key} type="button" role="tab" aria-selected={key === day} disabled={key > lastDay} onClick={() => setDay(key)}
            className={key === today ? 'is-today' : ''}>
            <span>{key === today ? tx('اليوم', 'Today') : DAY_SHORT[lang][weekdayOf(key)]}</span>
            <strong className="num">{dayLabel(key, locale, { day: 'numeric' })}</strong>
            <small>{dayLabel(key, locale, { month: 'short' })}</small>
          </button>
        ))}
        <Button variant="ghost" size="sm" className="btn-icon" disabled={addDays(start, 7) > lastDay} onClick={() => setStart(addDays(start, 7))} aria-label={tx('الأيام التالية', 'Later days')}>
          <Icon name="chevronRight" size={18} />
        </Button>
      </div>

      {state.error ? <ErrorState error={state.error} /> : state.loading && !state.data ? <SkeletonRows rows={3} cols={4} /> : !state.data?.length ? (
        <EmptyState icon="stethoscope" title={tx('لا يوجد طبيب يقدم هذه الخدمات', 'No doctor offers these services')} />
      ) : (
        <div className="slot-doctors" style={{ opacity: state.loading ? 0.6 : 1 }}>
          {state.data.map((doc) => {
            const groups = {}
            doc.slots.forEach((s) => { (groups[period(s.start)] ||= []).push(s) })
            return (
              <section key={doc.id} className="slot-doctor">
                <header>
                  <span className="dot-color" style={{ background: doc.color || 'var(--ink-600)' }} />
                  <strong>{pick(doc, 'full_name')}</strong>
                  <small className="muted">{pick(doc, 'title')}</small>
                </header>
                {!doc.slots.length ? (
                  <p className="muted slot-none">{doc.reason ? REASONS[doc.reason]?.[lang] : tx('لا توجد أوقات متاحة في هذا اليوم', 'No free times this day')}</p>
                ) : Object.entries(groups).map(([name, list]) => (
                  <div key={name} className="slot-group">
                    <span className="slot-period">{PERIODS[name][lang]}</span>
                    <div className="slot-grid">
                      {list.map((s) => {
                        const active = selected && selected.start === s.start && selected.doctorId === doc.id
                        return (
                          <button key={s.start} type="button" aria-pressed={active} onClick={() => onPick({ ...s, doctorId: doc.id, doctor: doc })}
                            title={s.room_name_en ? pick(s, 'room_name') : undefined}>
                            {clock(s.start, locale)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
