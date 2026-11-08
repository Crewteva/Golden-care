import RoleHome from '../../../components/RoleHome'
import BillingStats from '../../../components/billing/BillingStats'

// What this workspace will hold, from the project to-do list. Replace with real pages as they're built.
const UPCOMING = [
  { icon: 'calculator', ar: 'دفتر الأستاذ والقيود', en: "Ledger & journals", note: { ar: 'قيود تلقائية متوازنة', en: "Automatic balanced entries" } },
  { icon: 'lock', ar: 'إقفال الفترات', en: "Period closing", note: { ar: 'لا تعديل بعد الإقفال', en: "No edits after closing" } },
  { icon: 'users', ar: 'كشوف حسابات الأطباء', en: "Doctor statements", note: { ar: 'اعتماد بثلاث موافقات', en: "Three-way approval" } },
  { icon: 'fileSearch', ar: 'الفاتورة الإلكترونية', en: "E-invoicing", note: { ar: 'منظومة مصلحة الضرائب', en: "Egyptian Tax Authority" } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING}>{(data) => <BillingStats data={data} />}</RoleHome>
}
