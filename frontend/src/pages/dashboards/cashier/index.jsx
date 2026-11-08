import Home from './Home'
import Catalog from '../../../components/settings/Catalog'
import TodayBoard from '../../../components/appointments/TodayBoard'
import ComplaintsDesk from '../../../components/complaints/ComplaintsDesk'
import Desk from '../../../components/billing/Desk'
import InvoicesList from '../../../components/billing/InvoicesList'
import InvoicePage from '../../../components/billing/InvoicePage'
import PatientAccount from '../../../components/billing/PatientAccount'
import Refunds from '../../../components/billing/Refunds'
import { MyShift, ShiftReport, ShiftsList } from '../../../components/billing/Shift'
import { InvoicePrint, ReceiptPrint } from '../../../components/billing/Prints'

export default {
  role: 'cashier',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'billing', icon: 'cash', label: { ar: 'الخزينة', en: 'Cashier desk' }, element: <Desk />, permission: 'billing.collect' },
    { path: 'billing/shift', icon: 'calculator', label: { ar: 'ورديتي', en: 'My shift' }, element: <MyShift />, permission: 'billing.collect' },
    { path: 'billing/invoices', icon: 'clipboard', label: { ar: 'الفواتير', en: 'Invoices' }, element: <InvoicesList />, permission: 'billing.view' },
    { path: 'billing/refunds', icon: 'refresh', label: { ar: 'المرتجعات', en: 'Refunds' }, element: <Refunds />, permission: 'billing.view' },
    { path: 'billing/shifts', icon: 'layers', label: { ar: 'تقارير الورديات', en: 'Shift reports' }, element: <ShiftsList />, permission: 'billing.view' },
    { path: 'billing/shifts/:id', nav: false, element: <ShiftReport />, permission: 'billing.view' },
    { path: 'billing/invoices/:id', nav: false, element: <InvoicePage />, permission: 'billing.view' },
    { path: 'billing/invoices/:id/print', nav: false, element: <InvoicePrint />, permission: 'billing.view' },
    { path: 'billing/receipts/:id/print', nav: false, element: <ReceiptPrint />, permission: 'billing.view' },
    { path: 'billing/patients/:id', nav: false, element: <PatientAccount />, permission: 'billing.view' },
    { path: 'today', icon: 'bell', label: { ar: 'مواعيد اليوم', en: "Today's appointments" }, element: <TodayBoard />, permission: 'appointments.view' },
    { path: 'services', icon: 'clipboard', label: { ar: 'قائمة الأسعار', en: 'Price list' }, element: <Catalog />, permission: 'settings.view' },
    { path: 'complaints', icon: 'headphones', label: { ar: 'الشكاوى والطلبات', en: 'Complaints & requests' }, element: <ComplaintsDesk />, permission: 'complaints.create' },
  ],
}
