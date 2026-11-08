import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useAsync, useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtDate } from '../../lib/format'
import { PlanBadge, money, useClinical } from '../clinical/meta'

// Treatment plans: the doctor's own, or all plans for staff who follow up with patients.
export default function PlansList({ mine = false }) {
  const { tx, pick, locale } = useI18n()
  const { dental, base } = useClinical()
  const [state, setState] = useState(mine ? '' : 'quoted')
  const [q, setQ] = useState('')
  const term = useDebounced(q, 300)
  const { data, error, loading, reload } = useAsync(() => dental.plans({ state, q: term, mine }), [state, term, mine, dental])
  const tabs = [
    ['', tx('الكل', 'All')], ['draft', tx('مسودات', 'Drafts')], ['quoted', tx('بانتظار موافقة المريض', 'Awaiting patient')],
    ['expired', tx('عروض منتهية', 'Expired')], ['accepted', tx('جارٍ التنفيذ', 'In progress')], ['to_bill', tx('جاهز للفوترة', 'Ready to bill')],
    ['completed', tx('اكتملت', 'Completed')],
  ]
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الأسنان', 'Dental')} title={mine ? tx('خطط العلاج', 'Treatment plans') : tx('خطط العلاج وعروض الأسعار', 'Treatment plans & quotations')}
        description={mine ? tx('أنشئ خطة من ملف المريض (تبويب الأسنان).', "Create a plan from the patient's file (Dental tab).")
          : tx('تابع العروض التي تنتظر رد المريض، وسجّل موافقته عند توقيعه على العرض المطبوع.', 'Follow quotations waiting for the patient, and record their acceptance when they sign the printed quotation.')} />
      <section className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <div className="tabs" role="tablist">
            {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={state === k} onClick={() => setState(k)}>{label}</button>)}
          </div>
          <div className="input-wrap" style={{ minWidth: 220 }}>
            <span className="input-start"><Icon name="search" size={18} /></span>
            <input className="input has-start" value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx('بحث', 'Search')} placeholder={tx('مريض، رقم ملف، رقم خطة…', 'Patient, file no., plan no.…')} />
          </div>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={5} cols={5} /> : !data.length ? (
          <EmptyState icon="clipboard" title={tx('لا توجد خطط هنا', 'No plans here')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tx('الخطة', 'Plan')}</th><th>{tx('المريض', 'Patient')}</th>{!mine && <th>{tx('الطبيب', 'Doctor')}</th>}<th>{tx('الإجمالي', 'Total')}</th><th>{tx('التنفيذ', 'Progress')}</th><th>{tx('الحالة', 'Status')}</th></tr></thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id}>
                    <td><Link to={`${base}/plans/${p.id}`} className="person-name">{p.title}</Link><small className="muted" style={{ display: 'block' }}><span className="mrn">{p.ref}</span>
                      {p.valid_until && p.status === 'quoted' && <> · {tx('صالح حتى', 'valid until')} <bdi>{fmtDate(p.valid_until, locale)}</bdi></>}</small></td>
                    <td><strong>{pick(p, 'patient_name')}</strong><small className="mrn muted" style={{ display: 'block' }}>{p.mrn}</small></td>
                    {!mine && <td>{pick(p, 'doctor_name')}</td>}
                    <td className="num">{money(p.quote_total ?? p.items_total, locale)}{Number(p.to_bill_total) > 0 && <small className="bill-flag">{tx('جاهز للفوترة', 'to bill')} {money(p.to_bill_total, locale)}</small>}</td>
                    <td><div className="progress" aria-label={`${p.done_count}/${p.items_count}`}><i style={{ width: `${p.items_count ? (p.done_count / p.items_count) * 100 : 0}%` }} /></div><small className="muted num">{p.done_count}/{p.items_count}</small></td>
                    <td><PlanBadge state={p.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
