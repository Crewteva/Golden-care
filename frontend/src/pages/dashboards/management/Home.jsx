import { Link } from 'react-router-dom'
import Icon from '../../../components/Icon'
import RoleHome from '../../../components/RoleHome'
import { useI18n } from '../../../i18n/I18nContext'

// Still to come in this workspace (from the project to-do list).
const UPCOMING = [
  { icon: 'pie', ar: 'لوحة الأرقام الحية', en: 'Live numbers dashboard', note: { ar: 'الإيراد والمرضى والمواعيد اليوم', en: "Today's revenue, patients and appointments" } },
  { icon: 'trending', ar: 'ربحية كل خدمة وطبيب', en: 'Profit per service and doctor', note: { ar: 'بعد حصة الطبيب والمستهلكات', en: 'After doctor share and consumables' } },
  { icon: 'cash', ar: 'النقدية في الخزائن', en: 'Cash in drawers', note: { ar: 'لحظة بلحظة لكل فرع', en: 'Live, per branch' } },
  { icon: 'clipboard', ar: 'الموافقات المعلّقة', en: 'Pending approvals', note: { ar: 'الخصومات والمرتجعات والمشتريات', en: 'Discounts, refunds and purchases' } },
]

const SETUP = [
  { to: 'services', icon: 'clipboard', ar: 'الخدمات والأسعار', en: 'Services & prices', note: { ar: 'التخصصات والخدمات وقوائم الأسعار', en: 'Specialties, services and price lists' } },
  { to: 'doctors', icon: 'stethoscope', ar: 'الأطباء والجداول', en: 'Doctors & schedules', note: { ar: 'أيام وساعات كل طبيب وغرفته', en: "Each doctor's days, hours and room" } },
  { to: 'rooms', icon: 'building', ar: 'الغرف', en: 'Rooms', note: { ar: 'غرف كل فرع وأنواعها', en: "Each branch's rooms and types" } },
  { to: 'leave', icon: 'calendar', ar: 'الإجازات والعطلات', en: 'Leave & holidays', note: { ar: 'أيام لا يمكن فيها الحجز', en: "Days that can't be booked" } },
]

export default function Home() {
  const { tx, lang } = useI18n()
  return (
    <RoleHome upcoming={UPCOMING}>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>{tx('إعداد العيادة', 'Clinic setup')}</h2>
            <p className="muted" style={{ fontSize: '.86rem' }}>{tx('كل شيء قابل للتعديل والحذف حتى تستقر بيانات العيادة.', "Everything can be edited and deleted until the clinic's data is settled.")}</p>
          </div>
        </div>
        <div className="card-body">
          <ul className="roadmap">
            {SETUP.map((item) => (
              <li key={item.to} style={{ borderStyle: 'solid', padding: 0 }}>
                <Link to={item.to} style={{ display: 'flex', gap: 12, padding: '14px 16px', textDecoration: 'none', color: 'inherit', width: '100%' }}>
                  <span className="ico"><Icon name={item.icon} size={17} /></span>
                  <span><strong>{item[lang]}</strong><small>{item.note[lang]}</small></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </RoleHome>
  )
}
