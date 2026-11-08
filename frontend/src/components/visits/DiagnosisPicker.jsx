import { useEffect, useId, useState } from 'react'
import Icon from '../Icon'
import { useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { useVisits } from './meta'

// Pick diagnoses from the list (Arabic, English or ICD-10 code), or add one as free text. Each can carry a detail.
export default function DiagnosisPicker({ value, onChange, specialtyId, error }) {
  const { tx, pick } = useI18n()
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
    api.diagnoses({ q: term, specialty_id: specialtyId }).then((rows) => live && setResults(rows)).catch(() => live && setResults([]))
    return () => { live = false }
  }, [term, open, specialtyId, api])

  const chosen = new Set(value.filter((d) => d.diagnosis_id).map((d) => d.diagnosis_id))
  const options = results.filter((r) => !chosen.has(r.id)).slice(0, 8)
  const free = q.trim().length >= 3 ? [{ free: true, text: q.trim() }] : []
  const all = [...options, ...free]

  const add = (item) => {
    if (value.length >= 8) return
    onChange([...value, item.free ? { diagnosis_id: null, text: item.text } : { diagnosis_id: item.id, code: item.code, name_ar: item.name_ar, name_en: item.name_en, text: '' }])
    setQ('')
    setActive(0)
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, all.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    if (e.key === 'Enter' && open && all[active]) { e.preventDefault(); add(all[active]) }
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{tx('التشخيص', 'Diagnosis')}</label>
      {value.length > 0 && (
        <ul className="dx-list">
          {value.map((d, i) => (
            <li key={`${d.diagnosis_id || 'free'}-${i}`} className={i === 0 ? 'primary' : ''}>
              <div className="dx-name">
                {i === 0 && <span className="badge badge-gold badge-plain">{tx('رئيسي', 'Main')}</span>}
                <strong>{d.diagnosis_id ? pick(d) : d.text}</strong>
                {d.code && <span className="mono muted">{d.code}</span>}
                {!d.diagnosis_id && <span className="muted">· {tx('نص حر', 'free text')}</span>}
              </div>
              {d.diagnosis_id && (
                <input className="input input-sm" value={d.text || ''} maxLength={300} aria-label={tx('تفاصيل التشخيص', 'Diagnosis detail')}
                  placeholder={tx('تفاصيل (اختياري): الموضع، الشدة…', 'Detail (optional): site, severity…')}
                  onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              )}
              <button type="button" className="btn btn-quiet btn-icon btn-sm" aria-label={tx('حذف التشخيص', 'Remove diagnosis')}
                onClick={() => onChange(value.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="combo">
        <div className="input-wrap">
          <span className="input-start"><Icon name="search" size={18} /></span>
          <input id={id} className="input has-start" value={q} autoComplete="off" role="combobox" aria-expanded={open && all.length > 0}
            aria-controls={`${id}-list`} aria-invalid={error ? 'true' : undefined}
            placeholder={tx('ابحث بالاسم أو كود ICD-10… (مثال: acne، تسوس، L70)', 'Search by name or ICD-10 code… (e.g. acne, caries, L70)')}
            onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }} onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey} />
        </div>
        {open && all.length > 0 && (
          <ul className="combo-list" id={`${id}-list`} role="listbox">
            {all.map((item, i) => (
              <li key={item.free ? 'free' : item.id} role="option" aria-selected={i === active}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(item)} className={i === active ? 'active' : ''}>
                  {item.free ? (
                    <><Icon name="plus" size={15} /> {tx('إضافة كنص حر:', 'Add as free text:')} <strong>{item.text}</strong></>
                  ) : (
                    <><span>{pick(item)}</span>{item.code && <span className="mono muted">{item.code}</span>}{item.specialty_name_en && <small className="muted">{pick(item, 'specialty_name')}</small>}</>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="field-error" role="alert"><Icon name="alert" size={14} /><span>{error}</span></p>}
    </div>
  )
}
