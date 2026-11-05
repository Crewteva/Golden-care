// Small building blocks shared by every dashboard page.
import { useState } from 'react'
import Icon from './Icon'
import Button from './Button'
import { useI18n } from '../i18n/I18nContext'
import { errorText } from '../lib/errors'
import { initials } from '../lib/format'

export function PageHeader({ eyebrow, title, description, actions, back }) {
  return (
    <header className="page-header">
      <div>
        {back}
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Badge({ tone = 'neutral', plain, children }) {
  return <span className={`badge badge-${tone} ${plain ? 'badge-plain' : ''}`}>{children}</span>
}

export function Alert({ tone = 'info', title, children, icon }) {
  const icons = { danger: 'alert', warn: 'alert', success: 'checkCircle', info: 'info' }
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={icon || icons[tone]} size={18} />
      <div>
        {title && <strong>{title} </strong>}
        {children}
      </div>
    </div>
  )
}

export function Avatar({ name, size, muted }) {
  return (
    <span className={`avatar ${size === 'lg' ? 'lg' : ''} ${muted ? 'muted-av' : ''}`} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

export function EmptyState({ icon = 'inbox', title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-art">
        <Icon name={icon} size={28} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  const { t, tx } = useI18n()
  return (
    <div className="empty">
      <div className="empty-art" style={{ color: 'var(--danger)' }}>
        <Icon name="alert" size={28} />
      </div>
      <h3>{tx('تعذّر تحميل البيانات', "Couldn't load this")}</h3>
      <p>{errorText(error, t)}</p>
      {onRetry && (
        <Button variant="ghost" icon="refresh" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </div>
  )
}

export function SkeletonRows({ rows = 5, cols = 4 }) {
  return (
    <div style={{ padding: 20, display: 'grid', gap: 14 }} aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>
          {Array.from({ length: cols }).map((__, c) => (
            <div key={c} className="skeleton" style={{ height: 16, width: c === 0 ? '80%' : '60%' }} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SortTh({ label, column, sort, direction, onSort }) {
  const active = sort === column
  return (
    <th aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sort-btn" data-active={active} onClick={() => onSort(column)}>
        {label}
        <Icon name={active ? (direction === 'asc' ? 'sortUp' : 'sortDown') : 'sort'} size={14} />
      </button>
    </th>
  )
}

export function Pagination({ page, pageSize, total, onPage }) {
  const { t } = useI18n()
  if (!total) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <div className="pagination">
      <span className="num">{t('showing', { from, to, total })}</span>
      <div className="btns">
        <Button variant="ghost" size="sm" icon="chevronLeft" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('previous')}
        </Button>
        <Button variant="ghost" size="sm" iconEnd="chevronRight" disabled={to >= total} onClick={() => onPage(page + 1)}>
          {t('next')}
        </Button>
      </div>
    </div>
  )
}

export function SecretBox({ value }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked: the value is still visible */
    }
  }
  return (
    <div className="secret-box">
      <code>{value}</code>
      <Button size="sm" icon={copied ? 'check' : 'copy'} onClick={copy}>
        {copied ? t('copied') : t('copy')}
      </Button>
    </div>
  )
}

export function LangToggle({ dark }) {
  const { lang, setLang, t } = useI18n()
  return (
    <div className={`lang-toggle ${dark ? 'on-dark' : ''}`} role="group" aria-label={t('language')}>
      <button type="button" aria-pressed={lang === 'ar'} onClick={() => setLang('ar')} lang="ar">
        عربي
      </button>
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} lang="en">
        EN
      </button>
    </div>
  )
}

export function StatusBadge({ user }) {
  const { t } = useI18n()
  if (!user.is_active) return <Badge tone="danger">{t('status.inactive')}</Badge>
  if (user.locked) return <Badge tone="warn">{t('status.locked')}</Badge>
  if (user.mfa_required && !user.mfa_enabled) return <Badge tone="gold">{t('status.mfa_pending')}</Badge>
  return <Badge tone="success">{t('status.active')}</Badge>
}
