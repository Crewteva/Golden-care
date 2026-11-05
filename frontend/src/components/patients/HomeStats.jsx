import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { useI18n } from '../../i18n/I18nContext'
import { fmtNumber } from '../../lib/format'
import { useWorkspace } from './useWorkspace'

// Patient counts (and the review queue for doctors) on a role's home page.
export default function HomeStats({ data }) {
  const { tx, locale } = useI18n()
  const { base, patientsBase } = useWorkspace()
  if (!data?.patients) return null
  const n = (v) => fmtNumber(v, locale)
  return (
    <div className="stats">
      {data.pending_reviews !== undefined && (
        <Link to={`${base}/review`} className={`stat ${data.pending_reviews ? 'attention' : ''}`}>
          <div className="stat-label"><Icon name="clipboard" size={17} />{tx('نتائج بانتظار المراجعة', 'Results awaiting review')}</div>
          <div className="stat-value num">{n(data.pending_reviews)}</div>
          <div className="stat-foot">{tx('لا يراها المريض قبل مراجعتك', "Patients can't see them until reviewed")}</div>
        </Link>
      )}
      <Link to={patientsBase} className="stat feature">
        <div className="stat-label"><Icon name="users" size={17} />{tx('ملفات المرضى', 'Patient files')}</div>
        <div className="stat-value num">{n(data.patients.total)}</div>
      </Link>
      <div className="stat">
        <div className="stat-label"><Icon name="userPlus" size={17} />{tx('ملفات جديدة اليوم', 'New files today')}</div>
        <div className="stat-value num">{n(data.patients.today)}</div>
        <div className="stat-foot">{tx(`${data.patients.week} خلال ٧ أيام`, `${data.patients.week} in 7 days`)}</div>
      </div>
    </div>
  )
}
