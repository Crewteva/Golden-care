import RoleHome from '../../../components/RoleHome'

// What this workspace will hold, from the project to-do list. Replace with real pages as they're built.
const UPCOMING = [
  { icon: 'pie', ar: 'لوحة الأرقام الحية', en: "Live numbers dashboard", note: { ar: 'الإيراد والمرضى والمواعيد اليوم', en: "Today's revenue, patients and appointments" } },
  { icon: 'trending', ar: 'ربحية كل خدمة وطبيب', en: "Profit per service and doctor", note: { ar: 'بعد حصة الطبيب والمستهلكات', en: "After doctor share and consumables" } },
  { icon: 'cash', ar: 'النقدية في الخزائن', en: "Cash in drawers", note: { ar: 'لحظة بلحظة لكل فرع', en: "Live, per branch" } },
  { icon: 'award', ar: 'أداء الفريق', en: "Team performance", note: { ar: 'مؤشرات من بيانات النظام الفعلية', en: "KPIs from real system records" } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING} />
}
