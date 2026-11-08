import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../../components/Button'
import Icon from '../../../components/Icon'
import Modal from '../../../components/Modal'
import { TextArea } from '../../../components/Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../../components/ui'
import { useToast } from '../../../components/Toast'
import { useAsync } from '../../../components/useAsync'
import { STATUS, serviceNames } from '../../../components/appointments/meta'
import { fmtMoney } from '../../../components/settings/shared'
import { patientApi } from '../../../api/patient'
import { useI18n } from '../../../i18n/I18nContext'
import { errorText } from '../../../lib/errors'
import { clock, dayKey, dayLabel } from '../../../lib/clinicTime'

// The patient's appointments (and their children's): upcoming with cancel, then the past.
export default function MyAppointments() {
  const { t, tx, lang, pick, locale } = useI18n()
  const toast = useToast()
  const { data, error, loading, reload, setData } = useAsync(() => patientApi.appointments(), [])
  const [cancelling, setCancelling] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const cancel = async () => {
    setBusy(true)
    try {
      setData(await patientApi.cancel(cancelling.id, reason.trim() || null))
      toast.success(tx('تم إلغاء الموعد.', 'Appointment cancelled.'))
      setCancelling(null)
      setReason('')
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  const items = data?.items || []
  const now = new Date()
  const upcoming = items.filter((a) => new Date(a.ends_at) >= now && ['requested', 'booked', 'confirmed', 'arrived', 'in_room'].includes(a.status)).reverse()
  const past = items.filter((a) => !upcoming.includes(a))
  const people = new Set(items.map((a) => a.patient_id)).size > 1
  const hours = data?.rules?.portal_cancel_hours ?? 12

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('حسابي', 'My account')} title={tx('مواعيدي', 'My appointments')}
        actions={data?.rules?.portal_enabled && <Link to="/dashboard/patient/book" className="btn btn-gold"><Icon name="plus" size={18} />{tx('احجز موعدًا', 'Book a visit')}</Link>} />
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <section className="card"><SkeletonRows rows={3} cols={2} /></section> : (
        <>
          {!upcoming.length ? (
            <section className="card">
              <EmptyState icon="calendar" title={tx('لا توجد مواعيد قادمة', 'No upcoming visits')}
                action={data.rules.portal_enabled ? <Link to="/dashboard/patient/book" className="btn btn-primary">{tx('احجز الآن', 'Book now')}</Link> : null}>
                {data.rules.portal_enabled ? null : tx('للحجز اتصل بالعيادة.', 'To book, please call the clinic.')}
              </EmptyState>
            </section>
          ) : (
            <div className="grid-2">
              {upcoming.map((a) => (
                <article key={a.id} className="card visit-card">
                  <div className="visit-date">
                    <strong className="num">{dayLabel(dayKey(a.starts_at), locale, { day: 'numeric' })}</strong>
                    <span>{dayLabel(dayKey(a.starts_at), locale, { month: 'short' })}</span>
                    <small>{dayLabel(dayKey(a.starts_at), locale, { weekday: 'long' })}</small>
                  </div>
                  <div className="visit-body">
                    <div className="row-between">
                      <strong className="num" style={{ fontSize: '1.15rem', fontFamily: 'var(--font-display)' }}>{clock(a.starts_at, locale)}</strong>
                      <Badge tone={STATUS[a.status].tone}>{STATUS[a.status][lang]}</Badge>
                    </div>
                    <p>{pick(a, 'doctor_name')}</p>
                    <p className="muted">{serviceNames(a.services, pick)}</p>
                    {people && <p className="muted"><Icon name="user" size={14} /> {pick(a, 'patient_name')}</p>}
                    <p className="muted"><Icon name="mapPin" size={14} /> {pick(a, 'branch_name')}{a.room_name_en && ` · ${pick(a, 'room_name')}`}</p>
                    {a.status === 'requested' && <Alert tone="info">{tx('بانتظار تأكيد العيادة. سنتواصل معك.', 'Waiting for the clinic to confirm. We will contact you.')}</Alert>}
                    <div className="row-between">
                      <span className="muted num">{fmtMoney(a.estimated_price, locale)} <small>{tx('تقريبًا', 'approx.')}</small></span>
                      {a.can_cancel ? (
                        <Button variant="danger-ghost" size="sm" onClick={() => setCancelling(a)}>{tx('إلغاء', 'Cancel')}</Button>
                      ) : ['requested', 'booked', 'confirmed'].includes(a.status) && (
                        <small className="muted">{tx(`للإلغاء قبل أقل من ${hours} ساعة اتصل بالعيادة`, `Within ${hours} h, call the clinic to cancel`)}</small>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {past.length > 0 && (
            <section className="card">
              <div className="card-head"><h2>{tx('الزيارات السابقة', 'Past visits')}</h2></div>
              <div className="card-body" style={{ paddingBlock: 4 }}>
                <ul className="list">
                  {past.map((a) => (
                    <li key={a.id} className="row-between">
                      <span>
                        <strong style={{ fontWeight: 500 }}>{dayLabel(dayKey(a.starts_at), locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</strong>
                        <small className="muted" style={{ display: 'block' }}>{pick(a, 'doctor_name')} · {serviceNames(a.services, pick)}{people ? ` · ${pick(a, 'patient_name')}` : ''}</small>
                      </span>
                      <Badge tone={STATUS[a.status].tone}>{STATUS[a.status][lang]}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}
      <Modal open={Boolean(cancelling)} onClose={() => setCancelling(null)} busy={busy} title={tx('إلغاء الموعد؟', 'Cancel this visit?')}
        description={cancelling ? `${dayLabel(dayKey(cancelling.starts_at), locale)} · ${clock(cancelling.starts_at, locale)} · ${pick(cancelling, 'doctor_name')}` : ''}
        footer={<><Button variant="ghost" onClick={() => setCancelling(null)} disabled={busy}>{t('back')}</Button><Button variant="danger" loading={busy} onClick={cancel}>{tx('إلغاء الموعد', 'Cancel visit')}</Button></>}>
        <TextArea label={tx('السبب', 'Reason')} optional value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('يساعدنا على تحسين الخدمة', 'Helps us improve')} />
      </Modal>
    </div>
  )
}
