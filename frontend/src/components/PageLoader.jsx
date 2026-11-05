import { useI18n } from '../i18n/I18nContext'

export default function PageLoader({ full }) {
  const { t } = useI18n()
  return (
    <div className="page-loader" style={full ? { minHeight: '100dvh' } : undefined} role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{t('loading')}</span>
    </div>
  )
}
