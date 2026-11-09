import { useMemo, useState } from 'react'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { ChoiceGroup, SelectField, TextArea, TextField } from '../Fields'
import { Alert, ErrorState, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { clock } from '../../lib/clinicTime'
import { cleanAmount, cleanQty, lineErr, money, num, qty, today, useInventory } from './meta'

const blankLine = () => ({ key: Math.random().toString(36).slice(2), item_id: '', qty: '', unit_cost: '', lot_no: '', expiry: '' })

// Goods arriving: against an approved order (its remaining lines) or directly from a supplier.
export function ReceiveModal({ options, order, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const items = options.items.filter((i) => i.is_active)
  const itemById = useMemo(() => Object.fromEntries(options.items.map((i) => [String(i.id), i])), [options.items])
  const [head, setHead] = useState({
    supplier_id: '', store_id: String(options.stores.find((s) => s.is_active)?.id || ''), received_on: today(), delivery_note: '', note: '',
  })
  const [lines, setLines] = useState(() => (order
    ? order.lines.filter((l) => num(l.remaining) > 0).map((l) => ({ ...blankLine(), po_line_id: l.id, item_id: String(l.item_id), qty: String(num(l.remaining)), unit_cost: String(num(l.unit_cost)), remaining: num(l.remaining), name: pick(l), unit: pick(l, 'unit'), tracks_expiry: l.tracks_expiry }))
    : [blankLine()]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const sent = lines.filter((l) => l.item_id && num(l.qty) > 0)
  const total = sent.reduce((s, l) => s + num(l.qty) * num(l.unit_cost), 0)
  const setH = (k) => (e) => setHead((h) => ({ ...h, [k]: e.target.value }))
  const setL = (key, k) => (e) => {
    const v = k === 'qty' ? cleanQty(e.target.value) : k === 'unit_cost' ? cleanAmount(e.target.value) : e.target.value
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [k]: v } : l)))
  }
  const errFor = (row, field) => {
    const i = sent.indexOf(row)
    return i < 0 ? undefined : fieldText(field, lineErr(fe, i, field), t)
  }
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const body = {
        received_on: head.received_on, delivery_note: head.delivery_note.trim() || null, note: head.note.trim() || null,
        lines: sent.map((l) => ({ po_line_id: l.po_line_id || null, item_id: Number(l.item_id), qty: l.qty, unit_cost: l.unit_cost || '0', lot_no: l.lot_no.trim() || null, expiry: l.expiry || null })),
        ...(order ? { po_id: order.order.id } : { supplier_id: Number(head.supplier_id) || null, store_id: Number(head.store_id) || null }),
      }
      const row = await api.receive(body)
      toast.success(tx(`سُجّل الاستلام ${row.ref} وأُضيف للمخزون.`, `Delivery ${row.ref} received into stock.`))
      onDone(row)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const lineKnown = Object.keys(fe).some((k) => k.startsWith('lines.'))
  const known = lineKnown || ['supplier_id', 'store_id', 'received_on'].some((k) => fe[k])
  const ready = sent.length > 0 && (order || (head.supplier_id && head.store_id)) && sent.every((l) => !itemById[l.item_id]?.tracks_expiry && !l.tracks_expiry ? true : l.expiry)
  return (
    <Modal open wide onClose={onClose} busy={busy}
      title={order ? tx(`استلام على أمر الشراء ${order.order.ref}`, `Receive against ${order.order.ref}`) : tx('استلام بضاعة مباشرة', 'Receive goods directly')}
      description={tx('تدخل المخزن بتكلفتها، وتُقيَّد: مدين المخزون، دائن الموردين. البضاعة منتهية الصلاحية تُرفض.', 'Goods enter the store at their cost and post Inventory / Suppliers payable. Expired goods are refused.')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="download" loading={busy} disabled={!ready} onClick={submit}>{total ? tx(`استلام ${money(total, locale)}`, `Receive ${money(total, locale)}`) : tx('استلام', 'Receive')}</Button></>}>
      <div className="form">
        {error && !known && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <div className="form-grid">
          {order ? (
            <div className="po-summary span-2">
              <span><small>{tx('المورد', 'Supplier')}</small><strong>{order.order.supplier}</strong></span>
              <span><small>{tx('المخزن', 'Store')}</small><strong>{pick(order.order, 'store')}</strong></span>
            </div>
          ) : (
            <>
              <SelectField label={tx('المورد', 'Supplier')} value={head.supplier_id} onChange={setH('supplier_id')} placeholder={tx('اختر المورد', 'Choose a supplier')} data-autofocus
                options={options.suppliers.filter((s) => s.is_active).map((s) => ({ value: String(s.id), label: s.name }))} error={fieldText('supplier_id', fe.supplier_id, t)} />
              <SelectField label={tx('إلى مخزن', 'Into store')} value={head.store_id} onChange={setH('store_id')}
                options={options.stores.filter((s) => s.is_active).map((s) => ({ value: String(s.id), label: pick(s) }))} error={fieldText('store_id', fe.store_id, t)} />
            </>
          )}
          <TextField label={tx('تاريخ الاستلام', 'Received on')} type="date" value={head.received_on} max={today()} min={options.first_open_day || undefined} onChange={setH('received_on')} error={fieldText('received_on', fe.received_on, t)} />
          <TextField label={tx('رقم إذن التسليم', 'Delivery note no.')} optional dir="auto" value={head.delivery_note} onChange={setH('delivery_note')} />
        </div>

        <fieldset className="lines-edit">
          <legend>{tx('الأصناف المستلمة', 'Items received')}</legend>
          {lines.map((l) => {
            const item = itemById[l.item_id]
            const expiry = l.tracks_expiry ?? item?.tracks_expiry
            return (
              <div key={l.key} className="line-row">
                {order ? (
                  <div className="line-item"><strong>{l.name}</strong><small className="muted">{tx(`المتبقي ${qty(l.remaining, locale)} ${l.unit}`, `${qty(l.remaining, locale)} ${l.unit} left to receive`)}</small></div>
                ) : (
                  <SelectField className="line-item" label={tx('الصنف', 'Item')} value={l.item_id} onChange={setL(l.key, 'item_id')} placeholder={tx('اختر الصنف', 'Choose an item')}
                    options={items.map((i) => ({ value: String(i.id), label: `${pick(i)} (${pick(i, 'unit')})` }))} error={errFor(l, 'item_id')} />
                )}
                <TextField label={order ? tx('الكمية المستلمة', 'Qty received') : tx('الكمية', 'Qty')} inputMode="decimal" dir="ltr" value={l.qty} onChange={setL(l.key, 'qty')} placeholder="0" error={errFor(l, 'qty')} />
                <TextField label={tx('تكلفة الوحدة', 'Unit cost')} inputMode="decimal" dir="ltr" value={l.unit_cost} onChange={setL(l.key, 'unit_cost')} placeholder="0.00" error={errFor(l, 'unit_cost')} />
                <TextField label={tx('رقم التشغيلة', 'Lot no.')} optional dir="ltr" value={l.lot_no} onChange={setL(l.key, 'lot_no')} error={errFor(l, 'lot_no')} />
                <TextField label={tx('الصلاحية', 'Expiry')} type="date" optional={!expiry} min={today()} value={l.expiry} onChange={setL(l.key, 'expiry')} error={errFor(l, 'expiry')} />
                {!order && lines.length > 1 && (
                  <button type="button" className="btn btn-quiet btn-icon line-del" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={tx('حذف السطر', 'Remove line')}><Icon name="x" size={16} /></button>
                )}
              </div>
            )
          })}
          <div className="lines-foot">
            {!order ? <Button variant="ghost" size="sm" icon="plus" onClick={() => setLines((ls) => [...ls, blankLine()])}>{tx('صنف آخر', 'Another item')}</Button> : <small className="muted">{tx('اترك الكمية فارغة لما لم يصل بعد.', "Leave the quantity empty for what hasn't arrived.")}</small>}
            <span>{tx('الإجمالي', 'Total')} <strong className="num">{money(total, locale)}</strong></span>
          </div>
        </fieldset>
        <TextArea label={tx('ملاحظة', 'Note')} optional rows={2} value={head.note} onChange={setH('note')} />
      </div>
    </Modal>
  )
}

// Stock leaving: used for a room / a visit / general use (FEFO), or written off with a reason.
export function IssueModal({ kind = 'use', presetItem, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const { data: o, error: loadError, reload } = useAsync(() => api.useOptions(), [api])
  const [f, setF] = useState({ store_id: '', target: 'room', room_id: '', appointment_id: '', reason: '', note: '' })
  const [lines, setLines] = useState([{ ...blankLine(), item_id: presetItem ? String(presetItem) : '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const store = f.store_id || String(o?.stores[0]?.id || '')
  const stock = useMemo(() => (o ? o.items.filter((i) => String(i.store_id) === store) : []), [o, store])
  const avail = (id) => num(stock.find((i) => String(i.id) === id)?.available)
  const sent = lines.filter((l) => l.item_id && num(l.qty) > 0)
  const over = sent.some((l) => num(l.qty) > avail(l.item_id))
  const writeOff = kind === 'write_off'
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const setL = (key, k) => (e) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [k]: k === 'qty' ? cleanQty(e.target.value) : e.target.value } : l)))
  const visit = o?.visits.find((v) => v.id === f.appointment_id)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.issue({
        kind, store_id: Number(store), note: f.note.trim() || null, reason: writeOff ? f.reason.trim() : null,
        room_id: !writeOff && f.target === 'room' && f.room_id ? Number(f.room_id) : !writeOff && f.target === 'visit' && visit?.room_id ? visit.room_id : null,
        appointment_id: !writeOff && f.target === 'visit' ? f.appointment_id || null : null,
        lines: sent.map((l) => ({ item_id: Number(l.item_id), qty: l.qty })),
      })
      toast.success(writeOff ? tx(`سُجّل الإعدام ${row.ref}.`, `Write-off ${row.ref} entered.`) : tx(`سُجّل الصرف ${row.ref}.`, `Stock use ${row.ref} entered.`))
      onDone(row)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const lineKnown = Object.keys(fe).some((k) => k.startsWith('lines.'))
  const ready = o && sent.length > 0 && !over && (!writeOff || f.reason.trim().length >= 5) && (writeOff || f.target !== 'visit' || f.appointment_id) && (writeOff || f.target !== 'room' || f.room_id)
  const rooms = o ? o.rooms.filter((r) => !o.stores.find((s) => String(s.id) === store) || r.branch_id === o.stores.find((s) => String(s.id) === store).branch_id) : []
  return (
    <Modal open wide onClose={onClose} busy={busy}
      title={writeOff ? tx('إعدام مخزون', 'Write off stock') : tx('صرف مستهلكات', 'Use stock')}
      description={writeOff
        ? tx('للتالف أو المنتهي أو المفقود. يُخصم من المخزون ويُقيَّد كخسائر مخزون.', 'For damaged, expired or lost goods. Taken out of stock and posted as a stock loss.')
        : tx('يُصرف من أقرب تشغيلة انتهاءً أولًا، ولا يمكن صرف أكثر من المتاح.', 'Taken from the lot that expires first; you can never use more than there is.')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon={writeOff ? 'x' : 'check'} loading={busy} disabled={!ready} onClick={submit}>{writeOff ? tx('إعدام', 'Write off') : tx('تسجيل الصرف', 'Record use')}</Button></>}>
      {loadError ? <ErrorState error={loadError} onRetry={reload} /> : !o ? <SkeletonRows rows={3} cols={3} /> : (
        <div className="form">
          {error && !lineKnown && !fe.reason && <Alert tone="danger">{errorText(error, t)}</Alert>}
          <div className="form-grid">
            <SelectField label={tx('من مخزن', 'From store')} value={store} onChange={set('store_id')} options={o.stores.map((s) => ({ value: String(s.id), label: pick(s) }))} error={fieldText('store_id', fe.store_id, t)} />
            {!writeOff && (
              <ChoiceGroup legend={tx('الصرف لـ', 'Used for')} name="target" value={f.target} onChange={(v) => setF((s) => ({ ...s, target: v }))}
                options={[{ value: 'room', label: tx('غرفة', 'A room') }, { value: 'visit', label: tx('زيارة مريض', "A patient's visit") }, { value: 'general', label: tx('استخدام عام', 'General use') }]} />
            )}
            {!writeOff && f.target === 'room' && (
              <SelectField label={tx('الغرفة', 'Room')} value={f.room_id} onChange={set('room_id')} placeholder={tx('اختر الغرفة', 'Choose a room')} options={rooms.map((r) => ({ value: String(r.id), label: pick(r) }))} error={fieldText('room_id', fe.room_id, t)} />
            )}
            {!writeOff && f.target === 'visit' && (
              <SelectField label={tx('زيارة اليوم', "Today's visit")} value={f.appointment_id} onChange={set('appointment_id')} placeholder={o.visits.length ? tx('اختر الزيارة', 'Choose the visit') : tx('لا زيارات اليوم', 'No visits today')}
                options={o.visits.map((v) => ({ value: v.id, label: `${clock(v.starts_at, locale)} · ${pick(v, 'patient')} · ${v.mrn}` }))} error={fieldText('appointment_id', fe.appointment_id, t)} />
            )}
          </div>
          {writeOff && <TextArea label={tx('السبب', 'Reason')} rows={2} value={f.reason} onChange={set('reason')} placeholder={tx('مثال: منتهي الصلاحية، كسر أثناء النقل', 'e.g. expired, broken in handling')} error={fieldText('reason', fe.reason, t)} />}
          <fieldset className="lines-edit">
            <legend>{tx('الأصناف', 'Items')}</legend>
            {!stock.length && <p className="muted">{tx('لا يوجد مخزون صالح في هذا المخزن.', 'No usable stock in this store.')}</p>}
            {lines.map((l, idx) => {
              const a = avail(l.item_id)
              const i = sent.indexOf(l)
              const tooMuch = l.item_id && num(l.qty) > a
              const item = stock.find((s) => String(s.id) === l.item_id)
              return (
                <div key={l.key} className="line-row two">
                  <SelectField className="line-item" label={tx('الصنف', 'Item')} value={l.item_id} onChange={setL(l.key, 'item_id')} placeholder={tx('اختر الصنف', 'Choose an item')} data-autofocus={idx === 0 || undefined}
                    options={stock.map((s) => ({ value: String(s.id), label: `${pick(s)} — ${qty(s.available, locale)} ${pick(s, 'unit')}`, disabled: lines.some((x) => x !== l && x.item_id === String(s.id)) }))}
                    error={i >= 0 ? fieldText('item_id', lineErr(fe, i, 'item_id'), t) : undefined} />
                  <TextField label={item ? tx(`الكمية (${pick(item, 'unit')})`, `Qty (${pick(item, 'unit')})`) : tx('الكمية', 'Qty')} inputMode="decimal" dir="ltr" value={l.qty} onChange={setL(l.key, 'qty')} placeholder="0"
                    hint={l.item_id ? tx(`المتاح ${qty(a, locale)}`, `${qty(a, locale)} available`) : undefined}
                    error={tooMuch ? t('field.not_enough_stock') : i >= 0 ? fieldText('qty', lineErr(fe, i, 'qty'), t) : undefined} />
                  {lines.length > 1 && <button type="button" className="btn btn-quiet btn-icon line-del" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={tx('حذف السطر', 'Remove line')}><Icon name="x" size={16} /></button>}
                </div>
              )
            })}
            <div className="lines-foot"><Button variant="ghost" size="sm" icon="plus" disabled={!stock.length} onClick={() => setLines((ls) => [...ls, blankLine()])}>{tx('صنف آخر', 'Another item')}</Button></div>
          </fieldset>
          <TextField label={tx('ملاحظة', 'Note')} optional value={f.note} onChange={set('note')} />
        </div>
      )}
    </Modal>
  )
}
