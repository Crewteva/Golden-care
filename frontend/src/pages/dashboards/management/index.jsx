import Home from './Home'
import Catalog from '../../../components/settings/Catalog'
import Rooms from '../../../components/settings/Rooms'
import Doctors from '../../../components/settings/Doctors'
import DoctorSetup from '../../../components/settings/DoctorSetup'
import LeaveHolidays from '../../../components/settings/LeaveHolidays'
import WeekView from '../../../components/settings/WeekView'
import Calendar from '../../../components/appointments/Calendar'
import BookingRules from '../../../components/settings/BookingRules'
import ComplaintsDesk from '../../../components/complaints/ComplaintsDesk'
import PlansList from '../../../components/dental/PlansList'
import PlanPage from '../../../components/dental/PlanPage'
import QuotationPrint from '../../../components/dental/Quotation'

// Management (owner / general manager): the business side of the clinic.
export default {
  role: 'management',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'calendar', icon: 'calendar', label: { ar: 'التقويم', en: 'Calendar' }, element: <Calendar />, permission: 'appointments.view' },
    { path: 'complaints', icon: 'headphones', label: { ar: 'الشكاوى والطلبات', en: 'Complaints & requests' }, element: <ComplaintsDesk />, permission: 'complaints.manage' },
    { path: 'plans', icon: 'clipboard', label: { ar: 'خطط علاج الأسنان', en: 'Dental plans' }, element: <PlansList />, permission: 'dental.plans_view' },
    { path: 'plans/:id', nav: false, element: <PlanPage />, permission: 'dental.plans_view' },
    { path: 'plans/:id/print', nav: false, element: <QuotationPrint />, permission: 'dental.plans_view' },
    { path: 'booking-rules', icon: 'shield', label: { ar: 'قواعد الحجز', en: 'Booking rules' }, element: <BookingRules />, permission: 'settings.view' },
    { path: 'services', icon: 'clipboard', label: { ar: 'الخدمات والأسعار', en: 'Services & prices' }, element: <Catalog />, permission: 'settings.view' },
    { path: 'doctors', icon: 'stethoscope', label: { ar: 'الأطباء والجداول', en: 'Doctors & schedules' }, element: <Doctors />, permission: 'settings.view' },
    { path: 'doctors/:id', nav: false, element: <DoctorSetup />, permission: 'settings.view' },
    { path: 'schedules', icon: 'clock', label: { ar: 'جدول الأسبوع', en: 'Week view' }, element: <WeekView />, permission: 'settings.view' },
    { path: 'rooms', icon: 'building', label: { ar: 'الغرف', en: 'Rooms' }, element: <Rooms />, permission: 'settings.view' },
    { path: 'leave', icon: 'calendar', label: { ar: 'الإجازات والعطلات', en: 'Leave & holidays' }, element: <LeaveHolidays />, permission: 'settings.view' },
  ],
}
