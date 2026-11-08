import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { useAuth } from '../../auth/AuthContext'
import { useI18n } from '../../i18n/I18nContext'

const ITEMS = [
  { to: 'accounting', icon: 'pie', ar: 'نظرة عامة', en: 'Overview', note: { ar: 'النقدية والمستحقات وما ينتظر', en: "Money, what's owed and what's waiting" } },
  { to: 'accounting/journal', icon: 'layers', ar: 'دفتر اليومية', en: 'Journal', note: { ar: 'قيود الفوترة تلقائيًا + قيود يدوية', en: 'Billing posts itself, plus manual entries' } },
  { to: 'accounting/expenses', icon: 'briefcase', ar: 'المصروفات', en: 'Expenses', note: { ar: 'بمرفق، من البنك أو النثرية', en: 'With a receipt, from bank or petty cash' } },
  { to: 'accounting/payouts', icon: 'stethoscope', ar: 'مستحقات الأطباء', en: 'Doctor payouts', note: { ar: 'إعداد ← اعتماد الإدارة ← صرف', en: 'Prepare → management approves → pay' } },
  { to: 'accounting/months', icon: 'lock', ar: 'إقفال الأشهر', en: 'Month close', note: { ar: 'لا قيود بعد الإقفال', en: 'No entries after closing' } },
  { to: 'accounting/reports', icon: 'trending', ar: 'التقارير المالية', en: 'Financial reports', note: { ar: 'طباعة وتصدير CSV', en: 'Print and CSV export' } },
]

export default function AccountingShortcuts({ only }) {
  const { tx, lang } = useI18n()
  const { can } = useAuth()
  if (!can('accounting.view')) return null
  const items = only ? ITEMS.filter((i) => only.includes(i.to)) : ITEMS
  return (
    <section className="card">
      <div className="card-head"><h2>{tx('الحسابات العامة', 'Accounting')}</h2></div>
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
