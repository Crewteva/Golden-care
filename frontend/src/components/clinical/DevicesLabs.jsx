import { useState } from 'react'
import Button from '../Button'
import Modal from '../Modal'
import { Checkbox, SelectField, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtDateTime, fmtPhone } from '../../lib/format'
import { useSettings } from '../settings/shared'
import { money, useClinical } from './meta'

function DeviceModal({ device, onClose, onSaved }) {
  const { t, tx, pick } = useI18n()
  const { laser } = useClinical()
  const { api: sApi } = useSettings()
  const toast = useToast()
  const rooms = useAsync(() => sApi.rooms(), [sApi])
  const [form, setForm] = useState({ name: device?.name || '', model: device?.model || '', serial_no: device?.serial_no || '', room_id: device?.room_id ? String(device.room_id) : '',
    pulse_counter: String(device?.pulse_counter ?? 0), is_active: device?.is_active ?? true })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await laser.saveDevice(device?.id, { ...form, room_id: form.room_id ? Number(form.room_id) : null, pulse_counter: Number(form.pulse_counter) || 0, model: form.model || null, serial_no: form.serial_no || null })
      toast.success(tx('تم حفظ الجهاز.', 'Device saved.'))
      onSaved()
      onClose()
    } catch (err) {
      setErrors({ ...fieldErrors(err, t), form: errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }
  const roomList = rooms.data?.rooms || rooms.data || []
  return (
    <Modal open onClose={onClose} busy={busy} title={device ? tx('تعديل جهاز', 'Edit device') : tx('إضافة جهاز ليزر', 'Add a laser device')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button><Button type="submit" form="device-form" loading={busy}>{t('save')}</Button></>}>
      <form id="device-form" className="form" onSubmit={submit} noValidate>
        {errors.form && errors.form !== t('err.validation') && <Alert tone="danger">{errors.form}</Alert>}
        <TextField label={tx('الاسم', 'Name')} value={form.name} onChange={set('name')} error={errors.name} data-autofocus />
        <div className="form-grid">
          <TextField label={tx('الموديل', 'Model')} optional value={form.model} onChange={set('model')} />
          <TextField label={tx('الرقم التسلسلي', 'Serial no.')} optional value={form.serial_no} onChange={set('serial_no')} dir="ltr" />
          <SelectField label={tx('الغرفة', 'Room')} optional value={form.room_id} onChange={set('room_id')} placeholder={tx('بدون', 'None')}
            options={(Array.isArray(roomList) ? roomList : []).map((r) => ({ value: String(r.id), label: pick(r) }))} />
          <TextField label={tx('قراءة العدّاد الحالية', 'Current counter reading')} value={form.pulse_counter} onChange={set('pulse_counter')} inputMode="numeric" dir="ltr"
            error={errors.pulse_counter && tx('العدّاد لا يرجع للخلف.', "The counter can't go backwards.")} hint={tx('يتحدّث تلقائيًا مع كل جلسة موقّعة.', 'Updated automatically with every signed session.')} />
        </div>
        <Checkbox checked={form.is_active} onChange={set('is_active')} label={tx('الجهاز في الخدمة', 'Device in service')} />
      </form>
    </Modal>
  )
}

function LabModal({ lab, onClose, onSaved }) {
  const { t, tx } = useI18n()
  const { dental } = useClinical()
  const toast = useToast()
  const [form, setForm] = useState({ name: lab?.name || '', contact_name: lab?.contact_name || '', phone: lab?.phone || '', address: lab?.address || '', is_active: lab?.is_active ?? true })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await dental.saveLab(lab?.id, { ...form, contact_name: form.contact_name || null, phone: form.phone || null, address: form.address || null })
      toast.success(tx('تم حفظ المعمل.', 'Lab saved.'))
      onSaved()
      onClose()
    } catch (err) {
      setErrors({ ...fieldErrors(err, t), form: errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={lab ? tx('تعديل معمل', 'Edit lab') : tx('إضافة معمل أسنان', 'Add a dental lab')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button><Button type="submit" form="lab-form" loading={busy}>{t('save')}</Button></>}>
      <form id="lab-form" className="form" onSubmit={submit} noValidate>
        <TextField label={tx('اسم المعمل', 'Lab name')} value={form.name} onChange={set('name')} error={errors.name} data-autofocus />
        <div className="form-grid">
          <TextField label={tx('المسؤول', 'Contact person')} optional value={form.contact_name} onChange={set('contact_name')} />
          <TextField label={tx('التليفون', 'Phone')} optional value={form.phone} onChange={set('phone')} dir="ltr" />
        </div>
        <TextField label={tx('العنوان', 'Address')} optional value={form.address} onChange={set('address')} />
        <Checkbox checked={form.is_active} onChange={set('is_active')} label={tx('نتعامل معه حاليًا', 'We work with this lab')} />
      </form>
    </Modal>
  )
}

export function DevicesTab() {
  const { tx, pick, locale } = useI18n()
  const { laser } = useClinical()
  const [editing, setEditing] = useState(null)
  const { data, error, reload } = useAsync(() => laser.devices(true), [laser])
  return (
    <>
      <div className="toolbar"><Button size="sm" icon="plus" onClick={() => setEditing({})}>{tx('إضافة جهاز', 'Add device')}</Button></div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <SkeletonRows rows={2} cols={4} /> : !data.length ? <EmptyState icon="activity" title={tx('لا توجد أجهزة', 'No devices')} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{tx('الجهاز', 'Device')}</th><th>{tx('الغرفة', 'Room')}</th><th>{tx('العدّاد', 'Counter')}</th><th>{tx('آخر استخدام', 'Last used')}</th><th /></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} style={d.is_active ? undefined : { opacity: 0.55 }}>
                  <td><strong>{d.name}</strong>{!d.is_active && <> <Badge tone="neutral">{tx('خارج الخدمة', 'Out of service')}</Badge></>}<small className="muted" style={{ display: 'block' }}>{d.model}{d.serial_no && ` · ${d.serial_no}`}</small></td>
                  <td>{pick(d, 'room_name') || '—'}</td>
                  <td className="num">{new Intl.NumberFormat(locale).format(d.pulse_counter)}</td>
                  <td>{d.last_used_at ? <bdi>{fmtDateTime(d.last_used_at, locale)}</bdi> : '—'}</td>
                  <td className="actions"><Button size="sm" variant="quiet" icon="edit" onClick={() => setEditing(d)}>{tx('تعديل', 'Edit')}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <DeviceModal device={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  )
}

export function LabsTab() {
  const { tx, locale } = useI18n()
  const { dental } = useClinical()
  const [editing, setEditing] = useState(null)
  const { data, error, reload } = useAsync(() => dental.labs(true), [dental])
  return (
    <>
      <div className="toolbar"><Button size="sm" icon="plus" onClick={() => setEditing({})}>{tx('إضافة معمل', 'Add lab')}</Button></div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <SkeletonRows rows={2} cols={4} /> : !data.length ? <EmptyState icon="package" title={tx('لا توجد معامل', 'No labs')} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{tx('المعمل', 'Lab')}</th><th>{tx('التواصل', 'Contact')}</th><th>{tx('حالات مفتوحة', 'Open cases')}</th><th>{tx('تكلفة الأعمال المستلمة', 'Cost of work received')}</th><th /></tr></thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id} style={l.is_active ? undefined : { opacity: 0.55 }}>
                  <td><strong>{l.name}</strong><small className="muted" style={{ display: 'block' }}>{l.address}</small></td>
                  <td>{l.contact_name}{l.phone && <small className="muted" style={{ display: 'block' }}><bdi className="ltr">{fmtPhone(l.phone)}</bdi></small>}</td>
                  <td className="num">{l.open_cases}</td>
                  <td className="num">{money(l.cost_total, locale)}</td>
                  <td className="actions"><Button size="sm" variant="quiet" icon="edit" onClick={() => setEditing(l)}>{tx('تعديل', 'Edit')}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <LabModal lab={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  )
}
