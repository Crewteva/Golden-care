import { useEffect, useId, useState } from 'react'
import Icon from '../Icon'
import { useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { FORMS, useVisits } from './meta'

export function rowToItem(row) {
  return {
    drug_id: row.drug_id,
    drug: { name: row.drug_name, generic_name: row.generic_name, form: row.form, strength: row.strength, restricted: row.restricted, allergy_alert: row.allergy_alert },
    dose: row.dose, frequency: row.frequency, duration: row.duration, instructions: row.instructions || '',
    restricted_reason: row.restricted_reason || '', allergy_reason: row.allergy_reason || '',
  }
}

export function itemToBody(item) {
  return {
    drug_id: item.drug_id, dose: item.dose.trim(), frequency: item.frequency.trim(), duration: item.duration.trim(),
    instructions: item.instructions.trim() || null,
    restricted_reason: item.drug.restricted ? item.restricted_reason.trim() : null,
    allergy_reason: item.drug.allergy_alert ? item.allergy_reason.trim() : null,
  }
}

// What still stops a line from being saved: empty dose/frequency/duration, or a missing reason.
export function itemProblem(item) {
  if (!item.drug_id) return 'drug'
  if (item.drug.allergy_alert && item.allergy_reason.trim().length < 5) return 'allergy'
  if (item.drug.restricted && item.restricted_reason.trim().length < 5) return 'restricted'
  if (!item.dose.trim() || !item.frequency.trim() || !item.duration.trim()) return 'fields'
  return null
}

function DrugSearch({ patientId, onPick, disabled }) {
  const { tx, lang } = useI18n()
  const { api } = useVisits()
  const id = useId()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState([])
  const [active, setActive] = useState(0)
  const term = useDebounced(q, 200)

  useEffect(() => {
    if (!open) return
    let live = true
    api.drugs({ q: term, patient_id: patientId }).then((rows) => live && setResults(rows)).catch(() => live && setResults([]))
    return () => { live = false }
  }, [term, open, patientId, api])

  const pick = (drug) => { onPick(drug); setQ(''); setActive(0) }
  const list = results.slice(0, 8)
  return (
    <div className="combo">
      <label className="sr-only" htmlFor={id}>{tx('إضافة دواء', 'Add a drug')}</label>
      <div className="input-wrap">
        <span className="input-start"><Icon name="pill" size={18} /></span>
        <input id={id} className="input has-start" value={q} disabled={disabled} autoComplete="off" role="combobox"
          aria-expanded={open && list.length > 0} aria-controls={`${id}-list`}
          placeholder={tx('أضف دواء: ابحث بالاسم التجاري أو المادة الفعالة…', 'Add a drug: search brand or active ingredient…')}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }} onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, list.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            if (e.key === 'Enter' && list[active]) { e.preventDefault(); pick(list[active]) }
            if (e.key === 'Escape') setOpen(false)
          }} />
      </div>
      {open && list.length > 0 && (
        <ul className="combo-list" id={`${id}-list`} role="listbox">
          {list.map((d, i) => (
            <li key={d.id} role="option" aria-selected={i === active}>
              <button type="button" className={`${i === active ? 'active' : ''} ${d.allergy_alert ? 'danger' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(d)}>
                <span><strong>{d.name}</strong> <small className="muted">{d.generic_name} · {FORMS[d.form]?.[lang]}</small></span>
                {d.allergy_alert && <span className="badge badge-danger"><Icon name="alert" size={12} /> {tx('حساسية', 'Allergy')}</span>}
                {d.restricted && <span className="badge badge-gold">{tx('مقيّد', 'Restricted')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// The prescription of the visit: drugs from the list, with dose, how often, how long and instructions.
// A drug matching a recorded allergy, or a restricted medicine, needs a written reason before it can be kept.
export default function PrescriptionEditor({ items, onChange, patientId, canRestricted, problems = {} }) {
  const { tx, lang } = useI18n()
  const update = (i, patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const add = (d) => {
    if (items.length >= 15) return
    onChange([...items, {
      drug_id: d.id, drug: d, dose: d.default_dose || '', frequency: d.default_frequency || '', duration: d.default_duration || '',
      instructions: '', restricted_reason: '', allergy_reason: '',
    }])
  }
  const move = (i, dir) => {
    const next = [...items]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className="rx-editor">
      {!items.length && <p className="muted rx-empty">{tx('لا توجد أدوية في الروشتة. ابحث بالأسفل لإضافة دواء.', 'No drugs on the prescription yet. Search below to add one.')}</p>}
      <ol className="rx-items">
        {items.map((item, i) => {
          const problem = problems[i] || itemProblem(item)
          const blocked = item.drug.restricted && !canRestricted
          return (
            <li key={`${item.drug_id}-${i}`} className={`rx-item ${item.drug.allergy_alert ? 'allergy' : ''}`}>
              <div className="rx-item-head">
                <span className="rx-no num">{i + 1}</span>
                <div className="rx-drug">
                  <strong>{item.drug.name}</strong>
                  <small className="muted">{item.drug.generic_name}{item.drug.form && ` · ${FORMS[item.drug.form]?.[lang] || item.drug.form}`}</small>
                </div>
                {item.drug.restricted && <span className="badge badge-gold">{tx('دواء مقيّد', 'Restricted')}</span>}
                <div className="rx-tools">
                  <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={tx('لأعلى', 'Move up')}><Icon name="sortUp" size={15} /></button>
                  <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={tx('لأسفل', 'Move down')}><Icon name="sortDown" size={15} /></button>
                  <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={tx('حذف الدواء', 'Remove drug')}><Icon name="x" size={16} /></button>
                </div>
              </div>

              {item.drug.allergy_alert && (
                <div className="rx-warning danger" role="alert">
                  <Icon name="alert" size={18} />
                  <div>
                    <strong>{tx('تحذير حساسية', 'Allergy warning')}: </strong>
                    {tx('المريض مسجّل له:', 'The patient has:')} <em>{item.drug.allergy_alert}</em>.
                    {' '}{tx('لن يُحفظ هذا الدواء إلا بعد كتابة سبب الاستمرار.', 'This drug is kept only after you write why you continue.')}
                    <input className="input input-sm" value={item.allergy_reason} maxLength={300} aria-label={tx('سبب الاستمرار رغم الحساسية', 'Reason to continue despite the allergy')}
                      placeholder={tx('مثال: الحساسية كانت طفح بسيط وتم الاتفاق مع المريض', 'e.g. Mild rash only, discussed with the patient')}
                      onChange={(e) => update(i, { allergy_reason: e.target.value })} />
                  </div>
                </div>
              )}
              {item.drug.restricted && (
                <div className="rx-warning gold">
                  <Icon name="lock" size={18} />
                  <div>
                    {blocked
                      ? tx('هذا دواء مقيّد ولا تملك صلاحية وصفه. احذفه أو اطلب من طبيب مخوّل.', "This is a restricted medicine and you aren't allowed to prescribe it. Remove it or ask an authorised doctor.")
                      : <>{tx('دواء مقيّد: اكتب سبب الوصف (يُسجَّل في سجل النشاط).', 'Restricted medicine: write the reason (it is recorded in the activity log).')}
                        <input className="input input-sm" value={item.restricted_reason} maxLength={300} aria-label={tx('سبب وصف الدواء المقيّد', 'Reason for the restricted medicine')}
                          placeholder={tx('مثال: ألم شديد بعد الخلع لا يستجيب للمسكنات العادية', 'e.g. Severe pain after extraction not relieved by usual painkillers')}
                          onChange={(e) => update(i, { restricted_reason: e.target.value })} /></>}
                  </div>
                </div>
              )}

              <div className="rx-fields">
                <label><span>{tx('الجرعة', 'Dose')}</span><input className="input input-sm" value={item.dose} maxLength={120} onChange={(e) => update(i, { dose: e.target.value })} aria-invalid={problem === 'fields' && !item.dose.trim() ? 'true' : undefined} /></label>
                <label><span>{tx('كم مرة', 'How often')}</span><input className="input input-sm" value={item.frequency} maxLength={120} onChange={(e) => update(i, { frequency: e.target.value })} aria-invalid={problem === 'fields' && !item.frequency.trim() ? 'true' : undefined} /></label>
                <label><span>{tx('المدة', 'For how long')}</span><input className="input input-sm" value={item.duration} maxLength={120} onChange={(e) => update(i, { duration: e.target.value })} aria-invalid={problem === 'fields' && !item.duration.trim() ? 'true' : undefined} /></label>
                <label className="wide"><span>{tx('تعليمات للمريض', 'Instructions for the patient')}</span><input className="input input-sm" value={item.instructions} maxLength={300} placeholder={tx('مثال: بعد الأكل', 'e.g. after meals')} onChange={(e) => update(i, { instructions: e.target.value })} /></label>
              </div>
              {problem && problem !== 'drug' && (
                <p className="field-error"><Icon name="alert" size={14} /><span>
                  {problem === 'allergy' ? tx('اكتب سبب الاستمرار رغم الحساسية (٥ أحرف على الأقل).', 'Write why you continue despite the allergy (5+ characters).')
                    : problem === 'restricted' ? tx('اكتب سبب وصف الدواء المقيّد (٥ أحرف على الأقل).', 'Write the reason for the restricted medicine (5+ characters).')
                      : problem === 'fields' ? tx('أكمل الجرعة وعدد المرات والمدة.', 'Fill in dose, how often and how long.')
                        : problem}
                </span></p>
              )}
            </li>
          )
        })}
      </ol>
      <DrugSearch patientId={patientId} onPick={add} disabled={items.length >= 15} />
    </div>
  )
}
