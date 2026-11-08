import { useMemo, useState } from 'react'
import Button from '../Button'
import Modal from '../Modal'
import { Alert } from '../ui'
import { useToast } from '../Toast'
import { settingsApi } from '../../api/settings'
import { useAuth } from '../../auth/AuthContext'
import { slugFor } from '../../auth/roles'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'

export function useSettings() {
  const { me, can } = useAuth()
  const slug = slugFor(me.active_role)
  return useMemo(() => ({ api: settingsApi(slug), base: `/dashboard/${slug}`, can }), [slug, can])
}

// 0 = Sunday … 6 = Saturday. The Egyptian work week starts on Saturday.
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]
export const DAY_NAMES = {
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}
export const DAY_SHORT = {
  ar: ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

export function fmtTime(value, locale) {
  if (!value) return ''
  const [h, m] = value.split(':').map(Number)
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(2000, 0, 1, h, m))
}

export function fmtMoney(value, locale) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EGP', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value))
}

export function isoDate(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const SWATCHES = ['#1A6B5A', '#1A433C', '#B7862F', '#2D5D8A', '#9B3D5C', '#6B4FA0', '#C2562E', '#3F7D3A', '#55606B']

// "Delete X?" with a clear message when the database refuses because the item is in use.
export function ConfirmDelete({ open, title, children, onClose, onConfirm }) {
  const { t, tx } = useI18n()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const close = () => { setError(null); onClose() }
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      toast.success(tx('تم الحذف.', 'Deleted.'))
      close()
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={close} busy={busy} title={title}
      footer={<><Button variant="ghost" onClick={close} disabled={busy}>{t('cancel')}</Button><Button variant="danger" loading={busy} onClick={confirm}>{tx('حذف', 'Delete')}</Button></>}>
      <div className="form">
        {error && <Alert tone="danger">{error}</Alert>}
        <p>{children}</p>
        <p className="muted" style={{ fontSize: '.86rem' }}>{tx('سيُسجَّل الحذف في سجل النشاط.', 'The deletion is recorded in the activity log.')}</p>
      </div>
    </Modal>
  )
}

export function ColorField({ label, value, onChange }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {SWATCHES.map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)} aria-label={c} aria-pressed={value?.toUpperCase() === c}
            className="swatch" style={{ background: c }} />
        ))}
        <input type="color" value={value || '#1A433C'} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={label}
          style={{ width: 36, height: 30, border: 0, background: 'none', padding: 0, cursor: 'pointer' }} />
      </div>
    </div>
  )
}
