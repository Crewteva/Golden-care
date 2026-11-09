import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { Checkbox, SelectField, TextArea, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { Aging } from './Overview'
import { SetupModal } from './Setup'
import { BackLink, PAYMENT_STATE, PO_STATE, State, cleanAmount, dayLabelShort, daysBetween, daysText, money, num, today, useInventory } from './meta'

export default function Suppliers() {
  const { tx, locale } = useI18n()
  const { api, base, canManage } = useInventory()
  const { data, error, loading, reload } = useAsync(() => api.suppliers(), [api])
  const [editing, setEditing] = useState(null)
  const total = (data || []).reduce((s, r) => s + num(r.balance), 0)
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المخازن والمشتريات', 'Stock & purchasing')} title={tx('الموردون', 'Suppliers')}
        description={tx('رصيد كل مورد من البضاعة المستلمة وفواتير الصيانة الآجلة، ناقص ما دُفع له.', "Each supplier's balance: goods received and maintenance on credit, less what was paid.")}
        actions={<>
          <Link className="btn btn-ghost" to={`${base}/payables`}><Icon name="calendar" size={16} />{tx('أعمار المستحقات', 'Payables aging')}</Link>
          {canManage && <Button icon="plus" onClick={() => setEditing({})}>{tx('مورد جديد', 'New supplier')}</Button>}
        </>} />
      <section className="card">
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={4} cols={5} /> : !data.length ? (
          <EmptyState icon="briefcase" title={tx('لا موردين بعد', 'No suppliers yet')} action={canManage && <Button icon="plus" onClick={() => setEditing({})}>{tx('مورد جديد', 'New supplier')}</Button>} />
        ) : (
          <div className="table-wrap">
            <table className="table acc-table">
              <thead><tr><th>{tx('المورد', 'Supplier')}</th><th>{tx('التواصل', 'Contact')}</th><th>{tx('مدة السداد', 'Terms')}</th><th>{tx('آخر استلام', 'Last delivery')}</th><th>{tx('أوامر مفتوحة', 'Open orders')}</th><th className="num">{tx('الرصيد المستحق', 'Balance owed')}</th>{canManage && <th />}</tr></thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id} className={s.is_active ? '' : 'row-off'}>
                    <td className="cell-wrap"><Link to={`${base}/suppliers/${s.id}`} className="strong-link">{s.name}</Link>{!s.is_active && <> <Badge>{tx('موقوف', 'Off')}</Badge></>}</td>
                    <td className="cell-wrap">{s.contact_name || '—'}{s.phone && <small className="muted" style={{ display: 'block' }}><bdi dir="ltr">{s.phone}</bdi></small>}</td>
                    <td>{tx(`${s.payment_terms_days} يوم`, `${s.payment_terms_days} days`)}</td>
                    <td>{s.last_received ? <bdi>{dayLabelShort(s.last_received, locale)}</bdi> : <span className="muted">—</span>}</td>
                    <td>{s.open_orders ? <Badge tone="info">{s.open_orders}</Badge> : <span className="muted">—</span>}</td>
                    <td className="num"><strong className={num(s.balance) > 0 ? 'ink' : 'muted'}>{money(s.balance, locale)}</strong></td>
                    {canManage && <td className="row-actions"><button type="button" className="btn btn-quiet btn-icon" onClick={() => setEditing(s)} aria-label={tx(`تعديل ${s.name}`, `Edit ${s.name}`)}><Icon name="edit" size={16} /></button></td>}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th colSpan={5}>{tx('إجمالي المستحق للموردين', 'Total owed to suppliers')}</th><th className="num">{money(total, locale)}</th>{canManage && <th />}</tr></tfoot>
            </table>
          </div>
        )}
      </section>
      {editing && <SetupModal kind="suppliers" row={editing.id ? editing : null} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />}
    </div>
  )
}

const KIND_LABEL = {
  receipt: { ar: 'استلام بضاعة', en: 'Goods received', icon: 'download' },
  maintenance: { ar: 'صيانة آجلة', en: 'Maintenance on credit', icon: 'wrench' },
  payment: { ar: 'دفعة', en: 'Payment', icon: 'cash' },
  return: { ar: 'مرتجع', en: 'Returned goods', icon: 'refresh' },
}

export function SupplierPage() {
  const { id } = useParams()
  const { tx, locale, lang } = useI18n()
  const { api, base, canManage, canPay } = useInventory()
  const { data, error, loading, reload } = useAsync(() => api.supplier(id), [id, api])
  const options = useAsync(() => (canPay ? api.options() : Promise.resolve(null)), [api, canPay])
  const [modal, setModal] = useState(null)
  const back = <BackLink to={`${base}/suppliers`}>{tx('الموردون', 'Suppliers')}</BackLink>
  if (error) return <div className="page">{back}<section className="card"><ErrorState error={error} onRetry={reload} /></section></div>
  if (loading && !data) return <div className="page">{back}<section className="card"><SkeletonRows rows={6} cols={5} /></section></div>
  const s = data.supplier
  const unbilled = [...data.unbilled.receipts, ...data.unbilled.maintenance]
  const openBills = data.bills.filter((b) => num(b.open) > 0)
  const done = () => { setModal(null); reload() }
  return (
    <div className="page reveal">
      <PageHeader back={back} eyebrow={tx('كشف حساب مورد', 'Supplier statement')} title={s.name}
        description={[s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || tx(`السداد خلال ${s.payment_terms_days} يوم`, `Pays within ${s.payment_terms_days} days`)}
        actions={<>
          {canManage && <Button variant="ghost" icon="edit" onClick={() => setModal('edit')}>{tx('تعديل', 'Edit')}</Button>}
          {canPay && unbilled.length > 0 && <Button variant="ghost" icon="clipboard" onClick={() => setModal('bill')}>{tx('تسجيل فاتورة المورد', 'Enter supplier bill')}</Button>}
          {canManage && <Link className="btn btn-ghost" to={`${base}/returns?new=1&supplier=${s.id}`}><Icon name="refresh" size={16} />{tx('رد دفعة للمورد', 'Return a lot')}</Link>}
          {canPay && num(data.balance) > 0 && options.data && <Button icon="cash" onClick={() => setModal('pay')}>{tx('إعداد دفعة', 'Prepare a payment')}</Button>}
        </>} />

      {data.requests.length > 0 && <PaymentRequests rows={data.requests} onDone={reload} compact />}

      <div className="inv-hero sup-hero">
        <div className="stock-card">
          <div className="sc-head">
            <small>{tx('الرصيد المستحق', 'Balance owed')}</small>
            <strong className="num">{money(data.balance, locale)}</strong>
            <span>{tx(`مدة السداد ${s.payment_terms_days} يوم`, `${s.payment_terms_days}-day terms`)}{data.aging.oldest_due && <> · {tx('أقدم استحقاق', 'oldest due')} <bdi>{dayLabelShort(data.aging.oldest_due, locale)}</bdi></>}</span>
          </div>
          <div className="sc-alerts">
            <div className={`sc-tile ${unbilled.length ? 'on t-gold' : ''}`}><strong>{unbilled.length}</strong><span>{tx('بلا فاتورة مورد', 'Not billed yet')}</span></div>
            <div className={`sc-tile ${openBills.length ? 'on t-warn' : ''}`}><strong>{openBills.length}</strong><span>{tx('فواتير غير مسددة', 'Unpaid bills')}</span></div>
            <div className="sc-tile"><strong>{data.orders.filter((o) => ['pending_approval', 'approved', 'partial'].includes(o.status)).length}</strong><span>{tx('أوامر مفتوحة', 'Open orders')}</span></div>
          </div>
        </div>
        <section className="card"><div className="card-head"><h2>{tx('أعمار المستحق', 'Aging')}</h2></div><Aging totals={data.aging} /></section>
      </div>

      {canPay && unbilled.length > 0 && (
        <Alert tone="info" title={tx('استلامات بلا فاتورة مورد', 'Deliveries without a supplier bill')}>
          {tx('سجّل رقم فاتورة المورد عند وصولها ليُحسب تاريخ الاستحقاق منها. حتى ذلك، يُحسب الاستحقاق من تاريخ الاستلام.', 'Enter the supplier’s bill number when it arrives so the due date runs from the bill. Until then, it runs from the delivery date.')}
        </Alert>
      )}

      <section className="card">
        <div className="card-head"><h2>{tx('الحركات', 'Statement')}</h2></div>
        {!data.rows.length ? <p className="muted">{tx('لا حركات بعد.', 'Nothing yet.')}</p> : (
          <div className="table-wrap">
            <table className="table acc-table">
              <thead><tr><th>{tx('التاريخ', 'Date')}</th><th>{tx('الحركة', 'Entry')}</th><th>{tx('البيان', 'Detail')}</th><th>{tx('فاتورة المورد', 'Supplier bill')}</th><th className="num">{tx('عليه لنا', 'Owed')}</th><th className="num">{tx('مدفوع', 'Paid')}</th><th className="num">{tx('الرصيد', 'Balance')}</th></tr></thead>
              <tbody>
                {data.rows.map((r) => {
                  const k = KIND_LABEL[r.kind]
                  return (
                    <tr key={`${r.kind}-${r.id}`}>
                      <td><bdi>{dayLabelShort(r.day, locale)}</bdi></td>
                      <td><span className={`src-chip g-${r.kind === 'payment' || r.kind === 'return' ? 'money' : 'stock'}`}><Icon name={k.icon} size={12} />{k[lang]}</span> <span className="mrn">{r.ref}</span></td>
                      <td className="cell-wrap muted">{r.detail || '—'}</td>
                      <td>{r.bill_no ? <span className="mrn">{r.bill_no}</span> : r.kind === 'payment' || r.kind === 'return' ? <span className="muted">{tx('على الحساب', 'On account')}</span> : <span className="muted">—</span>}</td>
                      <td className="num">{num(r.owed) ? money(r.owed, locale) : '—'}</td>
                      <td className="num pos">{num(r.paid) ? money(r.paid, locale) : '—'}</td>
                      <td className="num"><strong>{money(r.balance, locale)}</strong></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="acc-split inv-split">
        <section className="card">
          <div className="card-head"><h2>{tx('فواتير المورد', 'Supplier bills')}</h2></div>
          {!data.bills.length ? <p className="muted">{tx('لم تُسجَّل فواتير بعد.', 'No bills entered yet.')}</p> : <BillsTable bills={data.bills} />}
        </section>
        <section className="card">
          <div className="card-head"><h2>{tx('أوامر الشراء', 'Purchase orders')}</h2></div>
          {!data.orders.length ? <p className="muted">{tx('لا أوامر بعد.', 'No orders yet.')}</p> : (
            <ul className="alert-list">
              {data.orders.map((o) => (
                <li key={o.id}>
                  <Link to={`${base}/orders/${o.id}`} className="mrn">{o.ref}</Link>
                  <span className="muted"><bdi>{dayLabelShort(o.ordered_on, locale)}</bdi></span>
                  <strong className="num">{money(o.total, locale)}</strong>
                  <State state={o.status} map={PO_STATE} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {modal === 'edit' && <SetupModal kind="suppliers" row={s} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'bill' && <BillModal supplier={s} unbilled={data.unbilled} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'pay' && <PayModal supplier={s} balance={data.balance} bills={openBills} options={options.data} onClose={() => setModal(null)} onDone={done} />}
    </div>
  )
}

export function BillsTable({ bills, showSupplier }) {
  const { tx, locale } = useI18n()
  const { base } = useInventory()
  const now = today()
  return (
    <div className="table-wrap">
      <table className="table acc-table compact-table">
        <thead><tr><th>{tx('الفاتورة', 'Bill')}</th>{showSupplier && <th>{tx('المورد', 'Supplier')}</th>}<th>{tx('الاستحقاق', 'Due')}</th><th className="num">{tx('القيمة', 'Amount')}</th><th className="num">{tx('المتبقي', 'Open')}</th></tr></thead>
        <tbody>
          {bills.map((b) => {
            const late = num(b.open) > 0 ? daysBetween(b.due_date, now) : null
            return (
              <tr key={b.id}>
                <td><span className="mrn">{b.bill_no}</span><small className="muted" style={{ display: 'block' }}><bdi>{dayLabelShort(b.bill_date, locale)}</bdi></small></td>
                {showSupplier && <td className="cell-wrap"><Link to={`${base}/suppliers/${b.supplier_id}`}>{b.supplier}</Link></td>}
                <td><bdi>{dayLabelShort(b.due_date, locale)}</bdi>{late !== null && <small className={late > 0 ? 'neg' : 'muted'} style={{ display: 'block' }}>{late > 0 ? tx(`متأخرة ${late} يوم`, `${late} days late`) : daysText(-late, tx)}</small>}</td>
                <td className="num">{money(b.amount, locale)}</td>
                <td className="num">{num(b.open) > 0 ? <strong>{money(b.open, locale)}</strong> : <Badge tone="success">{tx('مسددة', 'Paid')}</Badge>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BillModal({ supplier, unbilled, onClose, onDone }) {
  const { t, tx, locale } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const all = [...unbilled.receipts.map((r) => ({ ...r, kind: 'receipt' })), ...unbilled.maintenance.map((m) => ({ ...m, kind: 'maintenance' }))]
  const [picked, setPicked] = useState(() => new Set(all.map((r) => r.id)))
  const [f, setF] = useState({ bill_no: '', bill_date: today(), note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const total = all.filter((r) => picked.has(r.id)).reduce((s, r) => s + num(r.amount), 0)
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.addBill({
        supplier_id: supplier.id, bill_no: f.bill_no.trim(), bill_date: f.bill_date, note: f.note.trim() || null,
        receipt_ids: all.filter((r) => r.kind === 'receipt' && picked.has(r.id)).map((r) => r.id),
        maintenance_ids: all.filter((r) => r.kind === 'maintenance' && picked.has(r.id)).map((r) => r.id),
      })
      toast.success(tx(`سُجّلت الفاتورة ${row.bill_no}؛ تستحق ${dayLabelShort(row.due_date, locale)}.`, `Bill ${row.bill_no} entered; due ${dayLabelShort(row.due_date, locale)}.`))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const known = ['bill_no', 'bill_date', 'receipt_ids'].some((k) => fe[k])
  return (
    <Modal open wide onClose={onClose} busy={busy} title={tx('تسجيل فاتورة المورد', 'Enter the supplier’s bill')}
      description={tx(`اختر ما تغطيه الفاتورة. تستحق بعد ${supplier.payment_terms_days} يوم من تاريخها. لا قيد جديد: المبلغ مسجّل وقت الاستلام.`, `Tick what the bill covers. It falls due ${supplier.payment_terms_days} days after its date. No new journal entry: the amount was posted on delivery.`)}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="check" loading={busy} disabled={!f.bill_no.trim() || !picked.size} onClick={submit}>{tx(`تسجيل ${money(total, locale)}`, `Enter ${money(total, locale)}`)}</Button></>}>
      <div className="form">
        {error && !known && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <div className="form-grid">
          <TextField label={tx('رقم فاتورة المورد', 'Supplier bill no.')} dir="ltr" value={f.bill_no} onChange={set('bill_no')} data-autofocus error={fieldText('bill_no', fe.bill_no, t)} />
          <TextField label={tx('تاريخ الفاتورة', 'Bill date')} type="date" max={today()} value={f.bill_date} onChange={set('bill_date')} error={fieldText('bill_date', fe.bill_date, t)} />
        </div>
        <fieldset className="pick-list">
          <legend>{tx('تغطي', 'Covers')}</legend>
          {all.map((r) => (
            <Checkbox key={r.id} checked={picked.has(r.id)} onChange={() => toggle(r.id)}
              label={<span className="pick-row"><span className="mrn">{r.ref}</span><span>{r.kind === 'receipt' ? (r.po_ref || r.delivery_note || tx('استلام مباشر', 'Direct delivery')) : r.device}</span><bdi className="muted">{dayLabelShort(r.day, locale)}</bdi><strong className="num">{money(r.amount, locale)}</strong></span>} />
          ))}
          {fe.receipt_ids && <small className="neg">{fieldText('receipt_ids', fe.receipt_ids, t)}</small>}
        </fieldset>
        <TextField label={tx('ملاحظة', 'Note')} optional value={f.note} onChange={set('note')} />
      </div>
    </Modal>
  )
}

export function PayModal({ supplier, balance, bills, options, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const accounts = options.money_accounts
  const [f, setF] = useState({ bill_id: bills[0]?.id || '', amount: String(num(bills[0]?.open || balance)), paid_from_id: String(accounts[0]?.id || ''), paid_on: today(), reference: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const bill = bills.find((b) => b.id === f.bill_id)
  const cap = bill ? num(bill.open) : num(balance)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: k === 'amount' ? cleanAmount(e.target.value) : e.target.value }))
  const pickBill = (e) => {
    const b = bills.find((x) => x.id === e.target.value)
    setF((s) => ({ ...s, bill_id: e.target.value, amount: String(num(b ? b.open : balance)) }))
  }
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.preparePayment({ supplier_id: supplier.id, bill_id: f.bill_id || null, paid_on: f.paid_on, amount: f.amount, paid_from_id: Number(f.paid_from_id), reference: f.reference.trim() || null, note: f.note.trim() || null })
      toast.success(tx(`أُعدّت الدفعة ${row.ref}. لا تُقيَّد قبل أن يعتمدها شخص آخر.`, `Payment ${row.ref} prepared. Nothing is posted until someone else approves it.`))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const known = ['amount', 'paid_from_id', 'paid_on', 'bill_id'].some((k) => fe[k])
  return (
    <Modal open onClose={onClose} busy={busy} title={tx(`إعداد دفعة إلى ${supplier.name}`, `Prepare a payment to ${supplier.name}`)}
      description={tx(`المستحق ${money(balance, locale)}. الدفع بخطوتين: تُعدّها أنت، ويعتمدها شخص آخر فتُقيَّد (مدين الموردين، دائن الحساب الذي دُفع منه).`, `${money(balance, locale)} owed. Two steps: you prepare it, someone else approves it, and only then is it posted (Suppliers payable / the account it was paid from).`)}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="shieldCheck" loading={busy} disabled={!num(f.amount) || num(f.amount) > cap || !f.paid_from_id} onClick={submit}>{tx(`إعداد ${money(f.amount, locale)} للاعتماد`, `Prepare ${money(f.amount, locale)} for approval`)}</Button></>}>
      <div className="form">
        {error && !known && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <SelectField label={tx('عن فاتورة', 'Against bill')} value={f.bill_id} onChange={pickBill} placeholder={tx('على الحساب (الأقدم أولًا)', 'On account (oldest first)')}
          options={bills.map((b) => ({ value: b.id, label: `${b.bill_no} · ${money(b.open, locale)} · ${tx('تستحق', 'due')} ${dayLabelShort(b.due_date, locale)}` }))} error={fieldText('bill_id', fe.bill_id, t)} />
        <div className="form-grid">
          <TextField label={tx('المبلغ', 'Amount')} inputMode="decimal" dir="ltr" value={f.amount} onChange={set('amount')} data-autofocus
            hint={tx(`حتى ${money(cap, locale)}`, `Up to ${money(cap, locale)}`)} error={num(f.amount) > cap ? t(bill ? 'field.more_than_bill' : 'field.more_than_owed') : fieldText('amount', fe.amount, t)} />
          <TextField label={tx('تاريخ الدفع', 'Paid on')} type="date" max={today()} min={options.first_open_day || undefined} value={f.paid_on} onChange={set('paid_on')} error={fieldText('paid_on', fe.paid_on, t)} />
        </div>
        <SelectField label={tx('دُفع من', 'Paid from')} value={f.paid_from_id} onChange={set('paid_from_id')} options={accounts.map((a) => ({ value: String(a.id), label: `${a.code} · ${pick(a)}` }))} error={fieldText('paid_from_id', fe.paid_from_id, t)} />
        <TextField label={tx('المرجع (رقم التحويل أو الشيك)', 'Reference (transfer or cheque no.)')} optional dir="ltr" value={f.reference} onChange={set('reference')} />
        <TextArea label={tx('ملاحظة', 'Note')} optional rows={2} value={f.note} onChange={set('note')} />
      </div>
    </Modal>
  )
}

// Supplier payments waiting for (or past) the second person. Approvers: purchasing or management, never who prepared it.
function PaymentRequests({ rows, onDone, compact }) {
  const { tx, pick, locale } = useI18n()
  const { base, canPay, canApprove, userId } = useInventory()
  const [deciding, setDeciding] = useState(null)
  const waiting = rows.filter((r) => r.status === 'prepared')
  const shown = compact ? waiting : rows.slice(0, 12)
  if (!shown.length) return null
  const mayDecide = canPay || canApprove
  return (
    <section className={`card pay-approvals ${waiting.length ? 'has-waiting' : ''}`} aria-labelledby="pay-req-h">
      <div className="card-head">
        <h2 id="pay-req-h"><Icon name="shieldCheck" size={18} />{tx('دفعات بانتظار الاعتماد', 'Payments awaiting approval')}{waiting.length > 0 && <span className="count-pill">{waiting.length}</span>}</h2>
      </div>
      <p className="muted card-sub">{tx('الدفعة لا تُقيَّد ولا تُخصم من الخزينة حتى يعتمدها شخص غير من أعدّها.', "A payment isn't posted or taken from cash until someone other than its preparer approves it.")}</p>
      <ul className="req-list">
        {shown.map((r) => {
          const own = r.prepared_by === userId
          return (
            <li key={r.id} className={`st-${r.status}`}>
              <span className="req-main">
                <strong className="num">{money(r.amount, locale)}</strong>
                <span>{compact ? r.supplier : <Link to={`${base}/suppliers/${r.supplier_id}`} className="strong-link">{r.supplier}</Link>}</span>
                <small className="muted"><span className="mrn">{r.ref}</span> · {pick(r, 'paid_from')} · <bdi>{dayLabelShort(r.paid_on, locale)}</bdi>{r.bill_no && <> · {tx('فاتورة', 'bill')} <span className="mrn">{r.bill_no}</span></>}</small>
                <small className="muted">{tx('أعدّها', 'Prepared by')} {pick(r, 'prepared_by')}{r.decided_by_en && <> · {r.status === 'approved' ? tx('اعتمدها', 'approved by') : tx('رفضها', 'rejected by')} {pick(r, 'decided_by')}</>}{r.payment_ref && <> · <span className="mrn">{r.payment_ref}</span></>}</small>
                {r.status === 'rejected' && r.decision_note && <small className="neg">{r.decision_note}</small>}
              </span>
              <span className="req-side">
                <State state={r.status} map={PAYMENT_STATE} />
                {r.status === 'prepared' && mayDecide && (own
                  ? <small className="muted own-note">{tx('أعددتَها — يعتمدها غيرك', 'Yours — someone else approves')}</small>
                  : <Button size="sm" icon="shieldCheck" onClick={() => setDeciding(r)}>{tx('مراجعة', 'Review')}</Button>)}
              </span>
            </li>
          )
        })}
      </ul>
      {deciding && <DecidePaymentModal r={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); onDone() }} />}
    </section>
  )
}

function DecidePaymentModal({ r, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const decide = async (approve) => {
    setBusy(approve ? 'approve' : 'reject')
    setError(null)
    try {
      await api.decidePayment(r.id, { approve, note: note.trim() || null })
      toast.success(approve ? tx(`اعتُمدت ${r.ref} وقُيّدت: ${money(r.amount, locale)} إلى ${r.supplier}.`, `${r.ref} approved and posted: ${money(r.amount, locale)} to ${r.supplier}.`) : tx(`رُفضت ${r.ref}.`, `${r.ref} rejected.`))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(null)
    }
  }
  return (
    <Modal open onClose={onClose} busy={!!busy} title={tx(`اعتماد دفعة ${r.ref}`, `Approve payment ${r.ref}`)}
      description={<>{r.supplier} · <strong>{money(r.amount, locale)}</strong></>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={!!busy}>{t('cancel')}</Button>
        <Button variant="ghost" icon="x" loading={busy === 'reject'} disabled={!!busy || note.trim().length < 5} onClick={() => decide(false)}>{tx('رفض', 'Reject')}</Button>
        <Button icon="shieldCheck" loading={busy === 'approve'} disabled={!!busy} onClick={() => decide(true)}>{tx('اعتماد وقيد', 'Approve & post')}</Button></>}>
      <div className="form">
        {error && !error.fields?.note && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <dl className="lot-facts">
          <div><dt>{tx('من حساب', 'Paid from')}</dt><dd>{pick(r, 'paid_from')}</dd></div>
          <div><dt>{tx('تاريخ الدفع', 'Paid on')}</dt><dd><bdi>{dayLabelShort(r.paid_on, locale)}</bdi></dd></div>
          <div><dt>{tx('عن', 'Against')}</dt><dd>{r.bill_no ? <span className="mrn">{r.bill_no}</span> : tx('على الحساب (الأقدم أولًا)', 'On account (oldest first)')}</dd></div>
          <div><dt>{tx('أعدّها', 'Prepared by')}</dt><dd>{pick(r, 'prepared_by')}</dd></div>
          {r.reference && <div><dt>{tx('المرجع', 'Reference')}</dt><dd><bdi dir="ltr">{r.reference}</bdi></dd></div>}
          {r.note && <div className="wide"><dt>{tx('ملاحظة', 'Note')}</dt><dd>{r.note}</dd></div>}
        </dl>
        <TextArea label={tx('ملاحظة (مطلوبة عند الرفض)', 'Note (needed to reject)')} optional rows={2} value={note} onChange={(e) => setNote(e.target.value)} error={fieldText('note', error?.fields?.note, t)} />
      </div>
    </Modal>
  )
}

export function Payables() {
  const { tx, pick, locale } = useI18n()
  const { api, base, canPay } = useInventory()
  const { data, error, loading, reload } = useAsync(() => api.payables(), [api])
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المخازن والمشتريات', 'Stock & purchasing')} title={tx('مستحقات الموردين', 'Supplier payables')}
        description={tx('ما على العيادة لكل مورد حسب تاريخ الاستحقاق. الفواتير تستحق بعد مدة السداد من تاريخها؛ الاستلامات بلا فاتورة من تاريخ الاستلام.', 'What the clinic owes each supplier by due date. Bills fall due their payment terms after the bill date; deliveries without a bill, after the delivery date.')} />
      {error ? <section className="card"><ErrorState error={error} onRetry={reload} /></section> : loading && !data ? <section className="card"><SkeletonRows rows={6} cols={6} /></section> : (
        <>
          <PaymentRequests rows={data.requests} onDone={reload} />
          <div className="inv-hero">
            <section className="card"><div className="card-head"><h2>{tx('الإجمالي', 'All suppliers')}</h2></div><Aging totals={data.totals} /></section>
            <section className="card">
              <div className="card-head"><h2>{tx('تستحق خلال ١٤ يوم', 'Due within 14 days')}</h2></div>
              {!data.due_soon.length ? <div className="all-clear in-card"><Icon name="checkCircle" size={22} /><span>{tx('لا شيء مستحق قريبًا.', 'Nothing falls due soon.')}</span></div> : <BillsTable bills={data.due_soon} showSupplier />}
            </section>
          </div>
          <section className="card">
            <div className="card-head"><h2>{tx('حسب المورد', 'By supplier')}</h2></div>
            {!data.rows.length ? <div className="all-clear in-card"><Icon name="checkCircle" size={22} /><span>{tx('لا مستحقات لأي مورد.', 'Nothing is owed to any supplier.')}</span></div> : (
              <div className="table-wrap">
                <table className="table acc-table">
                  <thead><tr><th>{tx('المورد', 'Supplier')}</th><th className="num">{tx('لم يستحق', 'Not due')}</th><th className="num">1–30</th><th className="num">31–60</th><th className="num">61–90</th><th className="num">90+</th><th className="num">{tx('الإجمالي', 'Total')}</th></tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="cell-wrap"><Link to={`${base}/suppliers/${r.id}`} className="strong-link">{r.name}</Link><small className="muted" style={{ display: 'block' }}>{tx(`${r.payment_terms_days} يوم`, `${r.payment_terms_days}-day terms`)}</small></td>
                        {['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'].map((k) => <td key={k} className={`num ${k !== 'current' && num(r[k]) ? 'neg' : num(r[k]) ? '' : 'muted'}`}>{num(r[k]) ? money(r[k], locale) : '—'}</td>)}
                        <td className="num"><strong>{money(r.total, locale)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><th>{tx('الإجمالي', 'Total')}</th>{['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus', 'total'].map((k) => <th key={k} className="num">{money(data.totals[k], locale)}</th>)}</tr></tfoot>
                </table>
              </div>
            )}
            {canPay && data.rows.length > 0 && <p className="muted note-line">{tx('لإعداد دفعة افتح كشف حساب المورد.', "To prepare a payment, open the supplier's statement.")}</p>}
          </section>
          <section className="card">
            <div className="card-head"><h2>{tx('آخر المدفوعات', 'Recent payments')}</h2></div>
            {!data.payments.length ? <p className="muted">{tx('لا مدفوعات بعد.', 'No payments yet.')}</p> : (
              <div className="table-wrap">
                <table className="table acc-table compact-table">
                  <thead><tr><th>{tx('الدفعة', 'Payment')}</th><th>{tx('المورد', 'Supplier')}</th><th>{tx('التاريخ', 'Date')}</th><th>{tx('من', 'From')}</th><th>{tx('الفاتورة', 'Bill')}</th><th className="num">{tx('المبلغ', 'Amount')}</th></tr></thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="mrn">{p.ref}</td>
                        <td className="cell-wrap"><Link to={`${base}/suppliers/${p.supplier_id}`}>{p.supplier}</Link></td>
                        <td><bdi>{dayLabelShort(p.paid_on, locale)}</bdi></td>
                        <td>{pick(p, 'paid_from')}{p.reference && <small className="muted" style={{ display: 'block' }}><bdi dir="ltr">{p.reference}</bdi></small>}</td>
                        <td>{p.bill_no ? <span className="mrn">{p.bill_no}</span> : <span className="muted">{tx('على الحساب', 'On account')}</span>}</td>
                        <td className="num"><strong>{money(p.amount, locale)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
