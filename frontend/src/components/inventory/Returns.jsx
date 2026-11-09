import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { RETURN_STATE, State, cleanQty, dayLabelShort, money, num, qty, useInventory } from './meta'

const TABS = ['pending', 'approved', 'rejected', '']

// Sending an exact lot back to its supplier: one person asks, someone else approves; then the stock goes out and what we owe goes down.
export default function Returns() {
  const { tx, pick, locale, lang } = useI18n()
  const { api, base, canManage, canApprove, userId } = useInventory()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState(params.get('status') ?? 'pending')
  const [supplier, setSupplier] = useState(params.get('supplier') || '')
  const query = { status: status || undefined, supplier_id: supplier || undefined }
  const { data, error, loading, reload } = useAsync(() => api.returns(query), [JSON.stringify(query), api])
  const options = useAsync(() => api.options(), [api])
  const [deciding, setDeciding] = useState(null)
  const creating = params.get('new') === '1' && canManage
  const close = () => setParams({}, { replace: true })
  const mayDecide = canApprove || canManage
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المخازن والمشتريات', 'Stock & purchasing')} title={tx('المرتجعات للموردين', 'Returns to suppliers')}
        description={tx('اختر الدفعة نفسها التي ستُرد. يعتمدها شخص غير من طلبها، فتخرج الكمية من المخزن وينقص المستحق للمورد بتكلفتها.', 'Pick the exact lot going back. Someone other than who asked approves it; then the quantity leaves the store and what we owe the supplier drops by its cost.')}
        actions={canManage && <Button icon="refresh" onClick={() => setParams({ new: '1' })}>{tx('مرتجع جديد', 'New return')}</Button>} />
      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('الحالة', 'Status')}>
            {TABS.map((s) => <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>{s ? RETURN_STATE[s][lang] : tx('الكل', 'All')}</button>)}
          </div>
        </div>
        <div className="toolbar filters">
          <SelectField label={tx('المورد', 'Supplier')} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={tx('كل الموردين', 'All suppliers')}
            options={(options.data?.suppliers || []).map((s) => ({ value: String(s.id), label: s.name }))} />
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={4} cols={6} /> : !data.length ? (
          <EmptyState icon="refresh" title={status === 'pending' ? tx('لا مرتجعات بانتظار الاعتماد', 'No returns waiting for approval') : tx('لا مرتجعات هنا', 'No returns here')}
            action={canManage && <Button icon="refresh" onClick={() => setParams({ new: '1' })}>{tx('مرتجع جديد', 'New return')}</Button>} />
        ) : (
          <div className="table-wrap">
            <table className="table acc-table">
              <thead><tr><th>{tx('المرتجع', 'Return')}</th><th>{tx('الصنف والدفعة', 'Item & lot')}</th><th className="num">{tx('الكمية', 'Qty')}</th><th className="num">{tx('القيمة', 'Amount')}</th><th>{tx('السبب', 'Reason')}</th><th>{tx('الحالة', 'Status')}</th><th><span className="sr-only">{tx('إجراء', 'Action')}</span></th></tr></thead>
              <tbody>
                {data.map((r) => {
                  const own = r.created_by === userId
                  return (
                    <tr key={r.id}>
                      <td><span className="mrn">{r.ref}</span><small className="muted" style={{ display: 'block' }}><Link to={`${base}/suppliers/${r.supplier_id}`}>{r.supplier}</Link></small></td>
                      <td className="cell-wrap"><strong>{lang === 'ar' ? r.item_ar : r.item_en}</strong>
                        <small className="muted" style={{ display: 'block' }}>{tx('دفعة', 'Lot')} <bdi dir="ltr">{r.lot_no || '—'}</bdi>{r.expiry && <> · {tx('تنتهي', 'exp.')} <bdi>{dayLabelShort(r.expiry, locale)}</bdi></>} · {lang === 'ar' ? r.store_ar : r.store_en}</small></td>
                      <td className="num">{qty(r.qty, locale)} <small className="muted">{pick(r, 'unit')}</small></td>
                      <td className="num"><strong>{money(r.amount, locale)}</strong></td>
                      <td className="cell-wrap reason-cell">{r.reason}<small className="muted" style={{ display: 'block' }}>{pick(r, 'created_by')}</small></td>
                      <td><State state={r.status} map={RETURN_STATE} />{r.decided_by_en && <small className="muted" style={{ display: 'block' }}>{pick(r, 'decided_by')}{r.returned_on && <> · <bdi>{dayLabelShort(r.returned_on, locale)}</bdi></>}</small>}
                        {r.status === 'rejected' && r.decision_note && <small className="muted" style={{ display: 'block' }}>{r.decision_note}</small>}</td>
                      <td className="row-actions">
                        {r.status === 'pending' && mayDecide && (own
                          ? <small className="muted own-note">{tx('طلبتَه — يعتمده غيرك', 'Yours — someone else approves')}</small>
                          : <Button size="sm" variant="ghost" icon="shieldCheck" onClick={() => setDeciding(r)}>{tx('مراجعة', 'Review')}</Button>)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {creating && options.data && <ReturnModal suppliers={options.data.suppliers} initialSupplier={supplier} onClose={close} onDone={() => { close(); setStatus('pending'); reload() }} />}
      {deciding && <DecideReturnModal r={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); reload() }} />}
    </div>
  )
}

function ReturnModal({ suppliers, initialSupplier, onClose, onDone }) {
  const { t, tx, locale, lang } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const [supplier, setSupplier] = useState(initialSupplier || '')
  const lots = useAsync(() => api.returnableLots({ supplier_id: supplier || undefined }), [supplier, api])
  const [form, setForm] = useState({ lot_id: '', qty: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const lot = useMemo(() => (lots.data || []).find((l) => String(l.id) === form.lot_id), [lots.data, form.lot_id])
  const amount = lot ? num(form.qty) * num(lot.unit_cost) : 0
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: k === 'qty' ? cleanQty(e.target.value) : e.target.value }))
  const label = (l) => `${lang === 'ar' ? l.item_ar : l.item_en} — ${tx('دفعة', 'lot')} ${l.lot_no || '—'}${l.expiry ? ` · ${dayLabelShort(l.expiry, locale)}` : ''} · ${lang === 'ar' ? l.store_ar : l.store_en} (${qty(l.available, locale)})`
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.requestReturn({ lot_id: Number(form.lot_id), qty: form.qty, reason: form.reason.trim() })
      toast.success(tx(`سُجّل ${row.ref} وينتظر اعتماد شخص آخر.`, `${row.ref} recorded — waiting for someone else to approve it.`))
      onDone(row)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const known = ['lot_id', 'qty', 'reason'].some((k) => fe[k])
  const over = lot && num(form.qty) > num(lot.available)
  const ready = lot && num(form.qty) > 0 && !over && form.reason.trim().length >= 5
  return (
    <Modal open wide onClose={onClose} busy={busy} title={tx('مرتجع لمورد', 'Return to a supplier')}
      description={tx('تظهر فقط الدفعات التي وردت من مورد وما زال بها رصيد (مخصومًا منها ما ينتظر الرد).', 'Only lots that came from a supplier and still have stock are listed (less anything already waiting to go back).')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="shieldCheck" loading={busy} disabled={!ready} onClick={submit}>{tx('إرسال للاعتماد', 'Send for approval')}</Button></>}>
      <div className="form">
        {error && !known && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <SelectField label={tx('المورد', 'Supplier')} value={supplier} onChange={(e) => { setSupplier(e.target.value); setForm((f) => ({ ...f, lot_id: '' })) }} placeholder={tx('كل الموردين', 'All suppliers')} data-autofocus
          options={suppliers.map((s) => ({ value: String(s.id), label: s.name }))} />
        {lots.error ? <Alert tone="danger">{errorText(lots.error, t)}</Alert> : (
          <SelectField label={tx('الدفعة', 'Lot')} value={form.lot_id} onChange={set('lot_id')} disabled={lots.loading}
            placeholder={lots.loading ? tx('جارٍ التحميل…', 'Loading…') : (lots.data || []).length ? tx('اختر الدفعة', 'Choose the lot') : tx('لا دفعات قابلة للرد', 'No lots to return')}
            options={(lots.data || []).filter((l) => num(l.available) > 0).map((l) => ({ value: String(l.id), label: supplier ? label(l) : `${l.supplier}: ${label(l)}` }))}
            error={fieldText('lot_id', fe.lot_id, t)} />
        )}
        {lot && (
          <dl className="lot-facts">
            <div><dt>{tx('المورد', 'Supplier')}</dt><dd>{lot.supplier}</dd></div>
            <div><dt>{tx('إذن الاستلام', 'Receipt')}</dt><dd><span className="mrn">{lot.receipt_ref}</span> · <bdi>{dayLabelShort(lot.received_on, locale)}</bdi></dd></div>
            <div><dt>{tx('تكلفة الوحدة', 'Unit cost')}</dt><dd className="num">{money(lot.unit_cost, locale)}</dd></div>
            <div><dt>{tx('يمكن رده', 'Can return')}</dt><dd className="num">{qty(lot.available, locale)} {lang === 'ar' ? lot.unit_ar : lot.unit_en}</dd></div>
          </dl>
        )}
        <TextField label={lot ? tx(`الكمية (${lot.unit_ar})`, `Quantity (${lot.unit_en})`) : tx('الكمية', 'Quantity')} inputMode="decimal" dir="ltr" value={form.qty} onChange={set('qty')} placeholder="0" disabled={!lot}
          hint={amount > 0 ? tx(`ينقص المستحق للمورد ${money(amount, locale)}`, `Owed to the supplier drops by ${money(amount, locale)}`) : undefined}
          error={over ? fieldText('qty', 'not_enough_stock', t) : fieldText('qty', fe.qty, t)} />
        <TextArea label={tx('سبب الرد', 'Why it goes back')} rows={2} value={form.reason} onChange={set('reason')} placeholder={tx('مثال: عبوات تالفة عند الفتح', 'e.g. damaged packs found on opening')} error={fieldText('reason', fe.reason, t)} />
      </div>
    </Modal>
  )
}

function DecideReturnModal({ r, onClose, onDone }) {
  const { t, tx, pick, locale, lang } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const decide = async (approve) => {
    setBusy(approve ? 'approve' : 'reject')
    setError(null)
    try {
      await api.decideReturn(r.id, { approve, note: note.trim() || null })
      toast.success(approve ? tx(`اعتُمد ${r.ref}: خرجت الكمية ونقص المستحق ${money(r.amount, locale)}.`, `${r.ref} approved: stock out, ${money(r.amount, locale)} off what we owe.`) : tx(`رُفض ${r.ref}.`, `${r.ref} rejected.`))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(null)
    }
  }
  return (
    <Modal open onClose={onClose} busy={!!busy} title={tx(`مراجعة ${r.ref}`, `Review ${r.ref}`)}
      description={<>{r.supplier} · {money(r.amount, locale)}</>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={!!busy}>{t('cancel')}</Button>
        <Button variant="ghost" icon="x" loading={busy === 'reject'} disabled={!!busy || note.trim().length < 5} onClick={() => decide(false)}>{tx('رفض', 'Reject')}</Button>
        <Button icon="shieldCheck" loading={busy === 'approve'} disabled={!!busy} onClick={() => decide(true)}>{tx('اعتماد الرد', 'Approve return')}</Button></>}>
      <div className="form">
        {error && !error.fields?.note && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <dl className="lot-facts">
          <div><dt>{tx('الصنف', 'Item')}</dt><dd>{lang === 'ar' ? r.item_ar : r.item_en}</dd></div>
          <div><dt>{tx('الدفعة', 'Lot')}</dt><dd><bdi dir="ltr">{r.lot_no || '—'}</bdi>{r.expiry && <> · <bdi>{dayLabelShort(r.expiry, locale)}</bdi></>}</dd></div>
          <div><dt>{tx('الكمية', 'Quantity')}</dt><dd className="num">{qty(r.qty, locale)} {pick(r, 'unit')} × {money(r.unit_cost, locale)}</dd></div>
          <div><dt>{tx('من مخزن', 'From store')}</dt><dd>{lang === 'ar' ? r.store_ar : r.store_en}</dd></div>
          <div className="wide"><dt>{tx('السبب', 'Reason')} · {pick(r, 'created_by')}</dt><dd>{r.reason}</dd></div>
        </dl>
        <TextArea label={tx('ملاحظة (مطلوبة عند الرفض)', 'Note (needed to reject)')} optional rows={2} value={note} onChange={(e) => setNote(e.target.value)} error={fieldText('note', error?.fields?.note, t)} />
      </div>
    </Modal>
  )
}
