import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtPhone } from '../../lib/format'
import { dayKey, dayLabel, minutesBetween } from '../../lib/clinicTime'
import { useVisits } from './meta'

// Reception: follow-ups doctors asked for that nobody has booked yet (no medical details, just who and when).
export default function FollowUps() {
  const { tx, pick, locale } = useI18n()
  const { api, base, can } = useVisits()
  const { data, error, loading, reload } = useAsync(() => api.followUps(), [api])
  const today = dayKey()

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المواعيد', 'Appointments')} title={tx('متابعات مطلوبة', 'Follow-ups due')}
        description={tx('طلب الطبيب متابعة لهؤلاء المرضى ولم يُحجز لهم موعد بعد. يختفي المريض من القائمة بمجرد حجز موعد له مع نفس الطبيب.',
          "The doctor asked for a follow-up and nothing is booked yet. A patient leaves this list as soon as they're booked with the same doctor.")} />
      <section className="card">
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={5} cols={4} /> : !data.length ? (
          <EmptyState icon="checkCircle" title={tx('لا توجد متابعات متأخرة', 'No follow-ups waiting')}>{tx('كل المتابعات المطلوبة محجوزة.', 'Every requested follow-up is booked.')}</EmptyState>
        ) : (
          <ul className="follow-list">
            {data.map((f) => {
              const overdue = f.due_on < today
              const days = Math.round(minutesBetween(`${today}T12:00:00Z`, `${f.due_on}T12:00:00Z`) / 1440)
              return (
                <li key={f.visit_id} style={{ '--c': f.doctor_color || 'var(--ink-600)' }}>
                  <div className="follow-due">
                    <strong>{dayLabel(f.due_on, locale, { day: 'numeric', month: 'short' })}</strong>
                    {overdue ? <Badge tone="danger">{tx(`متأخر ${-days} يوم`, `${-days} days overdue`)}</Badge>
                      : days === 0 ? <Badge tone="gold">{tx('اليوم', 'Today')}</Badge>
                        : <small className="muted">{tx(`بعد ${days} يوم`, `in ${days} days`)}</small>}
                  </div>
                  <div className="follow-who">
                    <strong>{pick(f, 'patient_name')}</strong>
                    <small><span className="mrn">{f.mrn}</span>{f.patient_phone && <> · <bdi className="ltr">{fmtPhone(f.patient_phone)}</bdi></>}</small>
                  </div>
                  <div className="follow-doc">
                    <span><span className="dot-color" style={{ background: 'var(--c)' }} /> {pick(f, 'doctor_name')}</span>
                    {f.follow_up_note && <small className="muted">“{f.follow_up_note}”</small>}
                  </div>
                  {can('appointments.book') && (
                    <Link to={`${base}/book?patient=${f.patient_id}&doctor=${f.doctor_id}`} className="btn btn-gold btn-sm"><Icon name="calendar" size={16} />{tx('حجز المتابعة', 'Book follow-up')}</Link>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
