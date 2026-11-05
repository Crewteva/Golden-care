import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { Avatar, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtRelative } from '../../lib/format'
import { ReviewModal } from './Documents'
import { CATEGORIES, ageLabel } from './meta'
import { useWorkspace } from './useWorkspace'

// Results and reports waiting for a doctor, oldest first.
export default function ReviewQueue() {
  const { tx, lang, pick, locale } = useI18n()
  const { api, patientsBase } = useWorkspace()
  const { data, error, loading, reload } = useAsync(() => api.reviewQueue(), [api])
  const [reviewing, setReviewing] = useState(null)

  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('المراجعة الطبية', 'Clinical review')}
        title={tx('بانتظار المراجعة', 'Awaiting review')}
        description={tx('نتائج وتقارير رُفعت ولم يراجعها طبيب بعد. لا يراها المريض حتى تقرر إتاحتها مع شرح مبسّط.',
          "Results and reports uploaded but not yet reviewed. The patient can't see them until you release them with a plain-language note.")}
      />
      <section className="card">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <SkeletonRows rows={5} cols={4} />
        ) : !data.length ? (
          <EmptyState icon="checkCircle" title={tx('لا شيء بانتظارك', 'Nothing waiting')}>
            {tx('كل النتائج تمت مراجعتها.', 'Every result has been reviewed.')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table stack">
              <thead>
                <tr>
                  <th>{tx('المريض', 'Patient')}</th>
                  <th>{tx('المستند', 'Document')}</th>
                  <th>{tx('رُفع', 'Uploaded')}</th>
                  <th><span className="sr-only">{tx('إجراءات', 'Actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {data.map((f) => {
                  const days = (Date.now() - new Date(f.uploaded_at).getTime()) / 86400000
                  return (
                    <tr key={f.id}>
                      <td className="cell-main">
                        <div className="person">
                          <Avatar name={pick(f, 'full_name')} />
                          <div>
                            <Link to={`${patientsBase}/${f.patient_id}`} className="person-name">{pick(f, 'full_name')}</Link>
                            <small><span className="mrn">{f.mrn}</span> · {ageLabel(f.date_of_birth, tx)}</small>
                          </div>
                        </div>
                      </td>
                      <td data-label={tx('المستند', 'Document')}>
                        <strong style={{ fontWeight: 500 }}>{f.title}</strong>
                        <small className="muted" style={{ display: 'block' }}>{CATEGORIES[f.category][lang]}</small>
                      </td>
                      <td data-label={tx('رُفع', 'Uploaded')} style={{ whiteSpace: 'nowrap' }}>
                        <bdi>{fmtRelative(f.uploaded_at, locale)}</bdi>
                        <small className="muted" style={{ display: 'block' }}>{pick(f, 'uploaded_by')}</small>
                        {days > 3 && <Badge tone="warn">{tx('متأخر', 'Overdue')}</Badge>}
                      </td>
                      <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <a className="btn btn-ghost btn-sm" href={api.fileUrl(f.patient_id, f.id)} target="_blank" rel="noopener noreferrer">
                            <Icon name="eye" size={16} />{tx('فتح', 'Open')}
                          </a>
                          <Button size="sm" icon="check" onClick={() => setReviewing(f)}>{tx('مراجعة', 'Review')}</Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {reviewing && (
        <ReviewModal file={{ ...reviewing, patient: reviewing }} patientId={reviewing.patient_id}
          onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); reload() }} />
      )}
    </div>
  )
}
