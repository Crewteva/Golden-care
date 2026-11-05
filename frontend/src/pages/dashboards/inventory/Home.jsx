import RoleHome from '../../../components/RoleHome'

// What this workspace will hold, from the project to-do list. Replace with real pages as they're built.
const UPCOMING = [
  { icon: 'package', ar: 'المخزون والتشغيلات', en: "Stock & batches", note: { ar: 'مع تواريخ الانتهاء', en: "With expiry dates" } },
  { icon: 'clipboard', ar: 'أوامر الشراء والاستلام', en: "Purchase orders & receiving", note: { ar: 'مقابل كل أمر', en: "Against each order" } },
  { icon: 'swap', ar: 'التحويل بين المخازن', en: "Transfers between stores", note: { ar: 'مع حالة «في الطريق»', en: "With an 'in transit' status" } },
  { icon: 'alert', ar: 'تنبيهات النقص والانتهاء', en: "Low-stock & expiry alerts", note: { ar: 'قبل أن تنفد', en: "Before you run out" } },
]

export default function Home() {
  return <RoleHome upcoming={UPCOMING} />
}
