import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/alexandria/arabic-400.css'
import '@fontsource/alexandria/arabic-500.css'
import '@fontsource/alexandria/arabic-600.css'
import '@fontsource/alexandria/arabic-700.css'
import '@fontsource/alexandria/latin-400.css'
import '@fontsource/alexandria/latin-500.css'
import '@fontsource/alexandria/latin-600.css'
import '@fontsource/alexandria/latin-700.css'
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css'
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css'
import '@fontsource/ibm-plex-sans-arabic/latin-400.css'
import '@fontsource/ibm-plex-sans-arabic/latin-500.css'
import './styles/global.css'
import './styles/layouts.css'
import './styles/patients.css'
import './styles/settings.css'
import './styles/appointments.css'
import App from './App'
import { I18nProvider } from './i18n/I18nContext'
import { AuthProvider } from './auth/AuthContext'
import { ToastProvider } from './components/Toast'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
