import Overview from './Overview'
import Stock, { ItemCard } from './Stock'
import Moves from './Moves'
import Counts, { CountPage } from './Counts'
import Orders, { OrderPage } from './Orders'
import Suppliers, { Payables, SupplierPage } from './Suppliers'
import Devices, { DevicePage } from './Devices'
import Faults from './Faults'
import Setup from './Setup'
import UseStock from './UseStock'

const ALL = [
  { path: 'inventory', icon: 'box', label: { ar: 'المخازن', en: 'Stock & devices' }, element: <Overview />, end: true },
  { path: 'inventory/stock', icon: 'layers', label: { ar: 'أرصدة المخزون', en: 'Stock on hand' }, element: <Stock /> },
  { path: 'inventory/stock/:id', nav: false, element: <ItemCard /> },
  { path: 'inventory/moves', icon: 'swap', label: { ar: 'حركات المخزون', en: 'Movements' }, element: <Moves /> },
  { path: 'inventory/counts', icon: 'clipboard', label: { ar: 'الجرد', en: 'Stock counts' }, element: <Counts /> },
  { path: 'inventory/counts/:id', nav: false, element: <CountPage /> },
  { path: 'inventory/orders', icon: 'truck', label: { ar: 'أوامر الشراء', en: 'Purchase orders' }, element: <Orders /> },
  { path: 'inventory/orders/:id', nav: false, element: <OrderPage /> },
  { path: 'inventory/suppliers', icon: 'briefcase', label: { ar: 'الموردون', en: 'Suppliers' }, element: <Suppliers /> },
  { path: 'inventory/suppliers/:id', nav: false, element: <SupplierPage /> },
  { path: 'inventory/payables', icon: 'calendar', label: { ar: 'مستحقات الموردين', en: 'Supplier payables' }, element: <Payables /> },
  { path: 'inventory/devices', icon: 'monitor', label: { ar: 'الأجهزة الطبية', en: 'Medical devices' }, element: <Devices /> },
  { path: 'inventory/devices/:id', nav: false, element: <DevicePage /> },
  { path: 'inventory/faults', icon: 'alert', label: { ar: 'أعطال الأجهزة', en: 'Device faults' }, element: <Faults /> },
  { path: 'inventory/setup', icon: 'filter', label: { ar: 'القوائم والإعدادات', en: 'Lists & settings' }, element: <Setup /> },
]

// The stock, purchasing & devices pages for a role that sees them. `nav` lists the ones in the side menu; the rest stay reachable by link.
export function inventoryPages(nav) {
  return ALL.map((p) => ({
    ...p,
    permission: 'inventory.view',
    nav: p.nav === false || !nav ? p.nav : nav.includes(p.path.replace(/^inventory\/?/, '') || 'overview') ? undefined : false,
  }))
}

// Nurses and doctors: using consumables and reporting device faults.
export function inventoryUsePages() {
  return [
    { path: 'inventory/use', icon: 'box', label: { ar: 'صرف مستهلكات', en: 'Use stock' }, element: <UseStock />, permission: 'inventory.use' },
    { path: 'inventory/faults', icon: 'alert', label: { ar: 'أعطال الأجهزة', en: 'Device faults' }, element: <Faults />, permission: 'devices.report' },
  ]
}
