import { useEffect, useState } from 'react'
import Button from './Button'
import { TextField } from './Fields'
import { Alert, SecretBox } from './ui'
import { authApi } from '../api/auth'
import { useI18n } from '../i18n/I18nContext'
import { errorText, fieldErrors } from '../lib/errors'

export function OtpField({ value, onChange, error, label, autoFocus }) {
  const { tx } = useI18n()
  return (
    <TextField
      label={label || tx('رمز التحقق المكوّن من ٦ أرقام', '6-digit verification code')}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      inputClassName="otp-input"
      placeholder="••••••"
      error={error}
      autoFocus={autoFocus}
      data-autofocus
    />
  )
}

// Two-step setup: scan the QR code (or type the key) in an authenticator app, then confirm a code.
export default function MfaSetup({ onDone }) {
  const { t, tx } = useI18n()
  const [setup, setSetup] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    authApi.mfaSetup().then(setSetup).catch(setLoadError)
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    if (code.length !== 6) {
      setError(t('field.wrong_code'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const me = await authApi.mfaVerify(code)
      onDone(me)
    } catch (err) {
      if (err.code === 'mfa_too_many_attempts') {
        onDone(null, err)
        return
      }
      setError(fieldErrors(err, t).code || errorText(err, t))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <Alert tone="danger">{errorText(loadError, t)}</Alert>
  if (!setup) {
    return (
      <div style={{ display: 'grid', gap: 12 }} aria-busy="true">
        <div className="skeleton" style={{ height: 200, borderRadius: 18 }} />
        <div className="skeleton" style={{ height: 60 }} />
      </div>
    )
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <ol className="steps">
        <li>
          <span>
            <strong>{tx('ثبّت تطبيق مصادقة على هاتفك', 'Install an authenticator app')}</strong>
            <span className="muted">Google Authenticator · Microsoft Authenticator · Authy</span>
          </span>
        </li>
        <li>
          <span>
            <strong>{tx('امسح الرمز بالتطبيق', 'Scan this code with the app')}</strong>
            <span className="muted">{tx('أو أدخل المفتاح يدويًا إن تعذّر المسح.', "Or type the key if you can't scan.")}</span>
          </span>
        </li>
        <li>
          <span>
            <strong>{tx('أدخل الرمز الذي يظهر في التطبيق', 'Enter the code the app shows')}</strong>
          </span>
        </li>
      </ol>
      <div className="qr-block">
        <img src={setup.qr} alt={tx('رمز QR لإعداد التحقق بخطوتين', 'QR code for 2-step setup')} />
        <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
          <div className="muted" style={{ fontSize: '.85rem' }}>
            {tx('الحساب', 'Account')}: <bdi className="ltr">{setup.account}</bdi>
          </div>
          {showKey ? (
            <SecretBox value={setup.secret.replace(/(.{4})/g, '$1 ').trim()} />
          ) : (
            <Button variant="ghost" size="sm" icon="key" onClick={() => setShowKey(true)}>
              {tx('إظهار المفتاح للإدخال اليدوي', 'Show key for manual entry')}
            </Button>
          )}
        </div>
      </div>
      <OtpField value={code} onChange={setCode} error={error} />
      <Button type="submit" size="lg" block loading={busy} icon="shieldCheck">
        {tx('تفعيل والمتابعة', 'Turn on and continue')}
      </Button>
    </form>
  )
}
