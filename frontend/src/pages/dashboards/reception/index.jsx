import Home from './Home'
import PatientDirectory from '../../../components/patients/PatientDirectory'
import PatientFile from '../../../components/patients/PatientFile'
import NewPatient from './NewPatient'
import WeekView from '../../../components/settings/WeekView'
import TodayBoard from '../../../components/appointments/TodayBoard'
import BookAppointment from '../../../components/appointments/BookAppointment'
import Calendar from '../../../components/appointments/Calendar'

export default {
  role: 'reception',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'today', icon: 'bell', label: { ar: 'مواعيد اليوم', en: "Today's appointments" }, element: <TodayBoard />, permission: 'appointments.view' },
    { path: 'book', icon: 'plus', label: { ar: 'حجز موعد', en: 'Book appointment' }, element: <BookAppointment />, permission: 'appointments.book' },
    { path: 'calendar', icon: 'calendar', label: { ar: 'التقويم', en: 'Calendar' }, element: <Calendar />, permission: 'appointments.view' },
    { path: 'patients', icon: 'users', label: { ar: 'ملفات المرضى', en: 'Patient files' }, element: <PatientDirectory />, permission: 'patients.view' },
    { path: 'patients/new', nav: false, element: <NewPatient />, permission: 'patients.create' },
    { path: 'schedules', icon: 'clock', label: { ar: 'جدول الأطباء', en: 'Doctor schedules' }, element: <WeekView />, permission: 'settings.view' },
    { path: 'patients/:id', nav: false, element: <PatientFile />, permission: 'patients.view' },
  ],
}
