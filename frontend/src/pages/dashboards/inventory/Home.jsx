import RoleHome from '../../../components/RoleHome'
import InventoryShortcuts from '../../../components/inventory/Shortcuts'

// Still to come in this workspace (from the project to-do list).
const UPCOMING = [
  { icon: 'swap', ar: 'التحويل بين المخازن', en: 'Transfers between stores', note: { ar: 'عند فتح فرع ثانٍ', en: 'When a second branch opens' } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING}><InventoryShortcuts /></RoleHome>
}
