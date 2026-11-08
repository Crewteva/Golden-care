import { Link } from 'react-router-dom'
import Icon from '../../../components/Icon'
import { Welcome } from '../../../components/RoleHome'
import { Badge, ErrorState } from '../../../components/ui'
import { useAsync } from '../../../components/useAsync'
import { patientApi } from '../../../api/patient'
import { useI18n } from '../../../i18n/I18nContext'
import { fmtDate, fmtPhone } from '../../../lib/format'
import { clock, dayKey, dayLabel } from '../../../lib/clinicTime'

const COMING = [
  { icon: 'fileSearch', ar: 'الوصفات الطبية', en: 'Prescriptions', note: { ar: 'مطبوعة ومتاحة في حسابك', en: 'Printable, in your account' } },
  { icon: 'cash', ar: 'الفواتير والدفع أونلاين', en: 'Invoices & online payment', note: { ar: 'بطاقة أو محفظة', en: 'Card or wallet' } },
  { icon: 'headphones', ar: 'الشكاوى والطلبات', en: 'Complaints & requests', note: { ar: 'متابعة حتى الحل', en: 'Followed until resolved' } },
]

export default function PatientHome() {
  const { tx, lang, locale, pick } = useI18n()
  const { data, error, reload } = useAsync(() => patientApi.home(), [])
  const visits = useAsync(() => patientApi.appointments(), [])
  const p = data?.profile
  const next = (visits.data?.items || [])
    .filter((a) => ['requested', 'booked', 'confirmed', 'arrived'].includes(a.status) && new Date(a.ends_at) > new Date())
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0]

  return (
    <div className="page reveal">
      <Welcome>
        {p && (
          <div className="meta">
            <span>
              <Icon name="fileSearch" size={15} />
              {tx('رقم ملفك الطبي', 'Your file number')}: <bdi className="num" style={{ color: 'var(--gold-100)', fontWeight: 600 }}>{p.mrn}</bdi>
            </span>
          </div>
        )}
      </Welcome>
      {error && <ErrorState error={error} onRetry={reload} />}

      <section className="card next-visit">
        {next ? (
          <div className="row-between" style={{ padding: 20 }}>
            <div className="person">
              <span className="done-icon" style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--gold-100)', color: 'var(--gold-700)' }}>
                <Icon name="calendar" size={24} />
              </span>
              <div>
                <small className="muted">{tx('موعدك القادم', 'Your next visit')}</small>
                <strong style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>
                  {dayLabel(dayKey(next.starts_at), locale)} · <span className="num">{clock(next.starts_at, locale)}</span>
                </strong>
                <small className="muted">{pick(next, 'doctor_name')} · {next.services.map((s) => pick(s)).join(' + ')}</small>
              </div>
            </div>
            <Link to="/dashboard/patient/appointments" className="btn btn-ghost">{tx('مواعيدي', 'My appointments')}</Link>
          </div>
        ) : (
          <div className="row-between" style={{ padding: 20 }}>
            <span className="muted">{tx('لا يوجد لديك موعد قادم.', 'You have no upcoming visit.')}</span>
            {visits.data?.rules?.portal_enabled && <Link to="/dashboard/patient/book" className="btn btn-gold"><Icon name="plus" size={18} />{tx('احجز موعدًا', 'Book a visit')}</Link>}
          </div>
        )}
      </section>

      <div className="split">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>{tx('قريبًا في حسابك', 'Coming soon to your account')}</h2>
              <p className="muted" style={{ fontSize: '.86rem' }}>
                {tx('نعمل على إضافة هذه الخدمات تباعًا.', "We're adding these services one by one.")}
              </p>
            </div>
            <Badge tone="gold">{tx('قريبًا', 'Soon')}</Badge>
          </div>
          <div className="card-body">
            <ul className="roadmap">
              {COMING.map((item) => (
                <li key={item.en}>
                  <span className="ico"><Icon name={item.icon} size={17} /></span>
                  <span>
                    <strong>{item[lang]}</strong>
                    <small>{item.note[lang]}</small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>{tx('بياناتي', 'My details')}</h2>
            <Link to="/dashboard/patient/profile" style={{ fontSize: '.86rem' }}>{tx('تعديل', 'Edit')}</Link>
          </div>
          <div className="card-body">
            {!p ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 16 }} />)}
              </div>
            ) : (
              <dl className="dl">
                <dt>{tx('رقم الملف', 'File no.')}</dt>
                <dd className="mono">{p.mrn}</dd>
                <dt>{tx('الموبايل', 'Mobile')}</dt>
                <dd className="ltr" style={{ textAlign: 'start' }}>{fmtPhone(p.phone)}</dd>
                <dt>{tx('تاريخ الميلاد', 'Date of birth')}</dt>
                <dd className="num">{fmtDate(p.date_of_birth, locale)}</dd>
                <dt>{tx('التذكيرات', 'Reminders')}</dt>
                <dd>{p.consent_messages ? tx('مفعّلة عبر واتساب/رسائل', 'On (WhatsApp/SMS)') : tx('متوقفة', 'Off')}</dd>
              </dl>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
