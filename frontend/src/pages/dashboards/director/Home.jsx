import RoleHome from '../../../components/RoleHome'

// What this workspace will hold, from the project to-do list. Replace with real pages as they're built.
const UPCOMING = [
  { icon: 'trending', ar: 'لوحة التشغيل اليومية', en: "Daily operations board", note: { ar: 'المواعيد والطوابير والانتظار', en: "Appointments, queues and waiting" } },
  { icon: 'users', ar: 'متابعة الأقسام', en: "Department follow-up", note: { ar: 'الاستقبال والخزينة والمخازن', en: "Reception, cashier and stores" } },
  { icon: 'clipboard', ar: 'الموافقات المعلّقة', en: "Pending approvals", note: { ar: 'الخصومات والمرتجعات والمشتريات', en: "Discounts, refunds and purchases" } },
  { icon: 'headphones', ar: 'الشكاوى المفتوحة', en: "Open complaints", note: { ar: 'حتى الحل', en: "Until resolved" } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING} />
}
