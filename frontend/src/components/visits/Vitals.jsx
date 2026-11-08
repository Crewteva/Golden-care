import { useState } from 'react'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { TextField } from '../Fields'
import { Alert } from '../ui'
import { useToast } from '../Toast'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'
import { VITALS, bmi, useVisits, vitalFlag, vitalValue } from './meta'

const EMPTY = { bp_systolic: '', bp_diastolic: '', pulse: '', temperature: '', spo2: '', resp_rate: '', weight_kg: '', height_cm: '', note: '' }

// Record vital signs for an arrived patient (nurse) or during the visit (doctor). Never edited: record again to correct.
export function VitalsModal({ appointmentId, patientId, patientName, onClose, onSaved }) {
  const { t, tx } = useI18n()
  const { api } = useVisits()
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value.replace(',', '.') })

  const submit = async (event) => {
    event.preventDefault()
    const body = { appointment_id: appointmentId || null, patient_id: appointmentId ? null : patientId, note: form.note.trim() || null }
    for (const key of Object.keys(EMPTY)) {
      if (key !== 'note') body[key] = form[key] === '' ? null : Number(form[key])
    }
    const e = {}
    if ((body.bp_systolic === null) !== (body.bp_diastolic === null)) e[body.bp_systolic === null ? 'bp_systolic' : 'bp_diastolic'] = t('field.required')
    if (Object.keys(EMPTY).filter((k) => k !== 'note').every((k) => body[k] === null)) e.form = tx('أدخل قياسًا واحدًا على الأقل.', 'Enter at least one measurement.')
    for (const key of Object.keys(body)) if (typeof body[key] === 'number' && Number.isNaN(body[key])) e[key] = tx('رقم غير صحيح', 'Not a number')
    setErrors(e)
    setFormError(e.form || null)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const row = await api.recordVitals(body)
      toast.success(tx('تم تسجيل العلامات الحيوية.', 'Vital signs recorded.'))
      onSaved?.(row)
      onClose()
    } catch (err) {
      setErrors(fieldErrors(err, t))
      setFormError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  const num = (key, label, unit, props = {}) => (
    <TextField label={`${label} (${unit})`} value={form[key]} onChange={set(key)} error={errors[key]} inputMode="decimal" dir="ltr" inputClassName="num" {...props} />
  )
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('العلامات الحيوية', 'Vital signs')} description={patientName}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="vitals-form" loading={busy} icon="check">{t('save')}</Button></>}>
      <form id="vitals-form" className="form" onSubmit={submit} noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="form-grid">
          {num('bp_systolic', tx('الضغط الانقباضي', 'Systolic BP'), 'mmHg', { 'data-autofocus': true, placeholder: '120' })}
          {num('bp_diastolic', tx('الضغط الانبساطي', 'Diastolic BP'), 'mmHg', { placeholder: '80' })}
          {num('pulse', tx('النبض', 'Pulse'), '/min', { placeholder: '76' })}
          {num('temperature', tx('الحرارة', 'Temperature'), '°C', { placeholder: '36.8' })}
          {num('spo2', tx('الأكسجين', 'SpO₂'), '%', { placeholder: '98' })}
          {num('resp_rate', tx('معدل التنفس', 'Breathing rate'), '/min', { placeholder: '16' })}
          {num('weight_kg', tx('الوزن', 'Weight'), 'kg', { placeholder: '70' })}
          {num('height_cm', tx('الطول', 'Height'), 'cm', { placeholder: '168' })}
        </div>
        <TextField label={tx('ملاحظة', 'Note')} optional value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300}
          placeholder={tx('مثال: قيس الضغط بعد راحة ٥ دقائق', 'e.g. BP taken after 5 minutes rest')} />
      </form>
    </Modal>
  )
}

// The latest set of vitals as compact tiles; values outside the usual range are flagged.
export function VitalsTiles({ vitals }) {
  const { tx, lang, pick, locale } = useI18n()
  if (!vitals) return null
  const b = bmi(vitals)
  return (
    <div className="vitals">
      <div className="vitals-grid">
        {VITALS.map((m) => {
          const value = vitalValue(vitals, m.key)
          if (value === null) return null
          const flag = vitalFlag(vitals, m.key)
          return (
            <div key={m.key} className={`vital vital-${m.key} ${flag ? 'flag' : ''}`}>
              <small>{m[lang]}</small>
              <strong className="num">{value}<span>{m.unit}</span></strong>
              {flag && <Icon name="alert" size={14} />}
            </div>
          )
        })}
        {b && <div className="vital"><small>BMI</small><strong className="num">{b}</strong></div>}
      </div>
      <p className="muted vitals-meta">
        {pick(vitals, 'recorded_by')} · <bdi>{fmtDateTime(vitals.recorded_at, locale)}</bdi>
        {vitals.note && <> · {vitals.note}</>}
        {' '}<span className="sr-only">{tx('القيم المعلَّمة بالأحمر خارج المعدل المعتاد', 'Values flagged red are outside the usual range')}</span>
      </p>
    </div>
  )
}
