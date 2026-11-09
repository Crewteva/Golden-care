import RoleHome from '../../../components/RoleHome'
import HomeStats from '../../../components/patients/HomeStats'
import QuickSearch from '../../../components/patients/QuickSearch'

// Still to come in this workspace (from the project to-do list).
const UPCOMING = [
  { icon: 'plusSquare', ar: 'تجهيز المريض', en: "Patient preparation", note: { ar: 'العلامات الحيوية قبل الطبيب', en: "Vitals before the doctor" } },
  { icon: 'sparkle', ar: 'جلسات الليزر', en: "Laser sessions", note: { ar: 'الإعدادات وعدّاد النبضات', en: "Settings and pulse counter" } },
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
