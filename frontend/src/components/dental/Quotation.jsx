import { useParams } from 'react-router-dom'
import PageLoader from '../PageLoader'
import { LogoMark } from '../Logo'
import { ErrorState } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtDate, fmtPhone } from '../../lib/format'
import { ageLabel } from '../patients/meta'
import { PrintBar } from '../visits/RxSheet'
import { money, useClinical } from '../clinical/meta'

// The treatment plan quotation on the clinic letterhead: items by tooth, prices from the price list, payment plan, signatures.
export function QuotationSheet({ plan, items, schedule, branch }) {
  const { tx, pick, locale } = useI18n()
  const phases = [...new Set(items.map((i) => i.phase))].sort()
  const total = Number(plan.quote_total ?? items.reduce((s, i) => s + Number(i.price), 0))
  return (
    <article className="rx-sheet quote-sheet" aria-label={tx('عرض سعر', 'Quotation')}>
      <header className="rx-letterhead">
        <LogoMark size={46} />
        <div className="rx-clinic">
          <strong>{tx('عيادات جولدن كير', 'Golden Care Clinics')}</strong>
          <span>{branch ? pick(branch, 'name') : tx('مدينة الشروق', 'Madinat El Shorouk')}</span>
          {branch?.phone && <small><bdi className="ltr">{fmtPhone(branch.phone)}</bdi></small>}
        </div>
        <div className="rx-doctor">
          <strong>{tx('خطة علاج وعرض سعر', 'Treatment plan & quotation')}</strong>
          <span className="mrn">{plan.ref}</span>
          <small>{pick(plan, 'doctor_name')}</small>
        </div>
      </header>
      <dl className="rx-patient">
        <div><dt>{tx('المريض', 'Patient')}</dt><dd>{pick(plan, 'patient_name')}</dd></div>
        <div><dt>{tx('السن', 'Age')}</dt><dd>{ageLabel(plan.date_of_birth, tx)}</dd></div>
        <div><dt>{tx('تاريخ العرض', 'Issued')}</dt><dd><bdi>{fmtDate(plan.quoted_at || plan.created_at, locale)}</bdi></dd></div>
        <div><dt>{tx('صالح حتى', 'Valid until')}</dt><dd><bdi>{plan.valid_until ? fmtDate(plan.valid_until, locale) : '—'}</bdi></dd></div>
      </dl>
      <div className="rx-body">
        <h2 className="quote-title">{plan.title}</h2>
        <table className="quote-table">
          <thead><tr><th>{tx('السن', 'Tooth')}</th><th>{tx('العلاج', 'Treatment')}</th><th className="num">{tx('السعر', 'Price')}</th></tr></thead>
          {phases.map((ph) => (
            <tbody key={ph}>
              {phases.length > 1 && <tr className="phase-row"><td colSpan={3}>{tx(`المرحلة ${ph}`, `Phase ${ph}`)}</td></tr>}
              {items.filter((i) => i.phase === ph).map((i) => (
                <tr key={i.id}><td className="mono">{i.tooth ? `${i.tooth}${i.surfaces?.length ? ` ${i.surfaces.join('')}` : ''}` : '—'}</td><td>{pick(i, 'service_name')}</td><td className="num">{money(i.price, locale)}</td></tr>
              ))}
            </tbody>
          ))}
          <tfoot><tr><td colSpan={2}>{tx('الإجمالي', 'Total')}</td><td className="num">{money(total, locale)}</td></tr></tfoot>
        </table>
        {schedule?.length > 0 && (
          <div className="quote-schedule">
            <h3>{tx('طريقة الدفع', 'Payment plan')}</h3>
            <table className="quote-table">
              <tbody>
                {schedule.map((r) => (
                  <tr key={r.seq}><td>{r.seq === 0 ? tx('دفعة مقدمة', 'Down payment') : tx(`قسط ${r.seq}`, `Installment ${r.seq}`)}</td><td><bdi>{fmtDate(r.due_on, locale)}</bdi></td><td className="num">{money(r.amount, locale)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {plan.patient_note && <p className="quote-note" dir="auto">{plan.patient_note}</p>}
        <p className="quote-fine">{tx('الأسعار من قائمة أسعار العيادة وصالحة حتى التاريخ المذكور. يُحاسَب كل بند عند تنفيذه.',
          'Prices are from the clinic price list and valid until the date shown. Each item is billed when it is done.')}</p>
      </div>
      <footer className="rx-foot">
        <div><span className="rx-sign-line" /><small>{tx('توقيع المريض / ولي الأمر', 'Patient / guardian signature')}</small></div>
        <div><span className="rx-sign-line" /><small>{tx('توقيع الطبيب', "Doctor's signature")}</small></div>
      </footer>
    </article>
  )
}

// Staff page: /dashboard/<role>/plans/:id/print
export default function QuotationPrint() {
  const { id } = useParams()
  const { tx } = useI18n()
  const { dental, base } = useClinical()
  const { data, error, reload } = useAsync(() => dental.plan(id), [id, dental])
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  return (
    <div className="page print-page">
      <PrintBar back={`${base}/plans/${id}`} label={tx('الرجوع للخطة', 'Back to the plan')} />
      <QuotationSheet plan={data.plan} items={data.items.filter((i) => i.status !== 'cancelled')}
        schedule={data.installments.length ? data.installments : data.schedule_preview} branch={data.branch} />
    </div>
  )
}
