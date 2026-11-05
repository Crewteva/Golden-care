import RoleHome from '../../../components/RoleHome'
import HomeStats from '../../../components/patients/HomeStats'
import QuickSearch from '../../../components/patients/QuickSearch'

// Still to come in this workspace (from the project to-do list).
const UPCOMING = [
  { icon: 'inbox', ar: 'صندوق طلبات الموقع والإعلانات', en: "Website & ad requests inbox", note: { ar: 'مع مصدر كل طلب', en: "With the source of each request" } },
  { icon: 'clock', ar: 'سرعة الرد', en: "Response time tracking", note: { ar: 'مؤقت لكل طلب', en: "A timer on every request" } },
  { icon: 'calendar', ar: 'تحويل الطلب لموعد', en: "Turn a request into a visit", note: { ar: 'بضغطة واحدة', en: "In one click" } },
  { icon: 'headphones', ar: 'الشكاوى والطلبات', en: "Complaints & requests", note: { ar: 'إسناد ومتابعة', en: "Assign and follow up" } },
]

export default function Home() {
  return (
    <RoleHome upcoming={UPCOMING}>
      {(data) => (
        <>
          <QuickSearch />
          <HomeStats data={data} />
        </>
      )}
    </RoleHome>
  )
}
