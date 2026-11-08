import Home from './Home'
import PatientDirectory from '../../../components/patients/PatientDirectory'
import PatientFile from '../../../components/patients/PatientFile'
import ReviewQueue from '../../../components/patients/ReviewQueue'
import Doctors from '../../../components/settings/Doctors'
import DoctorSetup from '../../../components/settings/DoctorSetup'
import WeekView from '../../../components/settings/WeekView'
import LeaveHolidays from '../../../components/settings/LeaveHolidays'
import Catalog from '../../../components/settings/Catalog'
import Calendar from '../../../components/appointments/Calendar'

export default {
  role: 'medical_director',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'calendar', icon: 'calendar', label: { ar: 'التقويم', en: 'Calendar' }, element: <Calendar />, permission: 'appointments.view' },
    { path: 'patients', icon: 'users', label: { ar: 'ملفات المرضى', en: 'Patient files' }, element: <PatientDirectory />, permission: 'patients.view' },
    { path: 'review', icon: 'clipboard', label: { ar: 'بانتظار المراجعة', en: 'Awaiting review' }, element: <ReviewQueue />, permission: 'patient_files.review' },
    { path: 'doctors', icon: 'stethoscope', label: { ar: 'الأطباء والجداول', en: 'Doctors & schedules' }, element: <Doctors />, permission: 'settings.view' },
    { path: 'doctors/:id', nav: false, element: <DoctorSetup />, permission: 'settings.view' },
    { path: 'schedules', icon: 'clock', label: { ar: 'جدول الأسبوع', en: 'Week view' }, element: <WeekView />, permission: 'settings.view' },
    { path: 'leave', icon: 'calendar', label: { ar: 'الإجازات والعطلات', en: 'Leave & holidays' }, element: <LeaveHolidays />, permission: 'settings.view' },
    { path: 'services', icon: 'clipboard', label: { ar: 'التخصصات والخدمات', en: 'Specialties & services' }, element: <Catalog />, permission: 'settings.view' },
    { path: 'patients/:id', nav: false, element: <PatientFile />, permission: 'patients.view' },
  ],
}
