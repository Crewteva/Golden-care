import Home from './Home'
import Activity from './Activity'
import InvoicesList from '../../../components/billing/InvoicesList'
import InvoicePage from '../../../components/billing/InvoicePage'
import PatientAccount from '../../../components/billing/PatientAccount'
import Refunds from '../../../components/billing/Refunds'
import { ShiftReport, ShiftsList } from '../../../components/billing/Shift'
import { InvoicePrint, ReceiptPrint } from '../../../components/billing/Prints'

export default {
  role: 'auditor',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'activity', icon: 'activity', label: { ar: 'سجل النشاط', en: 'Activity log' }, element: <Activity />, permission: 'audit.view' },
    { path: 'billing/invoices', icon: 'cash', label: { ar: 'الفواتير', en: 'Invoices' }, element: <InvoicesList />, permission: 'billing.view' },
    { path: 'billing/shifts', icon: 'calculator', label: { ar: 'الورديات والخزينة', en: 'Shifts & cash' }, element: <ShiftsList />, permission: 'billing.view' },
    { path: 'billing/refunds', icon: 'refresh', label: { ar: 'المرتجعات', en: 'Refunds' }, element: <Refunds />, permission: 'billing.view' },
    { path: 'billing/shifts/:id', nav: false, element: <ShiftReport />, permission: 'billing.view' },
    { path: 'billing/invoices/:id', nav: false, element: <InvoicePage />, permission: 'billing.view' },
    { path: 'billing/invoices/:id/print', nav: false, element: <InvoicePrint />, permission: 'billing.view' },
    { path: 'billing/receipts/:id/print', nav: false, element: <ReceiptPrint />, permission: 'billing.view' },
    { path: 'billing/patients/:id', nav: false, element: <PatientAccount />, permission: 'billing.view' },
  ],
}
