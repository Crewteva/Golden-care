import { Alert, SecretBox } from './ui'
import { useI18n } from '../i18n/I18nContext'

// Shown once after creating an account or resetting a password.
export default function TempPasswordNotice({ password, name, identifier }) {
  const { tx } = useI18n()
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Alert tone="success" title={tx('جاهز.', 'Done.')}>
        {tx(`كلمة المرور المؤقتة لـ ${name}:`, `Temporary password for ${name}:`)}
      </Alert>
      <SecretBox value={password} />
      <Alert tone="warn">
        {tx(
          'تظهر هذه الكلمة مرة واحدة فقط. سلّمها للشخص بنفسك أو عبر قناة آمنة. سيُطلب منه اختيار كلمة مرور جديدة عند أول دخول.',
          "This password is shown only once. Hand it over in person or through a secure channel. They'll choose their own password at first sign-in.",
        )}
      </Alert>
      {identifier && (
        <p className="muted" style={{ fontSize: '.88rem' }}>
          {tx('يسجّل الدخول باستخدام:', 'They sign in with:')} <bdi className="ltr">{identifier}</bdi>
        </p>
      )}
    </div>
  )
}

