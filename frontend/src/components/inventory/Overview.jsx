import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtNumber } from '../../lib/format'
import { ReceiveModal } from './StockModals'
import { MoveChip, dayLabelShort, daysText, money, num, qty, useInventory } from './meta'

// Stock, purchasing & devices at a glance: value, alerts, what's waiting, supplier balances, devices needing care.
export default function Overview() {
  const { tx, pick, locale } = useI18n()
  const { api, base, canManage } = useInventory()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useAsync(() => api.overview(), [api])
  const options = useAsync(() => (canManage ? api.options() : Promise.resolve(null)), [api, canManage])
  const [receiving, setReceiving] = useState(false)

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المخازن والمشتريات', 'Stock & purchasing')} title={tx('المخزون والمشتريات والأجهزة', 'Stock, purchasing & devices')}
        description={tx('ما في المخازن وقيمته، ما ينقص أو تقترب صلاحيته، ما ننتظره من الموردين وما ندين به، والأجهزة التي تحتاج صيانة.', "What's in the stores and what it's worth, what's running low or expiring, what suppliers owe us and we owe them, and the devices that need care.")}
        actions={canManage && <>
          <Button variant="ghost" icon="clipboard" onClick={() => navigate(`${base}/orders?new=1`)}>{tx('أمر شراء', 'New order')}</Button>
          <Button icon="download" onClick={() => setReceiving(true)} disabled={!options.data}>{tx('استلام بضاعة', 'Receive goods')}</Button>
        </>} />
      {error ? <section className="card"><ErrorState error={error} onRetry={reload} /></section> : loading && !data ? <section className="card"><SkeletonRows rows={6} cols={4} /></section> : (
        <>
          <div className="inv-hero">
            <section className="stock-card" aria-labelledby="sv-h">
              <div className="sc-head">
                <span id="sv-h">{tx('قيمة المخزون بالتكلفة', 'Stock value at cost')}</span>
                <strong className="num">{money(data.stock_value, locale)}</strong>
                <small>{tx(`${fmtNumber(data.items, locale)} صنف نشط`, `${fmtNumber(data.items, locale)} active items`)}</small>
              </div>
              <ul className="sc-alerts">
                <AlertTile to={`${base}/stock?status=below_min`} icon="trending" n={data.counts.below_min} label={tx('تحت الحد الأدنى', 'Below minimum')} tone="warn" />
                <AlertTile to={`${base}/stock?status=expiring`} icon="clock" n={data.counts.expiring} label={tx('تنتهي خلال ٦٠ يومًا', 'Expiring in 60 days')} tone="gold" />
                <AlertTile to={`${base}/stock?status=expired`} icon="alert" n={data.counts.expired} label={tx('بها كمية منتهية', 'With expired stock')} tone="danger" />
              </ul>
              <Link to={`${base}/stock`} className="money-link">{tx('المخزون وبطاقات الأصناف', 'Stock & item cards')}<Icon name="arrowRight" size={14} /></Link>
            </section>

            <section className="card" aria-labelledby="ap-h">
              <div className="card-head"><h2 id="ap-h">{tx('مستحقات الموردين', 'Owed to suppliers')}</h2>
                <Link to={`${base}/payables`} className="link-btn">{tx('الأعمار والسداد', 'Aging & payments')}</Link></div>
              <div className="card-body">
                <Aging totals={data.payables} />
              </div>
            </section>
          </div>

          <Waiting data={data} />

          <div className="acc-split inv-split">
            <section className="card" aria-labelledby="al-h">
              <div className="card-head"><h2 id="al-h">{tx('تنبيهات المخزون', 'Stock alerts')}</h2><Link to={`${base}/stock`} className="link-btn">{tx('كل الأصناف', 'All items')}</Link></div>
              <StockAlerts alerts={data.alerts} base={base} />
            </section>
            <section className="card" aria-labelledby="dv-h">
              <div className="card-head"><h2 id="dv-h">{tx('الأجهزة', 'Devices')}</h2><Link to={`${base}/devices`} className="link-btn">{tx('سجل الأجهزة', 'Device register')}</Link></div>
              <DeviceAlerts devices={data.devices} base={base} />
            </section>
          </div>

          <section className="card" aria-labelledby="rc-h">
            <div className="card-head"><h2 id="rc-h">{tx('آخر الحركات', 'Latest movements')}</h2><Link to={`${base}/moves`} className="link-btn">{tx('كل الحركات', 'All movements')}</Link></div>
            {!data.recent.length ? <p className="muted card-body">{tx('لا حركات بعد.', 'No movements yet.')}</p> : (
              <div className="table-wrap">
                <table className="table compact-table">
                  <thead><tr><th>{tx('التاريخ', 'Date')}</th><th>{tx('الحركة', 'Movement')}</th><th>{tx('الصنف', 'Item')}</th><th className="num">{tx('الكمية', 'Qty')}</th><th>{tx('المستند', 'Document')}</th></tr></thead>
                  <tbody>
                    {data.recent.map((m) => (
                      <tr key={m.id}>
                        <td><bdi>{dayLabelShort(m.moved_on, locale)}</bdi></td>
                        <td><MoveChip kind={m.kind} /></td>
                        <td className="cell-wrap"><Link to={`${base}/stock/${m.item_id}`}>{pick(m, 'item')}</Link></td>
                        <td className={`num ${num(m.qty) < 0 ? 'neg' : 'pos'}`}><bdi dir="ltr">{num(m.qty) > 0 ? '+' : ''}{qty(m.qty, locale)}</bdi></td>
                        <td><span className="mrn">{m.doc_ref}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {receiving && options.data && <ReceiveModal options={options.data} onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); reload() }} />}
    </div>
  )
}

function AlertTile({ to, icon, n, label, tone }) {
  const { locale } = useI18n()
  return (
    <li className={`sc-tile ${n ? `on t-${tone}` : ''}`}>
      <Link to={to}><Icon name={icon} size={16} /><strong className="num">{fmtNumber(n, locale)}</strong><small>{label}</small></Link>
    </li>
  )
}

export function Aging({ totals }) {
  const { tx, locale } = useI18n()
  const buckets = [
    ['current', tx('لم يستحق', 'Not due')],
    ['d1_30', tx('١–٣٠ يوم تأخير', '1–30 days late')],
    ['d31_60', tx('٣١–٦٠', '31–60')],
    ['d61_90', tx('٦١–٩٠', '61–90')],
    ['d90_plus', tx('أكثر من ٩٠', '90+')],
  ]
  const total = num(totals.total)
  return (
    <div className="aging">
      <div className="aging-total"><small>{tx('الإجمالي المستحق', 'Total owed')}</small><strong className="num">{money(totals.total, locale)}</strong></div>
      <div className="aging-bar" aria-hidden="true">
        {buckets.map(([k]) => num(totals[k]) > 0 && <i key={k} className={`ab-${k}`} style={{ flexGrow: num(totals[k]) }} />)}
        {!total && <i className="ab-none" style={{ flexGrow: 1 }} />}
      </div>
      <dl className="aging-key">
        {buckets.map(([k, label]) => (
          <div key={k} className={num(totals[k]) ? '' : 'zero'}><dt><i className={`ab-${k}`} />{label}</dt><dd className="num">{money(totals[k], locale)}</dd></div>
        ))}
      </dl>
    </div>
  )
}

function Waiting({ data }) {
  const { tx, locale } = useI18n()
  const { base, canApprove, canDevices, canManage } = useInventory()
  const n = (v) => fmtNumber(v, locale)
  const overdue = data.devices.maintenance.filter((d) => d.maintenance_alert === 'overdue').length
  const items = [
    ...data.pending_orders.map((o) => ({ to: `${base}/orders/${o.id}`, icon: 'clipboard', tone: canApprove ? 'act' : '', text: tx(`أمر الشراء ${o.ref} (${o.supplier}، ${money(o.total, locale)}) بانتظار اعتماد الإدارة`, `Order ${o.ref} (${o.supplier}, ${money(o.total, locale)}) is waiting for management approval`) })),
    ...data.pending_counts.map((c) => ({ to: `${base}/counts/${c.id}`, icon: 'layers', tone: canApprove ? 'act' : '', text: tx(`فروق الجرد ${c.ref} بانتظار الاعتماد`, `Count ${c.ref} differences are waiting for approval`) })),
    data.open_faults > 0 && { to: `${base}/faults`, icon: 'alert', tone: canDevices ? 'act' : '', text: tx(`${n(data.open_faults)} بلاغ عطل مفتوح`, `${n(data.open_faults)} open fault report(s)`) },
    data.devices.maintenance.length > 0 && { to: `${base}/devices`, icon: 'refresh', tone: canDevices ? 'act' : '', text: overdue ? tx(`${n(overdue)} جهاز تأخرت صيانته`, `${n(overdue)} device(s) overdue for maintenance`) : tx(`${n(data.devices.maintenance.length)} جهاز تقترب صيانته`, `${n(data.devices.maintenance.length)} device(s) due for maintenance soon`) },
    data.open_orders - data.pending_orders.length > 0 && { to: `${base}/orders?status=open`, icon: 'download', tone: canManage ? '' : '', text: tx(`${n(data.open_orders - data.pending_orders.length)} أمر شراء معتمد بانتظار الاستلام`, `${n(data.open_orders - data.pending_orders.length)} approved order(s) waiting for delivery`) },
  ].filter(Boolean)
  if (!items.length) return <p className="all-clear"><Icon name="checkCircle" size={18} />{tx('لا شيء ينتظر الآن.', 'Nothing is waiting right now.')}</p>
  return (
    <ul className="pending-list" aria-label={tx('بانتظار إجراء', 'Waiting for action')}>
      {items.map((it) => (
        <li key={it.to + it.text} className={it.tone}>
          <Link to={it.to}><Icon name={it.icon} size={17} /><span>{it.text}</span><Icon name="arrowRight" size={15} /></Link>
        </li>
      ))}
    </ul>
  )
}

function StockAlerts({ alerts, base }) {
  const { tx, pick, locale } = useI18n()
  const tabs = [
    ['below_min', tx('ناقص', 'Low'), alerts.below_min],
    ['expiring', tx('ينتهي قريبًا', 'Expiring'), alerts.expiring],
    ['expired', tx('منتهي', 'Expired'), alerts.expired],
  ]
  const [tab, setTab] = useState(tabs.find((x) => x[2].length)?.[0] || 'below_min')
  const rows = tabs.find((x) => x[0] === tab)[2]
  return (
    <>
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label={tx('نوع التنبيه', 'Alert type')}>
          {tabs.map(([k, label, list]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label} <span className="tab-n">{list.length}</span></button>)}
        </div>
      </div>
      {!rows.length ? <p className="all-clear in-card"><Icon name="checkCircle" size={16} />{tx('لا شيء هنا.', 'Nothing here.')}</p> : (
        <ul className="inv-alerts">
          {rows.map((r) => tab === 'below_min' ? (
            <li key={r.id}>
              <Link to={`${base}/stock/${r.id}`}><strong>{pick(r)}</strong>
                <small className="muted">{tx(`المتاح ${qty(r.on_hand, locale)} من حد أدنى ${qty(r.min_qty, locale)} ${pick(r, 'unit')}`, `${qty(r.on_hand, locale)} on hand, minimum ${qty(r.min_qty, locale)} ${pick(r, 'unit')}`)}</small></Link>
              <span className="badge badge-warn">{tx(`ينقص ${qty(num(r.min_qty) - num(r.on_hand), locale)}`, `${qty(num(r.min_qty) - num(r.on_hand), locale)} short`)}</span>
            </li>
          ) : (
            <li key={r.id}>
              <Link to={`${base}/stock/${r.item_id}`}><strong>{pick(r)}</strong>
                <small className="muted">{tx('تشغيلة', 'Lot')} <bdi dir="ltr">{r.lot_no || '—'}</bdi> · {qty(r.qty_on_hand, locale)} {pick(r, 'unit')} · {pick(r, 'store')}</small></Link>
              <span className={`badge ${tab === 'expired' ? 'badge-danger' : 'badge-gold'}`}><bdi>{dayLabelShort(r.expiry, locale)}</bdi> · {daysText(r.days_left, tx)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function DeviceAlerts({ devices, base }) {
  const { tx, locale } = useI18n()
  const rows = [
    ...devices.not_working.map((d) => ({ d, tone: 'danger', icon: 'power', text: d.status === 'maintenance' ? tx('تحت الصيانة — لا يُستخدم', 'Under maintenance — not in use') : tx('خارج الخدمة — لا يُستخدم', 'Out of service — not in use') })),
    ...devices.maintenance.map((d) => ({ d, tone: d.maintenance_alert === 'overdue' ? 'danger' : 'warn', icon: 'refresh', text: d.maintenance_alert === 'overdue' ? tx(`الصيانة متأخرة منذ ${-d.days_to_due} يوم`, `Maintenance overdue by ${-d.days_to_due} day(s)`) : tx(`الصيانة ${daysText(d.days_to_due, tx)} (${dayLabelShort(d.next_due, locale)})`, `Maintenance ${daysText(d.days_to_due, tx)} (${dayLabelShort(d.next_due, locale)})`) })),
    ...devices.warranty.map((d) => ({ d, tone: 'gold', icon: 'shield', text: tx(`الضمان ينتهي ${dayLabelShort(d.warranty_end, locale)}`, `Warranty ends ${dayLabelShort(d.warranty_end, locale)}`) })),
  ]
  if (!rows.length) return <p className="all-clear in-card"><Icon name="checkCircle" size={16} />{tx('كل الأجهزة تعمل ولا صيانة قريبة.', 'All devices working, no maintenance due.')}</p>
  return (
    <ul className="inv-alerts">
      {rows.map(({ d, tone, icon, text }, i) => (
        <li key={`${d.id}-${i}`}>
          <Link to={`${base}/devices/${d.id}`}><strong>{d.name}</strong><small className="muted">{text}</small></Link>
          <span className={`dot-ico t-${tone}`}><Icon name={icon} size={15} /></span>
        </li>
      ))}
    </ul>
  )
}
