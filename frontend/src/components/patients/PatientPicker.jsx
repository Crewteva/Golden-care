import { useEffect, useId, useState } from 'react'
import Icon from '../Icon'
import { Avatar } from '../ui'
import { useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtPhone } from '../../lib/format'
import { ageLabel } from './meta'

// Search-as-you-type field to choose an existing patient file.
export default function PatientPicker({ api, label, onSelect, excludeId, error }) {
  const { tx, pick } = useI18n()
  const id = useId()
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const search = useDebounced(q, 250)

  useEffect(() => {
    let alive = true
    if (search.trim().length < 2) {
      setResults([])
      return undefined
    }
    api.search({ q: search, page_size: 6 }).then((data) => {
      if (alive) {
        setResults(data.items.filter((p) => p.id !== excludeId))
        setOpen(true)
      }
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [search, api, excludeId])

  return (
    <div className="field picker">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <span className="input-start"><Icon name="search" size={18} /></span>
        <input id={id} className="input has-start" value={q} autoComplete="off" role="combobox" aria-expanded={open && results.length > 0}
          aria-invalid={error ? 'true' : undefined}
          placeholder={tx('اسم، موبايل، رقم ملف أو رقم قومي…', 'Name, mobile, file no. or national ID…')}
          onChange={(e) => setQ(e.target.value)} onFocus={() => results.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      </div>
      {error && <p className="field-error" role="alert"><Icon name="alert" size={14} /><span>{error}</span></p>}
      {open && results.length > 0 && (
        <ul className="picker-list" role="listbox">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onSelect(p); setQ(''); setOpen(false) }}>
                <Avatar name={pick(p, 'full_name')} />
                <span>
                  {pick(p, 'full_name')}
                  <small><span className="mrn">{p.mrn}</span> · {ageLabel(p.date_of_birth, tx)}{p.phone && <> · <bdi className="ltr">{fmtPhone(p.phone)}</bdi></>}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
