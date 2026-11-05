import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import { useI18n } from '../i18n/I18nContext'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({ open, onClose, title, description, children, footer, wide, busy }) {
  const { t } = useI18n()
  const ref = useRef(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    const node = ref.current
    const first = node?.querySelector('[data-autofocus]') || node?.querySelector(FOCUSABLE)
    first?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose()
      if (event.key === 'Tab' && node) {
        const items = [...node.querySelectorAll(FOCUSABLE)]
        if (!items.length) return
        const [start, end] = [items[0], items[items.length - 1]]
        if (event.shiftKey && document.activeElement === start) {
          event.preventDefault()
          end.focus()
        } else if (!event.shiftKey && document.activeElement === end) {
          event.preventDefault()
          start.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open, onClose, busy])

  if (!open) return null
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
      >
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descId}>{description}</p>}
          </div>
          <button type="button" className="btn btn-quiet btn-icon" onClick={onClose} aria-label={t('close')} disabled={busy}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
