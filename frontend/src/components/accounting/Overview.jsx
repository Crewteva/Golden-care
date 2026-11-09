import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtNumber } from '../../lib/format'
import { monthLabel, money, num, useAccounting } from './meta'

// The books at a glance: money on hand, what's owed both ways, this month and the last six, and what's waiting.
export default function Overview() {
  const { tx, pick, locale } = useI18n()
  const { api, base, dash, can, canPost, canApprove } = useAccounting()
  const { data, error, loading, reload } = useAsync(() => api.overview(), [api])

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الحسابات العامة', 'Accounting')} title={tx('نظرة عامة على الحسابات', 'The books at a glance')}
        description={tx('كل فاتورة وتحصيل واسترداد وإقفال وردية يُقيَّد تلقائيًا. هنا ترى النتيجة.', 'Every invoice, payment, refund and shift close is posted on its own. This is where it adds up.')} />
      {error ? <section className="card"><ErrorState error={error} onRetry={reload} /></section> : loading && !data ? <section className="card"><SkeletonRows rows={6} cols={4} /></section> : (
        <>
          <div className="acc-hero">
            <section className="money-card" aria-labelledby="money-h">
              <div className="money-head">
                <span id="money-h">{tx('النقدية والبنك الآن', 'Cash & bank right now')}</span>
                <strong className="num">{money(data.money_total, locale)}</strong>
              </div>
              <ul className="money-list">
                {data.money.map((a) => (
                  <li key={a.id}>
                    <span><span className="mrn">{a.code}</span>{pick(a)}</span>
                    <strong className={`num ${num(a.balance) < 0 ? 'neg' : ''}`}>{money(a.balance, locale)}</strong>
                  </li>
                ))}
              </ul>
              <Link to={`${base}/money`} className="money-link">{tx('الخزينة والتسويات', 'Cash, bank & settlements')}<Icon name="arrowRight" size={14} /></Link>
            </section>

            <section className="card month-card" aria-labelledby="month-h">
              <div className="card-head"><h2 id="month-h">{tx(`شهر ${monthLabel(data.this_month.month, locale)}`, monthLabel(data.this_month.month, locale))}</h2>
                <Link to={`${base}/reports?r=pnl`} className="link-btn">{tx('الأرباح والخسائر', 'Profit & loss')}</Link></div>
              <dl className="month-figs">
                <div><dt>{tx('الإيرادات', 'Income')}</dt><dd className="num">{money(data.this_month.income, locale)}</dd></div>
                <div><dt>{tx('المصروفات', 'Expenses')}</dt><dd className="num">{money(data.this_month.expenses, locale)}</dd></div>
                <div className="net"><dt>{tx('الصافي', 'Net')}</dt><dd className={`num ${num(data.this_month.net) < 0 ? 'neg' : 'pos'}`}>{money(data.this_month.net, locale)}</dd></div>
              </dl>
              <Bars months={data.months} />
            </section>
          </div>

          <Pending data={data} base={base} canPost={canPost} canApprove={canApprove} />

          <section className="owed-grid" aria-label={tx('الأرصدة المستحقة', 'Balances owed')}>
            <Owed icon="trending" tone="in" label={tx('مستحق على المرضى', 'Owed by patients')} value={data.owed.receivables} to={`${base}/reports?r=aging`} foot={tx('أعمار الديون', 'Aging')} />
            <Owed icon="award" label={tx('أرصدة دائنة للمرضى', 'Patient credit')} value={data.owed.patient_credit} to={`${base}/reports?r=credit`} foot={tx('كشف الأرصدة', 'Credit list')} />
            <Owed icon="package" label={tx('باقات مدفوعة لم تُستخدم', 'Prepaid packages not used')} value={data.owed.deferred_packages} foot={tx('إيراد مؤجل', 'Deferred income')} />
            <Owed icon="stethoscope" tone="out" label={tx('مستحقات الأطباء', 'Owed to doctors')} value={data.owed.doctors_payable} to={`${base}/payouts`} foot={tx('كشوف الأطباء', 'Doctor payouts')} />
            <Owed icon="layers" tone="out" label={tx('مستحقات المعامل', 'Owed to labs')} value={data.owed.labs_payable} to={`${base}/payouts?tab=labs`} foot={tx('المعامل', 'Labs')} />
            {data.owed.suppliers_payable !== undefined && <Owed icon="truck" tone="out" label={tx('مستحقات الموردين', 'Owed to suppliers')} value={data.owed.suppliers_payable} to={can('inventory.view') ? `${dash}/inventory/payables` : undefined} foot={tx('أعمار الديون', 'Aging')} />}
            {data.owed.inventory !== undefined && <Owed icon="box" tone="in" label={tx('المخزون بالتكلفة', 'Stock at cost')} value={data.owed.inventory} to={can('inventory.view') ? `${dash}/inventory/stock` : undefined} foot={tx('المخزون', 'Stock')} />}
            <Owed icon="fileSearch" tone="out" label={tx('ضريبة القيمة المضافة', 'VAT payable')} value={data.owed.vat_payable} to={`${base}/reports?r=vat`} foot={tx('تقرير الضريبة', 'VAT report')} />
          </section>

          <div className="acc-split">
            <section className="card" aria-labelledby="top-exp">
              <div className="card-head"><h2 id="top-exp">{tx('أكبر المصروفات هذا الشهر', 'Biggest expenses this month')}</h2><Link to={`${base}/expenses`} className="link-btn">{tx('كل المصروفات', 'All expenses')}</Link></div>
              {!data.top_expenses.length ? <p className="muted card-body">{tx('لا مصروفات مسجلة هذا الشهر.', 'No expenses entered this month.')}</p> : (
                <ul className="exp-bars">
                  {data.top_expenses.map((e) => {
                    const max = Math.max(...data.top_expenses.map((x) => num(x.amount)), 1)
                    return (
                      <li key={e.id}>
                        <span><span className="mrn">{e.code}</span>{pick(e)}</span>
                        <strong className="num">{money(e.amount, locale)}</strong>
                        <i style={{ '--w': `${(num(e.amount) / max) * 100}%` }} aria-hidden="true" />
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
            <section className="card" aria-labelledby="recon-h">
              <div className="card-head"><h2 id="recon-h">{tx('مطابقة الدفاتر', 'Books vs. records')}</h2></div>
              <div className="card-body recon">
                <p className="muted">{tx('رصيد الحساب في الدفتر مقابل السجلات التي يلخّصها (أرصدة المرضى، المخزون، الموردون). يجب أن يتطابقا.', "The account's balance in the books against the records it sums up (patient balances, stock, suppliers). They should match.")}</p>
                {data.checks.map((c) => {
                  const ok = Math.abs(num(c.ledger) - num(c.records)) < 0.005
                  return (
                    <div key={c.code} className={`recon-row ${ok ? 'ok' : 'bad'}`}>
                      <Icon name={ok ? 'checkCircle' : 'alert'} size={18} />
                      <span>{{
                        receivables: tx('مستحق على المرضى', 'Owed by patients'),
                        patient_credit: tx('أرصدة دائنة للمرضى', 'Patient credit'),
                        inventory: tx('المخزون بالتكلفة', 'Stock at cost'),
                        suppliers_payable: tx('مستحقات الموردين', 'Owed to suppliers'),
                        stock_in_transit: tx('مخزون في الطريق بين المخازن', 'Stock in transit'),
                      }[c.code] || c.code}</span>
                      <span className="num">{money(c.ledger, locale)}</span>
                      <span className="num muted">{ok ? tx('مطابق', 'Matches') : money(c.records, locale)}</span>
                    </div>
                  )
                })}
                {data.last_closed && <p className="foot-note muted"><Icon name="lock" size={14} />{tx(`آخر شهر مُقفل: ${monthLabel(data.last_closed, locale)}`, `Last closed month: ${monthLabel(data.last_closed, locale)}`)}</p>}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function Owed({ icon, label, value, to, foot, tone = '' }) {
  const { locale } = useI18n()
  const inner = (
    <>
      <div className="stat-label"><Icon name={icon} size={17} />{label}</div>
      <div className="stat-value num">{money(value, locale)}</div>
      <div className="stat-foot">{foot}{to && <Icon name="arrowRight" size={13} />}</div>
    </>
  )
  return to ? <Link to={to} className={`stat owed-${tone}`}>{inner}</Link> : <div className={`stat owed-${tone}`}>{inner}</div>
}

// Income against expenses for the last six months, drawn with CSS.
function Bars({ months }) {
  const { tx, locale } = useI18n()
  const max = Math.max(...months.flatMap((m) => [num(m.income), num(m.expenses)]), 1)
  return (
    <figure className="acc-bars">
      <figcaption className="bars-key">
        <span><i className="k-in" />{tx('الإيرادات', 'Income')}</span>
        <span><i className="k-out" />{tx('المصروفات', 'Expenses')}</span>
      </figcaption>
      <div className="bars-plot" role="table" aria-label={tx('آخر ستة أشهر', 'Last six months')}>
        {months.map((m) => (
          <div key={m.month} className="bars-col" role="row">
            <div className="bars-pair" role="cell" title={`${monthLabel(m.month, locale)} — ${money(m.income, locale)} / ${money(m.expenses, locale)}`}>
              <i className="b-in" style={{ '--h': `${(num(m.income) / max) * 100}%` }}><span className="sr-only">{tx('الإيرادات', 'Income')} {money(m.income, locale)}</span></i>
              <i className="b-out" style={{ '--h': `${(num(m.expenses) / max) * 100}%` }}><span className="sr-only">{tx('المصروفات', 'Expenses')} {money(m.expenses, locale)}</span></i>
            </div>
            <small role="rowheader">{monthLabel(m.month, locale, true)}</small>
          </div>
        ))}
      </div>
    </figure>
  )
}

function Pending({ data, base, canPost, canApprove }) {
  const { tx, locale } = useI18n()
  const p = data.pending
  const n = (v) => fmtNumber(v, locale)
  const items = [
    p.close_requested > 0 && { to: `${base}/months`, icon: 'lock', tone: canApprove ? 'act' : '', text: tx('طلب إقفال شهر بانتظار اعتماد الإدارة', 'A month close is waiting for management') },
    p.payouts_prepared > 0 && { to: `${base}/payouts`, icon: 'stethoscope', tone: canApprove ? 'act' : '', text: tx(`${n(p.payouts_prepared)} كشف طبيب بانتظار الاعتماد`, `${n(p.payouts_prepared)} doctor payout(s) waiting for approval`) },
    p.payouts_approved > 0 && { to: `${base}/payouts`, icon: 'cash', tone: canPost ? 'act' : '', text: tx(`${n(p.payouts_approved)} كشف معتمد جاهز للصرف`, `${n(p.payouts_approved)} approved payout(s) ready to pay`) },
    p.unsettled > 0 && { to: `${base}/money?tab=settle`, icon: 'swap', tone: canPost ? 'act' : '', text: tx(`${n(p.unsettled)} دفعة بطاقة/تحويل لم تُسوَّ مع البنك`, `${n(p.unsettled)} card / transfer payment(s) not settled with the bank`) },
  ].filter(Boolean)
  if (!items.length) return <p className="all-clear"><Icon name="checkCircle" size={18} />{tx('لا شيء ينتظرك الآن.', 'Nothing is waiting on you right now.')}</p>
  return (
    <ul className="pending-list" aria-label={tx('بانتظار إجراء', 'Waiting for action')}>
      {items.map((it) => (
        <li key={it.to + it.icon} className={it.tone}>
          <Link to={it.to}><Icon name={it.icon} size={17} /><span>{it.text}</span><Icon name="arrowRight" size={15} /></Link>
        </li>
      ))}
    </ul>
  )
}
