import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon'
import { Alert, Badge } from '../../components/ui'
import { authApi } from '../../api/auth'
import { useAuth } from '../../auth/AuthContext'
import { ROLES, pathFor, roleName, slugFor } from '../../auth/roles'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'

// For people with more than one role (e.g. a doctor who is also medical director).
export default function ChooseRole() {
  const { me, setMe } = useAuth()
  const { t, tx, lang, pick, locale } = useI18n()
  const navigate = useNavigate()
  const [busyKey, setBusyKey] = useState(null)
  const [error, setError] = useState(null)

  const choose = async (role) => {
    const key = `${role.role}:${role.branch_id ?? ''}`
    setBusyKey(key)
    setError(null)
    try {
      const next = await authApi.chooseRole(role.role, role.branch_id)
      setMe(next)
      navigate(pathFor(next), { replace: true })
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="reveal">
      <div className="auth-head">
        <span className="kicker">{pick(me.user, 'full_name')}</span>
        <h1>{tx('بأي دور تريد العمل الآن؟', 'Which role are you working in?')}</h1>
        <p>{tx('يمكنك التبديل في أي وقت من القائمة الجانبية.', 'You can switch any time from the side menu.')}</p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="role-cards">
        {me.roles.map((r) => {
          const key = `${r.role}:${r.branch_id ?? ''}`
          const current = me.active_role === r.role && me.active_branch_id === r.branch_id
          return (
            <button
              key={key}
              type="button"
              className="role-card"
              onClick={() => choose(r)}
              aria-current={current ? 'true' : undefined}
              disabled={busyKey !== null}
            >
              <span className="role-ico">
                <Icon name={ROLES[r.role]?.icon || 'user'} size={22} />
              </span>
              <span>
                <strong>{roleName(r.role, lang)}</strong>
                <small>{r.branch_id ? pick(r, 'branch_name') : t('all_branches')}</small>
                {r.delegated && (
                  <small style={{ display: 'block' }}>
                    {tx('تغطية عن', 'Covering for')} {pick(r, 'from_name')} · {tx('حتى', 'until')}{' '}
                    <bdi className="num">{fmtDateTime(r.until, locale)}</bdi>
                  </small>
                )}
              </span>
              {busyKey === key ? (
                <span className="spinner" aria-hidden="true" />
              ) : current ? (
                <Badge tone="gold">{tx('الحالي', 'Current')}</Badge>
              ) : (
                <Icon name="chevronRight" />
              )}
            </button>
          )
        })}
      </div>
      {me.next_step === 'ready' && (
        <div style={{ marginTop: 20 }}>
          <Link to={`/dashboard/${slugFor(me.active_role)}`} className="back-link">
            <Icon name="arrowLeft" size={16} />
            {tx('العودة إلى لوحتي', 'Back to my dashboard')}
          </Link>
        </div>
      )}
    </div>
  )
}
