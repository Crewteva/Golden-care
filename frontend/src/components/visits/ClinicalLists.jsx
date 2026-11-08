import { useState } from 'react'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { Checkbox, SelectField, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync, useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { ConfirmDelete, useSettings } from '../settings/shared'
import { FORMS, useVisits } from './meta'
import { DevicesTab, LabsTab } from '../clinical/DevicesLabs'

const NEW_DRUG = { name: '', generic_name: '', form: 'tablet', strength: '', default_dose: '', default_frequency: '', default_duration: '', restricted: false, allergy_tags: '', is_active: true }

function DrugModal({ drug, onClose, onSaved }) {
  const { t, tx, lang } = useI18n()
  const { api } = useVisits()
  const toast = useToast()
  const [form, setForm] = useState(drug ? { ...NEW_DRUG, ...drug, allergy_tags: (drug.allergy_tags || []).join(', '),
    strength: drug.strength || '', default_dose: drug.default_dose || '', default_frequency: drug.default_frequency || '', default_duration: drug.default_duration || '' } : NEW_DRUG)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (form.name.trim().length < 2) e.name = t('field.required')
    if (form.generic_name.trim().length < 2) e.generic_name = t('field.required')
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    setFormError(null)
    try {
      await api.saveDrug(drug?.id, { ...form, allergy_tags: form.allergy_tags.split(/[,،]/).map((s) => s.trim()).filter(Boolean) })
      toast.success(tx('تم حفظ الدواء.', 'Drug saved.'))
      onSaved()
      onClose()
    } catch (err) {
      setErrors(fieldErrors(err, t))
      setFormError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open wide onClose={onClose} busy={busy} title={drug ? tx('تعديل دواء', 'Edit drug') : tx('إضافة دواء', 'Add drug')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="drug-form" loading={busy}>{t('save')}</Button></>}>
      <form id="drug-form" className="form" onSubmit={submit} noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="form-grid">
          <TextField label={tx('الاسم التجاري', 'Brand name')} value={form.name} onChange={set('name')} error={errors.name} dir="ltr" placeholder="Augmentin 1 g" data-autofocus />
          <TextField label={tx('المادة الفعالة', 'Active ingredient')} value={form.generic_name} onChange={set('generic_name')} error={errors.generic_name} dir="ltr" placeholder="amoxicillin + clavulanic acid" />
          <SelectField label={tx('الشكل', 'Form')} value={form.form} onChange={set('form')} options={Object.entries(FORMS).map(([value, l]) => ({ value, label: l[lang] }))} />
          <TextField label={tx('التركيز', 'Strength')} optional value={form.strength} onChange={set('strength')} dir="ltr" placeholder="1 g" />
          <TextField label={tx('الجرعة المعتادة', 'Usual dose')} optional value={form.default_dose} onChange={set('default_dose')} placeholder="1 tablet" />
          <TextField label={tx('كم مرة', 'How often')} optional value={form.default_frequency} onChange={set('default_frequency')} placeholder="every 12 hours" />
          <TextField label={tx('المدة المعتادة', 'Usual duration')} optional value={form.default_duration} onChange={set('default_duration')} placeholder="7 days" />
          <TextField label={tx('كلمات الحساسية', 'Allergy words')} optional value={form.allergy_tags} onChange={set('allergy_tags')} dir="ltr" placeholder="penicillin, amoxicillin"
            hint={tx('يُحذَّر الطبيب إذا وُجدت إحدى هذه الكلمات في حساسية المريض.', "The doctor is warned when one of these words is in the patient's allergies.")} />
        </div>
        <Checkbox checked={form.restricted} onChange={set('restricted')} label={tx('دواء مقيّد', 'Restricted medicine')}
          description={tx('يحتاج صلاحية "وصف الأدوية المقيّدة" وسببًا مكتوبًا يُسجَّل في سجل النشاط.', 'Needs the “Prescribe restricted medicines” permission and a written reason, recorded in the activity log.')} />
        <Checkbox checked={form.is_active} onChange={set('is_active')} label={tx('متاح للوصف', 'Available to prescribe')} />
      </form>
    </Modal>
  )
}

function DiagnosisModal({ item, specialties, onClose, onSaved }) {
  const { t, tx, pick } = useI18n()
  const { api } = useVisits()
  const toast = useToast()
  const [form, setForm] = useState(item ? { ...item, specialty_id: item.specialty_id ? String(item.specialty_id) : '', code: item.code || '' }
    : { specialty_id: '', code: '', name_ar: '', name_en: '', is_active: true, sort_order: 0 })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (form.name_ar.trim().length < 2) e.name_ar = t('field.required')
    if (form.name_en.trim().length < 2) e.name_en = t('field.required')
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    setFormError(null)
    try {
      await api.saveDiagnosis(item?.id, { ...form, specialty_id: form.specialty_id ? Number(form.specialty_id) : null, sort_order: Number(form.sort_order) || 0 })
      toast.success(tx('تم حفظ التشخيص.', 'Diagnosis saved.'))
      onSaved()
      onClose()
    } catch (err) {
      setErrors(fieldErrors(err, t))
      setFormError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={item ? tx('تعديل تشخيص', 'Edit diagnosis') : tx('إضافة تشخيص', 'Add diagnosis')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="dx-form" loading={busy}>{t('save')}</Button></>}>
      <form id="dx-form" className="form" onSubmit={submit} noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextField label={tx('الاسم بالعربية', 'Arabic name')} value={form.name_ar} onChange={set('name_ar')} error={errors.name_ar} data-autofocus />
        <TextField label={tx('الاسم بالإنجليزية', 'English name')} value={form.name_en} onChange={set('name_en')} error={errors.name_en} dir="ltr" />
        <div className="form-grid">
          <TextField label={tx('كود ICD-10', 'ICD-10 code')} optional value={form.code} onChange={set('code')} dir="ltr" placeholder="L70.0" />
          <SelectField label={tx('التخصص', 'Specialty')} value={form.specialty_id} onChange={set('specialty_id')} placeholder={tx('عام (كل التخصصات)', 'General (all specialties)')}
            options={specialties.map((s) => ({ value: String(s.id), label: pick(s) }))} />
        </div>
        <Checkbox checked={form.is_active} onChange={set('is_active')} label={tx('يظهر للأطباء', 'Shown to doctors')} />
      </form>
    </Modal>
  )
}

// Medical director: the drug list and the diagnosis list doctors pick from.
export default function ClinicalLists() {
  const { tx, lang, pick } = useI18n()
  const { api, can } = useVisits()
  const { api: sApi } = useSettings()
  const [tab, setTab] = useState('drugs')
  const [q, setQ] = useState('')
  const term = useDebounced(q, 250)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const catalog = useAsync(() => sApi.catalog(), [sApi])
  const drugs = useAsync(() => (tab === 'drugs' ? api.drugs({ q: term, all: true }) : Promise.resolve(null)), [tab, term, api])
  const dx = useAsync(() => (tab === 'dx' ? api.diagnoses({ q: term, all: true }) : Promise.resolve(null)), [tab, term, api])
  const manage = can('clinical_lists.manage')
  const current = tab === 'drugs' ? drugs : dx
  const specialties = catalog.data?.specialties || []

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('العمل الطبي', 'Clinical work')} title={tx('القوائم الطبية', 'Clinical lists')}
        description={tx('الأدوية والتشخيصات التي يختار منها الأطباء، وأجهزة الليزر ومعامل الأسنان. القوائم الحالية مبدئية للتجربة؛ عدّلها حسب العيادة.',
          'The drugs and diagnoses doctors pick from, the laser devices and the dental labs. The current lists are a starter set for the demo; adjust them to the clinic.')}
        actions={manage && ['drugs', 'dx'].includes(tab) && <Button icon="plus" onClick={() => setEditing({})}>{tab === 'drugs' ? tx('إضافة دواء', 'Add drug') : tx('إضافة تشخيص', 'Add diagnosis')}</Button>} />
      <section className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'drugs'} onClick={() => setTab('drugs')}><Icon name="pill" size={16} /> {tx('الأدوية', 'Drugs')}</button>
            <button type="button" role="tab" aria-selected={tab === 'dx'} onClick={() => setTab('dx')}><Icon name="clipboard" size={16} /> {tx('التشخيصات', 'Diagnoses')}</button>
            <button type="button" role="tab" aria-selected={tab === 'devices'} onClick={() => setTab('devices')}><Icon name="activity" size={16} /> {tx('أجهزة الليزر', 'Laser devices')}</button>
            <button type="button" role="tab" aria-selected={tab === 'labs'} onClick={() => setTab('labs')}><Icon name="package" size={16} /> {tx('معامل الأسنان', 'Dental labs')}</button>
          </div>
          {['drugs', 'dx'].includes(tab) && (
            <div className="input-wrap" style={{ minWidth: 240 }}>
              <span className="input-start"><Icon name="search" size={18} /></span>
              <input className="input has-start" value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx('بحث', 'Search')} placeholder={tx('بحث…', 'Search…')} />
            </div>
          )}
        </div>
        {tab === 'devices' ? <DevicesTab /> : tab === 'labs' ? <LabsTab /> : current.error ? <ErrorState error={current.error} onRetry={current.reload} /> : !current.data ? <SkeletonRows rows={8} cols={4} /> : !current.data.length ? (
          <EmptyState icon="search" title={tx('لا نتائج', 'No results')} />
        ) : tab === 'drugs' ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tx('الدواء', 'Drug')}</th><th>{tx('الشكل', 'Form')}</th><th>{tx('الجرعة المعتادة', 'Usual dose')}</th><th>{tx('كلمات الحساسية', 'Allergy words')}</th>{manage && <th><span className="sr-only">{tx('إجراءات', 'Actions')}</span></th>}</tr></thead>
              <tbody>
                {current.data.map((d) => (
                  <tr key={d.id} style={d.is_active ? undefined : { opacity: 0.55 }}>
                    <td dir="ltr" style={{ textAlign: 'start' }}><strong>{d.name}</strong> {d.restricted && <Badge tone="gold">{tx('مقيّد', 'Restricted')}</Badge>}{!d.is_active && <Badge tone="neutral">{tx('موقوف', 'Off')}</Badge>}<small className="muted" style={{ display: 'block' }}>{d.generic_name}</small></td>
                    <td>{FORMS[d.form]?.[lang]}{d.strength && <small className="muted" style={{ display: 'block' }} dir="ltr">{d.strength}</small>}</td>
                    <td dir="ltr" style={{ textAlign: 'start' }}><small>{[d.default_dose, d.default_frequency, d.default_duration].filter(Boolean).join(' · ') || '—'}</small></td>
                    <td><small className="muted" dir="ltr">{d.allergy_tags.join(', ') || '—'}</small></td>
                    {manage && <td className="actions"><Button size="sm" variant="quiet" icon="edit" onClick={() => setEditing(d)}>{tx('تعديل', 'Edit')}</Button><Button size="sm" variant="quiet" icon="x" onClick={() => setDeleting(d)} aria-label={tx('حذف', 'Delete')} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tx('التشخيص', 'Diagnosis')}</th><th>ICD-10</th><th>{tx('التخصص', 'Specialty')}</th>{manage && <th><span className="sr-only">{tx('إجراءات', 'Actions')}</span></th>}</tr></thead>
              <tbody>
                {current.data.map((d) => (
                  <tr key={d.id} style={d.is_active ? undefined : { opacity: 0.55 }}>
                    <td><strong>{pick(d)}</strong>{!d.is_active && <> <Badge tone="neutral">{tx('موقوف', 'Off')}</Badge></>}<small className="muted" style={{ display: 'block' }}>{lang === 'ar' ? d.name_en : d.name_ar}</small></td>
                    <td className="mono">{d.code || '—'}</td>
                    <td>{d.specialty_name_en ? pick(d, 'specialty_name') : <span className="muted">{tx('عام', 'General')}</span>}</td>
                    {manage && <td className="actions"><Button size="sm" variant="quiet" icon="edit" onClick={() => setEditing(d)}>{tx('تعديل', 'Edit')}</Button><Button size="sm" variant="quiet" icon="x" onClick={() => setDeleting(d)} aria-label={tx('حذف', 'Delete')} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && tab === 'drugs' && <DrugModal drug={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={drugs.reload} />}
      {editing && tab === 'dx' && <DiagnosisModal item={editing.id ? editing : null} specialties={specialties} onClose={() => setEditing(null)} onSaved={dx.reload} />}
      <ConfirmDelete open={Boolean(deleting)} title={tab === 'drugs' ? tx('حذف الدواء؟', 'Delete drug?') : tx('حذف التشخيص؟', 'Delete diagnosis?')}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { if (tab === 'drugs') { await api.deleteDrug(deleting.id); drugs.reload() } else { await api.deleteDiagnosis(deleting.id); dx.reload() } }}>
        {deleting && (deleting.name || pick(deleting))} — {tx('إذا كان مستخدمًا في زيارات سابقة فلن يُحذف؛ أوقفه بدلًا من ذلك.', "If it's used in past visits it can't be deleted; switch it off instead.")}
      </ConfirmDelete>
    </div>
  )
}
