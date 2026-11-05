import { useNavigate } from 'react-router-dom'
import Button from '../../components/Button'
import { useAuth } from '../../auth/AuthContext'
import { useI18n } from '../../i18n/I18nContext'

export default function NoAccess() {
  const { me, signOut } = useAuth()
  const { t, tx, pick } = useI18n()
  const navigate = useNavigate()
  return (
    <div className="reveal">
      <div className="auth-head">
        <span className="kicker">{pick(me.user, 'full_name')}</span>
        <h1>{tx('لا يوجد دور مرتبط بحسابك', 'Your account has no role yet')}</h1>
        <p>
          {tx(
            'تم تسجيل دخولك، لكن لم يُسند إليك أي دور بعد. اطلب من مدير النظام إضافة دورك ثم سجّل الدخول من جديد.',
            "You're signed in, but no role has been assigned to you yet. Ask the system admin to add your role, then sign in again.",
          )}
        </p>
      </div>
      <Button
        size="lg"
        block
        icon="logOut"
        onClick={async () => {
          await signOut()
          navigate('/login', { replace: true })
        }}
      >
        {t('sign_out')}
      </Button>
    </div>
  )
}
