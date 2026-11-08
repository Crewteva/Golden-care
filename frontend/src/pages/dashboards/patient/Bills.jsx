import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../../components/Icon'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../../components/ui'
import { useAsync } from '../../../components/useAsync'
import { INSTALLMENT_STATE, InvoiceBadge, Methods, PACKAGE_STATE, StateBadge, money, num } from '../../../components/billing/meta'
import { myBillingApi } from '../../../api/billing'
import { useI18n } from '../../../i18n/I18nContext'
import { fmtDate, fmtDateTime } from '../../../lib/format'

// My bills: what I owe, my invoices and installments, my receipts, my packages and my credit.
export default function MyBills() {
  const { tx, lang, pick, locale } = useI18n()
  const { data, error, loading, reload } = useAsync(() => myBillingApi.overview(), [])
  const [tab, setTab] = useState('invoices')
  const [open, setOpen] = useState(null)
  const people = new Set((data?.invoices || []).map((i) => i.patient_id))
  const credit = (data?.credit || []).reduce((s, c) => s + num(c.balance), 0)
  const activePk = (data?.packages || []).filter((p) => p.state === 'active')
  const next = (data?.invoices || []).flatMap((i) => i.installments.filter((r) => r.state === 'due' || r.state === 'overdue' || r.state === 'partly')
    .map((r) => ({ ...r, invoice_ref: i.ref }))).sort((a, b) => (a.due_on < b.due_on ? -1 : 1))[0]

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('حسابي', 'My account')} title={tx('فواتيري ومدفوعاتي', 'My bills & payments')}
        description={tx('فواتيرك وإيصالاتك وأقساطك وباقاتك في مكان واحد. الدفع يتم في العيادة.', 'Your invoices, receipts, installments and packages in one place. Payment is made at the clinic.')} />
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <section className="card"><SkeletonRows rows={4} cols={3} /></section> : (
        <>
          <div className="acct-stats">
            <div className={`acct-stat ${num(data.owed) > 0 ? 'owed' : ''}`}><small>{tx('المتبقي عليك', 'You owe')}</small><strong className="num">{money(data.owed, locale)}</strong>
              {next && <span className="muted">{tx('القسط القادم', 'Next installment')} <bdi>{fmtDate(next.due_on, locale)}</bdi> · <span className="num">{money(next.amount, locale)}</span></span>}</div>
            <div className={`acct-stat ${credit > 0 ? 'credit' : ''}`}><small>{tx('رصيدك لدى العيادة', 'Your credit')}</small><strong className="num">{money(credit, locale)}</strong>
              {credit > 0 && <span className="muted">{tx('يُخصم من فواتيرك القادمة.', 'Taken off your next bills.')}</span>}</div>
            <div className="acct-stat"><small>{tx('باقات سارية', 'Active packages')}</small><strong className="num">{activePk.length}</strong>
              {activePk.length > 0 && <span className="muted">{tx(`${activePk.reduce((s, p) => s + p.remaining, 0)} جلسة متبقية`, `${activePk.reduce((s, p) => s + p.remaining, 0)} sessions left`)}</span>}</div>
          </div>

          <section className="card">
            <div className="toolbar">
              <div className="tabs" role="tablist" aria-label={tx('الأقسام', 'Sections')}>
                <button type="button" role="tab" aria-selected={tab === 'invoices'} onClick={() => setTab('invoices')}>{tx('الفواتير', 'Invoices')}<span className="tab-count num">{data.invoices.length}</span></button>
                <button type="button" role="tab" aria-selected={tab === 'receipts'} onClick={() => setTab('receipts')}>{tx('الإيصالات', 'Receipts')}<span className="tab-count num">{data.receipts.length}</span></button>
                <button type="button" role="tab" aria-selected={tab === 'packages'} onClick={() => setTab('packages')}>{tx('الباقات', 'Packages')}<span className="tab-count num">{data.packages.length}</span></button>
              </div>
            </div>

            {tab === 'invoices' && (!data.invoices.length ? <EmptyState icon="clipboard" title={tx('لا توجد فواتير بعد', 'No invoices yet')} /> : (
              <ul className="my-bills">
                {data.invoices.map((i) => {
                  const expanded = open === i.id
                  return (
                    <li key={i.id} className={`my-bill ${i.status === 'void' ? 'is-void' : ''}`}>
                      <button type="button" className="my-bill-head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : i.id)}>
                        <span className="my-bill-id"><strong className="mrn">{i.ref}</strong><small className="muted"><bdi>{fmtDate(i.issued_at, locale)}</bdi>{people.size > 1 && <> · {pick(i, 'patient_name')}</>}</small></span>
                        <InvoiceBadge invoice={i} />
                        <span className="my-bill-money"><strong className="num">{money(i.total, locale)}</strong>{i.status === 'issued' && num(i.balance) > 0 && <small className="neg num">{tx('متبقي', 'Due')} {money(i.balance, locale)}</small>}</span>
                        <Icon name="chevronDown" size={18} className="my-bill-chev" />
                      </button>
                      {expanded && (
                        <div className="my-bill-body">
                          <ul className="my-bill-lines">
                            {i.lines.map((l) => (
                              <li key={l.position}><span>{l[`name_${lang}`]}{l.qty > 1 && <small className="muted"> × {l.qty}</small>}</span><span className="num">{l.kind === 'package_use' ? tx('من الباقة', 'prepaid') : money(l.line_total, locale)}</span></li>
                            ))}
                            {num(i.discount_amount) > 0 && <li className="disc"><span>{tx('خصم', 'Discount')}</span><span className="num">− {money(i.discount_amount, locale)}</span></li>}
                            {num(i.vat_total) > 0 && <li><span>{tx('ضريبة القيمة المضافة', 'VAT')}</span><span className="num">{money(i.vat_total, locale)}</span></li>}
                            <li className="total"><span>{tx('الإجمالي', 'Total')}</span><strong className="num">{money(i.total, locale)}</strong></li>
                            <li><span>{tx('المدفوع', 'Paid')}</span><span className="num">{money(i.paid_total, locale)}</span></li>
                          </ul>
                          {i.installments.length > 0 && (
                            <ol className="schedule my-schedule">
                              {i.installments.map((r) => (
                                <li key={r.seq}>
                                  <span>{r.seq === 0 ? tx('المقدم', 'Down payment') : tx(`القسط ${r.seq}`, `Installment ${r.seq}`)}</span>
                                  <bdi className="muted">{fmtDate(r.due_on, locale)}</bdi>
                                  <span className="num">{money(r.amount, locale)}</span>
                                  <StateBadge state={r.state} map={INSTALLMENT_STATE} />
                                </li>
                              ))}
                            </ol>
                          )}
                          <div className="my-bill-foot">
                            <Link to={`/dashboard/patient/bills/invoices/${i.id}/print`} className="btn btn-ghost btn-sm"><Icon name="printer" size={16} />{tx('طباعة الفاتورة', 'Print invoice')}</Link>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            ))}

            {tab === 'receipts' && (!data.receipts.length ? <EmptyState icon="cash" title={tx('لا توجد إيصالات', 'No receipts yet')} /> : (
              <ul className="receipt-list">
                {data.receipts.map((r) => (
                  <li key={r.id}>
                    <span><strong className="mrn">{r.ref}</strong><small className="muted"><bdi>{fmtDateTime(r.created_at, locale)}</bdi>{r.invoice_ref && <> · {r.invoice_ref}</>}</small></span>
                    <Methods payments={r.payments} />
                    <strong className="num">{money(r.total, locale)}</strong>
                    <Link to={`/dashboard/patient/bills/receipts/${r.id}/print`} className="btn btn-quiet btn-sm btn-icon" aria-label={tx('طباعة الإيصال', 'Print receipt')}><Icon name="printer" size={16} /></Link>
                  </li>
                ))}
              </ul>
            ))}

            {tab === 'packages' && (!data.packages.length ? <EmptyState icon="package" title={tx('لا توجد باقات', 'No packages')}>{tx('اسأل في الاستقبال عن باقات الجلسات المخفّضة.', 'Ask at reception about discounted session packages.')}</EmptyState> : (
              <ul className="pk-list">
                {data.packages.map((p) => (
                  <li key={p.id} className={`pk-item s-${p.state}`}>
                    <div className="pk-main">
                      <strong>{p[`name_${lang}`]}</strong>
                      <small className="muted">{p[`service_name_${lang}`]} · <span className="mrn">{p.ref}</span></small>
                      <div className="pk-meter" role="img" aria-label={tx(`استُخدم ${p.used} من ${p.sessions_total}`, `${p.used} of ${p.sessions_total} used`)}>
                        {Array.from({ length: p.sessions_total }, (_, k) => <span key={k} className={k < p.used ? 'used' : ''} />)}
                      </div>
                    </div>
                    <div className="pk-side">
                      <StateBadge state={p.state} map={PACKAGE_STATE} />
                      <span className="num">{tx(`${p.remaining} متبقية`, `${p.remaining} left`)}</span>
                      {p.expires_on && <small className="muted">{tx('حتى', 'Until')} <bdi>{fmtDate(p.expires_on, locale)}</bdi></small>}
                    </div>
                  </li>
                ))}
              </ul>
            ))}
          </section>

          {data.credit.filter((c) => num(c.balance) > 0).length > 1 && (
            <section className="card card-body">
              <h2 className="card-title">{tx('الرصيد لكل فرد', 'Credit per person')}</h2>
              <ul className="my-bill-lines">{data.credit.map((c) => <li key={c.patient_id}><span>{pick(c, 'name')}</span><span className="num">{money(c.balance, locale)}</span></li>)}</ul>
            </section>
          )}
          <p className="muted foot-note"><Icon name="info" size={14} /> {tx('للاستفسار عن فاتورة أو طلب استرداد، تواصل مع خزينة العيادة أو من «الشكاوى والطلبات».', 'For a question about a bill or a refund, contact the clinic cashier or use "Complaints & requests".')} <Badge tone="neutral">{tx('الدفع الإلكتروني قريبًا', 'Online payment coming soon')}</Badge></p>
        </>
      )}
    </div>
  )
}
