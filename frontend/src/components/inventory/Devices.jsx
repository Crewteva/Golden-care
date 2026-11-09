import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { Checkbox, ChoiceGroup, SelectField, TextArea, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { FaultList, FixModal, ReportFaultModal } from './Faults'
import { BackLink, DEVICE_STATE, State, cleanAmount, dayLabelShort, daysText, money, num, today, useInventory } from './meta'

export function DeviceAlertsLine({ d }) {
  const { tx } = useI18n()
  return (
    <span className="dev-flags">
      {d.maintenance_alert && <Badge tone={d.maintenance_alert === 'overdue' ? 'danger' : 'warn'}><Icon name="wrench" size={12} />{d.maintenance_alert === 'overdue' ? tx(`صيانة متأخرة ${-d.days_to_due} يوم`, `Service ${-d.days_to_due}d overdue`) : tx(`صيانة ${daysText(d.days_to_due, tx)}`, `Service ${daysText(d.days_to_due, tx)}`)}</Badge>}
      {d.calibration_alert && <Badge tone={d.calibration_alert === 'overdue' ? 'danger' : 'warn'}><Icon name="activity" size={12} />{d.calibration_alert === 'overdue' ? tx(`معايرة متأخرة ${-d.days_to_calibration} يوم`, `Calibration ${-d.days_to_calibration}d overdue`) : tx(`معايرة ${daysText(d.days_to_calibration, tx)}`, `Calibration ${daysText(d.days_to_calibration, tx)}`)}</Badge>}
      {d.pulse_alert && <Badge tone={d.pulse_alert === 'over' ? 'danger' : 'warn'}><Icon name="sparkle" size={12} />{d.pulse_alert === 'over' ? tx('تجاوز حد النبضات', 'Pulse limit passed') : tx(`النبضات ${Math.round(num(d.pulse_used) * 100)}٪ من الحد`, `Pulses at ${Math.round(num(d.pulse_used) * 100)}% of limit`)}</Badge>}
      {d.warranty_alert && <Badge tone={d.warranty_alert === 'ended' ? 'neutral' : 'gold'}>{d.warranty_alert === 'ended' ? tx('الضمان انتهى', 'Out of warranty') : tx('الضمان ينتهي قريبًا', 'Warranty ending')}</Badge>}
      {num(d.open_faults) > 0 && <Badge tone="danger"><Icon name="alert" size={12} />{tx(`${d.open_faults} عطل مفتوح`, `${d.open_faults} open fault${d.open_faults === 1 ? '' : 's'}`)}</Badge>}
    </span>
  )
}

// Pulses used since the last laser service, against the rated limit.
export function PulseGauge({ d, big }) {
  const { tx, locale } = useI18n()
  if (!d.pulse_limit) return null
  const used = num(d.pulse_used)
  const n = (v) => new Intl.NumberFormat(locale, { notation: big ? 'standard' : 'compact', maximumFractionDigits: 1 }).format(num(v))
  return (
    <span className={`pulse-gauge ${d.pulse_alert ? `is-${d.pulse_alert}` : ''} ${big ? 'big' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)}
      aria-label={tx('استهلاك النبضات', 'Pulse wear')}>
      <span className="pg-bar"><i style={{ '--w': `${Math.min(100, used * 100)}%` }} /><b aria-hidden="true" /></span>
      <small><bdi>{n(d.pulses_since_service)} / {n(d.pulse_limit)}</bdi> · {Math.round(used * 100)}%</small>
    </span>
  )
}

export default function Devices() {
  const { tx, pick, locale } = useI18n()
  const { api, base, canDevices, canReport } = useInventory()
  const { data, error, loading, reload } = useAsync(() => api.devices(), [api])
  const [modal, setModal] = useState(null)
  const working = (data || []).filter((d) => d.is_active && d.status === 'working').length
  const active = (data || []).filter((d) => d.is_active).length
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المخازن والمشتريات', 'Stock & purchasing')} title={tx('الأجهزة الطبية', 'Medical devices')}
        description={tx('سجل الأجهزة وحالتها وخطة الصيانة والأعطال. الجهاز الذي لا يعمل لا يمكن اختياره في الجلسات.', "The device register, status, maintenance plan and faults. A device that isn't working can't be picked for a session.")}
        actions={<>
          <Link className="btn btn-ghost" to={`${base}/bookings`}><Icon name="calendar" size={16} />{tx('الحجوزات', 'Bookings')}</Link>
          {canReport && <Button variant="ghost" icon="alert" onClick={() => setModal('fault')}>{tx('الإبلاغ عن عطل', 'Report a fault')}</Button>}
          {canDevices && <Button icon="plus" onClick={() => setModal('add')}>{tx('جهاز جديد', 'New device')}</Button>}
        </>} />
      {error ? <section className="card"><ErrorState error={error} onRetry={reload} /></section> : loading && !data ? <section className="card"><SkeletonRows rows={3} cols={4} /></section> : !data.length ? (
        <section className="card"><EmptyState icon="monitor" title={tx('لا أجهزة مسجلة', 'No devices registered')} action={canDevices && <Button icon="plus" onClick={() => setModal('add')}>{tx('جهاز جديد', 'New device')}</Button>} /></section>
      ) : (
        <>
          <p className="dev-summary"><strong className="num">{working}</strong> {tx(`من ${active} جهاز تعمل الآن`, `of ${active} devices working now`)}</p>
          <div className="device-grid">
            {data.map((d, i) => (
              <Link key={d.id} to={`${base}/devices/${d.id}`} className={`device-card st-${d.status} ${d.is_active ? '' : 'off'}`} style={{ '--i': i }}>
                <div className="dc-top">
                  <span className="dc-icon"><Icon name={d.is_laser ? 'sparkle' : 'monitor'} size={22} /></span>
                  <State state={d.status} map={DEVICE_STATE} />
                </div>
                <h3>{d.name}</h3>
                <p className="muted">{[pick(d, 'type'), d.model].filter(Boolean).join(' · ')}</p>
                <dl className="dc-facts">
                  <div><dt>{tx('الغرفة', 'Room')}</dt><dd>{pick(d, 'room') || '—'}</dd></div>
                  <div><dt>{tx('الصيانة القادمة', 'Next service')}</dt><dd>{d.next_due ? <bdi>{dayLabelShort(d.next_due, locale)}</bdi> : '—'}</dd></div>
                  <div><dt>{tx('المعايرة القادمة', 'Next calibration')}</dt><dd>{d.next_calibration ? <bdi>{dayLabelShort(d.next_calibration, locale)}</bdi> : '—'}</dd></div>
                  {d.pulse_limit && <div className="wide"><dt>{tx('النبضات منذ آخر صيانة', 'Pulses since service')}</dt><dd><PulseGauge d={d} /></dd></div>}
                </dl>
                <DeviceAlertsLine d={d} />
                {!d.is_active && <Badge>{tx('موقوف', 'Switched off')}</Badge>}
              </Link>
            ))}
          </div>
        </>
      )}
      {modal === 'add' && <DeviceModal onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
      {modal === 'fault' && data && <ReportFaultModal devices={data.filter((d) => d.is_active)} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
    </div>
  )
}

function DeviceModal({ device, onClose, onDone }) {
  const { t, tx, pick } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const { data: o } = useAsync(() => api.options(), [api])
  const s = (v) => (v === null || v === undefined ? '' : String(v))
  const [f, setF] = useState({
    name: s(device?.name), type_id: s(device?.type_id), model: s(device?.model), serial_no: s(device?.serial_no), room_id: s(device?.room_id),
    supplier_id: s(device?.supplier_id), purchase_date: s(device?.purchase_date), purchase_price: device?.purchase_price ? String(num(device.purchase_price)) : '',
    warranty_end: s(device?.warranty_end), maintenance_every_days: s(device?.maintenance_every_days), last_maintenance_on: s(device?.last_maintenance_on), notes: s(device?.notes),
    calibration_every_days: s(device?.calibration_every_days), last_calibration_on: s(device?.last_calibration_on), pulse_limit: s(device?.pulse_limit),
    is_active: device ? device.is_active : true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const set = (k, clean) => (e) => setF((x) => ({ ...x, [k]: clean ? clean(e.target.value) : e.target.value }))
  const submit = async () => {
    setBusy(true)
    setError(null)
    const nul = (v) => (v.trim() ? v.trim() : null)
    try {
      const row = await api.saveDevice(device?.id, {
        name: f.name.trim(), type_id: Number(f.type_id), model: nul(f.model), serial_no: nul(f.serial_no), room_id: Number(f.room_id) || null, supplier_id: Number(f.supplier_id) || null,
        purchase_date: f.purchase_date || null, purchase_price: f.purchase_price || null, warranty_end: f.warranty_end || null,
        maintenance_every_days: Number(f.maintenance_every_days) || null, last_maintenance_on: f.last_maintenance_on || null, notes: nul(f.notes), is_active: f.is_active,
      })
      toast.success(device ? tx('حُفظت بيانات الجهاز.', 'Device saved.') : tx(`سُجّل ${row.name}.`, `${row.name} registered.`))
      onDone(row)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const known = Object.keys(fe).some((k) => k in f)
  return (
    <Modal open wide onClose={onClose} busy={busy} title={device ? tx(`تعديل ${device.name}`, `Edit ${device.name}`) : tx('تسجيل جهاز', 'Register a device')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button icon="check" loading={busy} disabled={!f.name.trim() || !f.type_id} onClick={submit}>{t('save')}</Button></>}>
      {!o ? <SkeletonRows rows={4} cols={2} /> : (
        <div className="form">
          {error && !known && <Alert tone="danger">{errorText(error, t)}</Alert>}
          <div className="form-grid">
            <TextField label={tx('اسم الجهاز', 'Device name')} dir="auto" value={f.name} onChange={set('name')} data-autofocus placeholder={tx('مثال: جهاز تعقيم — غرفة ٢', 'e.g. Autoclave — Room 2')} error={fieldText('name', fe.name, t)} />
            <SelectField label={tx('النوع', 'Type')} value={f.type_id} onChange={set('type_id')} placeholder={tx('اختر النوع', 'Choose a type')}
              options={o.device_types.filter((x) => x.is_active || String(x.id) === f.type_id).map((x) => ({ value: String(x.id), label: pick(x) }))} error={fieldText('type_id', fe.type_id, t)} />
            <TextField label={tx('الموديل', 'Model')} optional dir="ltr" value={f.model} onChange={set('model')} />
            <TextField label={tx('الرقم التسلسلي', 'Serial no.')} optional dir="ltr" value={f.serial_no} onChange={set('serial_no')} error={fieldText('serial_no', fe.serial_no, t)} />
            <SelectField label={tx('الغرفة', 'Room')} optional value={f.room_id} onChange={set('room_id')} placeholder={tx('بلا غرفة', 'No room')}
              options={o.rooms.filter((r) => r.is_active || String(r.id) === f.room_id).map((r) => ({ value: String(r.id), label: pick(r) }))} />
            <SelectField label={tx('المورد / الوكيل', 'Supplier / agent')} optional value={f.supplier_id} onChange={set('supplier_id')} placeholder={tx('غير محدد', 'Not set')}
              options={o.suppliers.filter((x) => x.is_active || String(x.id) === f.supplier_id).map((x) => ({ value: String(x.id), label: x.name }))} />
            <TextField label={tx('تاريخ الشراء', 'Purchase date')} optional type="date" max={today()} value={f.purchase_date} onChange={set('purchase_date')} error={fieldText('purchase_date', fe.purchase_date, t)} />
            <TextField label={tx('سعر الشراء', 'Purchase price')} optional inputMode="decimal" dir="ltr" value={f.purchase_price} onChange={set('purchase_price', cleanAmount)} placeholder="0.00" />
            <TextField label={tx('نهاية الضمان', 'Warranty ends')} optional type="date" value={f.warranty_end} min={f.purchase_date || undefined} onChange={set('warranty_end')} error={fieldText('warranty_end', fe.warranty_end, t)} />
            <TextField label={tx('صيانة دورية كل (يوم)', 'Service every (days)')} optional inputMode="numeric" dir="ltr" value={f.maintenance_every_days} onChange={set('maintenance_every_days', (v) => v.replace(/\D/g, '').slice(0, 4))} placeholder="90" error={fieldText('maintenance_every_days', fe.maintenance_every_days, t)} />
            <TextField label={tx('آخر صيانة', 'Last serviced')} optional type="date" max={today()} value={f.last_maintenance_on} onChange={set('last_maintenance_on')} hint={tx('يُحدَّث تلقائيًا عند تسجيل صيانة', 'Updated on its own when maintenance is logged')} error={fieldText('last_maintenance_on', fe.last_maintenance_on, t)} />
          </div>
          <TextArea label={tx('ملاحظات', 'Notes')} optional rows={2} value={f.notes} onChange={set('notes')} />
          {device && <Checkbox label={tx('ضمن الأجهزة النشطة', 'In active use')} description={tx('الجهاز الموقوف يبقى في السجل بلا تنبيهات', 'A switched-off device stays on record without alerts')} checked={f.is_active} onChange={(e) => setF((x) => ({ ...x, is_active: e.target.checked }))} />}
        </div>
      )}
    </Modal>
  )
}

export function DevicePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, tx, pick, locale, lang } = useI18n()
  const { api, base, canDevices, canReport, canView } = useInventory()
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.device(id), [id, api])
  const [modal, setModal] = useState(null)
  const back = <BackLink to={canView ? `${base}/devices` : `${base}/faults`}>{canView ? tx('الأجهزة', 'Devices') : tx('الأعطال', 'Faults')}</BackLink>
  if (error) return <div className="page">{back}<section className="card"><ErrorState error={error} onRetry={reload} /></section></div>
  if (loading && !data) return <div className="page">{back}<section className="card"><SkeletonRows rows={6} cols={4} /></section></div>
  const d = data.device
  const done = () => { setModal(null); reload() }
  const remove = async () => {
    try {
      const res = await api.deleteDevice(d.id)
      if (res.switched_off) {
        toast.success(tx('للجهاز سجلات سابقة، فأُوقف بدل حذفه.', 'The device has history, so it was switched off instead.'))
        setModal(null)
        reload()
      } else {
        toast.success(tx('حُذف الجهاز.', 'Device deleted.'))
        navigate(`${base}/devices`)
      }
    } catch (err) {
      toast.error?.(errorText(err, t))
    }
  }
  const openFaults = data.faults.filter((f) => f.status === 'open')
  return (
    <div className="page reveal">
      <PageHeader back={back} eyebrow={pick(d, 'type')} title={d.name}
        description={<><State state={d.status} map={DEVICE_STATE} />{d.model && <> · {d.model}</>}{d.serial_no && <> · <bdi dir="ltr">S/N {d.serial_no}</bdi></>}{pick(d, 'room') && <> · {pick(d, 'room')}</>}</>}
        actions={<>
          {canReport && d.is_active && <Button variant="ghost" icon="alert" onClick={() => setModal('fault')}>{tx('عطل', 'Report fault')}</Button>}
          {canDevices && <>
            <Button variant="ghost" icon="edit" onClick={() => setModal('edit')}>{tx('تعديل', 'Edit')}</Button>
            <Button variant="ghost" icon="x" onClick={() => setModal('delete')}>{tx('حذف', 'Delete')}</Button>
            <Button variant="ghost" icon="power" onClick={() => setModal('status')}>{tx('الحالة', 'Status')}</Button>
            <Button icon="wrench" onClick={() => setModal('maintenance')}>{tx('تسجيل صيانة', 'Log maintenance')}</Button>
          </>}
        </>} />

      {d.status !== 'working' && (
        <Alert tone={d.status === 'out_of_service' ? 'danger' : 'warn'} title={DEVICE_STATE[d.status][lang]}>
          {d.status_note || tx('لا يمكن اختياره في الجلسات حتى يعود للعمل.', "It can't be picked for sessions until it's working again.")}
        </Alert>
      )}

      <div className="stats inv-stats">
        <div className={`stat ${d.maintenance_alert === 'overdue' ? 'fig-danger' : d.maintenance_alert ? 'fig-warn' : ''}`}>
          <div className="stat-label">{tx('الصيانة القادمة', 'Next service')}</div>
          <div className="stat-value small">{d.next_due ? <bdi>{dayLabelShort(d.next_due, locale)}</bdi> : '—'}</div>
          <div className="stat-foot">{d.maintenance_every_days ? <>{tx(`كل ${d.maintenance_every_days} يوم`, `Every ${d.maintenance_every_days} days`)}{d.days_to_due !== null && <> · {daysText(d.days_to_due, tx)}</>}</> : tx('بلا خطة صيانة', 'No service plan')}</div>
        </div>
        <div className={`stat ${d.warranty_alert === 'ending' ? 'fig-warn' : ''}`}>
          <div className="stat-label">{tx('الضمان', 'Warranty')}</div>
          <div className="stat-value small">{d.warranty_end ? <bdi>{dayLabelShort(d.warranty_end, locale)}</bdi> : '—'}</div>
          <div className="stat-foot">{d.warranty_alert === 'ended' ? tx('انتهى', 'Ended') : d.warranty_alert === 'ending' ? tx('ينتهي خلال ٦٠ يوم', 'Ends within 60 days') : d.warranty_end ? tx('ساري', 'Covered') : tx('غير مسجل', 'Not recorded')}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{tx('الشراء', 'Purchase')}</div>
          <div className="stat-value small">{d.purchase_price ? money(d.purchase_price, locale) : '—'}</div>
          <div className="stat-foot">{[d.supplier, d.purchase_date && dayLabelShort(d.purchase_date, locale)].filter(Boolean).join(' · ') || '—'}</div>
        </div>
        <div className={`stat ${openFaults.length ? 'fig-danger' : ''}`}>
          <div className="stat-label">{tx('أعطال مفتوحة', 'Open faults')}</div>
          <div className="stat-value num">{openFaults.length}</div>
          <div className="stat-foot">{tx(`${data.maintenance.length} صيانة مسجلة`, `${data.maintenance.length} maintenance record${data.maintenance.length === 1 ? '' : 's'}`)}</div>
        </div>
      </div>

      <section className="card">
        <div className="card-head"><h2>{tx('الأعطال', 'Faults')}</h2></div>
        {!data.faults.length ? <p className="muted">{tx('لم يُبلَّغ عن أعطال.', 'No faults reported.')}</p> : <FaultList faults={data.faults} onFix={canDevices ? (f) => setModal({ fix: f }) : null} hideDevice />}
      </section>

      <section className="card">
        <div className="card-head"><h2>{tx('سجل الصيانة', 'Maintenance log')}</h2></div>
        {!data.maintenance.length ? <p className="muted">{tx('لا صيانة مسجلة بعد.', 'No maintenance logged yet.')}</p> : (
          <ol className="maint-log">
            {data.maintenance.map((m) => (
              <li key={m.id} className={`k-${m.kind}`}>
                <span className="ml-dot"><Icon name={m.kind === 'repair' ? 'wrench' : 'refresh'} size={14} /></span>
                <div className="ml-body">
                  <div className="ml-head">
                    <strong>{m.kind === 'repair' ? tx('إصلاح', 'Repair') : tx('صيانة دورية', 'Preventive service')}</strong>
                    <span className="mrn">{m.ref}</span>
                    <bdi className="muted">{dayLabelShort(m.done_on, locale)}</bdi>
                    {m.fault_ref && <Badge tone="info">{m.fault_ref}</Badge>}
                  </div>
                  <p>{m.description}</p>
                  <small className="muted">
                    {[m.technician, m.supplier].filter(Boolean).join(' · ') || tx('داخلي', 'In-house')}
                    {num(m.cost) > 0 && <> · <strong className="ink">{money(m.cost, locale)}</strong> · {m.paid_from_en ? tx(`دُفع من ${pick(m, 'paid_from')}`, `paid from ${pick(m, 'paid_from')}`) : m.bill_no ? tx(`على فاتورة ${m.bill_no}`, `on bill ${m.bill_no}`) : tx('آجل على المورد', 'on credit with the supplier')}</>}
                    {' · '}{pick(m, 'by')}
                  </small>
                  {m.file_name && <a className="btn btn-quiet btn-sm ml-file" href={`${api.base}/maintenance/${m.id}/file`} target="_blank" rel="noreferrer"><Icon name="eye" size={14} />{m.file_name}</a>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {d.notes && <section className="card"><div className="card-head"><h2>{tx('ملاحظات', 'Notes')}</h2></div><p>{d.notes}</p></section>}

      {modal === 'edit' && <DeviceModal device={d} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'status' && <StatusModal device={d} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'maintenance' && <MaintenanceModal device={d} faults={openFaults} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'fault' && <ReportFaultModal devices={[d]} onClose={() => setModal(null)} onDone={done} />}
      {modal?.fix && <FixModal fault={modal.fix} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'delete' && (
        <Modal open onClose={() => setModal(null)} title={tx(`حذف ${d.name}؟`, `Delete ${d.name}?`)}
          footer={<><Button variant="ghost" onClick={() => setModal(null)}>{t('cancel')}</Button><Button icon="x" onClick={remove}>{tx('حذف', 'Delete')}</Button></>}>
          <p>{tx('إن لم يكن له جلسات أو صيانة أو أعطال يُحذف نهائيًا؛ وإلا يُوقف ويبقى سجله.', 'If it has no sessions, maintenance or faults it is deleted for good; otherwise it is switched off and its history kept.')}</p>
        </Modal>
      )}
    </div>
  )
}

function StatusModal({ device, onClose, onDone }) {
  const { t, tx, lang } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const [status, setStatus] = useState(device.status)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const needsNote = status !== 'working'
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.setStatus(device.id, { status, note: note.trim() || null })
      toast.success(tx('حُدّثت حالة الجهاز.', 'Device status updated.'))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('حالة الجهاز', 'Device status')} description={device.name}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button icon="check" loading={busy} disabled={status === device.status || (needsNote && note.trim().length < 3)} onClick={submit}>{t('save')}</Button></>}>
      <div className="form">
        {error && !error.fields?.note && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <ChoiceGroup legend={tx('الحالة', 'Status')} name="device-status" value={status} onChange={setStatus}
          options={Object.entries(DEVICE_STATE).map(([k, v]) => ({ value: k, label: v[lang] }))} />
        {needsNote && <p className="muted">{tx('لن يظهر الجهاز في اختيار الأجهزة بالجلسات حتى يعود للعمل.', "The device won't be offered for sessions until it's working again.")}</p>}
        <TextArea label={tx('السبب', 'Reason')} optional={!needsNote} rows={2} value={note} onChange={(e) => setNote(e.target.value)} error={fieldText('note', error?.fields?.note, t)} />
      </div>
    </Modal>
  )
}

function MaintenanceModal({ device, faults, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const { data: o } = useAsync(() => api.options(), [api])
  const input = useRef(null)
  const [f, setF] = useState({ kind: faults.length ? 'repair' : 'preventive', done_on: today(), description: '', technician: '', supplier_id: device.supplier_id ? String(device.supplier_id) : '', cost: '', paid_from_id: '', fault_id: faults[0]?.id || '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const set = (k, clean) => (e) => setF((x) => ({ ...x, [k]: clean ? clean(e.target.value) : e.target.value }))
  const tooBig = o && file && file.size > o.max_upload_mb * 1024 * 1024
  const onCredit = num(f.cost) > 0 && !f.paid_from_id
  const submit = async () => {
    setBusy(true)
    setError(null)
    const form = new FormData()
    Object.entries(f).forEach(([k, v]) => {
      if (k === 'fault_id' && f.kind !== 'repair') return
      if (String(v).trim()) form.append(k, String(v).trim())
    })
    if (file) form.append('file', file)
    try {
      const row = await api.addMaintenance(device.id, form)
      toast.success(tx(`سُجّلت الصيانة ${row.ref}.`, `Maintenance ${row.ref} logged.`))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const known = Object.keys(fe).some((k) => k in f || k === 'file')
  const ready = f.description.trim().length >= 3 && !tooBig && !(num(f.cost) > 0 && !f.paid_from_id && !f.supplier_id)
  return (
    <Modal open wide onClose={onClose} busy={busy} title={tx('تسجيل صيانة', 'Log maintenance')} description={device.name}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button icon="wrench" loading={busy} disabled={!ready} onClick={submit}>{t('save')}</Button></>}>
      {!o ? <SkeletonRows rows={4} cols={2} /> : (
        <div className="form">
          {error && !known && <Alert tone="danger">{errorText(error, t)}</Alert>}
          <ChoiceGroup legend={tx('النوع', 'Kind')} name="mt-kind" value={f.kind} onChange={(v) => setF((x) => ({ ...x, kind: v }))}
            options={[{ value: 'preventive', label: tx('صيانة دورية', 'Preventive service') }, { value: 'repair', label: tx('إصلاح', 'Repair') }]} />
          <div className="form-grid">
            <TextField label={tx('التاريخ', 'Done on')} type="date" max={today()} min={o.first_open_day || undefined} value={f.done_on} onChange={set('done_on')} error={fieldText('done_on', fe.done_on, t)} />
            <TextField label={tx('الفني', 'Technician')} optional dir="auto" value={f.technician} onChange={set('technician')} />
            {f.kind === 'repair' && faults.length > 0 && (
              <SelectField className="span-2" label={tx('يُغلق العطل', 'Closes fault')} optional value={f.fault_id} onChange={set('fault_id')} placeholder={tx('لا يخص عطلًا مفتوحًا', 'Not for an open fault')}
                options={faults.map((x) => ({ value: x.id, label: `${x.ref} · ${x.description.slice(0, 60)}` }))} hint={tx('يُغلق العطل ويعود الجهاز للعمل', 'The fault is closed and the device goes back to working')} />
            )}
          </div>
          <TextArea label={tx('ما تم', 'What was done')} rows={2} value={f.description} onChange={set('description')} error={fieldText('description', fe.description, t)} />
          <fieldset className="lines-edit">
            <legend>{tx('التكلفة', 'Cost')}</legend>
            <div className="form-grid">
              <TextField label={tx('التكلفة (شاملة الضريبة)', 'Cost (VAT included)')} optional inputMode="decimal" dir="ltr" value={f.cost} onChange={set('cost', cleanAmount)} placeholder="0.00" error={fieldText('cost', fe.cost, t)} />
              <SelectField label={tx('الجهة', 'Done by')} optional value={f.supplier_id} onChange={set('supplier_id')} placeholder={tx('فني مستقل / داخلي', 'Independent / in-house')}
                options={o.suppliers.filter((x) => x.is_active || String(x.id) === f.supplier_id).map((x) => ({ value: String(x.id), label: x.name }))} error={fieldText('supplier_id', fe.supplier_id, t)} />
              {num(f.cost) > 0 && (
                <SelectField className="span-2" label={tx('الدفع', 'Payment')} value={f.paid_from_id} onChange={set('paid_from_id')}
                  placeholder={f.supplier_id ? tx('آجل — على حساب المورد', 'On credit — owed to the supplier') : tx('اختر الحساب', 'Choose the account')}
                  options={o.money_accounts.map((a) => ({ value: String(a.id), label: tx(`دُفع الآن من ${a.code} · ${pick(a)}`, `Paid now from ${a.code} · ${pick(a)}`) }))} error={fieldText('paid_from_id', fe.paid_from_id, t)} />
              )}
            </div>
            {num(f.cost) > 0 && <small className="muted">{onCredit ? tx(`يُقيَّد ${money(f.cost, locale)}: مدين صيانة الأجهزة، دائن الموردين.`, `Posts ${money(f.cost, locale)}: Device maintenance / Suppliers payable.`) : tx(`يُقيَّد ${money(f.cost, locale)}: مدين صيانة الأجهزة، دائن الحساب المختار.`, `Posts ${money(f.cost, locale)}: Device maintenance / the chosen account.`)}</small>}
          </fieldset>
          <div className={`file-drop ${file ? 'has-file' : ''} ${fe.file || tooBig ? 'bad' : ''}`}>
            <Icon name={file ? 'checkCircle' : 'clipboard'} size={20} />
            <div>
              <strong>{file ? file.name : tx('تقرير الفني أو الفاتورة', 'Service report or invoice')}</strong>
              <small className="muted">{file ? `${(file.size / 1024).toFixed(0)} KB` : tx(`PDF أو JPG أو PNG حتى ${o.max_upload_mb} ميجابايت (اختياري)`, `PDF, JPG or PNG up to ${o.max_upload_mb} MB (optional)`)}</small>
              {(fe.file || tooBig) && <small className="neg">{tooBig ? t('field.too_large') : fieldText('file', fe.file, t)}</small>}
            </div>
            <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" id="mt-file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <label htmlFor="mt-file" className="btn btn-ghost btn-sm">{file ? tx('تغيير', 'Change') : tx('اختر ملفًا', 'Choose file')}</label>
            {file && <button type="button" className="btn btn-quiet btn-icon" onClick={() => { setFile(null); if (input.current) input.current.value = '' }} aria-label={tx('إزالة الملف', 'Remove file')}><Icon name="x" size={16} /></button>}
          </div>
        </div>
      )}
    </Modal>
  )
}
