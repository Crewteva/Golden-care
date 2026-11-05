import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtDate } from '../../lib/format'
import { DAY_SHORT, WEEK_ORDER, useSettings } from './shared'

// All doctors with their specialty, working days and hours. Click one to set them up.
export default function Doctors() {
  const { tx, lang, pick, locale } = useI18n()
  const { api, base } = useSettings()
  const { data, error, loading, reload } = useAsync(() => api.doctors(), [api])
  if (error) return <ErrorState error={error} onRetry={reload} />

  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('إعداد العيادة', 'Clinic setup')}
        title={tx('الأطباء والجداول', 'Doctors & schedules')}
        description={tx('تخصص كل طبيب، والخدمات التي يقدمها، وأيام وساعات عمله وغرفته. يظهر هنا كل حساب له دور «طبيب».',
          'Each doctor’s specialty, the services they perform, and their working days, hours and room. Every account with the Doctor role appears here.')}
      />
      {loading && !data ? <section className="card"><SkeletonRows rows={3} cols={3} /></section> : !data.length ? (
        <section className="card">
          <EmptyState icon="stethoscope" title={tx('لا يوجد أطباء بعد', 'No doctors yet')}>
            {tx('يضيف مدير النظام الأطباء من صفحة «الموظفون» بدور «طبيب».', 'The system admin adds doctors from “Staff” with the Doctor role.')}
          </EmptyState>
        </section>
      ) : (
        <div className="grid-3">
          {data.map((d) => {
            const days = WEEK_ORDER.filter((wd) => d.schedule.some((s) => s.weekday === wd))
            const nextLeave = d.leave[0]
            return (
              <Link key={d.id} to={`${base}/doctors/${d.id}`} className="card doctor-card">
                <div className="person">
                  <span className="avatar" style={d.color || d.specialty_color ? { background: d.color || d.specialty_color, color: '#fff', borderColor: 'transparent' } : undefined}>
                    {(pick(d, 'full_name') || '').replace(/^(د\.|dr\.?)\s*/i, '').slice(0, 1)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <strong className="doc-title">{pick(d, 'full_name')}</strong>
                    <small className="muted" style={{ display: 'block' }}>{pick(d, 'title') || tx('لم يُحدد اللقب', 'No title yet')}</small>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {d.specialty_id ? <span className="chip"><span className="dot-color" style={{ background: d.specialty_color }} />{pick(d, 'specialty_name')}</span>
                    : <Badge tone="warn">{tx('بدون تخصص', 'No specialty')}</Badge>}
                  <span className="chip">{tx(`${d.service_ids.length} خدمة`, `${d.service_ids.length} services`)}</span>
                </div>
                <div className="week-dots" aria-label={tx('أيام العمل', 'Working days')}>
                  {WEEK_ORDER.map((wd) => (
                    <span key={wd} className={days.includes(wd) ? 'on' : ''} title={DAY_SHORT[lang][wd]}>{DAY_SHORT[lang][wd]}</span>
                  ))}
                </div>
                <div className="row-between muted" style={{ fontSize: '.84rem' }}>
                  <span><Icon name="clock" size={14} /> {tx(`${d.weekly_hours} ساعة أسبوعيًا`, `${d.weekly_hours} h / week`)}</span>
                  {nextLeave && <Badge tone="gold">{tx('إجازة', 'Leave')} {fmtDate(nextLeave.starts_on, locale)}</Badge>}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
