import { useState } from 'react'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { ChoiceGroup, SelectField, TextArea } from '../Fields'
import { useToast } from '../Toast'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'
import { ALERT_KINDS, SEVERITY } from './meta'
import { useWorkspace } from './useWorkspace'

// Medical alerts at the top of the file: allergies, chronic conditions, pregnancy, implants...
export default function AlertsStrip({ patientId, alerts, onChange }) {
  const { t, tx, lang, pick, locale } = useI18n()
  const { api, can } = useWorkspace()
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [form, setForm] = useState({ kind: 'allergy', severity: 'warning', description: '' })
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const editable = can('patients.alerts')
  const critical = alerts.some((a) => a.severity === 'critical')

  const add = async (event) => {
    event.preventDefault()
    if (form.description.trim().length < 2) {
      setErrors({ description: t('field.required') })
      return
    }
    setBusy(true)
    try {
      onChange(await api.addAlert(patientId, { ...form, description: form.description.trim() }))
      setAdding(false)
      setForm({ kind: 'allergy', severity: 'warning', description: '' })
      toast.success(tx('أُضيف التنبيه.', 'Alert added.'))
    } catch (err) {
      setErrors(fieldErrors(err, t))
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (event) => {
    event.preventDefault()
    if (reason.trim().length < 3) {
      setErrors({ reason: t('field.required') })
      return
    }
    setBusy(true)
    try {
      onChange(await api.removeAlert(patientId, removing.id, reason.trim()))
      setRemoving(null)
      setReason('')
      toast.success(tx('أُزيل التنبيه وحُفظ السبب.', 'Alert removed; the reason was kept.'))
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`alerts-strip ${critical ? 'has-critical' : ''}`} aria-label={tx('التنبيهات الطبية', 'Medical alerts')}>
      <div className="head">
        <h2>
          <Icon name="alert" size={18} style={{ color: critical ? 'var(--danger)' : 'var(--gold-600)' }} />
          {tx('التنبيهات الطبية', 'Medical alerts')}
        </h2>
        {editable && (
          <Button variant="ghost" size="sm" icon="plus" onClick={() => { setErrors({}); setAdding(true) }}>
            {tx('إضافة تنبيه', 'Add alert')}
          </Button>
        )}
      </div>
      {!alerts.length ? (
        <p className="muted" style={{ fontSize: '.88rem' }}>
          {tx('لا توجد تنبيهات مسجّلة. هذا لا يعني عدم وجود حساسية؛ اسأل المريض دائمًا.', 'No alerts recorded. This does not mean there are no allergies — always ask the patient.')}
        </p>
      ) : (
        <ul className="alert-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {alerts.map((a) => (
            <li key={a.id} className={`alert-chip ${a.severity}`} title={`${pick(a, 'by')} · ${fmtDateTime(a.created_at, locale)}`}>
              <Icon name={ALERT_KINDS[a.kind].icon} size={16} />
              <span><b>{ALERT_KINDS[a.kind][lang]}:</b> {a.description}</span>
              {editable && (
                <button type="button" onClick={() => { setErrors({}); setRemoving(a) }} aria-label={tx('إزالة التنبيه', 'Remove alert')}>
                  <Icon name="x" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} busy={busy} title={tx('إضافة تنبيه طبي', 'Add a medical alert')}
        description={tx('يظهر لكل من يفتح الملف. اكتب بوضوح ما يجب الانتباه له.', 'Shown to everyone who opens the file. Say clearly what to watch for.')}
        footer={<><Button variant="ghost" onClick={() => setAdding(false)} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="alert-form" loading={busy}>{t('save')}</Button></>}>
        <form id="alert-form" className="form" onSubmit={add} noValidate>
          <SelectField label={tx('النوع', 'Type')} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            options={Object.entries(ALERT_KINDS).map(([k, v]) => ({ value: k, label: v[lang] }))} />
          <TextArea label={tx('التفاصيل', 'Details')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            error={errors.description} placeholder={tx('مثال: بنسلين — طفح جلدي وتورم', 'e.g. Penicillin — rash and swelling')} data-autofocus />
          <ChoiceGroup legend={tx('الأهمية', 'Importance')} name="severity" value={form.severity} onChange={(v) => setForm({ ...form, severity: v })}
            options={Object.entries(SEVERITY).map(([k, v]) => ({ value: k, label: v[lang] }))} />
        </form>
      </Modal>

      <Modal open={Boolean(removing)} onClose={() => setRemoving(null)} busy={busy} title={tx('إزالة تنبيه', 'Remove alert')}
        description={removing ? `${ALERT_KINDS[removing.kind][lang]}: ${removing.description}` : ''}
        footer={<><Button variant="ghost" onClick={() => setRemoving(null)} disabled={busy}>{t('cancel')}</Button><Button variant="danger" type="submit" form="alert-remove" loading={busy}>{tx('إزالة', 'Remove')}</Button></>}>
        <form id="alert-remove" onSubmit={remove} noValidate>
          <TextArea label={tx('السبب (يُحفظ في السجل)', 'Reason (kept in the log)')} value={reason} onChange={(e) => setReason(e.target.value)}
            error={errors.reason} placeholder={tx('مثال: اختبار الحساسية سلبي', 'e.g. Allergy test negative')} data-autofocus />
        </form>
      </Modal>
    </section>
  )
}
