import RoleHome from '../../../components/RoleHome'

// What this workspace will hold, from the project to-do list. Replace with real pages as they're built.
const UPCOMING = [
  { icon: 'users', ar: 'ملفات الموظفين', en: "Employee files", note: { ar: 'الرواتب والمستندات', en: "Salaries and documents" } },
  { icon: 'clock', ar: 'الحضور بالبصمة', en: "Fingerprint attendance", note: { ar: 'التأخير والغياب والإضافي', en: "Late, absent, overtime" } },
  { icon: 'calendar', ar: 'الإجازات والأرصدة', en: "Leave & balances", note: { ar: 'طلب واعتماد', en: "Request and approve" } },
  { icon: 'cash', ar: 'مسيّر الرواتب', en: "Payroll run", note: { ar: 'التأمينات والضرائب والسلف', en: "Insurance, tax and loans" } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING} />
}
