import RoleHome from '../../../components/RoleHome'

// What this workspace will hold, from the project to-do list. Replace with real pages as they're built.
const UPCOMING = [
  { icon: 'award', ar: 'مراجعة الجودة الطبية', en: "Clinical quality review", note: { ar: 'الزيارات الموقّعة والإضافات', en: "Signed visits and addenda" } },
  { icon: 'fileSearch', ar: 'اعتماد المحتوى الطبي', en: "Medical content approval", note: { ar: 'مقالات الموقع قبل النشر', en: "Website articles before publishing" } },
  { icon: 'stethoscope', ar: 'جداول الأطباء', en: "Doctor schedules", note: { ar: 'الإجازات والعطلات', en: "Leave and holidays" } },
  { icon: 'alert', ar: 'تنبيهات الحالات العاجلة', en: "Urgent case alerts", note: { ar: 'من متابعة ما بعد الزيارة', en: "From after-visit follow-up" } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING} />
}
