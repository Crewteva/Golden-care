import RoleHome from '../../../components/RoleHome'

// What this workspace will hold, from the project to-do list. Replace with real pages as they're built.
const UPCOMING = [
  { icon: 'stethoscope', ar: 'قائمة مرضى اليوم', en: "Today's patient list", note: { ar: 'بالترتيب والحالة', en: "In order, with status" } },
  { icon: 'clipboard', ar: 'سجل الزيارة', en: "Visit record", note: { ar: 'التشخيص والخطة والتوقيع', en: "Diagnosis, plan and sign-off" } },
  { icon: 'fileSearch', ar: 'الوصفات الطبية', en: "Prescriptions", note: { ar: 'مع تنبيه الحساسية', en: "With allergy alerts" } },
  { icon: 'cash', ar: 'كشف حسابي الشهري', en: "My monthly statement", note: { ar: 'نصيبي بعد الخصومات', en: "My share after discounts" } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING} />
}
