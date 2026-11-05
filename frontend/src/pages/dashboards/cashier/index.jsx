import Home from './Home'
import Catalog from '../../../components/settings/Catalog'

export default {
  role: 'cashier',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    { path: 'services', icon: 'clipboard', label: { ar: 'قائمة الأسعار', en: 'Price list' }, element: <Catalog />, permission: 'settings.view' },
  ],
}
