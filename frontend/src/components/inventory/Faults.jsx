import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { Checkbox, SelectField, TextArea } from '../Fields'
import { Alert, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'
import { DEVICE_STATE, FAULT_STATE, ROLE_LABEL, State, useInventory } from './meta'

export default function Faults() {
  const { tx } = useI18n()
  const { api, canDevices, canReport } = useInventory()
  const [status, setStatus] = useState('open')
  const { data, error, loading, reload } = useAsync(() => api.faults(status || undefined), [status, api])
  const devices = useAsync(() => (canReport ? api.devices() : Promise.resolve([])), [api, canReport])
  const [modal, setModal] = useState(null)
  const done = () => { setModal(null); reload(); devices.reload() }
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الأجهزة الطبية', 'Medical devices')} title={tx('أعطال الأجهزة', 'Device faults')}
        description={canDevices
          ? tx('يبلّغ التمريض والأطباء عن الأعطال؛ المخازن تصلحها. العطل الذي يمنع الاستخدام يُخرج الجهاز من الخدمة حتى إصلاحه.', 'Nurses and doctors report faults; the inventory team fixes them. A fault that stops use takes the device out of service until it is fixed.')
          : tx('أبلغ عن أي جهاز لا يعمل كما يجب. سيصل البلاغ لمسؤول المخازن فورًا.', "Report any device that isn't working as it should. The inventory team sees it straight away.")}
        actions={canReport && <Button icon="alert" onClick={() => setModal('report')}>{tx('الإبلاغ عن عطل', 'Report a fault')}</Button>} />
      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('الحالة', 'Status')}>
            {[['open', tx('مفتوحة', 'Open')], ['fixed', tx('تم إصلاحها', 'Fixed')], ['', tx('الكل', 'All')]].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={status === k} onClick={() => setStatus(k)}>{label}</button>
            ))}
          </div>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={4} cols={4} /> : !data.length ? (
          status === 'open'
            ? <div className="all-clear in-card"><Icon name="checkCircle" size={22} /><span>{tx('لا أعطال مفتوحة. كل الأجهزة سليمة.', 'No open faults. Every device is fine.')}</span></div>
            : <EmptyState icon="inbox" title={tx('لا أعطال هنا', 'No faults here')} />
        ) : <FaultList faults={data} onFix={canDevices ? (f) => setModal({ fix: f }) : null} />}
      </section>
      {modal === 'report' && devices.data && <ReportFaultModal devices={devices.data.filter((d) => d.is_active)} onClose={() => setModal(null)} onDone={done} />}
      {modal?.fix && <FixModal fault={modal.fix} onClose={() => setModal(null)} onDone={done} />}
    </div>
  )
}

export function FaultList({ faults, onFix, hideDevice }) {
  const { tx, pick, locale, lang } = useI18n()
  const { base, canView } = useInventory()
  return (
    <ul className="fault-list">
      {faults.map((f) => (
        <li key={f.id} className={`fl-${f.status} ${f.stops_use ? 'stops' : ''}`}>
          <div className="fl-head">
            <span className="mrn">{f.ref}</span>
            {!hideDevice && (canView ? <Link to={`${base}/devices/${f.device_id}`} className="strong-link">{f.device}</Link> : <strong>{f.device}</strong>)}
            {!hideDevice && pick(f, 'room') && <span className="muted">{pick(f, 'room')}</span>}
            <State state={f.status} map={FAULT_STATE} />
            {f.stops_use && f.status === 'open' && <State state={f.device_status} map={DEVICE_STATE} />}
          </div>
          <p>{f.description}</p>
          <small className="muted">
            {tx('أبلغ', 'Reported by')} {pick(f, 'reported_by')}{f.reported_role && ROLE_LABEL[f.reported_role] && <> ({ROLE_LABEL[f.reported_role][lang]})</>} · <bdi>{fmtDateTime(f.reported_at, locale)}</bdi>
          </small>
          {f.status === 'fixed' && (
            <p className="fl-fix"><Icon name="checkCircle" size={14} /> {f.resolution} <small className="muted">— {pick(f, 'fixed_by')} · <bdi>{fmtDateTime(f.fixed_at, locale)}</bdi></small></p>
          )}
          {onFix && f.status === 'open' && <Button size="sm" variant="ghost" icon="wrench" onClick={() => onFix(f)}>{tx('تم الإصلاح', 'Mark fixed')}</Button>}
        </li>
      ))}
    </ul>
  )
}

export function ReportFaultModal({ devices, onClose, onDone }) {
  const { t, tx, pick } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const [f, setF] = useState({ device_id: devices.length === 1 ? String(devices[0].id) : '', description: '', stops_use: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.reportFault({ device_id: Number(f.device_id), description: f.description.trim(), stops_use: f.stops_use })
      toast.success(tx(`سُجّل البلاغ ${row.ref}. شكرًا.`, `Fault ${row.ref} reported. Thank you.`))
      onDone(row)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('الإبلاغ عن عطل', 'Report a fault')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button icon="alert" loading={busy} disabled={!f.device_id || f.description.trim().length < 5} onClick={submit}>{tx('إرسال البلاغ', 'Send report')}</Button></>}>
      <div className="form">
        {error && !fe.device_id && !fe.description && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <SelectField label={tx('الجهاز', 'Device')} value={f.device_id} onChange={(e) => setF((s) => ({ ...s, device_id: e.target.value }))} placeholder={tx('اختر الجهاز', 'Choose the device')} data-autofocus
          options={devices.map((d) => ({ value: String(d.id), label: [d.name, pick(d, 'room')].filter(Boolean).join(' — ') }))} error={fieldText('device_id', fe.device_id, t)} />
        <TextArea label={tx('ما المشكلة؟', "What's wrong?")} rows={3} value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))}
          placeholder={tx('مثال: الشاشة تعطي رسالة خطأ E4 عند التشغيل', 'e.g. the screen shows error E4 on start-up')} error={fieldText('description', fe.description, t)} />
        <Checkbox label={tx('لا يمكن استخدامه', "It can't be used")} description={tx('يُخرج الجهاز من الخدمة فورًا ولا يُعرض في الجلسات حتى يُصلح', "Takes the device out of service now; it isn't offered for sessions until fixed")}
          checked={f.stops_use} onChange={(e) => setF((s) => ({ ...s, stops_use: e.target.checked }))} />
      </div>
    </Modal>
  )
}

export function FixModal({ fault, onClose, onDone }) {
  const { t, tx } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const [resolution, setResolution] = useState('')
  const [back, setBack] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.fixFault(fault.id, { resolution: resolution.trim(), back_to_work: back })
      toast.success(tx('أُغلق العطل.', 'Fault closed.'))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={tx(`إغلاق ${fault.ref}`, `Close ${fault.ref}`)} description={`${fault.device} — ${fault.description}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button icon="check" loading={busy} disabled={resolution.trim().length < 5} onClick={submit}>{tx('تم الإصلاح', 'Mark fixed')}</Button></>}>
      <div className="form">
        {error && !error.fields?.resolution && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <TextArea label={tx('ما الذي تم؟', 'What was done?')} rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} data-autofocus error={fieldText('resolution', error?.fields?.resolution, t)}
          hint={tx('إن كان للإصلاح تكلفة، سجّلها من «تسجيل صيانة» في صفحة الجهاز.', 'If the repair cost money, log it with “Log maintenance” on the device page.')} />
        <Checkbox label={tx('الجهاز يعمل الآن', 'The device is working again')} checked={back} onChange={(e) => setBack(e.target.checked)} />
      </div>
    </Modal>
  )
}
