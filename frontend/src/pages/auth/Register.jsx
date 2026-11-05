import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../../components/Button'
import { Checkbox, ChoiceGroup, PasswordField, TextField } from '../../components/Fields'
import { Alert } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { patientApi } from '../../api/patient'
import { useAuth } from '../../auth/AuthContext'
import { pathFor } from '../../auth/roles'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { passwordProblem } from '../../lib/password'

const EMPTY = {
  full_name_ar: '',
  full_name_en: '',
  phone: '',
  email: '',
  date_of_birth: '',
  gender: '',
  password: '',
  confirm: '',
  accept_terms: false,
  consent_messages: true,
}

// Patients create their own account here. Staff accounts are created by the system admin only.
export default function Register() {
  const { setMe } = useAuth()
  const { t, tx } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)

  const set = (key) => (event) => {
    const value = event?.target ? (event.target.type === 'checkbox' ? event.target.checked : event.target.value) : event
    setForm((f) => ({ ...f, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const validate = () => {
    const e = {}
    if (form.full_name_ar.trim().length < 2) e.full_name_ar = t('field.required')
    if (!/^[\d\s+\-()٠-٩]{8,}$/.test(form.phone.trim())) e.phone = t('field.invalid_phone')
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(form.email.trim())) e.email = t('field.invalid')
    if (!form.date_of_birth) e.date_of_birth = t('field.required')
    if (!form.gender) e.gender = t('field.required')
    const problem = passwordProblem(form.password, 'patient')
    if (problem) e.password = t(`field.${problem}`)
    if (form.confirm !== form.password) e.confirm = t('field.mismatch')
    if (!form.accept_terms) e.accept_terms = tx('يجب الموافقة للمتابعة.', 'Please agree to continue.')
    return e
  }

  const submit = async (event) => {
    event.preventDefault()
    const e = validate()
    setErrors(e)
    setFormError(null)
    if (Object.keys(e).length) {
      document.querySelector('[aria-invalid="true"]')?.focus()
      return
    }
    setBusy(true)
    try {
      const { confirm, ...body } = form
      const me = await patientApi.register({ ...body, full_name_en: body.full_name_en || null, email: body.email || null })
      setMe(me)
      toast.success(tx('تم إنشاء حسابك. أهلًا بك في جولدن كير!', 'Your account is ready. Welcome to Golden Care!'))
      navigate(pathFor(me), { replace: true })
    } catch (error) {
      const fields = fieldErrors(error, t)
      if (error.fields?.phone === 'taken') {
        fields.phone = tx('هذا الرقم مسجّل بالفعل. سجّل الدخول أو استعد كلمة المرور.', 'This number is already registered. Sign in or reset your password.')
      }
      setErrors(fields)
      setFormError(errorText(error, t))
    } finally {
      setBusy(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="reveal">
      <div className="auth-head">
        <span className="kicker">{tx('حساب المريض', 'Patient account')}</span>
        <h1>{tx('أنشئ حسابك', 'Create your account')}</h1>
        <p>
          {tx('حساب واحد لك لمتابعة مواعيدك وزياراتك ووصفاتك.', 'One account to follow your appointments, visits and prescriptions.')}{' '}
          <span className="muted">{tx('الموظفون يحصلون على حساباتهم من مدير النظام.', 'Staff get their accounts from the system admin.')}</span>
        </p>
      </div>

      <form className="form" onSubmit={submit} noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="form-grid">
          <TextField
            label={tx('الاسم بالكامل (بالعربية)', 'Full name (Arabic)')}
            value={form.full_name_ar}
            onChange={set('full_name_ar')}
            error={errors.full_name_ar}
            autoComplete="name"
            dir="rtl"
            lang="ar"
          />
          <TextField
            label={tx('الاسم بالإنجليزية', 'Full name (English)')}
            optional
            value={form.full_name_en}
            onChange={set('full_name_en')}
            error={errors.full_name_en}
            dir="ltr"
            lang="en"
          />
          <TextField
            label={tx('رقم الموبايل', 'Mobile number')}
            hint={tx('ستستخدمه لتسجيل الدخول', "You'll use it to sign in")}
            icon="smartphone"
            value={form.phone}
            onChange={set('phone')}
            error={errors.phone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            placeholder="01X XXXX XXXX"
          />
          <TextField
            label={tx('البريد الإلكتروني', 'E-mail')}
            optional
            icon="mail"
            value={form.email}
            onChange={set('email')}
            error={errors.email}
            type="email"
            autoComplete="email"
            dir="ltr"
          />
          <TextField
            label={tx('تاريخ الميلاد', 'Date of birth')}
            type="date"
            value={form.date_of_birth}
            onChange={set('date_of_birth')}
            error={errors.date_of_birth}
            max={today}
            autoComplete="bday"
          />
          <ChoiceGroup
            legend={tx('النوع', 'Sex')}
            name="gender"
            value={form.gender}
            onChange={set('gender')}
            error={errors.gender}
            options={[
              { value: 'female', label: tx('أنثى', 'Female') },
              { value: 'male', label: tx('ذكر', 'Male') },
            ]}
          />
          <PasswordField
            label={tx('كلمة المرور', 'Password')}
            value={form.password}
            onChange={set('password')}
            error={errors.password}
            autoComplete="new-password"
            strength
            kind="patient"
          />
          <PasswordField
            label={tx('تأكيد كلمة المرور', 'Confirm password')}
            value={form.confirm}
            onChange={set('confirm')}
            error={errors.confirm}
            autoComplete="new-password"
          />
        </div>
        <Checkbox
          checked={form.accept_terms}
          onChange={set('accept_terms')}
          error={errors.accept_terms}
          label={tx(
            'أوافق على شروط الاستخدام وسياسة الخصوصية، وعلى استخدام بياناتي لتقديم الرعاية الطبية.',
            'I agree to the terms of use and privacy policy, and to my data being used to provide my care.',
          )}
        />
        <Checkbox
          checked={form.consent_messages}
          onChange={set('consent_messages')}
          label={tx('أرغب في استلام تذكيرات المواعيد عبر واتساب أو الرسائل', 'Send me appointment reminders by WhatsApp or SMS')}
          description={tx('يمكنك تغيير ذلك في أي وقت من ملفك.', 'You can change this any time from your profile.')}
        />
        <Button type="submit" size="lg" block loading={busy} iconEnd="arrowRight">
          {tx('إنشاء الحساب', 'Create account')}
        </Button>
        <p className="muted" style={{ textAlign: 'center', fontSize: '.9rem' }}>
          {tx('لديك حساب بالفعل؟', 'Already have an account?')} <Link to="/login">{t('sign_in')}</Link>
        </p>
      </form>
    </div>
  )
}
