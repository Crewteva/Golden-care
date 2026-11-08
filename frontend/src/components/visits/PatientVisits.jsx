import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { EmptyState, ErrorState, SkeletonRows } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { VitalsModal } from './Vitals'
import { VITALS, VisitBadge, bmi, diagnosisName, useVisits, vitalFlag, vitalValue } from './meta'

// Patient file → Visits: every visit as a timeline. The content only for visits you may read.
export function PatientVisits({ patientId }) {
  const { tx, pick, locale } = useI18n()
  const { api, base } = useVisits()
  const { data, error, loading, reload } = useAsync(() => api.forPatient(patientId), [patientId, api])
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (loading && !data) return <section className="card"><SkeletonRows rows={4} cols={3} /></section>
  if (!data.length) {
    return <section className="card"><EmptyState icon="stethoscope" title={tx('لا توجد زيارات بعد', 'No visits yet')}>{tx('تظهر الزيارة هنا عندما يستدعي الطبيب المريض للكشف.', 'A visit appears here when the doctor calls the patient in.')}</EmptyState></section>
  }
  return (
    <section className="card">
      <div className="card-head"><h2>{tx('الزيارات', 'Visits')}</h2><span className="muted">{data.length}</span></div>
      <ol className="visit-timeline">
        {data.map((v) => (
          <li key={v.id} style={{ '--c': v.doctor_color || 'var(--ink-600)' }}>
            <div className="vt-date"><strong><bdi>{fmtDate(v.started_at, locale)}</bdi></strong><small className="mrn">{v.ref}</small></div>
            <div className="vt-body">
              <div className="vt-head">
                <span><strong>{pick(v, 'doctor_name')}</strong>{v.specialty_name_en && <small className="muted"> · {pick(v, 'specialty_name')}</small>}</span>
                {v.readable ? <VisitBadge visit={v} /> : <span className="badge badge-neutral"><Icon name="lock" size={12} /> {tx('للطبيب المعالج فقط', 'Treating doctor only')}</span>}
              </div>
              {v.readable ? (
                <>
                  {v.diagnoses.length > 0 && <p className="vt-dx">{v.diagnoses.map((d) => diagnosisName(d, pick)).join(' · ')}</p>}
                  {v.complaint && <p className="muted vt-line" dir="auto">{v.complaint}</p>}
                  {v.rx.length > 0 && <p className="vt-rx"><Icon name="pill" size={14} /> {v.rx.map((r) => r.drug_name).join('، ')}</p>}
                  <div className="vt-foot">
                    {v.addenda_count > 0 && <small className="muted">{tx(`${v.addenda_count} ملاحظة لاحقة`, `${v.addenda_count} addendum(s)`)}</small>}
                    <Link to={`${base}/visits/${v.id}`} className="btn btn-ghost btn-sm">{v.status === 'draft' ? tx('متابعة الكتابة', 'Continue writing') : tx('فتح الزيارة', 'Open visit')}<Icon name="chevronRight" size={16} /></Link>
                  </div>
                </>
              ) : (
                <p className="muted vt-line">{tx('محتوى الزيارة يراه الطبيب المعالج والمدير الطبي فقط.', 'Only the treating doctor and the medical director can read this visit.')}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

// Patient file → Vital signs: every reading, newest first, with a button to record new ones.
export function PatientVitals({ patientId, patientName }) {
  const { tx, lang, pick, locale } = useI18n()
  const { api, can } = useVisits()
  const [open, setOpen] = useState(false)
  const { data, error, loading, reload } = useAsync(() => api.patientVitals(patientId), [patientId, api])
  if (error) return <ErrorState error={error} onRetry={reload} />
  return (
    <section className="card">
      <div className="card-head">
        <h2>{tx('العلامات الحيوية', 'Vital signs')}</h2>
        {can('visits.vitals') && <Button size="sm" icon="plus" onClick={() => setOpen(true)}>{tx('تسجيل قياس', 'Record vitals')}</Button>}
      </div>
      {loading && !data ? <SkeletonRows rows={4} cols={6} /> : !data.length ? (
        <EmptyState icon="thermometer" title={tx('لا توجد قياسات بعد', 'No readings yet')} />
      ) : (
        <div className="table-wrap">
          <table className="table vitals-table">
            <thead>
              <tr>
                <th>{tx('الوقت', 'When')}</th>
                {VITALS.map((m) => <th key={m.key}>{m[lang]} <small className="muted">{m.unit}</small></th>)}
                <th>BMI</th>
                <th>{tx('بواسطة', 'By')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((v) => (
                <tr key={v.id}>
                  <td><bdi>{fmtDateTime(v.recorded_at, locale)}</bdi>{v.note && <small className="muted" style={{ display: 'block' }}>{v.note}</small>}</td>
                  {VITALS.map((m) => {
                    const value = vitalValue(v, m.key)
                    return <td key={m.key} className={`num ${vitalFlag(v, m.key) ? 'flag' : ''}`}>{value ?? <span className="muted">—</span>}</td>
                  })}
                  <td className="num">{bmi(v) ?? <span className="muted">—</span>}</td>
                  <td>{pick(v, 'recorded_by')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <VitalsModal patientId={patientId} patientName={patientName} onClose={() => setOpen(false)} onSaved={reload} />}
    </section>
  )
}
