import RoleHome from '../../../components/RoleHome'
import HomeStats from '../../../components/patients/HomeStats'
import QuickSearch from '../../../components/patients/QuickSearch'

// Still to come in this workspace (from the project to-do list).
const UPCOMING = [
  { icon: 'calendar', ar: 'حجز المواعيد', en: "Book appointments", note: { ar: 'بدون تعارض للطبيب أو الغرفة', en: "No doctor or room double-booking" } },
  { icon: 'clock', ar: 'الوصول وأرقام الدور', en: "Check-in & queue numbers", note: { ar: 'من الوصول حتى الدخول للطبيب', en: "From arrival to the doctor" } },
  { icon: 'bell', ar: 'قائمة اليوم', en: "Today's list", note: { ar: 'من حضر ومن تأخر', en: "Who arrived, who is late" } },
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
