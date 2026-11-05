import Home from './Home'
import PatientDirectory from '../../../components/patients/PatientDirectory'
import PatientFile from '../../../components/patients/PatientFile'
import ReviewQueue from '../../../components/patients/ReviewQueue'

export default {
  role: 'doctor',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'patients', icon: 'users', label: { ar: 'ملفات المرضى', en: 'Patient files' }, element: <PatientDirectory />, permission: 'patients.view' },
    { path: 'review', icon: 'clipboard', label: { ar: 'بانتظار المراجعة', en: 'Awaiting review' }, element: <ReviewQueue />, permission: 'patient_files.review' },
    { path: 'patients/:id', nav: false, element: <PatientFile />, permission: 'patients.view' },
  ],
}
