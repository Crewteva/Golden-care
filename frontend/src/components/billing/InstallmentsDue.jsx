import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtDate, fmtPhone } from '../../lib/format'
import { money, num, useBilling } from './meta'

const RANGES = [0, 7, 14, 30]

// The reminder call list: installments that are overdue or fall due soon, with the patient's phone.
export default function InstallmentsDue() {
  const { tx, pick, locale } = useI18n()
  const { api, bill } = useBilling()
  const [days, setDays] = useState(7)
  const { data, error, loading, reload } = useAsync(() => api.installmentsDue(days), [days, api])
  const overdue = (data || []).filter((r) => r.overdue)
  const total = (data || []).reduce((s, r) => s + num(r.remaining), 0)
  const label = (d) => (d === 0 ? tx('المتأخر فقط', 'Overdue only') : tx(`خلال ${d} يوم`, `Next ${d} days`))

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الحسابات', 'Billing')} title={tx('أقساط مستحقة', 'Installments due')}
        description={tx('قائمة الاتصال: أقساط متأخرة أو تستحق قريبًا. اتصل بالمريض لتذكيره قبل زيارته القادمة.', 'The call list: installments that are overdue or fall due soon. Call the patient to remind them before their next visit.')} />
      {data && (
        <div className="sum-strip">
          <div><small>{tx('أقساط', 'Installments')}</small><strong className="num">{data.length}</strong></div>
          <div className={overdue.length ? 'owed' : ''}><small>{tx('متأخرة', 'Overdue')}</small><strong className="num">{overdue.length}</strong></div>
          <div><small>{tx('المطلوب تحصيله', 'To collect')}</small><strong className="num">{money(total, locale)}</strong></div>
        </div>
      )}
      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('الفترة', 'Range')}>
            {RANGES.map((d) => <button key={d} type="button" role="tab" aria-selected={days === d} onClick={() => setDays(d)}>{label(d)}</button>)}
          </div>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={5} cols={5} /> : !data.length ? (
          <EmptyState icon="checkCircle" title={tx('لا أقساط في هذه الفترة', 'No installments in this range')}>{tx('كل الأقساط مسددة أو مستحقة لاحقًا.', 'Everything is paid or falls due later.')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table stack">
              <thead><tr><th>{tx('المريض', 'Patient')}</th><th>{tx('الموبايل', 'Mobile')}</th><th>{tx('الفاتورة', 'Invoice')}</th><th>{tx('الاستحقاق', 'Due')}</th><th className="num">{tx('المتبقي', 'Remaining')}</th></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={`${r.invoice_id}-${r.seq}`} className={r.overdue ? 'row-overdue' : ''}>
                    <td className="cell-main"><Link to={`${bill}/patients/${r.patient_id}`} className="person-name">{pick(r, 'patient_name')}</Link><small className="mrn muted" style={{ display: 'block' }}>{r.mrn}</small></td>
                    <td data-label={tx('الموبايل', 'Mobile')}>{r.patient_phone ? <a href={`tel:${r.patient_phone}`} className="ltr"><bdi>{fmtPhone(r.patient_phone)}</bdi></a> : '—'}</td>
                    <td data-label={tx('الفاتورة', 'Invoice')}><Link to={`${bill}/invoices/${r.invoice_id}`} className="mrn">{r.invoice_ref}</Link>
                      <small className="muted" style={{ display: 'block' }}>{r.seq === 0 ? tx('المقدم', 'Down payment') : tx(`القسط ${r.seq}`, `Installment ${r.seq}`)}</small></td>
                    <td data-label={tx('الاستحقاق', 'Due')}><bdi>{fmtDate(r.due_on, locale)}</bdi> {r.overdue ? <Badge tone="danger">{tx('متأخر', 'Overdue')}</Badge> : <Badge tone="gold">{tx('قريبًا', 'Soon')}</Badge>}</td>
                    <td className="num" data-label={tx('المتبقي', 'Remaining')}><strong>{money(r.remaining, locale)}</strong>
                      {num(r.remaining) < num(r.amount) && <small className="muted" style={{ display: 'block' }}>{tx(`من ${money(r.amount, locale)}`, `of ${money(r.amount, locale)}`)}</small>}</td>
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
