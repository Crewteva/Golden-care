import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import { Checkbox, SelectField, TextField } from '../Fields'
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useAsync, useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { IssueModal, ReceiveModal } from './StockModals'
import { BackLink, Level, MoveChip, STOCK_STATE, State, dayLabelShort, daysBetween, daysText, downloadCsv, money, num, qty, useInventory } from './meta'

const STATUSES = ['', 'below_min', 'expiring', 'expired', 'ok']

export default function Stock() {
  const { tx, pick, locale, lang } = useI18n()
  const { api, base, canManage, canUse } = useInventory()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [store, setStore] = useState('')
  const [all, setAll] = useState(false)
  const [modal, setModal] = useState(null)
  const status = params.get('status') || ''
  const term = useDebounced(q.trim(), 300)
  const query = { q: term, category_id: category, store_id: store, status, all: all || undefined }
  const { data, error, loading, reload } = useAsync(() => api.stock(query), [JSON.stringify(query), api])
  const options = useAsync(() => api.options(), [api])
  const o = options.data
  const labels = { '': tx('الكل', 'All'), below_min: tx('تحت الحد الأدنى', 'Below minimum'), expiring: tx('ينتهي قريبًا', 'Expiring'), expired: tx('منتهي', 'Expired'), ok: tx('سليم', 'OK') }
  const setStatus = (s) => setParams(s ? { status: s } : {}, { replace: true })
  const exportCsv = () => downloadCsv(`stock-${data.today}.csv`, [
    [tx('الصنف', 'Item'), tx('التصنيف', 'Category'), tx('الوحدة', 'Unit'), tx('المتاح', 'On hand'), tx('الحد الأدنى', 'Minimum'), tx('أقرب انتهاء', 'Next expiry'), tx('القيمة', 'Value'), tx('الحالة', 'Status')],
    ...data.items.map((r) => [pick(r), pick(r, 'category'), pick(r, 'unit'), num(r.on_hand), num(r.min_qty), r.next_expiry || '', num(r.value).toFixed(2), STOCK_STATE[r.status]?.[lang]]),
  ])

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المخازن والمشتريات', 'Stock & purchasing')} title={tx('المخزون', 'Stock')}
        description={tx('الكمية المتاحة لكل صنف، قيمتها بالتكلفة، وأقرب تاريخ انتهاء. اضغط على الصنف لبطاقة الصنف وكل حركاته.', 'What is on hand for every item, its value at cost and the next expiry. Open an item for its stock card and every movement.')}
        actions={<>
          {canManage && <Button variant="ghost" icon="x" onClick={() => setModal({ kind: 'write_off' })}>{tx('إعدام', 'Write off')}</Button>}
          {canUse && <Button variant="ghost" icon="activity" onClick={() => setModal({ kind: 'use' })}>{tx('صرف', 'Use stock')}</Button>}
          {canManage && <Button icon="download" onClick={() => setModal({ kind: 'receive' })} disabled={!o}>{tx('استلام بضاعة', 'Receive goods')}</Button>}
        </>} />

      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('الحالة', 'Status')}>
            {STATUSES.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>
                {labels[s]}{data && data.counts[s] > 0 && <span className={`tab-n t-${STOCK_STATE[s].tone}`}>{data.counts[s]}</span>}
              </button>
            ))}
          </div>
          {data && <div className="toolbar-end"><span className="muted">{tx('القيمة المعروضة', 'Value shown')} <strong className="num ink">{money(data.value, locale)}</strong></span>
            <Button variant="quiet" size="sm" icon="download" onClick={exportCsv} disabled={!data.items.length}>CSV</Button></div>}
        </div>
        <div className="toolbar filters">
          <TextField label={tx('بحث', 'Search')} icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('اسم الصنف', 'Item name')} />
          <SelectField label={tx('التصنيف', 'Category')} value={category} onChange={(e) => setCategory(e.target.value)} placeholder={tx('كل التصنيفات', 'All categories')} options={(o?.categories || []).map((c) => ({ value: String(c.id), label: pick(c) }))} />
          <SelectField label={tx('المخزن', 'Store')} value={store} onChange={(e) => setStore(e.target.value)} placeholder={tx('كل المخازن', 'All stores')} options={(o?.stores || []).map((s) => ({ value: String(s.id), label: pick(s) }))} />
          <Checkbox className="filter-check" checked={all} onChange={(e) => setAll(e.target.checked)} label={tx('إظهار الأصناف الموقوفة', 'Show switched-off items')} />
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={6} cols={6} /> : !data.items.length ? (
          <EmptyState icon="package" title={tx('لا أصناف مطابقة', 'No matching items')}>
            {canManage && <Link to={`${base}/setup?tab=items`}>{tx('أضف الأصناف من القوائم', 'Add items in Lists')}</Link>}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table acc-table stock-table">
              <thead><tr><th>{tx('الصنف', 'Item')}</th><th>{tx('المتاح', 'On hand')}</th><th className="num">{tx('الحد الأدنى', 'Minimum')}</th><th>{tx('أقرب انتهاء', 'Next expiry')}</th><th className="num">{tx('القيمة', 'Value')}</th><th>{tx('الحالة', 'Status')}</th></tr></thead>
              <tbody>
                {data.items.map((r) => {
                  const days = daysBetween(data.today, r.next_expiry)
                  return (
                    <tr key={r.id} className={r.is_active ? '' : 'row-muted'}>
                      <td className="cell-wrap"><Link to={`${base}/stock/${r.id}`} className="strong-link">{pick(r)}</Link>
                        <small className="muted" style={{ display: 'block' }}>{pick(r, 'category') || tx('بدون تصنيف', 'No category')}{!r.is_active && <> · {tx('موقوف', 'Switched off')}</>}</small></td>
                      <td><div className="onhand"><strong className="num">{qty(r.on_hand, locale)}</strong> <span className="muted">{pick(r, 'unit')}</span><Level onHand={r.on_hand} min={r.min_qty} /></div></td>
                      <td className="num">{num(r.min_qty) ? qty(r.min_qty, locale) : '—'}</td>
                      <td>{r.next_expiry ? <span className={days <= 60 ? 'exp-soon' : ''}><bdi>{dayLabelShort(r.next_expiry, locale)}</bdi><small className="muted" style={{ display: 'block' }}>{daysText(days, tx)}</small></span> : <span className="muted">{r.tracks_expiry ? '—' : tx('لا يتتبع', 'Not tracked')}</span>}</td>
                      <td className="num">{money(r.value, locale)}</td>
                      <td><State state={r.status} map={STOCK_STATE} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {modal?.kind === 'receive' && o && <ReceiveModal options={o} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
      {(modal?.kind === 'use' || modal?.kind === 'write_off') && <IssueModal kind={modal.kind} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
    </div>
  )
}

export function ItemCard() {
  const { id } = useParams()
  const { tx, pick, locale } = useI18n()
  const { api, base, canManage, canUse } = useInventory()
  const [modal, setModal] = useState(null)
  const { data, error, loading, reload } = useAsync(() => api.item(id), [id, api])
  const back = <BackLink to={`${base}/stock`}>{tx('المخزون', 'Stock')}</BackLink>
  if (error) return <div className="page">{back}<section className="card"><ErrorState error={error} onRetry={reload} /></section></div>
  if (loading && !data) return <div className="page">{back}<section className="card"><SkeletonRows rows={6} cols={4} /></section></div>
  const it = data.item
  const unit = pick(it, 'unit')
  const live = data.lots.filter((l) => num(l.qty_on_hand) > 0)
  return (
    <div className="page reveal">
      <PageHeader back={back} eyebrow={tx('بطاقة صنف', 'Stock card')} title={pick(it)}
        description={<>{pick(it, 'category') || tx('بدون تصنيف', 'No category')} · {tx('الوحدة', 'Unit')}: {unit}{it.tracks_expiry && <> · {tx('يتتبع الصلاحية', 'Tracks expiry')}</>}{!it.is_active && <> · <Badge tone="neutral">{tx('موقوف', 'Switched off')}</Badge></>}{it.notes && <> · {it.notes}</>}</>}
        actions={<>
          {canManage && <Button variant="ghost" icon="x" onClick={() => setModal('write_off')} disabled={!num(data.on_hand)}>{tx('إعدام', 'Write off')}</Button>}
          {canUse && <Button icon="activity" onClick={() => setModal('use')} disabled={!num(data.usable)}>{tx('صرف', 'Use')}</Button>}
        </>} />

      <div className="stats inv-stats">
        <Fig label={tx('المتاح', 'On hand')} value={`${qty(data.on_hand, locale)} ${unit}`} foot={<Level onHand={data.on_hand} min={it.min_qty} />} tone={num(it.min_qty) && num(data.on_hand) < num(it.min_qty) ? 'warn' : ''} />
        <Fig label={tx('الصالح للاستخدام', 'Usable (not expired)')} value={`${qty(data.usable, locale)} ${unit}`} tone={num(data.usable) < num(data.on_hand) ? 'danger' : ''} />
        <Fig label={tx('الحد الأدنى', 'Minimum')} value={num(it.min_qty) ? `${qty(it.min_qty, locale)} ${unit}` : '—'} />
        <Fig label={tx('القيمة بالتكلفة', 'Value at cost')} value={money(data.value, locale)} />
        <Fig label={tx('آخر تكلفة', 'Last cost')} value={data.last_cost !== null ? money(data.last_cost, locale) : '—'} />
        <Fig label={tx('الاستهلاك آخر ٩٠ يومًا', 'Used, last 90 days')} value={`${qty(data.used_90, locale)} ${unit}`} />
      </div>

      <section className="card" aria-labelledby="lots-h">
        <div className="card-head"><h2 id="lots-h">{tx('التشغيلات', 'Lots')}</h2><span className="muted">{tx('يُصرف الأقرب انتهاءً أولًا', 'First to expire is used first')}</span></div>
        {!data.lots.length ? <p className="muted card-body">{tx('لم يُستلم هذا الصنف بعد.', 'Nothing received for this item yet.')}</p> : (
          <div className="table-wrap">
            <table className="table acc-table">
              <thead><tr><th>{tx('التشغيلة', 'Lot')}</th><th>{tx('المخزن', 'Store')}</th><th>{tx('الصلاحية', 'Expiry')}</th><th className="num">{tx('المستلم', 'Received')}</th><th className="num">{tx('المتبقي', 'Left')}</th><th className="num">{tx('تكلفة الوحدة', 'Unit cost')}</th><th>{tx('الاستلام', 'Delivery')}</th></tr></thead>
              <tbody>
                {data.lots.map((l) => {
                  const days = daysBetween(data.today, l.expiry)
                  const empty = !num(l.qty_on_hand)
                  return (
                    <tr key={l.id} className={empty ? 'row-muted' : ''}>
                      <td><bdi dir="ltr" className="mrn">{l.lot_no || '—'}</bdi>{live[0]?.id === l.id && <> <Badge tone="info">{tx('التالي للصرف', 'Next out')}</Badge></>}</td>
                      <td>{pick(l, 'store')}</td>
                      <td>{l.expiry ? <><bdi>{dayLabelShort(l.expiry, locale)}</bdi>{!empty && days < 0 ? <> <Badge tone="danger">{tx('منتهي', 'Expired')}</Badge></> : !empty && days <= 60 ? <small className="muted" style={{ display: 'block' }}>{daysText(days, tx)}</small> : null}</> : '—'}</td>
                      <td className="num">{qty(l.qty_in, locale)}</td>
                      <td className="num"><strong>{qty(l.qty_on_hand, locale)}</strong></td>
                      <td className="num">{money(l.unit_cost, locale)}</td>
                      <td><span className="mrn">{l.receipt_ref || '—'}</span>{l.supplier && <small className="muted" style={{ display: 'block' }}>{l.supplier}</small>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="mv-h">
        <div className="card-head"><h2 id="mv-h">{tx('الحركات', 'Movements')}</h2><Link to={`${base}/moves?item_id=${it.id}`} className="link-btn">{tx('في سجل الحركات', 'In the movements log')}</Link></div>
        {!data.moves.length ? <p className="muted card-body">{tx('لا حركات بعد.', 'No movements yet.')}</p> : (
          <div className="table-wrap">
            <table className="table acc-table">
              <thead><tr><th>{tx('التاريخ', 'Date')}</th><th>{tx('الحركة', 'Movement')}</th><th>{tx('المستند', 'Document')}</th><th>{tx('التشغيلة', 'Lot')}</th><th className="num">{tx('الكمية', 'Qty')}</th><th className="num">{tx('الرصيد', 'Balance')}</th><th>{tx('بواسطة', 'By')}</th></tr></thead>
              <tbody>
                {data.moves.map((m) => (
                  <tr key={m.id}>
                    <td><bdi>{dayLabelShort(m.moved_on, locale)}</bdi></td>
                    <td><MoveChip kind={m.kind} /></td>
                    <td><span className="mrn">{m.doc_ref}</span></td>
                    <td><bdi dir="ltr">{m.lot_no || '—'}</bdi></td>
                    <td className={`num ${num(m.qty) < 0 ? 'neg' : 'pos'}`}><bdi dir="ltr">{num(m.qty) > 0 ? '+' : ''}{qty(m.qty, locale)}</bdi></td>
                    <td className="num"><strong>{qty(m.balance, locale)}</strong></td>
                    <td className="muted">{pick(m, 'by')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {modal && <IssueModal kind={modal} presetItem={it.id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
    </div>
  )
}

function Fig({ label, value, foot, tone = '' }) {
  return (
    <div className={`stat ${tone ? `fig-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value num">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  )
}
