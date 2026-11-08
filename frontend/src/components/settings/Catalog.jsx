import { useEffect, useState } from 'react'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { Checkbox, SelectField, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtDate } from '../../lib/format'
import PricesModal from './PricesModal'
import { ColorField, ConfirmDelete, fmtMoney, isoDate, useSettings } from './shared'
import { CONDITIONS, RESULTS } from '../clinical/meta'

const DURATIONS = [15, 20, 30, 45, 60, 90]

function SpecialtyModal({ specialty, onClose, onSaved }) {
  const { t, tx } = useI18n()
  const { api } = useSettings()
  const [form, setForm] = useState(specialty || { name_ar: '', name_en: '', color: '#1A6B5A', sort_order: 0, is_active: true })
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
      const body = { name_ar: form.name_ar, name_en: form.name_en, color: form.color, sort_order: Number(form.sort_order) || 0, is_active: form.is_active }
      specialty ? await api.specialties.edit(specialty.id, body) : await api.specialties.add(body)
      onSaved()
    } catch (err) {
      setErrors({ ...fieldErrors(err, t), form: errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={specialty ? tx('تعديل التخصص', 'Edit specialty') : tx('تخصص جديد', 'New specialty')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="spec-form" loading={busy}>{t('save')}</Button></>}>
      <form id="spec-form" className="form" onSubmit={submit} noValidate>
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <div className="form-grid">
          <TextField label={tx('الاسم بالعربية', 'Name in Arabic')} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} error={errors.name_ar} dir="rtl" data-autofocus />
          <TextField label={tx('الاسم بالإنجليزية', 'Name in English')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} error={errors.name_en} dir="ltr" />
        </div>
        <ColorField label={tx('اللون في الجداول', 'Colour in schedules')} value={form.color} onChange={(color) => setForm({ ...form, color })} />
        <Checkbox checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} label={tx('نشط', 'Active')}
          description={tx('خدمات التخصص غير النشط لا تظهر للحجز.', "An inactive specialty's services can't be booked.")} />
      </form>
    </Modal>
  )
}

function ServiceModal({ service, catalog, defaultSpecialty, onClose, onSaved }) {
  const { t, tx, lang, pick } = useI18n()
  const { api, can } = useSettings()
  const [form, setForm] = useState(service
    ? { ...service, room_type_id: service.room_type_id ?? '', vat_rate: String(Number(service.vat_rate ?? 0)), direct_cost: String(Number(service.direct_cost ?? 0)) }
    : { specialty_id: defaultSpecialty || catalog.specialties[0]?.id || '', code: '', name_ar: '', name_en: '', duration_min: 30, room_type_id: '', is_active: true, sort_order: 0, price: '', price_from: isoDate(new Date()), vat_rate: '0', direct_cost: '0' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (!form.specialty_id) e.specialty_id = t('field.required')
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]{1,19}$/.test(form.code.trim())) e.code = tx('حروف إنجليزية وأرقام وشرطة، مثل DRM-CONS', 'Letters, digits and dashes, e.g. DRM-CONS')
    if (form.name_ar.trim().length < 2) e.name_ar = t('field.required')
    if (form.name_en.trim().length < 2) e.name_en = t('field.required')
    if (!(Number(form.duration_min) >= 5 && Number(form.duration_min) <= 480)) e.duration_min = tx('من ٥ إلى ٤٨٠ دقيقة', '5 to 480 minutes')
    if (can('settings.prices')) {
      if (form.vat_rate === '' || !(Number(form.vat_rate) >= 0 && Number(form.vat_rate) <= 30)) e.vat_rate = tx('من ٠ إلى ٣٠٪', '0 to 30%')
      if (form.direct_cost === '' || !(Number(form.direct_cost) >= 0)) e.direct_cost = t('field.invalid')
    }
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const body = {
        specialty_id: Number(form.specialty_id), code: form.code, name_ar: form.name_ar, name_en: form.name_en,
        duration_min: Number(form.duration_min), room_type_id: form.room_type_id ? Number(form.room_type_id) : null,
        is_active: form.is_active, sort_order: Number(form.sort_order) || 0,
        clinical_record: form.clinical_record || null, dental_result: form.clinical_record === 'dental' ? form.dental_result || null : null,
        price: !service && form.price !== '' && can('settings.prices') ? { amount: Number(form.price), starts_on: form.price_from } : null,
        ...(can('settings.prices') ? { vat_rate: Number(form.vat_rate), direct_cost: Number(form.direct_cost) } : {}),
      }
      service ? await api.services.edit(service.id, body) : await api.services.add(body)
      onSaved()
    } catch (err) {
      const fields = fieldErrors(err, t)
      if (err.fields?.code === 'taken') fields.code = tx('هذا الرمز مستخدم لخدمة أخرى.', 'This code is used by another service.')
      setErrors({ ...fields, form: Object.keys(fields).length ? null : errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open wide onClose={onClose} busy={busy} title={service ? tx('تعديل الخدمة', 'Edit service') : tx('خدمة جديدة', 'New service')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="service-form" loading={busy}>{t('save')}</Button></>}>
      <form id="service-form" className="form" onSubmit={submit} noValidate>
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <div className="form-grid">
          <SelectField label={tx('التخصص', 'Specialty')} value={form.specialty_id} onChange={set('specialty_id')} error={errors.specialty_id}
            options={catalog.specialties.map((s) => ({ value: s.id, label: pick(s) }))} placeholder={tx('اختر…', 'Choose…')} />
          <TextField label={tx('الرمز', 'Code')} value={form.code} onChange={set('code')} error={errors.code} dir="ltr" maxLength={20}
            hint={tx('قصير ويظهر في الفواتير والتقارير', 'Short; shown on invoices and reports')} style={{ textTransform: 'uppercase' }} />
          <TextField label={tx('الاسم بالعربية', 'Name in Arabic')} value={form.name_ar} onChange={set('name_ar')} error={errors.name_ar} dir="rtl" data-autofocus />
          <TextField label={tx('الاسم بالإنجليزية', 'Name in English')} value={form.name_en} onChange={set('name_en')} error={errors.name_en} dir="ltr" />
          <div className="field">
            <TextField label={tx('المدة (دقيقة)', 'Duration (minutes)')} type="number" min="5" max="480" step="5" value={form.duration_min}
              onChange={set('duration_min')} error={errors.duration_min} dir="ltr" />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DURATIONS.map((m) => (
                <button key={m} type="button" className={`chip ${Number(form.duration_min) === m ? 'chip-on' : ''}`} onClick={() => setForm({ ...form, duration_min: m })}>{m}</button>
              ))}
            </div>
          </div>
          <SelectField label={tx('نوع الغرفة المطلوبة', 'Room type needed')} value={form.room_type_id} onChange={set('room_type_id')}
            options={catalog.room_types.map((r) => ({ value: r.id, label: pick(r) }))} placeholder={tx('أي غرفة', 'Any room')} />
          <SelectField label={tx('سجل طبي خاص', 'Clinical record')} value={form.clinical_record || ''} onChange={set('clinical_record')}
            placeholder={tx('زيارة عادية فقط', 'Visit note only')}
            options={[{ value: 'laser', label: tx('جلسة ليزر', 'Laser session') }, { value: 'dental', label: tx('أسنان (خريطة وخطة علاج)', 'Dental (chart & plan)') }]}
            hint={tx('يحدد السجل الذي يفتحه الطبيب لهذه الخدمة.', 'Decides which record the doctor opens for this service.')} />
          {form.clinical_record === 'dental' && (
            <SelectField label={tx('يظهر على خريطة الأسنان بعد التنفيذ', 'Shown on the tooth chart when done')} value={form.dental_result || ''} onChange={set('dental_result')}
              placeholder={tx('لا شيء', 'Nothing')} options={RESULTS.map((r) => ({ value: r, label: CONDITIONS[r][lang] }))} />
          )}
        </div>
        {!service && can('settings.prices') && (
          <div className="form-grid">
            <TextField label={tx('السعر الأساسي (جنيه)', 'Standard price (EGP)')} optional type="number" min="0" step="0.01" dir="ltr" value={form.price} onChange={set('price')} />
            <TextField label={tx('يبدأ من', 'Starts on')} type="date" value={form.price_from} onChange={set('price_from')} />
          </div>
        )}
        {can('settings.prices') && (
          <div className="form-grid">
            <TextField label={tx('ضريبة القيمة المضافة (٪)', 'VAT (%)')} type="number" min="0" max="30" step="0.01" dir="ltr" value={form.vat_rate} onChange={set('vat_rate')}
              error={errors.vat_rate} hint={tx('٠ للخدمات الطبية المعفاة.', '0 for exempt medical services.')} />
            <TextField label={tx('التكلفة المباشرة (جنيه)', 'Direct cost (EGP)')} type="number" min="0" step="0.01" dir="ltr" value={form.direct_cost} onChange={set('direct_cost')}
              error={errors.direct_cost} hint={tx('مواد مستهلكة لكل جلسة؛ تُخصم قبل حصة الطبيب إن طُلب.', 'Consumables per session; taken off before the doctor share when set.')} />
          </div>
        )}
        <Checkbox checked={form.is_active} onChange={set('is_active')} label={tx('متاحة للحجز', 'Available for booking')}
          description={tx('أوقفها بدلًا من الحذف إذا كانت مستخدمة.', "Turn it off instead of deleting it once it's been used.")} />
      </form>
    </Modal>
  )
}

// Specialties, services and their prices. Everything can be added, edited and deleted.
export default function Catalog() {
  const { t, tx, pick, locale } = useI18n()
  const { api, can } = useSettings()
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.catalog(), [api])
  const doctors = useAsync(() => api.doctors(), [api])
  const [specialty, setSpecialty] = useState('')
  const [q, setQ] = useState('')
  const [editingSpec, setEditingSpec] = useState(null)
  const [editingService, setEditingService] = useState(null)
  const [pricing, setPricing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const canServices = can('settings.services')

  useEffect(() => { if (specialty && data && !data.specialties.some((s) => s.id === specialty)) setSpecialty('') }, [data, specialty])
  if (error) return <ErrorState error={error} onRetry={reload} />

  const specById = Object.fromEntries((data?.specialties || []).map((s) => [s.id, s]))
  const typeById = Object.fromEntries((data?.room_types || []).map((r) => [r.id, r]))
  const term = q.trim().toLowerCase()
  const services = (data?.services || []).filter((s) => (!specialty || s.specialty_id === specialty) &&
    (!term || s.name_ar.includes(q.trim()) || s.name_en.toLowerCase().includes(term) || s.code.toLowerCase().includes(term)))
  const saved = (message) => () => { setEditingSpec(null); setEditingService(null); toast.success(message || tx('تم الحفظ.', 'Saved.')); reload() }

  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('إعداد العيادة', 'Clinic setup')}
        title={can('settings.prices') || !can('settings.services') ? tx('الخدمات والأسعار', 'Services & prices') : tx('التخصصات والخدمات', 'Specialties & services')}
        description={tx('كل ما هنا قابل للتعديل والحذف حتى تستقر قائمة العيادة. البيانات الحالية للعرض فقط.',
          "Everything here can be edited and deleted until the clinic's list is settled. The current data is a demo.")}
        actions={canServices && <Button variant="gold" icon="plus" onClick={() => setEditingService('new')} disabled={!data?.specialties.length}>{tx('خدمة جديدة', 'New service')}</Button>}
      />

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 2.4fr) minmax(0, 1fr)' }}>
        <section className="card">
          <div className="toolbar">
            <div className="search">
              <label className="sr-only" htmlFor="svc-q">{t('search')}</label>
              <div className="input-wrap">
                <span className="input-start"><Icon name="search" size={18} /></span>
                <input id="svc-q" className="input has-start" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('ابحث باسم الخدمة أو الرمز…', 'Search service name or code…')} />
              </div>
            </div>
            {specialty && <Button variant="quiet" size="sm" icon="x" onClick={() => setSpecialty('')}>{pick(specById[specialty])}</Button>}
          </div>
          {loading && !data ? <SkeletonRows rows={8} cols={5} /> : !services.length ? (
            <EmptyState icon="clipboard" title={tx('لا توجد خدمات هنا', 'No services here')}
              action={canServices && data.specialties.length ? <Button variant="ghost" icon="plus" onClick={() => setEditingService('new')}>{tx('أضف خدمة', 'Add a service')}</Button> : null}>
              {!data.specialties.length ? tx('أضف تخصصًا أولًا من القائمة الجانبية.', 'Add a specialty first from the side panel.') : null}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table stack">
                <thead>
                  <tr>
                    <th>{tx('الخدمة', 'Service')}</th>
                    <th>{tx('المدة', 'Duration')}</th>
                    <th>{tx('السعر الحالي', 'Current price')}</th>
                    <th><span className="sr-only">{t('actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((s) => {
                    const sp = specById[s.specialty_id]
                    return (
                      <tr key={s.id} style={s.is_active ? undefined : { opacity: 0.6 }}>
                        <td className="cell-main">
                          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <span className="dot-color" style={{ background: sp?.color }} aria-hidden="true" />
                            <div>
                              <strong style={{ fontWeight: 500 }}>{pick(s)}</strong>
                              <small className="muted" style={{ display: 'block' }}>
                                <span className="mono">{s.code}</span> · {pick(sp)}{s.room_type_id ? ` · ${pick(typeById[s.room_type_id])}` : ''}
                              </small>
                              {!s.is_active && <Badge tone="neutral">{tx('موقوفة', 'Off')}</Badge>}
                            </div>
                          </div>
                        </td>
                        <td data-label={tx('المدة', 'Duration')} className="num" style={{ whiteSpace: 'nowrap' }}>{tx(`${s.duration_min} دقيقة`, `${s.duration_min} min`)}</td>
                        <td data-label={tx('السعر', 'Price')} style={{ whiteSpace: 'nowrap' }}>
                          <strong className="num" style={{ fontWeight: 600 }}>{fmtMoney(s.current_price, locale)}</strong>
                          {s.next_price !== null && (
                            <small className="muted" style={{ display: 'block' }}>→ {fmtMoney(s.next_price, locale)} {tx('من', 'from')} {fmtDate(s.next_from, locale)}</small>
                          )}
                          {s.doctor_prices > 0 && <small className="muted" style={{ display: 'block' }}>{tx(`+ أسعار لـ ${s.doctor_prices} طبيب`, `+ ${s.doctor_prices} doctor price(s)`)}</small>}
                        </td>
                        <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
                          <Button variant="ghost" size="sm" onClick={() => setPricing(s)}>{tx('الأسعار', 'Prices')}</Button>
                          {canServices && (
                            <>
                              <Button variant="quiet" size="sm" className="btn-icon" aria-label={t('edit')} onClick={() => setEditingService(s)}><Icon name="edit" size={16} /></Button>
                              <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('حذف', 'Delete')} onClick={() => setDeleting({ kind: 'service', item: s })}><Icon name="x" size={16} /></Button>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="card">
          <div className="card-head">
            <h2>{tx('التخصصات', 'Specialties')}</h2>
            {canServices && <Button variant="quiet" size="sm" icon="plus" onClick={() => setEditingSpec('new')}>{tx('إضافة', 'Add')}</Button>}
          </div>
          <ul className="spec-list">
            <li>
              <button type="button" className="spec-item" aria-pressed={!specialty} onClick={() => setSpecialty('')}>
                <span className="dot-color" style={{ background: 'var(--ink-300)' }} />
                <span style={{ flex: 1 }}>{tx('كل الخدمات', 'All services')}</span>
                <span className="muted num">{data?.services.length ?? ''}</span>
              </button>
            </li>
            {(data?.specialties || []).map((s) => (
              <li key={s.id} className="spec-row">
                <button type="button" className="spec-item" aria-pressed={specialty === s.id} onClick={() => setSpecialty(s.id)}>
                  <span className="dot-color" style={{ background: s.color }} />
                  <span style={{ flex: 1 }}>{pick(s)}{!s.is_active && <small className="muted"> · {tx('موقوف', 'off')}</small>}</span>
                  <span className="muted num">{s.services}</span>
                </button>
                {canServices && (
                  <span className="spec-actions">
                    <Button variant="quiet" size="sm" className="btn-icon" aria-label={t('edit')} onClick={() => setEditingSpec(s)}><Icon name="edit" size={15} /></Button>
                    <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('حذف', 'Delete')} onClick={() => setDeleting({ kind: 'specialty', item: s })}><Icon name="x" size={15} /></Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {editingSpec && <SpecialtyModal specialty={editingSpec === 'new' ? null : editingSpec} onClose={() => setEditingSpec(null)} onSaved={saved()} />}
      {editingService && data && (
        <ServiceModal service={editingService === 'new' ? null : editingService} catalog={data} defaultSpecialty={specialty}
          onClose={() => setEditingService(null)} onSaved={saved()} />
      )}
      {pricing && <PricesModal service={pricing} doctors={doctors.data || []} onClose={() => setPricing(null)} onChanged={reload} />}
      <ConfirmDelete open={Boolean(deleting)} onClose={() => setDeleting(null)}
        title={deleting?.kind === 'specialty' ? tx('حذف التخصص', 'Delete specialty') : tx('حذف الخدمة', 'Delete service')}
        onConfirm={async () => {
          if (deleting.kind === 'specialty') await api.specialties.remove(deleting.item.id)
          else await api.services.remove(deleting.item.id)
          reload()
        }}>
        {deleting && (deleting.kind === 'specialty'
          ? tx(`حذف «${pick(deleting.item)}»؟ يجب حذف خدماته أو نقلها أولًا.`, `Delete “${pick(deleting.item)}”? Its services must be deleted or moved first.`)
          : tx(`حذف «${pick(deleting.item)}» وكل أسعارها؟`, `Delete “${pick(deleting.item)}” and all its prices?`))}
      </ConfirmDelete>
    </div>
  )
}
