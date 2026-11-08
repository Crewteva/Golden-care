import RoleHome from '../../../components/RoleHome'
import HomeStats from '../../../components/patients/HomeStats'
import QuickSearch from '../../../components/patients/QuickSearch'

// Still to come in this workspace (from the project to-do list).
const UPCOMING = [
  { icon: 'cash', ar: 'تحصيل الفواتير عند الوصول', en: 'Collect payment at check-in', note: { ar: 'من قائمة الأسعار مباشرة', en: 'Straight from the price list' } },
  { icon: 'smartphone', ar: 'تذكير المرضى بالواتساب', en: 'WhatsApp reminders', note: { ar: 'تأكيد وتذكير تلقائي', en: 'Automatic confirmation and reminders' } },
  { icon: 'headphones', ar: 'مكتب الشكاوى والطلبات', en: 'Complaints & requests desk', note: { ar: 'متابعة حتى الحل', en: 'Followed until resolved' } },
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
