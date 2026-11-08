import RoleHome from '../../../components/RoleHome'
import HomeStats from '../../../components/patients/HomeStats'
import QuickSearch from '../../../components/patients/QuickSearch'

// Still to come in this workspace (from the project to-do list).
const UPCOMING = [
  { icon: 'clipboard', ar: 'سجل الزيارة', en: "Visit record", note: { ar: 'التشخيص والخطة والتوقيع', en: "Diagnosis, plan and sign-off" } },
  { icon: 'fileSearch', ar: 'الوصفات الطبية', en: "Prescriptions", note: { ar: 'مع تنبيه الحساسية', en: "With allergy alerts" } },
  { icon: 'cash', ar: 'كشف حسابي الشهري', en: "My monthly statement", note: { ar: 'نصيبي بعد الخصومات', en: "My share after discounts" } },
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
