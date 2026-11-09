import Home from './Home'
import PatientDirectory from '../../../components/patients/PatientDirectory'
import PatientFile from '../../../components/patients/PatientFile'
import ReviewQueue from '../../../components/patients/ReviewQueue'
import WeekView from '../../../components/settings/WeekView'
import DoctorDay from '../../../components/appointments/DoctorDay'
import VisitWorkspace from '../../../components/visits/VisitWorkspace'
import VisitList from '../../../components/visits/VisitList'
import RxPrint from '../../../components/visits/RxSheet'
import LaserToday from '../../../components/laser/LaserToday'
import LaserSession from '../../../components/laser/LaserSession'
import PlansList from '../../../components/dental/PlansList'
import PlanPage from '../../../components/dental/PlanPage'
import QuotationPrint from '../../../components/dental/Quotation'
import LabCases from '../../../components/dental/LabCases'
import { inventoryUsePages } from '../../../components/inventory/routes'

export default {
  role: 'doctor',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'my-day', icon: 'stethoscope', label: { ar: 'يومي', en: 'My day' }, element: <DoctorDay />, permission: 'appointments.view' },
    { path: 'visits', icon: 'pen', label: { ar: 'زياراتي', en: 'My visits' }, element: <VisitList mine />, permission: 'visits.write' },
    { path: 'laser', icon: 'sparkle', label: { ar: 'جلسات الليزر', en: 'Laser sessions' }, element: <LaserToday />, permission: 'laser.record' },
    { path: 'plans', icon: 'clipboard', label: { ar: 'خطط العلاج', en: 'Treatment plans' }, element: <PlansList mine />, permission: 'dental.plans' },
    { path: 'lab-cases', icon: 'package', label: { ar: 'أعمال المعمل', en: 'Lab work' }, element: <LabCases />, permission: 'dental.lab' },
    ...inventoryUsePages(),
    { path: 'patients', icon: 'users', label: { ar: 'ملفات المرضى', en: 'Patient files' }, element: <PatientDirectory />, permission: 'patients.view' },
    { path: 'review', icon: 'fileSearch', label: { ar: 'بانتظار المراجعة', en: 'Awaiting review' }, element: <ReviewQueue />, permission: 'patient_files.review' },
    { path: 'my-schedule', icon: 'clock', label: { ar: 'جدولي', en: 'My schedule' }, element: <WeekView selfOnly />, permission: 'settings.view' },
    { path: 'patients/:id', nav: false, element: <PatientFile />, permission: 'patients.view' },
    { path: 'visits/:id', nav: false, element: <VisitWorkspace />, permission: 'visits.write' },
    { path: 'visits/:id/print', nav: false, element: <RxPrint />, permission: 'visits.write' },
    { path: 'laser/:id', nav: false, element: <LaserSession />, permission: 'laser.record' },
    { path: 'plans/:id', nav: false, element: <PlanPage />, permission: 'dental.plans' },
    { path: 'plans/:id/print', nav: false, element: <QuotationPrint />, permission: 'dental.plans' },
  ],
}
