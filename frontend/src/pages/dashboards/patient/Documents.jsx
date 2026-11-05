import Icon from '../../../components/Icon'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../../components/ui'
import { useAsync } from '../../../components/useAsync'
import { CATEGORIES } from '../../../components/patients/meta'
import { patientApi } from '../../../api/patient'
import { useAuth } from '../../../auth/AuthContext'
import { useI18n } from '../../../i18n/I18nContext'
import { fmtDate } from '../../../lib/format'

// Results the doctor released (with their note) and signed consents, for me and the children I manage.
export default function MyDocuments() {
  const { me } = useAuth()
  const { tx, lang, pick, locale } = useI18n()
  const { data, error, loading, reload } = useAsync(() => patientApi.files(), [])
  const people = new Set((data || []).map((f) => f.patient_id))
  const mine = pick(me.user, 'full_name')

  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('حسابي', 'My account')}
        title={tx('نتائجي ومستنداتي', 'My results & documents')}
        description={tx('تظهر النتائج هنا بعد أن يراجعها طبيبك ويكتب لك شرحًا مبسطًا. للاستفسار تواصل مع العيادة.',
          'Results appear here once your doctor has reviewed them and written you a simple explanation. For questions, contact the clinic.')}
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <section className="card"><SkeletonRows rows={3} cols={2} /></section>
      ) : !data.length ? (
        <section className="card">
          <EmptyState icon="fileSearch" title={tx('لا توجد مستندات بعد', 'No documents yet')}>
            {tx('عندما يتيح طبيبك نتيجة أو تقريرًا ستجده هنا.', 'When your doctor releases a result or report, you will find it here.')}
          </EmptyState>
        </section>
      ) : (
        <div className="grid-2">
          {data.map((f) => (
            <article key={f.id} className="card portal-doc">
              <div className="top">
                <div className="person">
                  <span className="doc-ico clinical"><Icon name={CATEGORIES[f.category].icon} size={20} /></span>
                  <div>
                    <div className="doc-title">{f.title}</div>
                    <div className="doc-meta">
                      {CATEGORIES[f.category][lang]} · <bdi>{fmtDate(f.released_at || f.uploaded_at, locale)}</bdi>
                    </div>
                  </div>
                </div>
                {people.size > 1 && <Badge tone="neutral">{pick(f, 'patient_name') || mine}</Badge>}
              </div>
              {f.patient_note && (
                <div className="doc-note" style={{ marginTop: 0 }}>
                  <small>{tx('ملاحظة الطبيب', "Doctor's note")}{f.released_by_en ? ` · ${pick(f, 'released_by')}` : ''}</small>
                  {f.patient_note}
                </div>
              )}
              <a className="btn btn-ghost btn-sm" href={patientApi.fileUrl(f.id)} target="_blank" rel="noopener noreferrer" style={{ justifySelf: 'start' }}>
                <Icon name="eye" size={16} />{tx('فتح المستند', 'Open document')}
              </a>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
