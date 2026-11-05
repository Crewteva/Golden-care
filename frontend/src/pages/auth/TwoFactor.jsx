import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/Button'
import MfaSetup, { OtpField } from '../../components/MfaSetup'
import { Alert } from '../../components/ui'
import { authApi } from '../../api/auth'
import { useAuth } from '../../auth/AuthContext'
import { pathFor } from '../../auth/roles'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'

export default function TwoFactor() {
  const { me, setMe, signOut } = useAuth()
  const { t, tx, pick } = useI18n()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const setupMode = me.next_step === 'mfa_setup'

  const finish = async (nextMe, err) => {
    if (!nextMe) {
      await signOut()
      navigate('/login', { replace: true, state: { notice: errorText(err, t) } })
      return
    }
    setMe(nextMe)
    navigate(pathFor(nextMe), { replace: true })
  }

  const verify = async (event) => {
    event.preventDefault()
    if (code.length !== 6) {
      setError(t('field.wrong_code'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await finish(await authApi.mfaVerify(code))
    } catch (err) {
      if (err.code === 'mfa_too_many_attempts') return finish(null, err)
      setError(fieldErrors(err, t).code || errorText(err, t))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const leave = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="reveal">
      <div className="auth-head">
        <span className="kicker">{pick(me.user, 'full_name')}</span>
        <h1>{setupMode ? tx('فعّل التحقق بخطوتين', 'Turn on 2-step verification') : tx('التحقق بخطوتين', '2-step verification')}</h1>
        <p>
          {setupMode
            ? tx(
                'دورك يتعامل مع بيانات حساسة، لذلك نطلب رمزًا من هاتفك مع كلمة المرور. الإعداد مرة واحدة فقط.',
                'Your role handles sensitive data, so we ask for a code from your phone as well as your password. You set this up once.',
              )
            : tx('افتح تطبيق المصادقة على هاتفك وأدخل الرمز الحالي.', 'Open the authenticator app on your phone and enter the current code.')}
        </p>
      </div>

      {setupMode ? (
        <MfaSetup onDone={finish} />
      ) : (
        <form className="form" onSubmit={verify} noValidate>
          {error && !code && <Alert tone="danger">{error}</Alert>}
          <OtpField value={code} onChange={setCode} error={code ? error : null} autoFocus />
          <Button type="submit" size="lg" block loading={busy} icon="shieldCheck">
            {t('confirm')}
          </Button>
          <p className="muted" style={{ fontSize: '.86rem' }}>
            {tx('فقدت هاتفك؟ اطلب من مدير النظام إعادة ضبط التحقق بخطوتين لحسابك.', 'Lost your phone? Ask the system admin to reset 2-step verification for your account.')}
          </p>
        </form>
      )}
      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <Button variant="quiet" size="sm" icon="logOut" onClick={leave}>
          {tx('تسجيل الدخول بحساب آخر', 'Use another account')}
        </Button>
      </div>
    </div>
  )
}
