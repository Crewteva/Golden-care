import RoleHome from '../../../components/RoleHome'

const UPCOMING = [
  { icon: 'activity', ar: 'سجل النشاط الكامل', en: 'Full activity log', note: { ar: 'متاح الآن من القائمة', en: 'Available now from the menu' } },
  { icon: 'calculator', ar: 'مراجعة القيود المحاسبية', en: 'Review journal entries', note: { ar: 'قراءة فقط', en: 'Read-only' } },
  { icon: 'cash', ar: 'إقفال الخزينة اليومي', en: 'Daily cash closings', note: { ar: 'الفروقات وأسبابها', en: 'Differences and their reasons' } },
  { icon: 'shield', ar: 'تقارير الصلاحيات', en: 'Access reports', note: { ar: 'من يملك ماذا ومتى تغيّر', en: 'Who holds what, and when it changed' } },
]

export default function AuditorHome() {
  return <RoleHome upcoming={UPCOMING} />
}
