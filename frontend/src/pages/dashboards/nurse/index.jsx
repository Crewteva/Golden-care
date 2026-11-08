import Home from './Home'
import PatientDirectory from '../../../components/patients/PatientDirectory'
import PatientFile from '../../../components/patients/PatientFile'
import WeekView from '../../../components/settings/WeekView'
import TodayBoard from '../../../components/appointments/TodayBoard'

export default {
  role: 'nurse',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'today', icon: 'bell', label: { ar: 'مواعيد اليوم', en: "Today's appointments" }, element: <TodayBoard />, permission: 'appointments.view' },
    { path: 'patients', icon: 'users', label: { ar: 'ملفات المرضى', en: 'Patient files' }, element: <PatientDirectory />, permission: 'patients.view' },
    { path: 'schedules', icon: 'clock', label: { ar: 'جدول الأطباء', en: 'Doctor schedules' }, element: <WeekView />, permission: 'settings.view' },
    { path: 'patients/:id', nav: false, element: <PatientFile />, permission: 'patients.view' },
  ],
}
