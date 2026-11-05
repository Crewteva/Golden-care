import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { pathFor, roleName } from '../auth/roles'
import { useI18n } from '../i18n/I18nContext'

// Shown when someone opens another role's dashboard address.
export default function Forbidden({ role }) {
  const { me } = useAuth()
  const { tx, lang } = useI18n()
  const holds = me?.roles?.some((r) => r.role === role)
  return (
    <div className="not-found">
      <div style={{ display: 'grid', gap: 14, justifyItems: 'center', maxWidth: 480 }}>
        <div className="code">403</div>
        <h1 style={{ fontSize: '1.5rem' }}>{tx('هذه الصفحة تخص دورًا آخر', 'This page belongs to another role')}</h1>
        <p className="muted">
          {holds
            ? tx(`أنت تملك دور «${roleName(role, lang)}». بدّل إليه لفتح هذه الصفحة.`, `You hold the “${roleName(role, lang)}” role. Switch to it to open this page.`)
            : tx('لا يملك حسابك صلاحية فتح هذه الصفحة.', "Your account isn't allowed to open this page.")}
        </p>
        <div className="page-actions">
          {holds && (
            <Link to="/choose-role" className="btn btn-gold">
              {tx('تبديل الدور', 'Switch role')}
            </Link>
          )}
          <Link to={pathFor(me)} className="btn btn-primary">
            {tx('إلى لوحتي', 'Go to my dashboard')}
          </Link>
        </div>
      </div>
    </div>
  )
}
