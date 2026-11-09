import Home from './Home'
import PatientDirectory from '../../../components/patients/PatientDirectory'
import PatientFile from '../../../components/patients/PatientFile'
import WeekView from '../../../components/settings/WeekView'
import TodayBoard from '../../../components/appointments/TodayBoard'
import NurseVitals from '../../../components/visits/NurseVitals'
import LaserToday from '../../../components/laser/LaserToday'
import LaserSession from '../../../components/laser/LaserSession'
import LabCases from '../../../components/dental/LabCases'
import ComplaintsDesk from '../../../components/complaints/ComplaintsDesk'
import { inventoryUsePages } from '../../../components/inventory/routes'

export default {
  role: 'nurse',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'today', icon: 'bell', label: { ar: 'مواعيد اليوم', en: "Today's appointments" }, element: <TodayBoard />, permission: 'appointments.view' },
    { path: 'vitals', icon: 'thermometer', label: { ar: 'العلامات الحيوية', en: 'Vital signs' }, element: <NurseVitals />, permission: 'visits.vitals' },
    { path: 'laser', icon: 'sparkle', label: { ar: 'جلسات الليزر', en: 'Laser sessions' }, element: <LaserToday />, permission: 'laser.record' },
    { path: 'lab-cases', icon: 'package', label: { ar: 'أعمال المعمل', en: 'Lab work' }, element: <LabCases />, permission: 'dental.lab' },
    ...inventoryUsePages(),
    { path: 'patients', icon: 'users', label: { ar: 'ملفات المرضى', en: 'Patient files' }, element: <PatientDirectory />, permission: 'patients.view' },
    { path: 'complaints', icon: 'headphones', label: { ar: 'الشكاوى والطلبات', en: 'Complaints & requests' }, element: <ComplaintsDesk />, permission: 'complaints.create' },
    { path: 'schedules', icon: 'clock', label: { ar: 'جدول الأطباء', en: 'Doctor schedules' }, element: <WeekView />, permission: 'settings.view' },
    { path: 'patients/:id', nav: false, element: <PatientFile />, permission: 'patients.view' },
    { path: 'laser/:id', nav: false, element: <LaserSession />, permission: 'laser.record' },
  ],
}
