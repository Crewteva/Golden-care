import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { pathFor } from '../auth/roles'
import { useI18n } from '../i18n/I18nContext'

export default function NotFound() {
  const { me } = useAuth()
  const { tx } = useI18n()
  return (
    <div className="not-found">
      <div style={{ display: 'grid', gap: 14, justifyItems: 'center' }}>
        <div className="code">404</div>
        <h1 style={{ fontSize: '1.5rem' }}>{tx('الصفحة غير موجودة', 'Page not found')}</h1>
        <p className="muted">{tx('ربما تغيّر الرابط أو كُتب بشكل غير صحيح.', 'The link may have changed or been mistyped.')}</p>
        <Link to={pathFor(me)} className="btn btn-primary">
          {me ? tx('إلى لوحتي', 'Go to my dashboard') : tx('تسجيل الدخول', 'Sign in')}
        </Link>
      </div>
    </div>
  )
}
