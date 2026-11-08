import { Link, useParams } from 'react-router-dom'
import Icon from '../../../components/Icon'
import PageLoader from '../../../components/PageLoader'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../../components/ui'
import { useAsync } from '../../../components/useAsync'
import { FORMS } from '../../../components/visits/meta'
import { PrintBar, RxSheet } from '../../../components/visits/RxSheet'
import { patientApi } from '../../../api/patient'
import { useI18n } from '../../../i18n/I18nContext'
import { fmtDate } from '../../../lib/format'

// The visits my doctor released: a simple explanation and the prescription. Never the doctor's medical notes.
export default function MyVisits() {
  const { tx, lang, pick, locale } = useI18n()
  const { data, error, loading, reload } = useAsync(() => patientApi.visits(), [])
  const people = new Set((data || []).map((v) => v.patient_id))

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('حسابي', 'My account')} title={tx('زياراتي', 'My visits')}
        description={tx('ملخص كل زيارة بكلمات بسيطة من طبيبك، مع الروشتة. تظهر الزيارة هنا بعد أن يتيحها الطبيب.',
          'A plain-language summary of each visit from your doctor, with the prescription. A visit appears here once your doctor releases it.')} />
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? (
        <section className="card"><SkeletonRows rows={3} cols={2} /></section>
      ) : !data.length ? (
        <section className="card">
          <EmptyState icon="stethoscope" title={tx('لا توجد زيارات بعد', 'No visits yet')}>
            {tx('بعد زيارتك سيكتب لك الطبيب ملخصًا وتجد الروشتة هنا.', 'After your visit, your doctor writes you a summary and you will find the prescription here.')}
          </EmptyState>
        </section>
      ) : (
        <div className="portal-visits">
          {data.map((v) => (
            <article key={v.id} className="card portal-visit">
              <header>
                <div>
                  <strong>{pick(v, 'doctor_name')}</strong>
                  <small className="muted">{pick(v, 'specialty_name')} · <bdi>{fmtDate(v.started_at, locale)}</bdi></small>
                </div>
                {people.size > 1 && <Badge tone="neutral">{pick(v, 'patient_name')}</Badge>}
              </header>
              <div className="doc-note prewrap"><small>{tx('من طبيبك', 'From your doctor')}</small>{v.patient_summary}</div>
              {v.rx.length > 0 && (
                <div className="portal-rx">
                  <h3><Icon name="pill" size={16} /> {tx('الروشتة', 'Prescription')}</h3>
                  <ul>
                    {v.rx.map((r, i) => (
                      <li key={i}>
                        <span dir="ltr"><strong>{r.drug_name}</strong> <small className="muted">{FORMS[r.form]?.[lang]}</small></span>
                        <span dir="ltr" className="rx-sig">{r.dose} · {r.frequency} · {r.duration}</span>
                        {r.instructions && <em>{r.instructions}</em>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <footer>
                {v.follow_up_days && <span className="muted"><Icon name="calendar" size={14} /> {tx(`ينصح الطبيب بمتابعة بعد ${v.follow_up_days} يوم`, `Your doctor advises a follow-up in ${v.follow_up_days} days`)}</span>}
                {v.rx.length > 0 && <Link to={`/dashboard/patient/visits/${v.id}/print`} className="btn btn-ghost btn-sm"><Icon name="printer" size={16} />{tx('طباعة الروشتة', 'Print prescription')}</Link>}
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

export function MyVisitPrint() {
  const { id } = useParams()
  const { tx } = useI18n()
  const { data, error, reload } = useAsync(() => patientApi.visit(id), [id])
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  return (
    <div className="page print-page">
      <PrintBar back="/dashboard/patient/visits" label={tx('زياراتي', 'My visits')} />
      <RxSheet visit={data} rx={data.rx} allergies={data.allergies} branch={data.branch} />
    </div>
  )
}
