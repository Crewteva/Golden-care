import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../../../components/Button'
import Icon from '../../../components/Icon'
import { Alert, ErrorState, PageHeader } from '../../../components/ui'
import PageLoader from '../../../components/PageLoader'
import { useToast } from '../../../components/Toast'
import { useAsync } from '../../../components/useAsync'
import SlotPicker from '../../../components/appointments/SlotPicker'
import { fmtMoney } from '../../../components/settings/shared'
import { patientApi } from '../../../api/patient'
import { useI18n } from '../../../i18n/I18nContext'
import { errorText } from '../../../lib/errors'
import { clock, dayKey, dayLabel } from '../../../lib/clinicTime'

// Online booking from the patient's account: who → service → day & time → confirm.
export default function BookOnline() {
  const { t, tx, pick, locale } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const { data, error, reload } = useAsync(() => patientApi.bookingOptions(), [])
  const [person, setPerson] = useState(null)
  const [service, setService] = useState(null)
  const [slot, setSlot] = useState(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState(null)

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const who = person || (data.people.length === 1 ? data.people[0] : null)
  const groups = [...new Set(data.services.map((s) => s.specialty_id))]

  const book = async () => {
    setBusy(true)
    setFormError(null)
    try {
      await patientApi.book({ patient_id: who.id, service_id: service.id, doctor_id: slot.doctorId, starts_at: slot.start })
      toast.success(data.rules.portal_needs_confirmation ? tx('أُرسل طلبك وسنؤكده قريبًا.', 'Request sent; we will confirm soon.') : tx('تم الحجز.', 'Booked.'))
      navigate('/dashboard/patient/appointments')
    } catch (err) {
      setFormError(errorText(err, t))
      if (['slot_taken', 'room_taken'].includes(err.code)) setSlot(null)
    } finally {
      setBusy(false)
    }
  }

  if (!data.rules.portal_enabled) {
    return (
      <div className="page reveal">
        <PageHeader title={tx('حجز موعد', 'Book a visit')} />
        <Alert tone="info">{t('err.portal_booking_off')}</Alert>
      </div>
    )
  }

  return (
    <div className="page reveal">
      <Link to="/dashboard/patient/appointments" className="back-link"><Icon name="arrowLeft" size={16} />{tx('مواعيدي', 'My appointments')}</Link>
      <PageHeader eyebrow={tx('حجز أونلاين', 'Online booking')} title={tx('احجز موعدك', 'Book your visit')}
        description={tx('تظهر الأوقات المتاحة فعليًا فقط. ستصلك تفاصيل الموعد في صفحة «مواعيدي».', 'Only times that are really free are shown. Your visit then appears under “My appointments”.')} />

      {data.people.length > 1 && (
        <section className="card card-pad">
          <h2 className="book-q">{tx('لمن الموعد؟', 'Who is the visit for?')}</h2>
          <div className="choice-group">
            {data.people.map((p) => (
              <label key={p.id} className="choice">
                <input type="radio" name="who" checked={who?.id === p.id} onChange={() => { setPerson(p); setSlot(null) }} />
                <span>{pick(p, 'full_name')}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      {who && (
        <section className="card card-pad">
          <h2 className="book-q">{tx('ما الخدمة التي تحتاجها؟', 'Which service do you need?')}</h2>
          <div className="service-pick">
            {groups.map((gid) => {
              const list = data.services.filter((s) => s.specialty_id === gid)
              return (
                <div key={gid} className="service-pick-group">
                  <span className="label"><span className="dot-color" style={{ background: list[0].color }} />{pick(list[0], 'specialty_name')}</span>
                  <div className="service-chips">
                    {list.map((s) => (
                      <button key={s.id} type="button" aria-pressed={service?.id === s.id} onClick={() => { setService(s); setSlot(null) }}>
                        <strong>{pick(s)}</strong>
                        <small className="num">{tx(`${s.duration_min} دقيقة`, `${s.duration_min} min`)} · {fmtMoney(s.price, locale)}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {who && service && (
        <section className="card card-pad">
          <h2 className="book-q">{tx('اختر اليوم والوقت', 'Pick a day and time')}</h2>
          <SlotPicker days={data.rules.portal_days_ahead} selected={slot} onPick={setSlot} deps={[service.id]}
            load={({ on }) => patientApi.bookingSlots({ service_id: service.id, on })} />
        </section>
      )}

      {slot && (
        <section className="card card-pad booking-confirm-card">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="row-between">
            <div>
              <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>
                {dayLabel(dayKey(slot.start), locale)} · <span className="num">{clock(slot.start, locale)}</span>
              </strong>
              <p className="muted">{pick(slot.doctor, 'full_name')} · {pick(service)} · {pick(who, 'full_name')}</p>
              {data.rules.portal_needs_confirmation && <p className="muted" style={{ fontSize: '.86rem' }}>{tx('سيؤكد الاستقبال الموعد.', 'Reception will confirm the visit.')}</p>}
            </div>
            <Button size="lg" icon="check" loading={busy} onClick={book}>
              {data.rules.portal_needs_confirmation ? tx('إرسال طلب الحجز', 'Send booking request') : tx('تأكيد الحجز', 'Confirm booking')}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
