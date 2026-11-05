import RoleHome from '../../../components/RoleHome'

// What this workspace will hold, from the project to-do list. Replace with real pages as they're built.
const UPCOMING = [
  { icon: 'plusSquare', ar: 'تجهيز المريض', en: "Patient preparation", note: { ar: 'العلامات الحيوية قبل الطبيب', en: "Vitals before the doctor" } },
  { icon: 'package', ar: 'صرف المستهلكات للجلسات', en: "Consumables for sessions", note: { ar: 'الأقرب انتهاءً أولًا', en: "Nearest expiry first" } },
  { icon: 'sparkle', ar: 'جلسات الليزر', en: "Laser sessions", note: { ar: 'الإعدادات وعدّاد النبضات', en: "Settings and pulse counter" } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING} />
}
