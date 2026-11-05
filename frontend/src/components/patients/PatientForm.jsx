import Icon from '../Icon'
import { Checkbox, ChoiceGroup, TextField } from '../Fields'
import { useI18n } from '../../i18n/I18nContext'
import { fmtDate } from '../../lib/format'
import { nidDigits, parseNationalId } from '../../lib/nationalId'

export const EMPTY_PATIENT = {
  full_name_ar: '',
  full_name_en: '',
  date_of_birth: '',
  gender: '',
  national_id: '',
  passport_no: '',
  nationality: 'EG',
  phone: '',
  phone2: '',
  email: '',
  area: '',
  address: '',
  emergency_name: '',
  emergency_relation: '',
  emergency_phone: '',
  consent_messages: true,
}

const localPhone = (p) => (p && /^\+201\d{9}$/.test(p) ? `0${p.slice(3)}` : p || '')

export function patientToForm(p) {
  const form = { ...EMPTY_PATIENT }
  for (const key of Object.keys(EMPTY_PATIENT)) if (p[key] !== null && p[key] !== undefined) form[key] = p[key]
  form.phone = localPhone(p.phone)
  form.phone2 = localPhone(p.phone2)
  form.emergency_phone = localPhone(p.emergency_phone)
  return form
}

export function formToBody(f) {
  const body = {}
  for (const [key, value] of Object.entries(f)) body[key] = typeof value === 'string' ? value.trim() || null : value
  body.nationality = body.nationality || 'EG'
  return body
}

export const SENSITIVE = ['full_name_ar', 'full_name_en', 'date_of_birth', 'gender', 'national_id']

export function validatePatient(f, t, { phoneOptional = false } = {}) {
  const e = {}
  if (f.full_name_ar.trim().length < 2) e.full_name_ar = t('field.required')
  if (!f.date_of_birth) e.date_of_birth = t('field.required')
  else if (new Date(f.date_of_birth) > new Date()) e.date_of_birth = t('field.invalid_date')
  if (!f.gender) e.gender = t('field.required')
  const phoneOk = (v) => !v || /^[\d\s+\-()٠-٩]{10,}$/.test(v.trim())
  if (!f.phone.trim() && !phoneOptional) e.phone = t('field.required_unless_guardian')
  if (!phoneOk(f.phone)) e.phone = t('field.invalid_phone')
  if (!phoneOk(f.phone2)) e.phone2 = t('field.invalid_phone')
  if (!phoneOk(f.emergency_phone)) e.emergency_phone = t('field.invalid_phone')
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(f.email.trim())) e.email = t('field.invalid')
  const digits = nidDigits(f.national_id)
  if (digits) {
    const parsed = parseNationalId(digits)
    if (!parsed) e.national_id = t('field.invalid_national_id')
    else if (parsed.date_of_birth !== f.date_of_birth || parsed.gender !== f.gender) e.national_id = t('field.id_mismatch')
  }
  return e
}

// The patient-file form, used to open a new file and to edit an existing one.
export default function PatientForm({ value, onChange, errors = {}, phoneOptional = false }) {
  const { tx, lang, locale } = useI18n()
  const set = (key) => (event) => {
    const v = event?.target ? (event.target.type === 'checkbox' ? event.target.checked : event.target.value) : event
    onChange({ ...value, [key]: v })
  }
  const onNationalId = (event) => {
    const raw = event.target.value
    const parsed = parseNationalId(raw)
    onChange(parsed ? { ...value, national_id: raw, date_of_birth: parsed.date_of_birth, gender: parsed.gender } : { ...value, national_id: raw })
  }
  const parsed = parseNationalId(value.national_id)
  const nidHint = parsed
    ? null
    : tx('اختياري. عند إدخاله يُملأ تاريخ الميلاد والنوع تلقائيًا.', 'Optional. Fills in the birth date and sex automatically.')
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="form">
      <fieldset className="form-section">
        <legend>
          <Icon name="user" size={18} />
          {tx('الهوية', 'Identity')}
        </legend>
        <div className="form-grid">
          <TextField label={tx('الاسم بالكامل (بالعربية)', 'Full name (Arabic)')} value={value.full_name_ar} onChange={set('full_name_ar')}
            error={errors.full_name_ar} dir="rtl" lang="ar" data-autofocus />
          <TextField label={tx('الاسم بالإنجليزية', 'Full name (English)')} optional value={value.full_name_en} onChange={set('full_name_en')}
            error={errors.full_name_en} dir="ltr" lang="en" />
        </div>
        <div className="form-grid">
          <div className="field">
            <TextField label={tx('الرقم القومي', 'National ID')} value={value.national_id} onChange={onNationalId}
              error={errors.national_id} hint={nidHint} inputMode="numeric" dir="ltr" maxLength={20} placeholder="2XXXXXXXXXXXXX" />
            {parsed && !errors.national_id && (
              <p className="field-ok">
                <Icon name="checkCircle" size={14} />
                {tx('مواليد', 'Born')} {fmtDate(parsed.date_of_birth, locale)} · {parsed.gender === 'female' ? tx('أنثى', 'Female') : tx('ذكر', 'Male')} · {parsed.governorate[lang === 'ar' ? 0 : 1]}
              </p>
            )}
          </div>
          <TextField label={tx('تاريخ الميلاد', 'Date of birth')} type="date" value={value.date_of_birth} onChange={set('date_of_birth')}
            error={errors.date_of_birth} max={today} />
        </div>
        <div className="form-grid-3">
          <ChoiceGroup legend={tx('النوع', 'Sex')} name="gender" value={value.gender} onChange={set('gender')} error={errors.gender}
            options={[{ value: 'female', label: tx('أنثى', 'Female') }, { value: 'male', label: tx('ذكر', 'Male') }]} />
          <TextField label={tx('الجنسية', 'Nationality')} value={value.nationality} onChange={set('nationality')} error={errors.nationality}
            hint={tx('EG لمصر', 'EG for Egyptian')} dir="ltr" />
          <TextField label={tx('جواز السفر', 'Passport no.')} optional value={value.passport_no} onChange={set('passport_no')}
            hint={tx('لغير المصريين', 'For non-Egyptians')} dir="ltr" />
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>
          <Icon name="smartphone" size={18} />
          {tx('التواصل', 'Contact')}
        </legend>
        <div className="form-grid-3">
          <TextField label={tx('الموبايل', 'Mobile')} optional={phoneOptional} type="tel" inputMode="tel" dir="ltr" value={value.phone}
            onChange={set('phone')} error={errors.phone} placeholder="01X XXXX XXXX"
            hint={phoneOptional ? tx('يمكن تركه فارغًا: نتواصل عبر ولي الأمر', 'Can be empty: we contact the guardian') : undefined} />
          <TextField label={tx('موبايل آخر', 'Mobile 2')} optional type="tel" inputMode="tel" dir="ltr" value={value.phone2}
            onChange={set('phone2')} error={errors.phone2} />
          <TextField label={tx('البريد الإلكتروني', 'E-mail')} optional type="email" dir="ltr" value={value.email} onChange={set('email')}
            error={errors.email} />
        </div>
        <div className="form-grid">
          <TextField label={tx('المنطقة / الحي', 'Area / district')} optional value={value.area} onChange={set('area')} />
          <TextField label={tx('العنوان', 'Address')} optional value={value.address} onChange={set('address')} />
        </div>
        <Checkbox checked={value.consent_messages} onChange={set('consent_messages')}
          label={tx('يوافق على استلام تذكيرات المواعيد عبر واتساب أو الرسائل', 'Agrees to appointment reminders by WhatsApp or SMS')} />
      </fieldset>

      <fieldset className="form-section">
        <legend>
          <Icon name="heart" size={18} />
          {tx('للطوارئ', 'Emergency contact')}
        </legend>
        <div className="form-grid-3">
          <TextField label={tx('الاسم', 'Name')} optional value={value.emergency_name} onChange={set('emergency_name')} />
          <TextField label={tx('صلة القرابة', 'Relationship')} optional value={value.emergency_relation} onChange={set('emergency_relation')}
            placeholder={tx('مثال: الزوج', 'e.g. Husband')} />
          <TextField label={tx('الموبايل', 'Mobile')} optional type="tel" dir="ltr" value={value.emergency_phone}
            onChange={set('emergency_phone')} error={errors.emergency_phone} />
        </div>
      </fieldset>
    </div>
  )
}
