import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import Icon from './Icon'
import { useI18n } from '../i18n/I18nContext'

const ToastCtx = createContext(null)
let counter = 0

export function ToastProvider({ children }) {
  const { t } = useI18n()
  const [items, setItems] = useState([])

  const dismiss = useCallback((id) => setItems((list) => list.filter((item) => item.id !== id)), [])
  const push = useCallback(
    (message, tone = 'success') => {
      const id = ++counter
      setItems((list) => [...list.slice(-3), { id, message, tone }])
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4500)
    },
    [dismiss],
  )
  const value = useMemo(() => ({ success: (m) => push(m, 'success'), error: (m) => push(m, 'error') }), [push])

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast ${item.tone}`}>
            <Icon name={item.tone === 'error' ? 'alert' : 'checkCircle'} />
            <span>{item.message}</span>
            <button type="button" onClick={() => dismiss(item.id)} aria-label={t('close')}>
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)
