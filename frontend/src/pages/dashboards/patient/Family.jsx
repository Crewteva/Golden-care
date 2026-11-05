import { Avatar, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../../components/ui'
import { useAsync } from '../../../components/useAsync'
import { RELATIONSHIPS, ageLabel } from '../../../components/patients/meta'
import { patientApi } from '../../../api/patient'
import { useI18n } from '../../../i18n/I18nContext'

export default function MyFamily() {
  const { tx, lang, pick } = useI18n()
  const { data, error, loading, reload } = useAsync(() => patientApi.family(), [])

  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('حسابي', 'My account')}
        title={tx('عائلتي', 'My family')}
        description={tx('أفراد العائلة المرتبطون بملفك. نتائج الأبناء الذين تتولى أمرهم تظهر في «نتائجي ومستنداتي».',
          'Family members linked to your file. Results for the children in your care appear under “My results & documents”.')}
      />
      <section className="card">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <SkeletonRows rows={3} cols={2} />
        ) : !data.length ? (
          <EmptyState icon="users" title={tx('لا يوجد أفراد عائلة مرتبطون', 'No family members linked')}>
            {tx('لإضافة أبنائك إلى حسابك، اطلب ذلك من الاستقبال في زيارتك القادمة.', 'To add your children to your account, ask reception at your next visit.')}
          </EmptyState>
        ) : (
          <div className="card-body" style={{ paddingBlock: 6 }}>
          <ul className="list">
            {data.map((f) => (
              <li key={f.id} className="relative">
                <div className="person">
                  <Avatar name={pick(f, 'full_name')} />
                  <div>
                    <strong style={{ fontWeight: 500 }}>{pick(f, 'full_name')}</strong>
                    <small>{RELATIONSHIPS[f.relationship][lang]} · {ageLabel(f.date_of_birth, tx)} · <span className="mrn">{f.mrn}</span></small>
                  </div>
                </div>
                {f.managed_by_this_patient && <Badge tone="gold">{tx('تحت ولايتك', 'In your care')}</Badge>}
                {f.manages_this_patient && <Badge tone="info">{tx('ولي أمرك', 'Your guardian')}</Badge>}
              </li>
            ))}
          </ul>
          </div>
        )}
      </section>
    </div>
  )
}
