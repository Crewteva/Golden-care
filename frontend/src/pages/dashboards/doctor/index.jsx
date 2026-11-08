import Home from './Home'
import PatientDirectory from '../../../components/patients/PatientDirectory'
import PatientFile from '../../../components/patients/PatientFile'
import ReviewQueue from '../../../components/patients/ReviewQueue'
import WeekView from '../../../components/settings/WeekView'
import DoctorDay from '../../../components/appointments/DoctorDay'

export default {
  role: 'doctor',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'my-day', icon: 'stethoscope', label: { ar: 'يومي', en: 'My day' }, element: <DoctorDay />, permission: 'appointments.view' },
    { path: 'patients', icon: 'users', label: { ar: 'ملفات المرضى', en: 'Patient files' }, element: <PatientDirectory />, permission: 'patients.view' },
    { path: 'review', icon: 'clipboard', label: { ar: 'بانتظار المراجعة', en: 'Awaiting review' }, element: <ReviewQueue />, permission: 'patient_files.review' },
    { path: 'my-schedule', icon: 'clock', label: { ar: 'جدولي', en: 'My schedule' }, element: <WeekView selfOnly />, permission: 'settings.view' },
    { path: 'patients/:id', nav: false, element: <PatientFile />, permission: 'patients.view' },
  ],
}
