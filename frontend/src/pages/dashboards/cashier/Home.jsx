import RoleHome from '../../../components/RoleHome'

// What this workspace will hold, from the project to-do list. Replace with real pages as they're built.
const UPCOMING = [
  { icon: 'cash', ar: 'فتح وإغلاق الوردية', en: "Open & close shift", note: { ar: 'مع عدّ الدرج', en: "With drawer count" } },
  { icon: 'clipboard', ar: 'تحصيل الفواتير', en: "Collect invoices", note: { ar: 'نقدي وبطاقة وإنستاباي ومحفظة', en: "Cash, card, InstaPay, wallet" } },
  { icon: 'refresh', ar: 'صرف المرتجعات المعتمدة', en: "Pay approved refunds", note: { ar: 'بعد موافقة المسؤول', en: "After approval" } },
  { icon: 'fileSearch', ar: 'إيصال حراري ٨٠ مم', en: "80 mm thermal receipt", note: { ar: 'طباعة فورية', en: "Instant print" } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING} />
}
