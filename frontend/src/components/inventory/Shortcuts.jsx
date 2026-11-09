import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { useAuth } from '../../auth/AuthContext'
import { useI18n } from '../../i18n/I18nContext'

const ITEMS = [
  { to: 'inventory', icon: 'box', ar: 'نظرة عامة', en: 'Overview', note: { ar: 'قيمة المخزون والتنبيهات وما ينتظر', en: "Stock value, alerts and what's waiting" } },
  { to: 'inventory/stock', icon: 'layers', ar: 'أرصدة المخزون', en: 'Stock on hand', note: { ar: 'بالتشغيلة والصلاحية', en: 'By lot and expiry' } },
  { to: 'inventory/counts', icon: 'clipboard', ar: 'الجرد', en: 'Stock counts', note: { ar: 'جرد أعمى ← اعتماد الفروق', en: 'Blind count → differences approved' } },
  { to: 'inventory/orders', icon: 'truck', ar: 'أوامر الشراء', en: 'Purchase orders', note: { ar: 'يعتمدها شخص ثانٍ؛ أعلى من الحد الإدارة', en: 'A second person approves; above the limit, management' } },
  { to: 'inventory/transfers', icon: 'swap', ar: 'التحويلات بين المخازن', en: 'Transfers between stores', note: { ar: 'طلب ← إرسال ← استلام بالعجز', en: 'Request → send → receive, shortages noted' } },
  { to: 'inventory/returns', icon: 'refresh', ar: 'المرتجعات للموردين', en: 'Returns to suppliers', note: { ar: 'الدفعة نفسها، باعتماد شخص ثانٍ', en: 'The exact lot, approved by a second person' } },
  { to: 'inventory/payables', icon: 'calendar', ar: 'مستحقات الموردين', en: 'Supplier payables', note: { ar: 'الأعمار واعتماد الدفعات', en: 'Aging and payment approvals' } },
  { to: 'inventory/devices', icon: 'monitor', ar: 'الأجهزة الطبية', en: 'Medical devices', note: { ar: 'الصيانة والمعايرة والنبضات والأعطال', en: 'Service, calibration, pulses and faults' } },
  { to: 'inventory/bookings', icon: 'calendar', ar: 'حجز الأجهزة', en: 'Device booking', note: { ar: 'بلا تداخل، والجهاز المعطل لا يُحجز', en: "No overlaps; broken devices can't be booked" } },
  { to: 'inventory/setup', icon: 'filter', ar: 'القوائم والإعدادات', en: 'Lists & settings', note: { ar: 'الأصناف والموردون وحد الاعتماد', en: 'Items, suppliers and the approval limit' } },
]

export default function InventoryShortcuts({ only }) {
  const { tx, lang } = useI18n()
  const { can } = useAuth()
  if (!can('inventory.view')) return null
  const items = only ? ITEMS.filter((i) => only.includes(i.to)) : ITEMS
  return (
    <section className="card">
      <div className="card-head"><h2>{tx('المخازن والمشتريات', 'Stock & purchasing')}</h2></div>
      <div className="card-body">
        <ul className="roadmap">
          {items.map((item) => (
            <li key={item.to} className="roadmap-link">
              <Link to={item.to}>
                <span className="ico"><Icon name={item.icon} size={17} /></span>
                <span><strong>{item[lang]}</strong><small>{item.note[lang]}</small></span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
