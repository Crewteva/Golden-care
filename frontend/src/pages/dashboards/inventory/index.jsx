import Home from './Home'
import { inventoryPages } from '../../../components/inventory/routes'

// Inventory (stores keeper): stock, purchasing, suppliers and medical devices.
export default {
  role: 'inventory',
  pages: [
    { path: '', icon: 'home', label: { ar: 'الرئيسية', en: 'Home' }, element: <Home /> },
    ...inventoryPages(),
  ],
}
