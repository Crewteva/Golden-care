import RoleHome from '../../../components/RoleHome'
import BillingStats from '../../../components/billing/BillingStats'
import AccountingShortcuts from '../../../components/accounting/Shortcuts'
import InventoryShortcuts from '../../../components/inventory/Shortcuts'

// What this workspace will hold, from the project to-do list. Replace with real pages as they're built.
const UPCOMING = [
  { icon: 'fileSearch', ar: 'الفاتورة الإلكترونية', en: "E-invoicing", note: { ar: 'منظومة مصلحة الضرائب', en: "Egyptian Tax Authority" } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING}>{(data) => <><BillingStats data={data} /><AccountingShortcuts /><InventoryShortcuts only={['inventory', 'inventory/payables']} /></>}</RoleHome>
}
