import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { useI18n } from '../../i18n/I18nContext'
import { fmtNumber } from '../../lib/format'
import { useWorkspace } from './useWorkspace'

// Patient counts (and the review queue for doctors) on a role's home page.
export default function HomeStats({ data }) {
  const { tx, locale } = useI18n()
  const { base, patientsBase, slug } = useWorkspace()
  if (!data || !(data.patients || data.tickets || data.plans || data.lab_cases)) return null
  const n = (v) => fmtNumber(v, locale)
  const a = data.appointments
  const dayPage = slug === 'doctor' ? `${base}/my-day` : `${base}/today`
  return (
    <div className="stats">
      {a && (
        <Link to={dayPage} className="stat feature">
          <div className="stat-label"><Icon name="calendar" size={17} />{tx('مواعيد اليوم', "Today's appointments")}</div>
          <div className="stat-value num">{n(a.today)}</div>
          <div className="stat-foot">{tx(`${a.completed} انتهت · ${a.arrived + a.in_room} في العيادة · ${a.waiting_arrival} لم يصل`, `${a.completed} done · ${a.arrived + a.in_room} in clinic · ${a.waiting_arrival} not arrived`)}</div>
        </Link>
      )}
      {a && a.requested > 0 && (
        <Link to={dayPage} className="stat attention">
          <div className="stat-label"><Icon name="inbox" size={17} />{tx('طلبات حجز أونلاين', 'Online booking requests')}</div>
          <div className="stat-value num">{n(a.requested)}</div>
          <div className="stat-foot">{tx('بانتظار تأكيدك', 'Waiting for you to confirm')}</div>
        </Link>
      )}
      {data.visits && (
        <Link to={`${base}/visits`} className={`stat ${data.visits.draft ? 'attention' : ''}`}>
          <div className="stat-label"><Icon name="pen" size={17} />{slug === 'doctor' ? tx('زيارات لم تُوقَّع', 'Unsigned visits') : tx('زيارات لم يوقّعها الأطباء', 'Visits not yet signed')}</div>
          <div className="stat-value num">{n(data.visits.draft)}</div>
          <div className="stat-foot">{tx(`${data.visits.unreleased} موقّعة لم تُتح للمريض · ${data.visits.signed_today} وُقّعت اليوم`, `${data.visits.unreleased} signed, not released · ${data.visits.signed_today} signed today`)}</div>
        </Link>
      )}
      {data.follow_ups !== undefined && (
        <Link to={`${base}/follow-ups`} className={`stat ${data.follow_ups ? 'attention' : ''}`}>
          <div className="stat-label"><Icon name="refresh" size={17} />{tx('متابعات مطلوبة', 'Follow-ups due')}</div>
          <div className="stat-value num">{n(data.follow_ups)}</div>
          <div className="stat-foot">{tx('طلبها الأطباء ولم تُحجز بعد', 'Asked for by doctors, not booked yet')}</div>
        </Link>
      )}
      {data.plans && (
        <Link to={`${base}/plans`} className={`stat ${data.plans.awaiting ? 'attention' : ''}`}>
          <div className="stat-label"><Icon name="clipboard" size={17} />{tx('عروض أسعار بانتظار المريض', 'Quotations awaiting patients')}</div>
          <div className="stat-value num">{n(data.plans.awaiting)}</div>
          <div className="stat-foot">{tx(`${data.plans.in_progress} خطة جارية · ${data.plans.draft} مسودة`, `${data.plans.in_progress} in progress · ${data.plans.draft} drafts`)}</div>
        </Link>
      )}
      {data.lab_cases && (
        <Link to={`${base}/lab-cases`} className={`stat ${data.lab_cases.overdue || data.lab_cases.ready ? 'attention' : ''}`}>
          <div className="stat-label"><Icon name="package" size={17} />{tx('أعمال المعمل', 'Lab work')}</div>
          <div className="stat-value num">{n(data.lab_cases.at_lab)}</div>
          <div className="stat-foot">{tx(`${data.lab_cases.ready} جاهزة للتسليم · ${data.lab_cases.overdue} متأخرة`, `${data.lab_cases.ready} ready to fit · ${data.lab_cases.overdue} overdue`)}</div>
        </Link>
      )}
      {data.tickets && (
        <Link to={`${base}/complaints`} className={`stat ${data.tickets.overdue ? 'attention' : ''}`}>
          <div className="stat-label"><Icon name="headphones" size={17} />{tx('شكاوى وطلبات مفتوحة', 'Open complaints & requests')}</div>
          <div className="stat-value num">{n(data.tickets.open)}</div>
          <div className="stat-foot">{tx(`${data.tickets.overdue} تجاوزت المهلة`, `${data.tickets.overdue} past deadline`)}</div>
        </Link>
      )}
      {data.pending_reviews !== undefined && (
        <Link to={`${base}/review`} className={`stat ${data.pending_reviews ? 'attention' : ''}`}>
          <div className="stat-label"><Icon name="clipboard" size={17} />{tx('نتائج بانتظار المراجعة', 'Results awaiting review')}</div>
          <div className="stat-value num">{n(data.pending_reviews)}</div>
          <div className="stat-foot">{tx('لا يراها المريض قبل مراجعتك', "Patients can't see them until reviewed")}</div>
        </Link>
      )}
      {data.patients && (
        <>
          <Link to={patientsBase} className={`stat ${a ? '' : 'feature'}`}>
            <div className="stat-label"><Icon name="users" size={17} />{tx('ملفات المرضى', 'Patient files')}</div>
            <div className="stat-value num">{n(data.patients.total)}</div>
          </Link>
          <div className="stat">
            <div className="stat-label"><Icon name="userPlus" size={17} />{tx('ملفات جديدة اليوم', 'New files today')}</div>
            <div className="stat-value num">{n(data.patients.today)}</div>
            <div className="stat-foot">{tx(`${data.patients.week} خلال ٧ أيام`, `${data.patients.week} in 7 days`)}</div>
          </div>
        </>
      )}
    </div>
  )
}
