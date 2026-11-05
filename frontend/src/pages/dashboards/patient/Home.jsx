import { Link } from 'react-router-dom'
import Icon from '../../../components/Icon'
import { Welcome } from '../../../components/RoleHome'
import { Badge, ErrorState } from '../../../components/ui'
import { useAsync } from '../../../components/useAsync'
import { patientApi } from '../../../api/patient'
import { useI18n } from '../../../i18n/I18nContext'
import { fmtDate, fmtPhone } from '../../../lib/format'

const COMING = [
  { icon: 'calendar', ar: 'حجز المواعيد أونلاين', en: 'Book appointments online', note: { ar: 'من المواعيد المتاحة فعليًا لكل طبيب', en: "From each doctor's real availability" } },
  { icon: 'clock', ar: 'مواعيدي القادمة والسابقة', en: 'My upcoming & past visits', note: { ar: 'مع إمكانية الإلغاء والتقييم', en: 'Cancel or rate a visit' } },
  { icon: 'fileSearch', ar: 'الوصفات والنتائج', en: 'Prescriptions & results', note: { ar: 'بعد مراجعة الطبيب واعتماده', en: 'Once your doctor reviews and releases them' } },
  { icon: 'cash', ar: 'الفواتير والدفع أونلاين', en: 'Invoices & online payment', note: { ar: 'بطاقة أو محفظة', en: 'Card or wallet' } },
  { icon: 'users', ar: 'حسابات العائلة', en: 'Family accounts', note: { ar: 'إدارة مواعيد أبنائك', en: "Manage your children's visits" } },
  { icon: 'headphones', ar: 'الشكاوى والطلبات', en: 'Complaints & requests', note: { ar: 'متابعة حتى الحل', en: 'Followed until resolved' } },
]

export default function PatientHome() {
  const { tx, lang, locale } = useI18n()
  const { data, error, reload } = useAsync(() => patientApi.home(), [])
  const p = data?.profile

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
