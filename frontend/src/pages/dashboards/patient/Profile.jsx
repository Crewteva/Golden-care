import { useEffect, useState } from 'react'
import Button from '../../../components/Button'
import { Checkbox, SelectField, TextField } from '../../../components/Fields'
import { Alert, ErrorState, PageHeader } from '../../../components/ui'
import PageLoader from '../../../components/PageLoader'
import { useToast } from '../../../components/Toast'
import { useAsync } from '../../../components/useAsync'
import { patientApi } from '../../../api/patient'
import { useAuth } from '../../../auth/AuthContext'
import { useI18n } from '../../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../../lib/errors'
import { fmtDate, fmtPhone } from '../../../lib/format'

export default function PatientProfile() {
  const { refresh } = useAuth()
  const { t, tx, locale, setLang, pick } = useI18n()
  const toast = useToast()
  const { data, error, loading, reload, setData } = useAsync(() => patientApi.profile(), [])
  const [form, setForm] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (data) setForm({ email: data.email || '', preferred_lang: data.preferred_lang, consent_messages: data.consent_messages })
  }, [data])

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (loading || !form) return <PageLoader />

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const next = await patientApi.updateProfile({ ...form, email: form.email.trim() || null })
      setData(next)
      setLang(next.preferred_lang)
      refresh()
      toast.success(tx('تم حفظ ملفك.', 'Your profile is saved.'))
    } catch (err) {
      setErrors(fieldErrors(err, t))
      if (!err.fields || !Object.keys(err.fields).length) toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('حسابي', 'My account')} title={tx('ملفي', 'My profile')} />
      <div className="split">
        <section className="card">
          <div className="card-head">
            <h2>{tx('بيانات التواصل والتفضيلات', 'Contact & preferences')}</h2>
          </div>
          <form className="card-body form" onSubmit={submit} noValidate>
            <TextField label={tx('البريد الإلكتروني', 'E-mail')} optional type="email" dir="ltr" value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} error={errors.email} />
            <SelectField label={tx('لغة الرسائل والواجهة', 'Language for messages and screens')} value={form.preferred_lang}
              onChange={(e) => setForm((f) => ({ ...f, preferred_lang: e.target.value }))}
              options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
            <Checkbox checked={form.consent_messages} onChange={(e) => setForm((f) => ({ ...f, consent_messages: e.target.checked }))}
              label={tx('استلام تذكيرات المواعيد عبر واتساب أو الرسائل', 'Receive appointment reminders by WhatsApp or SMS')}
              description={tx('لن نرسل لك عروضًا تسويقية دون موافقتك.', "We won't send you marketing offers without your consent.")} />
            <div>
              <Button type="submit" loading={busy}>{t('save_changes')}</Button>
            </div>
          </form>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>{tx('البيانات المسجّلة', 'Registered details')}</h2>
          </div>
          <div className="card-body form">
            <dl className="dl">
              <dt>{tx('الاسم', 'Name')}</dt>
              <dd>{pick(data, 'full_name')}</dd>
              <dt>{tx('رقم الملف', 'File no.')}</dt>
              <dd className="mono">{data.mrn}</dd>
              <dt>{tx('الموبايل', 'Mobile')}</dt>
              <dd className="ltr" style={{ textAlign: 'start' }}>{fmtPhone(data.phone)}</dd>
              <dt>{tx('تاريخ الميلاد', 'Date of birth')}</dt>
              <dd className="num">{fmtDate(data.date_of_birth, locale)}</dd>
              <dt>{tx('النوع', 'Sex')}</dt>
              <dd>{data.gender === 'female' ? tx('أنثى', 'Female') : tx('ذكر', 'Male')}</dd>
            </dl>
            <Alert tone="info">
              {tx('لتصحيح الاسم أو رقم الموبايل أو تاريخ الميلاد، تواصل مع الاستقبال حفاظًا على دقة ملفك الطبي.', 'To correct your name, mobile or date of birth, please contact reception so your medical record stays accurate.')}
            </Alert>
          </div>
        </section>
      </div>
    </div>
  )
}
