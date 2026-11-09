import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { addDays, clock, dayKey, dayLabel, minuteOfDay } from '../../lib/clinicTime'
import { DEVICE_STATE, State, useInventory } from './meta'

const OPEN = 8 * 60
const CLOSE = 22 * 60
const HOURS = Array.from({ length: (CLOSE - OPEN) / 60 + 1 }, (_, i) => OPEN / 60 + i)
const pct = (m) => `${((Math.min(Math.max(m, OPEN), CLOSE) - OPEN) / (CLOSE - OPEN)) * 100}%`

// Who has which device when. A device can't be booked twice at once, and one that isn't working can't be booked at all.
export default function Bookings() {
  const { tx, pick, locale } = useI18n()
  const { api, base, canReport, canDevices, canView, userId } = useInventory()
  const [params, setParams] = useSearchParams()
  const [day, setDay] = useState(params.get('day') || '')
  const { data, error, loading, reload } = useAsync(() => api.bookings({ day: day || undefined }), [day, api])
  const [modal, setModal] = useState(params.get('device') ? { device_id: params.get('device') } : null)
  const [cancelling, setCancelling] = useState(null)
  const canBook = canReport || canDevices
  const shown = data?.day || day
  const go = (d) => setDay(d)
  const devPath = (id) => (canView ? `${base}/devices/${id}` : null)
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الأجهزة الطبية', 'Medical devices')} title={tx('حجز الأجهزة', 'Device booking')}
        description={tx('احجز الجهاز للجلسة قبل أن تبدأ. لا يُحجز جهاز مرتين في نفس الوقت، ولا يُحجز جهاز تحت الصيانة أو خارج الخدمة.', "Book the device before the session. A device can't be booked twice at the same time, and one under maintenance or out of service can't be booked.")}
        actions={canBook && <Button icon="plus" onClick={() => setModal({})}>{tx('حجز جهاز', 'Book a device')}</Button>} />
      <section className="card">
        <div className="day-nav">
          <Button variant="ghost" size="sm" icon={locale.startsWith('ar') ? 'arrowRight' : 'arrowLeft'} aria-label={tx('اليوم السابق', 'Previous day')} disabled={!shown} onClick={() => go(addDays(shown, -1))} />
          <h2 className="day-title">{shown ? dayLabel(shown, locale) : '…'}{data && shown === data.today && <span className="today-pill">{tx('اليوم', 'Today')}</span>}</h2>
          <Button variant="ghost" size="sm" icon={locale.startsWith('ar') ? 'arrowLeft' : 'arrowRight'} aria-label={tx('اليوم التالي', 'Next day')} disabled={!shown} onClick={() => go(addDays(shown, 1))} />
          <TextField className="day-pick" label={tx('اذهب إلى يوم', 'Go to day')} type="date" value={shown || ''} onChange={(e) => e.target.value && go(e.target.value)} />
          {data && shown !== data.today && <Button variant="ghost" size="sm" onClick={() => go(data.today)}>{tx('اليوم', 'Today')}</Button>}
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={5} cols={4} /> : (
          <div className="bk-board" role="table" aria-label={tx('حجوزات الأجهزة', 'Device bookings')}>
            <div className="bk-row bk-scale" role="row" aria-hidden="true">
              <span className="bk-name" />
              <span className="bk-track">{HOURS.map((h) => <i key={h} style={{ insetInlineStart: pct(h * 60) }}>{h}</i>)}</span>
            </div>
            {data.devices.map((d) => {
              const mine = data.bookings.filter((b) => b.device_id === d.id)
              const off = d.status !== 'working'
              return (
                <div key={d.id} className={`bk-row ${off ? 'is-off' : ''}`} role="row">
                  <span className="bk-name" role="rowheader">
                    {devPath(d.id) ? <Link to={devPath(d.id)} className="strong-link">{d.name}</Link> : <strong>{d.name}</strong>}
                    {off ? <State state={d.status} map={DEVICE_STATE} /> : <small className="muted">{tx(`${mine.length} حجز`, `${mine.length} booking${mine.length === 1 ? '' : 's'}`)}</small>}
                  </span>
                  <span className="bk-track" role="cell">
                    {HOURS.slice(0, -1).map((h) => <i key={h} className="bk-hour" style={{ insetInlineStart: pct(h * 60) }} aria-hidden="true" />)}
                    {off && <span className="bk-blocked">{tx('غير متاح للحجز', 'Not bookable')}</span>}
                    {mine.map((b) => {
                      const from = dayKey(b.starts_at) < shown ? OPEN : minuteOfDay(b.starts_at)
                      const to = dayKey(b.ends_at) > shown ? CLOSE : minuteOfDay(b.ends_at)
                      return (
                        <button key={b.id} type="button" className={`bk-slot ${b.booked_by === userId ? 'own' : ''}`} style={{ insetInlineStart: pct(from), width: `calc(${pct(to)} - ${pct(from)})` }}
                          title={`${clock(b.starts_at, locale)}–${clock(b.ends_at, locale)} · ${b.purpose}`} onClick={() => setCancelling(b)}>
                          <span>{clock(b.starts_at, locale)}</span><small>{b.purpose}</small>
                        </button>
                      )
                    })}
                    {!off && canBook && !mine.length && <button type="button" className="bk-free" onClick={() => setModal({ device_id: String(d.id), day: shown })}><Icon name="plus" size={13} />{tx('احجز', 'Book')}</button>}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {data && (
        <section className="card">
          <div className="card-head"><h2>{tx('حجوزات اليوم', "This day's bookings")}</h2></div>
          {!data.bookings.length ? <p className="muted card-body">{tx('لا حجوزات في هذا اليوم.', 'No bookings on this day.')}</p> : (
            <ul className="bk-list">
              {data.bookings.map((b) => (
                <li key={b.id}>
                  <span className="bk-time"><bdi>{clock(b.starts_at, locale)}</bdi><small><bdi>{clock(b.ends_at, locale)}</bdi></small></span>
                  <span className="bk-what"><strong>{b.device}</strong><span>{b.purpose}</span>
                    <small className="muted"><span className="mrn">{b.ref}</span> · {tx('حجزه', 'by')} {pick(b, 'booked_by')}{b.room_en && <> · {pick(b, 'room')}</>}</small></span>
                  {(b.booked_by === userId || canDevices) && new Date(b.ends_at) > new Date() && <Button size="sm" variant="ghost" icon="x" onClick={() => setCancelling(b)}>{tx('إلغاء', 'Cancel')}</Button>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {modal && data && <BookModal data={data} initial={{ day: shown, ...modal }} onClose={() => { setModal(null); setParams({}, { replace: true }) }} onDone={(row) => { setModal(null); setParams({}, { replace: true }); if (row.day !== shown) setDay(row.day); else reload() }} />}
      {cancelling && <CancelBooking b={cancelling} canCancel={(cancelling.booked_by === userId || canDevices) && new Date(cancelling.ends_at) > new Date()} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); reload() }} />}
    </div>
  )
}

function BookModal({ data, initial, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const [form, setForm] = useState({ device_id: initial.device_id || '', day: initial.day || data.today, starts: '10:00', ends: '11:00', purpose: '', room_id: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const device = data.devices.find((d) => String(d.id) === form.device_id)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.book({ device_id: Number(form.device_id), day: form.day, starts: form.starts, ends: form.ends, purpose: form.purpose.trim(), room_id: form.room_id ? Number(form.room_id) : null })
      toast.success(tx(`حُجز ${device?.name} (${row.ref}).`, `${device?.name} booked (${row.ref}).`))
      onDone({ ...row, day: form.day })
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const clash = error?.code === 'device_taken' && error.data?.clash_ref
  const known = ['device_id', 'day', 'starts', 'ends', 'purpose', 'room_id'].some((k) => fe[k])
  const ready = form.device_id && form.day && form.starts && form.ends && form.ends > form.starts && form.purpose.trim().length >= 3 && device?.status === 'working'
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('حجز جهاز', 'Book a device')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="calendar" loading={busy} disabled={!ready} onClick={submit}>{tx('حجز', 'Book')}</Button></>}>
      <div className="form">
        {clash ? (
          <Alert tone="danger" title={t('err.device_taken')}>
            {tx(`الحجز ${error.data.clash_ref} من ${error.data.clash_from} إلى ${error.data.clash_to}. اختر وقتًا آخر.`, `Booking ${error.data.clash_ref} holds it ${error.data.clash_from}–${error.data.clash_to}. Pick another time.`)}
          </Alert>
        ) : error && !known && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <SelectField label={tx('الجهاز', 'Device')} value={form.device_id} onChange={set('device_id')} placeholder={tx('اختر الجهاز', 'Choose a device')} data-autofocus
          options={data.devices.map((d) => ({ value: String(d.id), label: d.status === 'working' ? d.name : `${d.name} — ${tx('غير متاح', 'not available')}`, disabled: d.status !== 'working' }))}
          error={device && device.status !== 'working' ? fieldText('device_id', 'device_not_working', t) : fieldText('device_id', fe.device_id, t)} />
        <div className="form-grid three">
          <TextField label={tx('اليوم', 'Day')} type="date" value={form.day} min={data.today} onChange={set('day')} error={fieldText('day', fe.day, t)} />
          <TextField label={tx('من', 'From')} type="time" step={900} value={form.starts} onChange={set('starts')} error={clash ? undefined : fieldText('starts', fe.starts, t)} />
          <TextField label={tx('إلى', 'To')} type="time" step={900} value={form.ends} onChange={set('ends')} error={form.ends && form.ends <= form.starts ? fieldText('ends', 'before_start', t) : fieldText('ends', fe.ends, t)} />
        </div>
        <TextField label={tx('الغرض', 'What for')} value={form.purpose} onChange={set('purpose')} placeholder={tx('مثال: جلسة إزالة شعر — م. ٢٣٤١', 'e.g. hair removal session — P-2341')} error={fieldText('purpose', fe.purpose, t)} />
        <SelectField label={tx('الغرفة', 'Room')} optional value={form.room_id} onChange={set('room_id')} placeholder={tx('غرفة الجهاز', "The device's room")}
          options={data.rooms.map((r) => ({ value: String(r.id), label: pick(r) }))} error={fieldText('room_id', fe.room_id, t)} />
        <p className="muted note-line"><Icon name="clock" size={14} /> {tx('الأوقات بتوقيت العيادة (القاهرة).', 'Times are on the clinic clock (Cairo).')}</p>
      </div>
    </Modal>
  )
}

function CancelBooking({ b, canCancel, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.cancelBooking(b.id, { reason: reason.trim() })
      toast.success(tx('أُلغي الحجز.', 'Booking cancelled.'))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={<>{b.device} <span className="mrn">{b.ref}</span></>}
      description={<><bdi>{clock(b.starts_at, locale)}</bdi> – <bdi>{clock(b.ends_at, locale)}</bdi> · {pick(b, 'booked_by')}</>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{canCancel ? t('cancel') : tx('إغلاق', 'Close')}</Button>
        {canCancel && <Button icon="x" loading={busy} disabled={reason.trim().length < 5} onClick={submit}>{tx('إلغاء الحجز', 'Cancel booking')}</Button>}</>}>
      <div className="form">
        <p>{b.purpose}{b.room_en && <span className="muted"> · {pick(b, 'room')}</span>}</p>
        {error && !error.fields?.reason && <Alert tone="danger">{errorText(error, t)}</Alert>}
        {canCancel && <TextArea label={tx('سبب الإلغاء', 'Why cancel')} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={fieldText('reason', error?.fields?.reason, t)} />}
      </div>
    </Modal>
  )
}
