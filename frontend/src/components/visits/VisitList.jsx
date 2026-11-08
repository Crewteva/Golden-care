import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { EmptyState, ErrorState, PageHeader, Pagination, SkeletonRows } from '../ui'
import { useAsync, useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtDateTime } from '../../lib/format'
import { VisitBadge, diagnosisName, useVisits } from './meta'

// "My visits" for a doctor (drafts to finish, signed visits to release) or every doctor's visits for the medical director.
export default function VisitList({ mine = false }) {
  const { tx, pick, locale } = useI18n()
  const { api, base } = useVisits()
  const [state, setState] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const term = useDebounced(q, 300)
  const { data, error, loading, reload } = useAsync(() => api.list({ state, q: term, mine, page }), [state, term, mine, page, api])
  const counts = data?.counts || {}
  const tabs = [
    ['', tx('الكل', 'All')],
    ['draft', tx('مسودات لم تُوقَّع', 'Unsigned drafts'), counts.draft],
    ['unreleased', tx('لم تُتح للمريض', 'Not released'), counts.unreleased],
    ['released', tx('مُتاحة للمريض', 'Released')],
  ]

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('العمل الطبي', 'Clinical work')} title={mine ? tx('زياراتي', 'My visits') : tx('الزيارات', 'Visits')}
        description={mine ? tx('المسودات تحتاج توقيعًا، والزيارات الموقعة يمكن إتاحتها للمريض بملخص مبسط.', 'Drafts need signing; signed visits can be released to the patient with a simple summary.')
          : tx('كل زيارات الأطباء. فتح زيارة طبيب آخر يُسجَّل في سجل النشاط.', "Every doctor's visits. Opening another doctor's visit is recorded in the activity log.")} />
      <section className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <div className="tabs" role="tablist">
            {tabs.map(([key, label, n]) => (
              <button key={key} type="button" role="tab" aria-selected={state === key} onClick={() => { setState(key); setPage(1) }}>
                {label}{n > 0 && <span className="badge badge-gold badge-plain" style={{ marginInlineStart: 6 }}>{n}</span>}
              </button>
            ))}
          </div>
          <div className="input-wrap" style={{ minWidth: 240 }}>
            <span className="input-start"><Icon name="search" size={18} /></span>
            <input className="input has-start" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} aria-label={tx('بحث', 'Search')}
              placeholder={tx('مريض، رقم ملف، تشخيص…', 'Patient, file no., diagnosis…')} />
          </div>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={6} cols={4} /> : !data.items.length ? (
          <EmptyState icon="stethoscope" title={tx('لا توجد زيارات هنا', 'No visits here')}>
            {state === 'draft' ? tx('كل زياراتك موقّعة.', 'All your visits are signed.') : null}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{tx('الزيارة', 'Visit')}</th>
                    <th>{tx('المريض', 'Patient')}</th>
                    {!mine && <th>{tx('الطبيب', 'Doctor')}</th>}
                    <th>{tx('التشخيص', 'Diagnosis')}</th>
                    <th>{tx('الحالة', 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((v) => (
                    <tr key={v.id}>
                      <td><Link to={`${base}/visits/${v.id}`} className="person-name"><bdi>{fmtDateTime(v.started_at, locale)}</bdi></Link><small className="mrn muted" style={{ display: 'block' }}>{v.ref}</small></td>
                      <td><strong>{pick(v, 'patient_name')}</strong><small className="mrn muted" style={{ display: 'block' }}>{v.mrn}</small></td>
                      {!mine && <td><span className="dot-color" style={{ background: v.doctor_color || 'var(--ink-300)' }} /> {pick(v, 'doctor_name')}</td>}
                      <td>{v.diagnoses.length ? v.diagnoses.map((d) => diagnosisName(d, pick)).join(' · ') : <span className="muted">—</span>}
                        {v.rx_count > 0 && <small className="muted" style={{ display: 'block' }}><Icon name="pill" size={12} /> {tx(`${v.rx_count} دواء`, `${v.rx_count} drug(s)`)}</small>}</td>
                      <td><VisitBadge visit={v} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </section>
    </div>
  )
}
