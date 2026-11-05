import RoleHome from '../../../components/RoleHome'

// What this workspace will hold, from the project to-do list. Replace with real pages as they're built.
const UPCOMING = [
  { icon: 'inbox', ar: 'صندوق طلبات الموقع والإعلانات', en: "Website & ad requests inbox", note: { ar: 'مع مصدر كل طلب', en: "With the source of each request" } },
  { icon: 'clock', ar: 'سرعة الرد', en: "Response time tracking", note: { ar: 'مؤقت لكل طلب', en: "A timer on every request" } },
  { icon: 'calendar', ar: 'تحويل الطلب لموعد', en: "Turn a request into a visit", note: { ar: 'بضغطة واحدة', en: "In one click" } },
  { icon: 'headphones', ar: 'الشكاوى والطلبات', en: "Complaints & requests", note: { ar: 'إسناد ومتابعة', en: "Assign and follow up" } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING} />
}
