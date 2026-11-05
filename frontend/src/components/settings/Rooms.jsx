import { useState } from 'react'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { Checkbox, SelectField, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { ConfirmDelete, useSettings } from './shared'

function RoomModal({ room, branches, types, onClose, onSaved }) {
  const { t, tx, pick } = useI18n()
  const { api } = useSettings()
  const [form, setForm] = useState(room
    ? { ...room, room_type_id: room.room_type_id ?? '', notes: room.notes || '' }
    : { branch_id: branches.find((b) => b.is_active)?.id || '', room_type_id: '', name_ar: '', name_en: '', notes: '', is_active: true, sort_order: 0 })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (!form.name_ar.trim()) e.name_ar = t('field.required')
    if (!form.name_en.trim()) e.name_en = t('field.required')
    if (!form.branch_id) e.branch_id = t('field.required')
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const body = { branch_id: Number(form.branch_id), room_type_id: form.room_type_id ? Number(form.room_type_id) : null, name_ar: form.name_ar,
        name_en: form.name_en, notes: form.notes || null, is_active: form.is_active, sort_order: Number(form.sort_order) || 0 }
      room ? await api.rooms.edit(room.id, body) : await api.rooms.add(body)
      onSaved()
    } catch (err) {
      setErrors({ ...fieldErrors(err, t), form: errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={room ? tx('تعديل الغرفة', 'Edit room') : tx('غرفة جديدة', 'New room')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="room-form" loading={busy}>{t('save')}</Button></>}>
      <form id="room-form" className="form" onSubmit={submit} noValidate>
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <div className="form-grid">
          <TextField label={tx('الاسم بالعربية', 'Name in Arabic')} value={form.name_ar} onChange={set('name_ar')} error={errors.name_ar} dir="rtl" data-autofocus />
          <TextField label={tx('الاسم بالإنجليزية', 'Name in English')} value={form.name_en} onChange={set('name_en')} error={errors.name_en} dir="ltr" />
          <SelectField label={tx('الفرع', 'Branch')} value={form.branch_id} onChange={set('branch_id')} error={errors.branch_id}
            options={branches.map((b) => ({ value: b.id, label: pick(b) }))} />
          <SelectField label={tx('النوع', 'Type')} value={form.room_type_id} onChange={set('room_type_id')}
            options={types.map((r) => ({ value: r.id, label: pick(r) }))} placeholder={tx('بدون نوع', 'No type')} />
        </div>
        <TextField label={tx('ملاحظات', 'Notes')} optional value={form.notes} onChange={set('notes')} placeholder={tx('مثال: بها جهاز سونار', 'e.g. Has an ultrasound machine')} />
        <Checkbox checked={form.is_active} onChange={set('is_active')} label={tx('الغرفة متاحة', 'Room in use')} />
      </form>
    </Modal>
  )
}

function TypeModal({ type, onClose, onSaved }) {
  const { t, tx } = useI18n()
  const { api } = useSettings()
  const [form, setForm] = useState(type || { name_ar: '', name_en: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (form.name_ar.trim().length < 2) e.name_ar = t('field.required')
    if (form.name_en.trim().length < 2) e.name_en = t('field.required')
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      type ? await api.roomTypes.edit(type.id, form) : await api.roomTypes.add(form)
      onSaved()
    } catch (err) {
      setErrors({ form: errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={type ? tx('تعديل نوع الغرفة', 'Edit room type') : tx('نوع غرفة جديد', 'New room type')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="type-form" loading={busy}>{t('save')}</Button></>}>
      <form id="type-form" className="form" onSubmit={submit} noValidate>
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <TextField label={tx('الاسم بالعربية', 'Name in Arabic')} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} error={errors.name_ar} dir="rtl" data-autofocus />
        <TextField label={tx('الاسم بالإنجليزية', 'Name in English')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} error={errors.name_en} dir="ltr" />
      </form>
    </Modal>
  )
}

// Rooms of every branch and the room types services can ask for.
export default function Rooms() {
  const { t, tx, pick } = useI18n()
  const { api, can } = useSettings()
  const toast = useToast()
  const rooms = useAsync(() => api.rooms.list(), [api])
  const catalog = useAsync(() => api.catalog(), [api])
  const [editingRoom, setEditingRoom] = useState(null)
  const [editingType, setEditingType] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const editable = can('settings.rooms')
  const types = catalog.data?.room_types || []
  const saved = () => { setEditingRoom(null); setEditingType(null); toast.success(tx('تم الحفظ.', 'Saved.')); rooms.reload(); catalog.reload() }

  if (rooms.error) return <ErrorState error={rooms.error} onRetry={rooms.reload} />
  const branches = rooms.data?.branches || []

  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('إعداد العيادة', 'Clinic setup')}
        title={tx('الغرف', 'Rooms')}
        description={tx('غرف كل فرع وأنواعها. الحجز سيمنع وضع مريضين في نفس الغرفة في نفس الوقت.', "Each branch's rooms and their types. Booking will stop two patients being put in the same room at the same time.")}
        actions={editable && <Button variant="gold" icon="plus" onClick={() => setEditingRoom('new')}>{tx('غرفة جديدة', 'New room')}</Button>}
      />
      <div className="split">
        <div className="page" style={{ gap: 20 }}>
          {rooms.loading && !rooms.data ? <section className="card"><SkeletonRows rows={5} cols={3} /></section> : branches.map((b) => {
            const list = rooms.data.rooms.filter((r) => r.branch_id === b.id)
            return (
              <section key={b.id} className="card">
                <div className="card-head"><h2>{pick(b)}</h2><Badge tone="neutral" plain>{list.length}</Badge></div>
                {!list.length ? (
                  <EmptyState icon="building" title={tx('لا توجد غرف', 'No rooms yet')}
                    action={editable ? <Button variant="ghost" icon="plus" onClick={() => setEditingRoom('new')}>{tx('أضف غرفة', 'Add a room')}</Button> : null} />
                ) : (
                  <div className="table-wrap">
                    <table className="table stack">
                      <thead><tr><th>{tx('الغرفة', 'Room')}</th><th>{tx('النوع', 'Type')}</th><th>{tx('جداول عليها', 'Schedules')}</th><th /></tr></thead>
                      <tbody>
                        {list.map((r) => (
                          <tr key={r.id} style={r.is_active ? undefined : { opacity: 0.6 }}>
                            <td className="cell-main">
                              <strong style={{ fontWeight: 500 }}>{pick(r)}</strong>
                              {r.notes && <small className="muted" style={{ display: 'block' }}>{r.notes}</small>}
                              {!r.is_active && <Badge tone="neutral">{tx('غير متاحة', 'Not in use')}</Badge>}
                            </td>
                            <td data-label={tx('النوع', 'Type')}>{r.room_type_id ? pick(r, 'type_name') : <span className="muted">—</span>}</td>
                            <td data-label={tx('جداول', 'Schedules')} className="num">{r.schedules}</td>
                            <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
                              {editable && (
                                <>
                                  <Button variant="quiet" size="sm" className="btn-icon" aria-label={t('edit')} onClick={() => setEditingRoom(r)}><Icon name="edit" size={16} /></Button>
                                  <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('حذف', 'Delete')} onClick={() => setDeleting({ kind: 'room', item: r })}><Icon name="x" size={16} /></Button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )
          })}
        </div>
        <section className="card">
          <div className="card-head">
            <h2>{tx('أنواع الغرف', 'Room types')}</h2>
            {editable && <Button variant="quiet" size="sm" icon="plus" onClick={() => setEditingType('new')}>{tx('إضافة', 'Add')}</Button>}
          </div>
          <div className="card-body" style={{ paddingBlock: 4 }}>
            {!types.length ? <p className="muted" style={{ padding: '12px 0' }}>{tx('لا توجد أنواع.', 'No types yet.')}</p> : (
              <ul className="list">
                {types.map((rt) => (
                  <li key={rt.id} className="row-between">
                    <span>
                      {pick(rt)}
                      <small className="muted" style={{ display: 'block' }}>{tx(`${rt.rooms} غرفة · ${rt.services} خدمة`, `${rt.rooms} room(s) · ${rt.services} service(s)`)}</small>
                    </span>
                    {editable && (
                      <span>
                        <Button variant="quiet" size="sm" className="btn-icon" aria-label={t('edit')} onClick={() => setEditingType(rt)}><Icon name="edit" size={15} /></Button>
                        <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('حذف', 'Delete')} onClick={() => setDeleting({ kind: 'type', item: rt })}><Icon name="x" size={15} /></Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {editingRoom && <RoomModal room={editingRoom === 'new' ? null : editingRoom} branches={branches} types={types} onClose={() => setEditingRoom(null)} onSaved={saved} />}
      {editingType && <TypeModal type={editingType === 'new' ? null : editingType} onClose={() => setEditingType(null)} onSaved={saved} />}
      <ConfirmDelete open={Boolean(deleting)} onClose={() => setDeleting(null)}
        title={deleting?.kind === 'room' ? tx('حذف الغرفة', 'Delete room') : tx('حذف نوع الغرفة', 'Delete room type')}
        onConfirm={async () => {
          if (deleting.kind === 'room') await api.rooms.remove(deleting.item.id)
          else await api.roomTypes.remove(deleting.item.id)
          rooms.reload(); catalog.reload()
        }}>
        {deleting && (deleting.kind === 'room'
          ? tx(`حذف «${pick(deleting.item)}»؟ الجداول المرتبطة بها ستبقى بدون غرفة.`, `Delete “${pick(deleting.item)}”? Schedules using it will keep running without a room.`)
          : tx(`حذف «${pick(deleting.item)}»؟ الغرف والخدمات من هذا النوع ستصبح بدون نوع.`, `Delete “${pick(deleting.item)}”? Rooms and services of this type will have no type.`))}
      </ConfirmDelete>
    </div>
  )
}
