import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { Checkbox, SelectField, TextArea } from '../Fields'
import { Avatar, Badge } from '../ui'
import { useToast } from '../Toast'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'
import { RELATIONSHIPS, ageLabel } from './meta'
import PatientPicker from './PatientPicker'
import { useWorkspace } from './useWorkspace'

export default function FamilyCard({ patient, family, onChange }) {
  const { t, tx, lang, pick } = useI18n()
  const { api, patientsBase, can } = useWorkspace()
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [relative, setRelative] = useState(null)
  const [relationship, setRelationship] = useState('parent')
  const [guardian, setGuardian] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const editable = can('patients.edit')

  const reset = () => { setAdding(false); setRelative(null); setRelationship('parent'); setGuardian(false); setError(null) }

  const link = async (event) => {
    event.preventDefault()
    if (!relative) {
      setError(t('field.required'))
      return
    }
    setBusy(true)
    try {
      onChange(await api.linkFamily(patient.id, { relative_id: relative.id, relationship, is_guardian: relationship === 'parent' && guardian }))
      toast.success(tx('تم ربط فرد العائلة.', 'Family member linked.'))
      reset()
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (event) => {
    event.preventDefault()
    if (reason.trim().length < 3) {
      setError(t('field.required'))
      return
    }
    setBusy(true)
    try {
      onChange(await api.unlinkFamily(patient.id, removing.link_id, reason.trim()))
      toast.success(tx('أُزيل الربط.', 'Link removed.'))
      setRemoving(null)
      setReason('')
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{tx('العائلة', 'Family')}</h2>
        {editable && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {can('patients.create') && patient.age >= 16 && (
              <Link to={`${patientsBase}/new?guardian=${patient.id}`} className="btn btn-quiet btn-sm">
                <Icon name="userPlus" size={16} />{tx('تسجيل طفل', 'Register a child')}
              </Link>
            )}
            <Button variant="quiet" size="sm" icon="plus" onClick={() => setAdding(true)}>{tx('ربط قريب', 'Link relative')}</Button>
          </div>
        )}
      </div>
      <div className="card-body" style={{ paddingBlock: 6 }}>
        {!family.length ? (
          <p className="muted" style={{ padding: '12px 0', fontSize: '.9rem' }}>{tx('لا يوجد أفراد عائلة مرتبطون.', 'No family members linked.')}</p>
        ) : (
          <ul className="list">
            {family.map((f) => (
              <li key={f.link_id} className="relative">
                <div className="person">
                  <Avatar name={pick(f, 'full_name')} />
                  <div style={{ minWidth: 0 }}>
                    <Link to={`${patientsBase}/${f.id}`} className="person-name">{pick(f, 'full_name')}</Link>
                    <small>{RELATIONSHIPS[f.relationship][lang]} · {ageLabel(f.date_of_birth, tx)} · <span className="mrn">{f.mrn}</span></small>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      {f.manages_this_patient && <Badge tone="gold">{tx('ولي الأمر', 'Guardian')}</Badge>}
                      {f.managed_by_this_patient && <Badge tone="info">{tx('تحت ولايته', 'In their care')}</Badge>}
                    </div>
                  </div>
                </div>
                {editable && (
                  <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('إزالة الربط', 'Remove link')}
                    onClick={() => { setError(null); setRemoving(f) }}>
                    <Icon name="x" size={16} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={adding} onClose={reset} busy={busy} title={tx('ربط فرد من العائلة', 'Link a family member')}
        description={tx('اختر ملفًا موجودًا. لتسجيل طفل جديد استخدم «تسجيل طفل».', 'Pick an existing file. To register a new child use “Register a child”.')}
        footer={<><Button variant="ghost" onClick={reset} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="family-form" loading={busy}>{tx('ربط', 'Link')}</Button></>}>
        <form id="family-form" className="form" onSubmit={link} noValidate>
          {relative ? (
            <div className="picked">
              <Avatar name={pick(relative, 'full_name')} />
              <span style={{ flex: 1 }}>{pick(relative, 'full_name')} <small className="muted mrn">{relative.mrn}</small></span>
              <Button variant="quiet" size="sm" onClick={() => setRelative(null)}>{tx('تغيير', 'Change')}</Button>
            </div>
          ) : (
            <PatientPicker api={api} label={tx('القريب', 'Relative')} onSelect={setRelative} excludeId={patient.id} error={error && !relative ? error : null} />
          )}
          <SelectField label={tx(`صلته بـ ${pick(patient, 'full_name')}`, `Who they are to ${pick(patient, 'full_name')}`)} value={relationship}
            onChange={(e) => setRelationship(e.target.value)} options={Object.entries(RELATIONSHIPS).map(([k, v]) => ({ value: k, label: v[lang] }))} />
          {relationship === 'parent' && (
            <Checkbox checked={guardian} onChange={(e) => setGuardian(e.target.checked)}
              label={tx('ولي الأمر: يدير هذا الملف ويراه من حسابه', 'Guardian: manages this file and sees it from their account')} />
          )}
          {error && relative && <p className="field-error" role="alert"><Icon name="alert" size={14} />{error}</p>}
        </form>
      </Modal>

      <Modal open={Boolean(removing)} onClose={() => setRemoving(null)} busy={busy} title={tx('إزالة ربط العائلة', 'Remove family link')}
        description={removing ? pick(removing, 'full_name') : ''}
        footer={<><Button variant="ghost" onClick={() => setRemoving(null)} disabled={busy}>{t('cancel')}</Button><Button variant="danger" type="submit" form="unlink-form" loading={busy}>{tx('إزالة', 'Remove')}</Button></>}>
        <form id="unlink-form" onSubmit={unlink} noValidate>
          <TextArea label={tx('السبب', 'Reason')} value={reason} onChange={(e) => setReason(e.target.value)} error={error} data-autofocus />
        </form>
      </Modal>
    </section>
  )
}
