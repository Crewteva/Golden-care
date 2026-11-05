import Home from './Home'
import Activity from './Activity'

export default {
  role: 'auditor',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'activity', icon: 'activity', label: { ar: 'سجل النشاط', en: 'Activity log' }, element: <Activity />, permission: 'audit.view' },
  ],
}
