import Home from './Home'
import Profile from './Profile'

export default {
  role: 'patient',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'profile', icon: 'user', label: { ar: 'ملفي', en: 'My profile' }, element: <Profile /> },
  ],
}
