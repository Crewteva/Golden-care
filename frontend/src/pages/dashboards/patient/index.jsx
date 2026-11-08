import Home from './Home'
import Documents from './Documents'
import Family from './Family'
import Profile from './Profile'
import Appointments from './Appointments'
import BookOnline from './BookOnline'
import Visits, { MyVisitPrint } from './Visits'
import Plans, { MyPlanPrint } from './Plans'
import Requests from './Requests'

export default {
  role: 'patient',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'appointments', icon: 'calendar', label: { ar: 'مواعيدي', en: 'My appointments' }, element: <Appointments /> },
    { path: 'book', nav: false, element: <BookOnline /> },
    { path: 'visits', icon: 'stethoscope', label: { ar: 'زياراتي والروشتات', en: 'My visits' }, element: <Visits /> },
    { path: 'visits/:id/print', nav: false, element: <MyVisitPrint /> },
    { path: 'plans', icon: 'clipboard', label: { ar: 'خطط العلاج', en: 'Treatment plans' }, element: <Plans /> },
    { path: 'plans/:id/print', nav: false, element: <MyPlanPrint /> },
    { path: 'documents', icon: 'fileSearch', label: { ar: 'نتائجي ومستنداتي', en: 'Results & documents' }, element: <Documents /> },
    { path: 'family', icon: 'users', label: { ar: 'عائلتي', en: 'My family' }, element: <Family /> },
    { path: 'requests', icon: 'headphones', label: { ar: 'الشكاوى والطلبات', en: 'Complaints & requests' }, element: <Requests /> },
    { path: 'profile', icon: 'user', label: { ar: 'ملفي', en: 'My profile' }, element: <Profile /> },
  ],
}
