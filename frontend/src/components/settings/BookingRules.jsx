import { useEffect, useState } from 'react'
import Button from '../Button'
import { Checkbox, SelectField, TextField } from '../Fields'
import { Alert, ErrorState, PageHeader } from '../ui'
import PageLoader from '../PageLoader'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'
import { api } from '../../api/client'
import { useSettings } from './shared'

// Management sets how booking works: slot length, lateness, and patients' online booking & cancelling.
export default function BookingRules() {
  const { t, tx } = useI18n()
  const { base, can } = useSettings()
  const slug = base.split('/').pop()
  const toast = useToast()
  const { data, error, reload, setData } = useAsync(() => api(`/${slug}/settings/booking-rules`), [slug])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const editable = can('settings.booking')
  useEffect(() => { if (data) setForm(data) }, [data])
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!form) return <PageLoader />

  const num = (key) => (e) => setForm({ ...form, [key]: e.target.value === '' ? '' : Number(e.target.value) })
  const flag = (key) => (e) => setForm({ ...form, [key]: e.target.checked })
  const save = async () => {
    setBusy(true)
    try {
      setData(await api(`/${slug}/settings/booking-rules`, { method: 'PUT', body: form }))
      toast.success(tx('تم حفظ قواعد الحجز.', 'Booking rules saved.'))
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('إعداد العيادة', 'Clinic setup')} title={tx('قواعد الحجز', 'Booking rules')}
        description={tx('تنطبق فورًا على حجز الاستقبال وحجز المرضى من حساباتهم.', "Apply at once to reception's booking and to patients booking from their accounts.")}
        actions={editable && <Button loading={busy} onClick={save}>{t('save_changes')}</Button>} />
      {!editable && <Alert tone="info">{tx('لديك صلاحية العرض فقط.', 'You have view-only access.')}</Alert>}
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>{tx('في العيادة', 'At the clinic')}</h2></div>
          <div className="card-body form">
            <SelectField label={tx('الفاصل بين الأوقات المعروضة', 'Gap between offered times')} value={form.slot_step_min} disabled={!editable}
              onChange={num('slot_step_min')} options={[5, 10, 15, 20, 30].map((m) => ({ value: m, label: tx(`${m} دقيقة`, `${m} minutes`) }))}
              hint={tx('مثال: ١٥ دقيقة تعرض ٤:٠٠ و٤:١٥ و٤:٣٠…', 'e.g. 15 minutes offers 4:00, 4:15, 4:30…')} />
            <TextField label={tx('يُعتبر المريض متأخرًا بعد (دقيقة)', 'A patient counts as late after (minutes)')} type="number" min="0" max="120"
              value={form.late_after_min} onChange={num('late_after_min')} disabled={!editable} dir="ltr" />
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>{tx('حجز المرضى أونلاين', 'Patients booking online')}</h2></div>
          <div className="card-body form">
            <Checkbox checked={form.portal_enabled} onChange={flag('portal_enabled')} disabled={!editable}
              label={tx('السماح للمرضى بالحجز من حساباتهم', 'Let patients book from their accounts')} />
            <Checkbox checked={form.portal_needs_confirmation} onChange={flag('portal_needs_confirmation')} disabled={!editable || !form.portal_enabled}
              label={tx('الحجز الأونلاين يحتاج تأكيد الاستقبال', 'Online bookings need confirmation by reception')}
              description={tx('يظهر الحجز كطلب حتى يؤكده الاستقبال، ويبقى الوقت محجوزًا له.', 'The booking shows as a request until reception confirms; the time stays held.')} />
            <div className="form-grid">
              <TextField label={tx('الإلغاء أونلاين حتى (ساعة قبل الموعد)', 'Online cancel allowed until (hours before)')} type="number" min="0" max="168"
                value={form.portal_cancel_hours} onChange={num('portal_cancel_hours')} disabled={!editable} dir="ltr" />
              <TextField label={tx('الحجز متاح حتى (يوم مقدمًا)', 'Bookable up to (days ahead)')} type="number" min="1" max="180"
                value={form.portal_days_ahead} onChange={num('portal_days_ahead')} disabled={!editable} dir="ltr" />
              <TextField label={tx('أقصى عدد مواعيد قادمة لكل مريض', 'Most upcoming visits per patient')} type="number" min="1" max="20"
                value={form.portal_max_upcoming} onChange={num('portal_max_upcoming')} disabled={!editable} dir="ltr" />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
