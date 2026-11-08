import Overview from './Overview'
import Journal, { EntryPage } from './Journal'
import Expenses from './Expenses'
import Money from './Money'
import Payouts, { PayoutPage } from './Payouts'
import Months from './Months'
import Reports from './Reports'
import Accounts from './Accounts'

const ALL = [
  { path: 'accounting', icon: 'pie', label: { ar: 'الحسابات العامة', en: 'Accounting' }, element: <Overview />, end: true },
  { path: 'accounting/journal', icon: 'layers', label: { ar: 'دفتر اليومية', en: 'Journal' }, element: <Journal /> },
  { path: 'accounting/journal/:id', nav: false, element: <EntryPage /> },
  { path: 'accounting/expenses', icon: 'briefcase', label: { ar: 'المصروفات', en: 'Expenses' }, element: <Expenses /> },
  { path: 'accounting/money', icon: 'swap', label: { ar: 'الخزينة والبنك', en: 'Cash & bank' }, element: <Money /> },
  { path: 'accounting/payouts', icon: 'stethoscope', label: { ar: 'مستحقات الأطباء', en: 'Doctor payouts' }, element: <Payouts /> },
  { path: 'accounting/payouts/:id', nav: false, element: <PayoutPage /> },
  { path: 'accounting/months', icon: 'lock', label: { ar: 'إقفال الأشهر', en: 'Month close' }, element: <Months /> },
  { path: 'accounting/reports', icon: 'trending', label: { ar: 'التقارير المالية', en: 'Financial reports' }, element: <Reports /> },
  { path: 'accounting/accounts', icon: 'clipboard', label: { ar: 'دليل الحسابات', en: 'Chart of accounts' }, element: <Accounts /> },
]

// The accounting pages for a role. `nav` lists the ones shown in the side menu; the rest stay reachable by link.
export function accountingPages(nav) {
  return ALL.map((p) => ({
    ...p,
    permission: 'accounting.view',
    nav: p.nav === false || !nav ? p.nav : nav.includes(p.path.replace(/^accounting\/?/, '') || 'overview') ? undefined : false,
  }))
}
