import RoleHome from '../../../components/RoleHome'
import BillingStats from '../../../components/billing/BillingStats'
import AccountingShortcuts from '../../../components/accounting/Shortcuts'
import InventoryShortcuts from '../../../components/inventory/Shortcuts'

const UPCOMING = [
  { icon: 'activity', ar: 'سجل النشاط الكامل', en: 'Full activity log', note: { ar: 'متاح الآن من القائمة', en: 'Available now from the menu' } },
  { icon: 'shield', ar: 'تقارير الصلاحيات', en: 'Access reports', note: { ar: 'من يملك ماذا ومتى تغيّر', en: 'Who holds what, and when it changed' } },
]

export default function AuditorHome() {
  return <RoleHome upcoming={UPCOMING}>{(data) => <><BillingStats data={data} /><AccountingShortcuts /><InventoryShortcuts only={['inventory', 'inventory/stock']} /></>}</RoleHome>
}
