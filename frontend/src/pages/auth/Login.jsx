import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Button from '../../components/Button'
import { PasswordField, TextField } from '../../components/Fields'
import { Alert } from '../../components/ui'
import { authApi } from '../../api/auth'
import { useAuth } from '../../auth/AuthContext'
import { pathFor, slugFor } from '../../auth/roles'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'

export default function Login() {
  const { setMe } = useAuth()
  const { t, tx } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(location.state?.notice || null)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    const next = {}
    if (identifier.trim().length < 3) next.identifier = t('field.required')
    if (!password) next.password = t('field.required')
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      const me = await authApi.login(identifier.trim(), password)
      setMe(me)
      const from = location.state?.from
      const home = pathFor(me)
      const target =
        me.next_step === 'ready' && from && from.startsWith(`/dashboard/${slugFor(me.active_role)}`) ? from : home
      navigate(target, { replace: true })
    } catch (error) {
      setFormError(errorText(error, t))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="reveal">
      <div className="auth-head">
        <span className="kicker">{tx('أهلًا بعودتك', 'Welcome back')}</span>
        <h1>{t('sign_in')}</h1>
        <p>{tx('للموظفين والمرضى. سننقلك تلقائيًا إلى مساحتك.', "For staff and patients. We'll take you to your own space.")}</p>
      </div>

      <form className="form" onSubmit={submit} noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextField
          label={tx('البريد الإلكتروني أو رقم الموبايل', 'E-mail or mobile number')}
          hint={tx('الموظفون: بريد العمل · المرضى: رقم الموبايل', 'Staff: work e-mail · Patients: mobile number')}
          icon="user"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          error={errors.identifier}
          autoComplete="username"
          dir="ltr"
          inputMode="email"
          autoFocus
        />
        <PasswordField
          label={tx('كلمة المرور', 'Password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          autoComplete="current-password"
        />
        <div className="row-between">
          <Link to="/forgot-password" style={{ fontSize: '.88rem' }}>
            {tx('نسيت كلمة المرور؟', 'Forgot your password?')}
          </Link>
        </div>
        <Button type="submit" size="lg" block loading={busy} iconEnd="arrowRight">
          {t('sign_in')}
        </Button>
      </form>

      <div className="auth-alt">
        <p>
          <strong>{tx('مريض جديد؟', 'New patient?')}</strong>
          <span className="muted">{tx('أنشئ حسابك لمتابعة مواعيدك وزياراتك.', 'Create your account to follow your visits.')}</span>
        </p>
        <Link to="/register" className="btn btn-ghost">
          {tx('إنشاء حساب', 'Create account')}
        </Link>
      </div>
    </div>
  )
}
