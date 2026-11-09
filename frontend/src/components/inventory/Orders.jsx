import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync, useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'
import { ReceiveModal } from './StockModals'
import { BackLink, PO_STATE, State, cleanAmount, cleanQty, dayLabelShort, lineErr, money, num, qty, today, useInventory } from './meta'

const TABS = ['open', 'pending_approval', 'approved', 'partial', 'received', '']

export default function Orders() {
  const { tx, locale, lang } = useI18n()
  const { api, base, canManage } = useInventory()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState('open')
  const [supplier, setSupplier] = useState('')
  const [q, setQ] = useState('')
  const term = useDebounced(q.trim(), 300)
  const query = { status: status || undefined, supplier_id: supplier, q: term }
  const { data, error, loading, reload } = useAsync(() => api.orders(query), [JSON.stringify(query), api])
  const options = useAsync(() => api.options(), [api])
  const creating = params.get('new') === '1' && canManage
  const close = () => setParams({}, { replace: true })
  const labels = { open: tx('المفتوحة', 'Open'), '': tx('الكل', 'All') }
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المخازن والمشتريات', 'Stock & purchasing')} title={tx('أوامر الشراء', 'Purchase orders')}
        description={options.data && (num(options.data.approval_limit) > 0
          ? tx(`الأوامر أعلى من ${money(options.data.approval_limit, locale)} تحتاج اعتماد الإدارة قبل إرسالها للمورد.`, `Orders above ${money(options.data.approval_limit, locale)} need management approval before they go to the supplier.`)
          : tx('كل أوامر الشراء تحتاج اعتماد الإدارة.', 'Every purchase order needs management approval.'))}
        actions={canManage && <Button icon="plus" onClick={() => setParams({ new: '1' })}>{tx('أمر شراء جديد', 'New order')}</Button>} />
      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('الحالة', 'Status')}>
            {TABS.map((s) => <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>{labels[s] ?? PO_STATE[s][lang]}</button>)}
          </div>
        </div>
        <div className="toolbar filters">
          <TextField label={tx('بحث', 'Search')} icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('رقم الأمر، المورد', 'Order no., supplier')} />
          <SelectField label={tx('المورد', 'Supplier')} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={tx('كل الموردين', 'All suppliers')} options={(options.data?.suppliers || []).map((s) => ({ value: String(s.id), label: s.name }))} />
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={5} cols={6} /> : !data.length ? (
          <EmptyState icon="clipboard" title={tx('لا أوامر شراء هنا', 'No purchase orders here')} action={canManage && <Button icon="plus" onClick={() => setParams({ new: '1' })}>{tx('أمر شراء جديد', 'New order')}</Button>} />
        ) : (
          <div className="table-wrap">
            <table className="table acc-table">
              <thead><tr><th>{tx('الأمر', 'Order')}</th><th>{tx('المورد', 'Supplier')}</th><th>{tx('المخزن', 'Store')}</th><th>{tx('التاريخ', 'Ordered')}</th><th className="num">{tx('الإجمالي', 'Total')}</th><th>{tx('المستلم', 'Received')}</th><th>{tx('الحالة', 'Status')}</th></tr></thead>
              <tbody>
                {data.map((o) => (
                  <tr key={o.id}>
                    <td><Link to={`${base}/orders/${o.id}`} className="mrn">{o.ref}</Link></td>
                    <td className="cell-wrap"><strong>{o.supplier}</strong><small className="muted" style={{ display: 'block' }}>{tx(`${o.line_count} صنف`, `${o.line_count} item${o.line_count === 1 ? '' : 's'}`)}</small></td>
                    <td>{lang === 'ar' ? o.store_ar : o.store_en}</td>
                    <td><bdi>{dayLabelShort(o.ordered_on, locale)}</bdi>{o.expected_on && <small className="muted" style={{ display: 'block' }}>{tx('متوقع', 'Due')} <bdi>{dayLabelShort(o.expected_on, locale)}</bdi></small>}</td>
                    <td className="num"><strong>{money(o.total, locale)}</strong></td>
                    <td><ReceivedBar value={o.received_value} total={o.total} /></td>
                    <td><State state={o.status} map={PO_STATE} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {creating && options.data && <OrderModal options={options.data} onClose={close} onDone={() => { close(); reload() }} />}
    </div>
  )
}

function ReceivedBar({ value, total }) {
  const { locale } = useI18n()
  const pct = num(total) ? Math.min(100, Math.round((num(value) / num(total)) * 100)) : 0
  return <span className="inv-progress" title={money(value, locale)}><i style={{ '--w': `${pct}%` }} aria-hidden="true" /><small>{pct}%</small></span>
}

const blank = () => ({ key: Math.random().toString(36).slice(2), item_id: '', qty: '', unit_cost: '' })

function OrderModal({ options, order, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api, base } = useInventory()
  const toast = useToast()
  const o = order?.order
  const [head, setHead] = useState({
    supplier_id: o ? String(o.supplier_id) : '', store_id: o ? String(o.store_id) : String(options.stores.find((s) => s.is_active)?.id || ''),
    ordered_on: o?.ordered_on || today(), expected_on: o?.expected_on || '', note: o?.note || '',
  })
  const [lines, setLines] = useState(() => (order ? order.lines.map((l) => ({ ...blank(), item_id: String(l.item_id), qty: String(num(l.qty)), unit_cost: String(num(l.unit_cost)) })) : [blank()]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const items = options.items.filter((i) => i.is_active || lines.some((l) => l.item_id === String(i.id)))
  const sent = lines.filter((l) => l.item_id && num(l.qty) > 0)
  const total = sent.reduce((s, l) => s + num(l.qty) * num(l.unit_cost), 0)
  const limit = num(options.approval_limit)
  const needsApproval = limit <= 0 || total > limit
  const setH = (k) => (e) => setHead((h) => ({ ...h, [k]: e.target.value }))
  const setL = (key, k) => (e) => {
    const v = k === 'qty' ? cleanQty(e.target.value) : k === 'unit_cost' ? cleanAmount(e.target.value) : e.target.value
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [k]: v } : l)))
  }
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.saveOrder(o?.id, {
        supplier_id: Number(head.supplier_id), store_id: Number(head.store_id), ordered_on: head.ordered_on, expected_on: head.expected_on || null, note: head.note.trim() || null,
        lines: sent.map((l) => ({ item_id: Number(l.item_id), qty: l.qty, unit_cost: l.unit_cost || '0' })),
      })
      toast.success(row.status === 'pending_approval'
        ? tx(`حُفظ ${row.ref} وأُرسل لاعتماد الإدارة.`, `${row.ref} saved and sent to management for approval.`)
        : tx(`حُفظ ${row.ref} — معتمد وجاهز للإرسال للمورد.`, `${row.ref} saved — approved and ready to send to the supplier.`))
      onDone(row)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const known = Object.keys(fe).some((k) => k.startsWith('lines') || ['supplier_id', 'store_id', 'ordered_on', 'expected_on'].includes(k))
  const ready = head.supplier_id && head.store_id && sent.length > 0 && total > 0
  return (
    <Modal open wide onClose={onClose} busy={busy} title={o ? tx(`تعديل ${o.ref}`, `Edit ${o.ref}`) : tx('أمر شراء جديد', 'New purchase order')}
      description={tx('الأسعار شاملة الضريبة. بعد الاعتماد يُستلم الأمر على دفعة أو أكثر.', 'Prices include VAT. Once approved, the order can be received in one or more deliveries.')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon={needsApproval ? 'shieldCheck' : 'check'} loading={busy} disabled={!ready} onClick={submit}>{needsApproval ? tx('حفظ وإرسال للاعتماد', 'Save & send for approval') : tx('حفظ الأمر', 'Save order')}</Button></>}>
      <div className="form">
        {error && !known && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <div className="form-grid">
          <SelectField label={tx('المورد', 'Supplier')} value={head.supplier_id} onChange={setH('supplier_id')} placeholder={tx('اختر المورد', 'Choose a supplier')} data-autofocus
            options={options.suppliers.filter((s) => s.is_active || String(s.id) === head.supplier_id).map((s) => ({ value: String(s.id), label: s.name }))} error={fieldText('supplier_id', fe.supplier_id, t)} />
          <SelectField label={tx('يُسلَّم إلى مخزن', 'Deliver to store')} value={head.store_id} onChange={setH('store_id')}
            options={options.stores.filter((s) => s.is_active || String(s.id) === head.store_id).map((s) => ({ value: String(s.id), label: pick(s) }))} error={fieldText('store_id', fe.store_id, t)} />
          <TextField label={tx('تاريخ الأمر', 'Order date')} type="date" value={head.ordered_on} max={today()} onChange={setH('ordered_on')} error={fieldText('ordered_on', fe.ordered_on, t)} />
          <TextField label={tx('التسليم المتوقع', 'Expected delivery')} type="date" optional value={head.expected_on} min={head.ordered_on} onChange={setH('expected_on')} error={fieldText('expected_on', fe.expected_on, t)} />
        </div>
        <fieldset className="lines-edit">
          <legend>{tx('الأصناف', 'Items')}</legend>
          {lines.map((l) => {
            const i = sent.indexOf(l)
            const item = options.items.find((x) => String(x.id) === l.item_id)
            return (
              <div key={l.key} className="line-row three">
                <SelectField className="line-item" label={tx('الصنف', 'Item')} value={l.item_id} onChange={setL(l.key, 'item_id')} placeholder={tx('اختر الصنف', 'Choose an item')}
                  options={items.map((x) => ({ value: String(x.id), label: `${pick(x)} (${pick(x, 'unit')})`, disabled: lines.some((y) => y !== l && y.item_id === String(x.id)) }))}
                  error={i >= 0 ? fieldText('item_id', lineErr(fe, i, 'item_id'), t) : undefined} />
                <TextField label={item ? tx(`الكمية (${pick(item, 'unit')})`, `Qty (${pick(item, 'unit')})`) : tx('الكمية', 'Qty')} inputMode="decimal" dir="ltr" value={l.qty} onChange={setL(l.key, 'qty')} placeholder="0"
                  error={i >= 0 ? fieldText('qty', lineErr(fe, i, 'qty'), t) : undefined} />
                <TextField label={tx('سعر الوحدة', 'Unit price')} inputMode="decimal" dir="ltr" value={l.unit_cost} onChange={setL(l.key, 'unit_cost')} placeholder="0.00"
                  hint={num(l.qty) && num(l.unit_cost) ? money(num(l.qty) * num(l.unit_cost), locale) : undefined}
                  error={i >= 0 ? fieldText('unit_cost', lineErr(fe, i, 'unit_cost'), t) : undefined} />
                {lines.length > 1 && <button type="button" className="btn btn-quiet btn-icon line-del" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={tx('حذف السطر', 'Remove line')}><Icon name="x" size={16} /></button>}
              </div>
            )
          })}
          <div className="lines-foot">
            <Button variant="ghost" size="sm" icon="plus" onClick={() => setLines((ls) => [...ls, blank()])}>{tx('صنف آخر', 'Another item')}</Button>
            <span>{tx('الإجمالي', 'Total')} <strong className="num">{money(total, locale)}</strong></span>
          </div>
          {fe.lines && <small className="neg">{fieldText('lines', fe.lines, t)}</small>}
        </fieldset>
        {total > 0 && (
          <div className={`limit-note ${needsApproval ? 'over' : ''}`}>
            <Icon name={needsApproval ? 'shieldCheck' : 'checkCircle'} size={18} />
            <span>{needsApproval
              ? (limit <= 0 ? tx('يحتاج اعتماد الإدارة (كل الأوامر تُعتمد).', 'Needs management approval (every order does).') : tx(`أعلى من حد الاعتماد ${money(limit, locale)}: يحتاج اعتماد الإدارة.`, `Above the ${money(limit, locale)} approval limit: management must approve it.`))
              : tx(`في حدود ${money(limit, locale)}: يُعتمد تلقائيًا.`, `Within the ${money(limit, locale)} limit: approved automatically.`)}</span>
          </div>
        )}
        <TextArea label={tx('ملاحظة للمورد أو للإدارة', 'Note for the supplier or management')} optional rows={2} value={head.note} onChange={setH('note')} />
        {o && <small className="muted"><Link to={`${base}/orders/${o.id}`}>{o.ref}</Link></small>}
      </div>
    </Modal>
  )
}

export function OrderPage() {
  const { id } = useParams()
  const { tx, pick, locale } = useI18n()
  const { api, base, canManage, canApprove } = useInventory()
  const { data, error, loading, reload } = useAsync(() => api.order(id), [id, api])
  const options = useAsync(() => api.options(), [api])
  const [modal, setModal] = useState(null)
  const back = <BackLink to={`${base}/orders`}>{tx('أوامر الشراء', 'Purchase orders')}</BackLink>
  const totals = useMemo(() => {
    if (!data) return null
    return data.lines.reduce((s, l) => ({ ordered: s.ordered + num(l.amount), received: s.received + num(l.received_qty) * num(l.unit_cost) }), { ordered: 0, received: 0 })
  }, [data])
  if (error) return <div className="page">{back}<section className="card"><ErrorState error={error} onRetry={reload} /></section></div>
  if (loading && !data) return <div className="page">{back}<section className="card"><SkeletonRows rows={6} cols={5} /></section></div>
  const o = data.order
  const nothingIn = data.receipts.length === 0
  const canEdit = canManage && ['pending_approval', 'approved'].includes(o.status) && nothingIn
  const canReceive = canManage && ['approved', 'partial'].includes(o.status)
  const canCancel = canManage && ['pending_approval', 'approved', 'partial'].includes(o.status)
  const done = () => { setModal(null); reload() }
  return (
    <div className="page reveal">
      <PageHeader back={back} eyebrow={tx('أمر شراء', 'Purchase order')} title={<>{o.supplier} <span className="mrn title-ref">{o.ref}</span></>}
        description={<><State state={o.status} map={PO_STATE} /> · {tx('أنشأه', 'Created by')} {pick(o, 'created_by')} · <bdi>{dayLabelShort(o.ordered_on, locale)}</bdi></>}
        actions={<>
          {canEdit && options.data && <Button variant="ghost" icon="edit" onClick={() => setModal('edit')}>{tx('تعديل', 'Edit')}</Button>}
          {canCancel && <Button variant="ghost" icon="x" onClick={() => setModal('cancel')}>{o.status === 'partial' ? tx('إغلاق الباقي', 'Close the rest') : tx('إلغاء', 'Cancel order')}</Button>}
          {o.status === 'pending_approval' && canApprove && <>
            <Button variant="ghost" icon="x" onClick={() => setModal('reject')}>{tx('رفض', 'Reject')}</Button>
            <Button icon="shieldCheck" onClick={() => setModal('approve')}>{tx('اعتماد', 'Approve')}</Button>
          </>}
          {canReceive && options.data && <Button icon="download" onClick={() => setModal('receive')}>{tx('استلام بضاعة', 'Receive goods')}</Button>}
        </>} />

      {o.status === 'pending_approval' && (
        <Alert tone="warn" title={tx('بانتظار اعتماد الإدارة', 'Waiting for management')}>
          {num(o.approval_limit) > 0
            ? tx(`الإجمالي ${money(o.total, locale)} أعلى من حد الاعتماد ${money(o.approval_limit, locale)}. لا يُستلم شيء قبل الاعتماد.`, `The total ${money(o.total, locale)} is above the ${money(o.approval_limit, locale)} approval limit. Nothing can be received until it's approved.`)
            : tx('كل الأوامر تحتاج اعتماد الإدارة. لا يُستلم شيء قبل الاعتماد.', "Every order needs management approval. Nothing can be received until it's approved.")}
        </Alert>
      )}
      {(o.status === 'rejected' || o.cancel_reason) && (
        <Alert tone={o.status === 'rejected' ? 'danger' : 'info'} title={o.status === 'rejected' ? tx(`رفضه ${pick(o, 'decided_by')}`, `Rejected by ${pick(o, 'decided_by')}`) : tx('أُغلق الأمر', 'Order closed')}>
          {o.decision_note || o.cancel_reason}
        </Alert>
      )}

      <div className="stats inv-stats">
        <div className="stat"><div className="stat-label">{tx('إجمالي الأمر', 'Order total')}</div><div className="stat-value num">{money(o.total, locale)}</div><div className="stat-foot">{tx('شامل الضريبة', 'VAT included')}</div></div>
        <div className="stat"><div className="stat-label">{tx('المستلم', 'Received')}</div><div className="stat-value num">{money(totals.received, locale)}</div><div className="stat-foot"><ReceivedBar value={totals.received} total={o.total} /></div></div>
        <div className="stat"><div className="stat-label">{tx('المخزن', 'Store')}</div><div className="stat-value small">{pick(o, 'store')}</div>{o.expected_on && <div className="stat-foot">{tx('التسليم المتوقع', 'Expected')} <bdi>{dayLabelShort(o.expected_on, locale)}</bdi></div>}</div>
        {o.decided_by_en && o.status !== 'rejected' && <div className="stat"><div className="stat-label">{tx('اعتمده', 'Approved by')}</div><div className="stat-value small">{pick(o, 'decided_by')}</div><div className="stat-foot"><bdi>{fmtDateTime(o.decided_at, locale)}</bdi></div></div>}
      </div>

      <section className="card">
        <div className="card-head"><h2>{tx('الأصناف', 'Items')}</h2></div>
        <div className="table-wrap">
          <table className="table acc-table">
            <thead><tr><th>{tx('الصنف', 'Item')}</th><th className="num">{tx('المطلوب', 'Ordered')}</th><th className="num">{tx('المستلم', 'Received')}</th><th className="num">{tx('المتبقي', 'Left')}</th><th className="num">{tx('سعر الوحدة', 'Unit price')}</th><th className="num">{tx('القيمة', 'Amount')}</th></tr></thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.id}>
                  <td className="cell-wrap"><Link to={`${base}/stock/${l.item_id}`} className="strong-link">{pick(l)}</Link></td>
                  <td className="num">{qty(l.qty, locale)} <small className="muted">{pick(l, 'unit')}</small></td>
                  <td className="num">{qty(l.received_qty, locale)}</td>
                  <td className={`num ${num(l.remaining) > 0 && ['approved', 'partial'].includes(o.status) ? 'ink' : 'muted'}`}>{num(l.remaining) > 0 ? qty(l.remaining, locale) : '—'}</td>
                  <td className="num">{money(l.unit_cost, locale)}</td>
                  <td className="num"><strong>{money(l.amount, locale)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th colSpan={5}>{tx('الإجمالي', 'Total')}</th><th className="num">{money(o.total, locale)}</th></tr></tfoot>
          </table>
        </div>
        {o.note && <p className="muted note-line"><Icon name="info" size={14} /> {o.note}</p>}
      </section>

      <section className="card">
        <div className="card-head"><h2>{tx('الاستلامات', 'Deliveries')}</h2></div>
        {nothingIn ? <p className="muted">{['approved'].includes(o.status) ? tx('لم يصل شيء بعد.', 'Nothing has arrived yet.') : tx('لا استلامات على هذا الأمر.', 'No deliveries against this order.')}</p> : (
          <div className="table-wrap">
            <table className="table acc-table compact-table">
              <thead><tr><th>{tx('الاستلام', 'Delivery')}</th><th>{tx('التاريخ', 'Date')}</th><th>{tx('إذن التسليم', 'Delivery note')}</th><th className="num">{tx('القيمة', 'Value')}</th><th>{tx('فاتورة المورد', 'Supplier bill')}</th></tr></thead>
              <tbody>
                {data.receipts.map((r) => (
                  <tr key={r.id}>
                    <td><Link className="mrn" to={`${base}/moves?q=${encodeURIComponent(r.ref)}`}>{r.ref}</Link></td>
                    <td><bdi>{dayLabelShort(r.received_on, locale)}</bdi></td>
                    <td><bdi dir="ltr">{r.delivery_note || '—'}</bdi></td>
                    <td className="num">{money(r.total, locale)}</td>
                    <td>{r.bill_no ? <span className="mrn">{r.bill_no}</span> : <span className="muted">{tx('لم تُسجَّل بعد', 'Not entered yet')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted note-line"><Link to={`${base}/suppliers/${o.supplier_id}`} className="strong-link">{tx(`كشف حساب ${o.supplier}`, `${o.supplier} statement`)} <Icon name="arrowRight" size={13} /></Link></p>
      </section>

      {modal === 'edit' && <OrderModal options={options.data} order={data} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'receive' && <ReceiveModal options={options.data} order={data} onClose={() => setModal(null)} onDone={done} />}
      {['approve', 'reject', 'cancel'].includes(modal) && <DecideModal order={o} action={modal} onClose={() => setModal(null)} onDone={done} />}
    </div>
  )
}

function DecideModal({ order, action, onClose, onDone }) {
  const { t, tx, locale } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const needsNote = action !== 'approve'
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (action === 'cancel') await api.cancelOrder(order.id, { reason: note.trim() })
      else await api.decideOrder(order.id, { approve: action === 'approve', note: note.trim() || null })
      toast.success({ approve: tx('اعتُمد الأمر.', 'Order approved.'), reject: tx('رُفض الأمر.', 'Order rejected.'), cancel: tx('أُغلق الأمر.', 'Order closed.') }[action])
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const title = { approve: tx('اعتماد أمر الشراء', 'Approve the order'), reject: tx('رفض أمر الشراء', 'Reject the order'), cancel: order.status === 'partial' ? tx('إغلاق باقي الأمر', 'Close the rest of the order') : tx('إلغاء أمر الشراء', 'Cancel the order') }[action]
  const field = action === 'cancel' ? 'reason' : 'note'
  return (
    <Modal open onClose={onClose} busy={busy} title={title} description={<><span className="mrn">{order.ref}</span> · {order.supplier} · {money(order.total, locale)}</>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon={action === 'approve' ? 'shieldCheck' : 'x'} loading={busy} disabled={needsNote && note.trim().length < 5} onClick={submit}>{action === 'approve' ? tx('اعتماد', 'Approve') : action === 'reject' ? tx('رفض', 'Reject') : tx('تأكيد', 'Confirm')}</Button></>}>
      <div className="form">
        {error && !error.fields?.[field] && <Alert tone="danger">{errorText(error, t)}</Alert>}
        {action === 'cancel' && order.status === 'partial' && <p>{tx('ما استُلم يبقى كما هو؛ يُغلق الأمر ولا يُنتظر الباقي.', "What was received stays; the order is closed and the rest isn't expected any more.")}</p>}
        <TextArea label={needsNote ? tx('السبب', 'Reason') : tx('ملاحظة', 'Note')} optional={!needsNote} rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus error={fieldText(field, error?.fields?.[field], t)} />
      </div>
    </Modal>
  )
}
