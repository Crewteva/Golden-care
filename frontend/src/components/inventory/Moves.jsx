import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { SelectField, TextField } from '../Fields'
import { EmptyState, ErrorState, PageHeader, Pagination, SkeletonRows } from '../ui'
import { useAsync, useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { MOVE_KIND, MoveChip, dayLabelShort, money, num, qty, useInventory } from './meta'

const KINDS = ['', 'receive', 'use', 'write_off', 'count', 'transfer_out', 'transfer_in', 'return']

// Every quantity that went in or out, with the document behind it.
export default function Moves() {
  const { tx, pick, locale, lang } = useI18n()
  const { api, base } = useInventory()
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [kind, setKind] = useState(params.get('kind') || '')
  const [itemId, setItemId] = useState(params.get('item_id') || '')
  const [store, setStore] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const term = useDebounced(q.trim(), 300)
  const query = { q: term, kind, item_id: itemId, store_id: store, date_from: from, date_to: to, page }
  const { data, error, loading, reload } = useAsync(() => api.moves(query), [JSON.stringify(query), api])
  const options = useAsync(() => api.options(), [api])
  const reset = (fn) => (e) => { fn(e.target ? e.target.value : e); setPage(1) }

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المخازن والمشتريات', 'Stock & purchasing')} title={tx('حركات المخزون', 'Stock movements')}
        description={tx('كل استلام وصرف وإعدام وتسوية جرد، بالتشغيلة والتكلفة والمستند ومن قام به.', 'Every delivery, use, write-off and count adjustment, with the lot, cost, document and who did it.')} />
      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('نوع الحركة', 'Movement type')}>
            {KINDS.map((k) => <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => reset(setKind)(k)}>{k ? MOVE_KIND[k][lang] : tx('الكل', 'All')}</button>)}
          </div>
        </div>
        <div className="toolbar filters">
          <TextField label={tx('بحث', 'Search')} icon="search" value={q} onChange={reset(setQ)} placeholder={tx('المستند، الصنف، التشغيلة', 'Document, item, lot')} />
          <SelectField label={tx('الصنف', 'Item')} value={itemId} onChange={reset(setItemId)} placeholder={tx('كل الأصناف', 'All items')} options={(options.data?.items || []).map((i) => ({ value: String(i.id), label: pick(i) }))} />
          <SelectField label={tx('المخزن', 'Store')} value={store} onChange={reset(setStore)} placeholder={tx('كل المخازن', 'All stores')} options={(options.data?.stores || []).map((s) => ({ value: String(s.id), label: pick(s) }))} />
          <TextField label={tx('من', 'From')} type="date" value={from} onChange={reset(setFrom)} />
          <TextField label={tx('إلى', 'To')} type="date" value={to} onChange={reset(setTo)} />
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={8} cols={7} /> : !data.items.length ? (
          <EmptyState icon="layers" title={tx('لا حركات مطابقة', 'No matching movements')} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table acc-table">
                <thead><tr><th>{tx('التاريخ', 'Date')}</th><th>{tx('الحركة', 'Movement')}</th><th>{tx('الصنف', 'Item')}</th><th>{tx('المخزن والتشغيلة', 'Store & lot')}</th><th className="num">{tx('الكمية', 'Qty')}</th><th className="num">{tx('القيمة', 'Value')}</th><th>{tx('المستند', 'Document')}</th><th>{tx('بواسطة', 'By')}</th></tr></thead>
                <tbody>
                  {data.items.map((m) => (
                    <tr key={m.id}>
                      <td><bdi>{dayLabelShort(m.moved_on, locale)}</bdi></td>
                      <td><MoveChip kind={m.kind} /></td>
                      <td className="cell-wrap"><Link to={`${base}/stock/${m.item_id}`}>{pick(m, 'item')}</Link></td>
                      <td className="cell-wrap">{pick(m, 'store')}<small className="muted" style={{ display: 'block' }}><bdi dir="ltr">{m.lot_no || '—'}</bdi>{m.expiry && <> · <bdi>{dayLabelShort(m.expiry, locale)}</bdi></>}</small></td>
                      <td className={`num ${num(m.qty) < 0 ? 'neg' : 'pos'}`}><bdi dir="ltr">{num(m.qty) > 0 ? '+' : ''}{qty(m.qty, locale)}</bdi></td>
                      <td className="num">{money(Math.abs(num(m.qty) * num(m.unit_cost)), locale)}</td>
                      <td><DocLink m={m} /></td>
                      <td className="muted">{pick(m, 'by')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </section>
    </div>
  )
}

function DocLink({ m }) {
  const { base } = useInventory()
  if (m.doc_type === 'count') return <Link to={`${base}/counts/${m.doc_id}`} className="mrn">{m.doc_ref}</Link>
  if (m.doc_type === 'transfer') return <Link to={`${base}/transfers/${m.doc_id}`} className="mrn">{m.doc_ref}</Link>
  if (m.doc_type === 'return') return <Link to={`${base}/returns?status=`} className="mrn">{m.doc_ref}</Link>
  return <span className="mrn">{m.doc_ref}</span>
}
