import Home from './Home'
import Documents from './Documents'
import Family from './Family'
import Profile from './Profile'

export default {
  role: 'patient',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'documents', icon: 'fileSearch', label: { ar: 'نتائجي ومستنداتي', en: 'Results & documents' }, element: <Documents /> },
    { path: 'family', icon: 'users', label: { ar: 'عائلتي', en: 'My family' }, element: <Family /> },
    { path: 'profile', icon: 'user', label: { ar: 'ملفي', en: 'My profile' }, element: <Profile /> },
  ],
}
