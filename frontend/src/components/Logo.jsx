import { useId } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext'

// The Golden Care mark: a gold "G" whose bar points inward, toward the patient.
export function LogoMark({ size = 40 }) {
  const id = `gc${useId().replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F6E3AE" />
          <stop offset=".55" stopColor="#CB9C45" />
          <stop offset="1" stopColor="#8E6420" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="14" fill="#0B211E" stroke="rgba(227,194,125,.35)" />
      <path
        d="M34.4 14.2A13.5 13.5 0 1 0 37.6 25.6H25.4"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="34.4" cy="14.2" r="1.2" fill="#F6E3AE" />
    </svg>
  )
}

export default function Logo({ to = '/', size = 40, sub = true }) {
  const { t } = useI18n()
  return (
    <Link to={to} className="logo" aria-label={t('app_name')}>
      <LogoMark size={size} />
      <span className="logo-text">
        <b>{t('app_name')}</b>
        {sub && <small>{t('app_suffix')}</small>}
      </span>
    </Link>
  )
}

// Thin concentric gold orbits used behind dark brand panels.
export function Orbits({ className = 'auth-orbits' }) {
  return (
    <svg className={className} viewBox="0 0 640 640" fill="none" aria-hidden="true" focusable="false">
      <circle cx="320" cy="320" r="310" stroke="currentColor" strokeOpacity=".22" strokeDasharray="2 10" />
      <circle cx="320" cy="320" r="250" stroke="currentColor" strokeOpacity=".28" />
      <circle cx="320" cy="320" r="190" stroke="currentColor" strokeOpacity=".2" strokeDasharray="1 7" />
      <circle cx="320" cy="320" r="130" stroke="currentColor" strokeOpacity=".32" />
      <circle cx="320" cy="320" r="70" stroke="currentColor" strokeOpacity=".2" />
      <circle cx="320" cy="70" r="5" fill="currentColor" fillOpacity=".7" />
      <circle cx="570" cy="320" r="3.5" fill="currentColor" fillOpacity=".55" />
      <circle cx="190" cy="430" r="4" fill="currentColor" fillOpacity=".45" />
    </svg>
  )
}
