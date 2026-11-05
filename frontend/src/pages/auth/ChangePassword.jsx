import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/Button'
import { PasswordField } from '../../components/Fields'
import { Alert } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { authApi } from '../../api/auth'
import { useAuth } from '../../auth/AuthContext'
import { pathFor } from '../../auth/roles'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { passwordProblem } from '../../lib/password'

// Shown after the admin issued a temporary password: the person must choose their own.
export default function ChangePassword() {
  const { me, setMe, signOut } = useAuth()
  const { t, tx, pick } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const kind = me.user.kind

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (!form.current) e.current_password = t('field.required')
    const problem = passwordProblem(form.next, kind)
    if (problem) e.new_password = t(`field.${problem}`)
    if (form.next && form.next === form.current) e.new_password = t('field.same_as_current')
    if (form.confirm !== form.next) e.confirm = t('field.mismatch')
    setErrors(e)
    setFormError(null)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const next = await authApi.changePassword(form.current, form.next)
      setMe(next)
      toast.success(tx('تم حفظ كلمة المرور الجديدة.', 'Your new password is saved.'))
      navigate(pathFor(next), { replace: true })
    } catch (err) {
      setErrors(fieldErrors(err, t))
      setFormError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="reveal">
      <div className="auth-head">
        <span className="kicker">{pick(me.user, 'full_name')}</span>
        <h1>{tx('اختر كلمة مرور خاصة بك', 'Choose your own password')}</h1>
        <p>
          {tx(
            'كلمة المرور الحالية مؤقتة أصدرها مدير النظام. اختر كلمة جديدة لا يعرفها أحد غيرك.',
            'Your current password is a temporary one issued by the system admin. Choose a new one only you know.',
          )}
        </p>
      </div>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <PasswordField
          label={tx('كلمة المرور المؤقتة', 'Temporary password')}
          value={form.current}
          onChange={set('current')}
          error={errors.current_password}
          autoComplete="current-password"
          autoFocus
        />
        <PasswordField
          label={tx('كلمة المرور الجديدة', 'New password')}
          value={form.next}
          onChange={set('next')}
          error={errors.new_password}
          autoComplete="new-password"
          strength
          kind={kind}
        />
        <PasswordField
          label={tx('تأكيد كلمة المرور الجديدة', 'Confirm new password')}
          value={form.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
          autoComplete="new-password"
        />
        <Button type="submit" size="lg" block loading={busy} icon="key">
          {tx('حفظ ومتابعة', 'Save and continue')}
        </Button>
        <Button
          variant="quiet"
          size="sm"
          icon="logOut"
          onClick={async () => {
            await signOut()
            navigate('/login', { replace: true })
          }}
        >
          {t('sign_out')}
        </Button>
      </form>
    </div>
  )
}
