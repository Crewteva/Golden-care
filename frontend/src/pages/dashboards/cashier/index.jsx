import Home from './Home'
import Catalog from '../../../components/settings/Catalog'
import TodayBoard from '../../../components/appointments/TodayBoard'
import ComplaintsDesk from '../../../components/complaints/ComplaintsDesk'

export default {
  role: 'cashier',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'today', icon: 'bell', label: { ar: 'مواعيد اليوم', en: "Today's appointments" }, element: <TodayBoard />, permission: 'appointments.view' },
    { path: 'services', icon: 'clipboard', label: { ar: 'قائمة الأسعار', en: 'Price list' }, element: <Catalog />, permission: 'settings.view' },
    { path: 'complaints', icon: 'headphones', label: { ar: 'الشكاوى والطلبات', en: 'Complaints & requests' }, element: <ComplaintsDesk />, permission: 'complaints.create' },
  ],
}
