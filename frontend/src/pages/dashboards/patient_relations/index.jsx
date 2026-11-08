import Home from './Home'
import PatientDirectory from '../../../components/patients/PatientDirectory'
import PatientFile from '../../../components/patients/PatientFile'
import WeekView from '../../../components/settings/WeekView'
import TodayBoard from '../../../components/appointments/TodayBoard'
import BookAppointment from '../../../components/appointments/BookAppointment'
import Calendar from '../../../components/appointments/Calendar'
import FollowUps from '../../../components/visits/FollowUps'
import ComplaintsDesk from '../../../components/complaints/ComplaintsDesk'
import PlansList from '../../../components/dental/PlansList'
import PlanPage from '../../../components/dental/PlanPage'
import QuotationPrint from '../../../components/dental/Quotation'

export default {
  role: 'patient_relations',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'today', icon: 'bell', label: { ar: 'مواعيد اليوم', en: "Today's appointments" }, element: <TodayBoard />, permission: 'appointments.view' },
    { path: 'book', icon: 'plus', label: { ar: 'حجز موعد', en: 'Book appointment' }, element: <BookAppointment />, permission: 'appointments.book' },
    { path: 'follow-ups', icon: 'refresh', label: { ar: 'متابعات مطلوبة', en: 'Follow-ups due' }, element: <FollowUps />, permission: 'appointments.book' },
    { path: 'calendar', icon: 'calendar', label: { ar: 'التقويم', en: 'Calendar' }, element: <Calendar />, permission: 'appointments.view' },
    { path: 'complaints', icon: 'headphones', label: { ar: 'الشكاوى والطلبات', en: 'Complaints & requests' }, element: <ComplaintsDesk />, permission: 'complaints.manage' },
    { path: 'patients', icon: 'users', label: { ar: 'ملفات المرضى', en: 'Patient files' }, element: <PatientDirectory />, permission: 'patients.view' },
    { path: 'plans', icon: 'clipboard', label: { ar: 'خطط علاج الأسنان', en: 'Dental plans' }, element: <PlansList />, permission: 'dental.plans_view' },
    { path: 'plans/:id', nav: false, element: <PlanPage />, permission: 'dental.plans_view' },
    { path: 'plans/:id/print', nav: false, element: <QuotationPrint />, permission: 'dental.plans_view' },
    { path: 'schedules', icon: 'clock', label: { ar: 'جدول الأطباء', en: 'Doctor schedules' }, element: <WeekView />, permission: 'settings.view' },
    { path: 'patients/:id', nav: false, element: <PatientFile />, permission: 'patients.view' },
  ],
}
