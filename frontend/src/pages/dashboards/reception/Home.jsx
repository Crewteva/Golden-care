import RoleHome from '../../../components/RoleHome'

// What this workspace will hold, from the project to-do list. Replace with real pages as they're built.
const UPCOMING = [
  { icon: 'calendar', ar: 'حجز المواعيد', en: "Book appointments", note: { ar: 'بدون تعارض للطبيب أو الغرفة', en: "No doctor or room double-booking" } },
  { icon: 'users', ar: 'ملفات المرضى', en: "Patient files", note: { ar: 'بحث بالاسم العربي ورقم الموبايل', en: "Search Arabic names and mobiles" } },
  { icon: 'clock', ar: 'الوصول وأرقام الدور', en: "Check-in & queue numbers", note: { ar: 'من الوصول حتى الدخول للطبيب', en: "From arrival to the doctor" } },
  { icon: 'alert', ar: 'تنبيه الملفات المكررة', en: "Duplicate file warning", note: { ar: 'قبل إنشاء ملف جديد', en: "Before creating a new file" } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING} />
}
