import RoleHome from '../../../components/RoleHome'
import HomeStats from '../../../components/patients/HomeStats'
import QuickSearch from '../../../components/patients/QuickSearch'

// Still to come in this workspace (from the project to-do list).
const UPCOMING = [
  { icon: 'award', ar: 'مراجعة الجودة الطبية', en: "Clinical quality review", note: { ar: 'الزيارات الموقّعة والإضافات', en: "Signed visits and addenda" } },
  { icon: 'fileSearch', ar: 'اعتماد المحتوى الطبي', en: "Medical content approval", note: { ar: 'مقالات الموقع قبل النشر', en: "Website articles before publishing" } },
  { icon: 'stethoscope', ar: 'جداول الأطباء', en: "Doctor schedules", note: { ar: 'الإجازات والعطلات', en: "Leave and holidays" } },
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
