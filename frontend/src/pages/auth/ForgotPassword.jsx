import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../components/Button'
import Icon from '../../components/Icon'
import { TextField } from '../../components/Fields'
import { Alert } from '../../components/ui'
import { authApi } from '../../api/auth'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'

// The request goes to the system admin, who verifies the person before issuing a temporary password.
export default function ForgotPassword() {
  const { t, tx } = useI18n()
  const [identifier, setIdentifier] = useState('')
  const [error, setError] = useState(null)
  const [fieldError, setFieldError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (identifier.trim().length < 3) {
      setFieldError(t('field.required'))
      return
    }
    setFieldError(null)
    setError(null)
    setBusy(true)
    try {
      await authApi.forgot(identifier.trim())
      setSent(true)
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="reveal">
        <div className="auth-head">
          <span className="kicker">{tx('تم استلام طلبك', 'Request received')}</span>
          <h1>{tx('سنتواصل معك قريبًا', "We'll be in touch")}</h1>
          <p>
            {tx(
              'إن كان هناك حساب بهذه البيانات، فسيصل الطلب إلى مدير النظام. لحماية ملفك الطبي، سيتحقق من هويتك قبل إصدار كلمة مرور مؤقتة.',
              'If an account matches, your request has reached the system admin. To protect your medical record, they will verify your identity before issuing a temporary password.',
            )}
          </p>
        </div>
        <ul className="steps">
          <li>
            <span>
              <strong>{tx('الموظفون', 'Staff')}</strong>
              <span className="muted">{tx('تواصل مع مدير النظام في الفرع.', 'Contact the system admin at your branch.')}</span>
            </span>
          </li>
          <li>
            <span>
              <strong>{tx('المرضى', 'Patients')}</strong>
              <span className="muted">
                {tx('اتصل بالاستقبال أو زرنا ومعك بطاقة الرقم القومي.', 'Call reception or visit us with your national ID.')}
              </span>
            </span>
          </li>
        </ul>
        <Link to="/login" className="btn btn-primary btn-lg btn-block">
          <Icon name="arrowLeft" size={18} />
          {tx('العودة لتسجيل الدخول', 'Back to sign in')}
        </Link>
      </div>
    )
  }

  return (
    <div className="reveal">
      <div className="auth-head">
        <span className="kicker">{tx('استعادة الدخول', 'Account recovery')}</span>
        <h1>{tx('نسيت كلمة المرور؟', 'Forgot your password?')}</h1>
        <p>{tx('أدخل بريدك أو رقم موبايلك وسنرسل طلبًا آمنًا لإعادة التعيين.', "Enter your e-mail or mobile and we'll send a secure reset request.")}</p>
      </div>
      <form className="form" onSubmit={submit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField
          label={tx('البريد الإلكتروني أو رقم الموبايل', 'E-mail or mobile number')}
          icon="user"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          error={fieldError}
          autoComplete="username"
          dir="ltr"
          autoFocus
        />
        <Button type="submit" size="lg" block loading={busy}>
          {tx('إرسال الطلب', 'Send request')}
        </Button>
        <Link to="/login" className="back-link" style={{ justifySelf: 'center' }}>
          <Icon name="arrowLeft" size={16} />
          {tx('العودة لتسجيل الدخول', 'Back to sign in')}
        </Link>
      </form>
    </div>
  )
}
