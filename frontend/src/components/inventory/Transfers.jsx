import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'
import { BackLink, State, TRANSFER_STATE, cleanQty, dayLabelShort, lineErr, money, num, qty, today, useInventory } from './meta'

const TABS = ['open', 'requested', 'dispatched', 'received', 'cancelled', '']

// Moving stock between stores and branches: requested → sent (in transit) → received, with any shortage explained.
export default function Transfers() {
  const { tx, pick, locale, lang } = useI18n()
  const { api, base, canManage } = useInventory()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState('open')
  const [store, setStore] = useState('')
  const query = { status: status || undefined, store_id: store || undefined }
  const { data, error, loading, reload } = useAsync(() => api.transfers(query), [JSON.stringify(query), api])
  const options = useAsync(() => api.options(), [api])
  const creating = params.get('new') === '1' && canManage
  const close = () => setParams({}, { replace: true })
  const labels = { open: tx('المفتوحة', 'Open'), '': tx('الكل', 'All') }
  const transit = (data || []).filter((t) => t.status === 'dispatched').reduce((s, t) => s + num(t.sent_value), 0)
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('المخازن والمشتريات', 'Stock & purchasing')} title={tx('التحويلات بين المخازن', 'Transfers between stores')}
        description={tx('يطلب مخزن، يُرسل المخزن الآخر الدفعات الأقرب انتهاءً، ثم يستلم الطالب ما وصل فعلًا. أي عجز يُكتب سببه ويُقيّد خسارة.', 'One store asks, the other sends the lots closest to expiry, then the asking store confirms what actually arrived. Any shortage is explained and posted as a loss.')}
        actions={canManage && <Button icon="plus" onClick={() => setParams({ new: '1' })}>{tx('طلب تحويل', 'Request a transfer')}</Button>} />
      {transit > 0 && status === 'open' && (
        <p className="transit-note"><Icon name="truck" size={18} /><span>{tx(`في الطريق الآن بقيمة ${money(transit, locale)} — تظهر في حساب «مخزون في الطريق» حتى يُستلم.`, `${money(transit, locale)} is on the road right now — it sits in "Stock in transit" until it's received.`)}</span></p>
      )}
      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('الحالة', 'Status')}>
            {TABS.map((s) => <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>{labels[s] ?? TRANSFER_STATE[s][lang]}</button>)}
          </div>
        </div>
        <div className="toolbar filters">
          <SelectField label={tx('المخزن', 'Store')} value={store} onChange={(e) => setStore(e.target.value)} placeholder={tx('كل المخازن', 'All stores')}
            options={(options.data?.stores || []).map((s) => ({ value: String(s.id), label: pick(s) }))} />
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={4} cols={6} /> : !data.length ? (
          <EmptyState icon="truck" title={tx('لا تحويلات هنا', 'No transfers here')} action={canManage && <Button icon="plus" onClick={() => setParams({ new: '1' })}>{tx('طلب تحويل', 'Request a transfer')}</Button>} />
        ) : (
          <div className="table-wrap">
            <table className="table acc-table">
              <thead><tr><th>{tx('التحويل', 'Transfer')}</th><th>{tx('من ← إلى', 'From → to')}</th><th>{tx('طُلب', 'Requested')}</th><th className="num">{tx('المُرسل', 'Sent')}</th><th className="num">{tx('المستلم', 'Received')}</th><th>{tx('الحالة', 'Status')}</th></tr></thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id}>
                    <td><Link to={`${base}/transfers/${t.id}`} className="mrn">{t.ref}</Link><small className="muted" style={{ display: 'block' }}>{tx(`${t.line_count} صنف`, `${t.line_count} item${t.line_count === 1 ? '' : 's'}`)}</small></td>
                    <td className="cell-wrap"><span className="route"><span>{lang === 'ar' ? t.from_ar : t.from_en}</span><Icon name="arrowRight" size={14} /><strong>{lang === 'ar' ? t.to_ar : t.to_en}</strong></span></td>
                    <td><bdi>{dayLabelShort(t.requested_at, locale)}</bdi><small className="muted" style={{ display: 'block' }}>{pick(t, 'requested_by')}</small></td>
                    <td className="num">{t.sent_value !== null ? money(t.sent_value, locale) : <span className="muted">—</span>}</td>
                    <td className="num">{t.received_value !== null ? <>{money(t.received_value, locale)}{num(t.shortage_value) > 0 && <small className="neg" style={{ display: 'block' }}>{tx('عجز', 'Short')} {money(t.shortage_value, locale)}</small>}</> : <span className="muted">—</span>}</td>
                    <td><State state={t.status} map={TRANSFER_STATE} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {creating && options.data && <RequestModal options={options.data} onClose={close} onDone={() => { close(); reload() }} />}
    </div>
  )
}

const blank = () => ({ key: Math.random().toString(36).slice(2), item_id: '', qty: '' })

function RequestModal({ options, onClose, onDone }) {
  const { t, tx, pick } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const stores = options.stores.filter((s) => s.is_active)
  const [head, setHead] = useState({ from_store_id: String(stores[0]?.id || ''), to_store_id: String(stores[1]?.id || ''), note: '' })
  const [lines, setLines] = useState([blank()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const sent = lines.filter((l) => l.item_id && num(l.qty) > 0)
  const setH = (k) => (e) => setHead((h) => ({ ...h, [k]: e.target.value }))
  const setL = (key, k) => (e) => {
    const v = k === 'qty' ? cleanQty(e.target.value) : e.target.value
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [k]: v } : l)))
  }
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.requestTransfer({
        from_store_id: Number(head.from_store_id), to_store_id: Number(head.to_store_id), note: head.note.trim() || null,
        lines: sent.map((l) => ({ item_id: Number(l.item_id), qty: l.qty })),
      })
      toast.success(tx(`سُجّل الطلب ${row.ref}. يرسله المخزن الآخر حين يجهّزه.`, `${row.ref} requested. The sending store packs and sends it.`))
      onDone(row)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const known = Object.keys(fe).some((k) => k.startsWith('lines') || ['from_store_id', 'to_store_id'].includes(k))
  const same = head.from_store_id && head.from_store_id === head.to_store_id
  const ready = head.from_store_id && head.to_store_id && !same && sent.length > 0
  return (
    <Modal open wide onClose={onClose} busy={busy} title={tx('طلب تحويل بين المخازن', 'Request a transfer')}
      description={tx('اختر المخزن الذي يُرسل والمخزن الذي يستلم والكميات المطلوبة. لا يتحرك شيء قبل الإرسال.', 'Choose which store sends, which receives, and how much. Nothing moves until it is sent.')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="truck" loading={busy} disabled={!ready} onClick={submit}>{tx('تسجيل الطلب', 'Request it')}</Button></>}>
      <div className="form">
        {error && !known && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <div className="form-grid">
          <SelectField label={tx('من مخزن (يُرسل)', 'From store (sends)')} value={head.from_store_id} onChange={setH('from_store_id')} data-autofocus
            options={stores.map((s) => ({ value: String(s.id), label: pick(s) }))} error={fieldText('from_store_id', fe.from_store_id, t)} />
          <SelectField label={tx('إلى مخزن (يستلم)', 'To store (receives)')} value={head.to_store_id} onChange={setH('to_store_id')}
            options={stores.map((s) => ({ value: String(s.id), label: pick(s) }))} error={same ? fieldText('to_store_id', 'same_store', t) : fieldText('to_store_id', fe.to_store_id, t)} />
        </div>
        <fieldset className="lines-edit">
          <legend>{tx('الأصناف المطلوبة', 'Items needed')}</legend>
          {lines.map((l) => {
            const i = sent.indexOf(l)
            const item = options.items.find((x) => String(x.id) === l.item_id)
            return (
              <div key={l.key} className="line-row two">
                <SelectField className="line-item" label={tx('الصنف', 'Item')} value={l.item_id} onChange={setL(l.key, 'item_id')} placeholder={tx('اختر الصنف', 'Choose an item')}
                  options={options.items.filter((x) => x.is_active).map((x) => ({ value: String(x.id), label: `${pick(x)} (${pick(x, 'unit')})`, disabled: lines.some((y) => y !== l && y.item_id === String(x.id)) }))}
                  error={i >= 0 ? fieldText('item_id', lineErr(fe, i, 'item_id'), t) : undefined} />
                <TextField label={item ? tx(`الكمية (${pick(item, 'unit')})`, `Qty (${pick(item, 'unit')})`) : tx('الكمية', 'Qty')} inputMode="decimal" dir="ltr" value={l.qty} onChange={setL(l.key, 'qty')} placeholder="0"
                  error={i >= 0 ? fieldText('qty', lineErr(fe, i, 'qty'), t) : undefined} />
                {lines.length > 1 && <button type="button" className="btn btn-quiet btn-icon line-del" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={tx('حذف السطر', 'Remove line')}><Icon name="x" size={16} /></button>}
              </div>
            )
          })}
          <div className="lines-foot"><Button variant="ghost" size="sm" icon="plus" onClick={() => setLines((ls) => [...ls, blank()])}>{tx('صنف آخر', 'Another item')}</Button></div>
          {fe.lines && <small className="neg">{fieldText('lines', fe.lines, t)}</small>}
        </fieldset>
        <TextArea label={tx('ملاحظة', 'Note')} optional rows={2} value={head.note} onChange={setH('note')} placeholder={tx('مثال: قبل جلسات الخميس', 'e.g. needed before Thursday sessions')} />
      </div>
    </Modal>
  )
}

// The three steps, as a small progress line.
function Flow({ t }) {
  const { tx, pick, locale } = useI18n()
  const steps = [
    { key: 'requested', icon: 'clipboard', label: tx('طُلب', 'Requested'), who: pick(t, 'requested_by'), when: t.requested_at },
    { key: 'dispatched', icon: 'truck', label: tx('أُرسل', 'Sent'), who: t.dispatched_by_en && pick(t, 'dispatched_by'), when: t.dispatched_at },
    { key: 'received', icon: 'checkCircle', label: tx('استُلم', 'Received'), who: t.received_by_en && pick(t, 'received_by'), when: t.received_at },
  ]
  const at = { requested: 0, dispatched: 1, received: 2, cancelled: 0 }[t.status]
  const live = t.status !== 'cancelled'
  return (
    <ol className={`tf-flow ${live ? '' : 'is-cancelled'}`} aria-label={tx('مراحل التحويل', 'Transfer steps')}>
      {steps.map((s, i) => (
        <li key={s.key} className={i <= at ? 'done' : live && i === at + 1 ? 'next' : ''} aria-current={live && i === at + 1 ? 'step' : undefined}>
          <span className="tf-dot"><Icon name={s.icon} size={16} /></span>
          <span className="tf-text"><strong>{s.label}</strong>{s.when ? <small><bdi>{fmtDateTime(s.when, locale)}</bdi>{s.who && <> · {s.who}</>}</small> : <small className="muted">{tx('لم يتم بعد', 'Not yet')}</small>}</span>
        </li>
      ))}
    </ol>
  )
}

export function TransferPage() {
  const { id } = useParams()
  const { tx, pick, locale } = useI18n()
  const { api, base, canManage } = useInventory()
  const { data, error, loading, reload } = useAsync(() => api.transfer(id), [id, api])
  const [modal, setModal] = useState(null)
  const back = <BackLink to={`${base}/transfers`}>{tx('التحويلات', 'Transfers')}</BackLink>
  if (error) return <div className="page">{back}<section className="card"><ErrorState error={error} onRetry={reload} /></section></div>
  if (loading && !data) return <div className="page">{back}<section className="card"><SkeletonRows rows={6} cols={5} /></section></div>
  const t = data.transfer
  const done = () => { setModal(null); reload() }
  const shortLots = data.lots.filter((l) => l.qty_received !== null && num(l.qty_received) < num(l.qty_sent))
  return (
    <div className="page reveal">
      <PageHeader back={back} eyebrow={tx('تحويل بين المخازن', 'Stock transfer')}
        title={<><span className="route big"><span>{pick(t, 'from')}</span><Icon name="arrowRight" size={20} /><span>{pick(t, 'to')}</span></span> <span className="mrn title-ref">{t.ref}</span></>}
        description={<State state={t.status} map={TRANSFER_STATE} />}
        actions={canManage && <>
          {t.status === 'requested' && <Button variant="ghost" icon="x" onClick={() => setModal('cancel')}>{tx('إلغاء الطلب', 'Cancel request')}</Button>}
          {t.status === 'requested' && <Button icon="truck" onClick={() => setModal('dispatch')}>{tx('إرسال', 'Send it')}</Button>}
          {t.status === 'dispatched' && <Button icon="download" onClick={() => setModal('receive')}>{tx('تأكيد الاستلام', 'Confirm arrival')}</Button>}
        </>} />

      <Flow t={t} />

      {t.status === 'cancelled' && <Alert tone="info" title={tx('أُلغي الطلب', 'Request cancelled')}>{t.cancel_reason}</Alert>}
      {num(t.shortage_value) > 0 && (
        <Alert tone="warn" title={tx(`وصل أقل مما أُرسل: عجز ${money(t.shortage_value, locale)}`, `Less arrived than was sent: ${money(t.shortage_value, locale)} short`)}>
          {t.shortage_note} {tx('— قُيّد العجز في حساب خسائر المخزون.', '— the shortage was posted to Stock losses.')}
        </Alert>
      )}

      {t.status !== 'requested' && t.status !== 'cancelled' && (
        <div className="stats inv-stats">
          <div className="stat"><div className="stat-label">{tx('قيمة المُرسل', 'Value sent')}</div><div className="stat-value num">{money(t.sent_value, locale)}</div><div className="stat-foot">{tx('بالتكلفة', 'At cost')} · <bdi>{dayLabelShort(t.dispatched_on, locale)}</bdi></div></div>
          <div className={`stat ${t.status === 'dispatched' ? 'fig-warn' : ''}`}><div className="stat-label">{tx('قيمة المستلم', 'Value received')}</div><div className="stat-value num">{t.received_value !== null ? money(t.received_value, locale) : '—'}</div><div className="stat-foot">{t.received_on ? <bdi>{dayLabelShort(t.received_on, locale)}</bdi> : tx('في الطريق', 'On the road')}</div></div>
          {t.status === 'received' && <div className={`stat ${num(t.shortage_value) > 0 ? 'fig-danger' : ''}`}><div className="stat-label">{tx('العجز', 'Shortage')}</div><div className="stat-value num">{money(t.shortage_value, locale)}</div><div className="stat-foot">{num(t.shortage_value) > 0 ? tx('خسائر مخزون', 'Stock losses') : tx('وصل كاملًا', 'All arrived')}</div></div>}
        </div>
      )}

      <section className="card">
        <div className="card-head"><h2>{tx('الأصناف', 'Items')}</h2></div>
        <div className="table-wrap">
          <table className="table acc-table">
            <thead><tr><th>{tx('الصنف', 'Item')}</th><th className="num">{tx('المطلوب', 'Asked')}</th>
              {t.status === 'requested' ? <th className="num">{tx(`المتاح في ${pick(t, 'from')}`, `Available at ${pick(t, 'from')}`)}</th> : <><th className="num">{tx('أُرسل', 'Sent')}</th><th className="num">{tx('وصل', 'Arrived')}</th></>}</tr></thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.id}>
                  <td className="cell-wrap"><Link to={`${base}/stock/${l.item_id}`} className="strong-link">{pick(l)}</Link></td>
                  <td className="num">{qty(l.qty, locale)} <small className="muted">{pick(l, 'unit')}</small></td>
                  {t.status === 'requested'
                    ? <td className={`num ${num(l.available) < num(l.qty) ? 'neg' : ''}`}>{qty(l.available, locale)}{num(l.available) < num(l.qty) && <small style={{ display: 'block' }}>{tx('لا يكفي كل المطلوب', 'Not enough for all of it')}</small>}</td>
                    : <><td className="num">{qty(l.sent, locale)}</td><td className={`num ${l.received !== null && num(l.received) < num(l.sent) ? 'neg' : ''}`}>{l.received !== null ? qty(l.received, locale) : <span className="muted">—</span>}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {t.note && <p className="muted note-line"><Icon name="info" size={14} /> {t.note}</p>}
      </section>

      {data.lots.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>{tx('الدفعات المُرسلة', 'Lots sent')}</h2></div>
          <p className="muted card-sub">{tx('تحتفظ كل دفعة برقمها وتاريخ انتهائها وتكلفتها في المخزن المستلم، فيمكن ردّها للمورد لاحقًا.', 'Each lot keeps its number, expiry and cost in the receiving store, so it can still be returned to the supplier later.')}</p>
          <div className="table-wrap">
            <table className="table acc-table compact-table">
              <thead><tr><th>{tx('الصنف', 'Item')}</th><th>{tx('الدفعة', 'Lot')}</th><th>{tx('الانتهاء', 'Expiry')}</th><th className="num">{tx('أُرسل', 'Sent')}</th><th className="num">{tx('وصل', 'Arrived')}</th><th className="num">{tx('القيمة', 'Value')}</th></tr></thead>
              <tbody>
                {data.lots.map((l) => (
                  <tr key={l.id} className={shortLots.includes(l) ? 'row-short' : ''}>
                    <td className="cell-wrap">{pick(l)}</td>
                    <td><bdi dir="ltr" className="mrn">{l.lot_no || '—'}</bdi></td>
                    <td><bdi>{l.expiry ? dayLabelShort(l.expiry, locale) : '—'}</bdi></td>
                    <td className="num">{qty(l.qty_sent, locale)} <small className="muted">{pick(l, 'unit')}</small></td>
                    <td className={`num ${shortLots.includes(l) ? 'neg' : ''}`}>{l.qty_received !== null ? qty(l.qty_received, locale) : <span className="muted">—</span>}</td>
                    <td className="num">{money(l.value, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {modal === 'dispatch' && <DispatchModal data={data} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'receive' && <ArrivalModal data={data} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'cancel' && <CancelModal t={t} onClose={() => setModal(null)} onDone={done} />}
    </div>
  )
}

// Server errors index lines and lots in the order they were stored (by id).
const byId = (rows) => [...rows].sort((a, b) => (a.id > b.id ? 1 : -1))

function DispatchModal({ data, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const tr = data.transfer
  const [day, setDay] = useState(today())
  const [send, setSend] = useState(() => Object.fromEntries(data.lines.map((l) => [l.item_id, String(Math.min(num(l.qty), num(l.available)))])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const stored = byId(data.lines)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.dispatchTransfer(tr.id, { dispatched_on: day, lines: data.lines.map((l) => ({ item_id: l.item_id, qty: send[l.item_id] || '0' })) })
      toast.success(tx(`أُرسل ${tr.ref} بقيمة ${money(res.sent_value, locale)}. ينتظر تأكيد الاستلام.`, `${tr.ref} sent (${money(res.sent_value, locale)}). Waiting for the arrival to be confirmed.`))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const known = Object.keys(fe).some((k) => k.startsWith('lines') || k === 'dispatched_on')
  const any = Object.values(send).some((v) => num(v) > 0)
  return (
    <Modal open wide onClose={onClose} busy={busy} title={tx(`إرسال ${tr.ref}`, `Send ${tr.ref}`)}
      description={tx(`يخرج من ${pick(tr, 'from')} الأقرب انتهاءً أولًا (الصالح فقط). يمكن إرسال أقل من المطلوب أو صفر إن لم يكفِ الرصيد.`, `Leaves ${pick(tr, 'from')} closest-expiry first (usable stock only). You can send less than asked, or 0, when there isn't enough.`)}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="truck" loading={busy} disabled={!any || !day} onClick={submit}>{tx('إرسال الآن', 'Send now')}</Button></>}>
      <div className="form">
        {error && !known && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <TextField label={tx('تاريخ الإرسال', 'Sent on')} type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} error={fieldText('dispatched_on', fe.dispatched_on, t)} />
        <ul className="pack-list">
          {data.lines.map((l) => {
            const i = stored.indexOf(l)
            return (
              <li key={l.id}>
                <div><strong>{pick(l)}</strong><small className="muted">{tx(`المطلوب ${qty(l.qty, locale)} · المتاح ${qty(l.available, locale)} ${pick(l, 'unit')}`, `Asked ${qty(l.qty, locale)} · available ${qty(l.available, locale)} ${pick(l, 'unit')}`)}</small></div>
                <TextField label={tx(`يُرسل (${pick(l, 'unit')})`, `Send (${pick(l, 'unit')})`)} inputMode="decimal" dir="ltr" value={send[l.item_id]}
                  onChange={(e) => setSend((s) => ({ ...s, [l.item_id]: cleanQty(e.target.value) }))}
                  error={fieldText('qty', lineErr(fe, i, 'qty'), t) || (num(send[l.item_id]) > num(l.qty) ? fieldText('qty', 'more_than_requested', t) : undefined)} />
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}

function ArrivalModal({ data, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const tr = data.transfer
  const [day, setDay] = useState(today())
  const [got, setGot] = useState(() => Object.fromEntries(data.lots.map((l) => [l.id, String(num(l.qty_sent))])))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fe = error?.fields || {}
  const stored = byId(data.lots)
  const received = data.lots.reduce((s, l) => s + Math.min(num(got[l.id]), num(l.qty_sent)) * num(l.unit_cost), 0)
  const shortage = Math.max(0, Math.round((num(tr.sent_value) - received) * 100) / 100)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.receiveTransfer(tr.id, { received_on: day, lots: data.lots.map((l) => ({ lot_id: l.id, qty_received: got[l.id] || '0' })), shortage_note: note.trim() || null })
      toast.success(num(res.shortage_value) > 0
        ? tx(`استُلم ${tr.ref} بعجز ${money(res.shortage_value, locale)} قُيّد خسارة.`, `${tr.ref} received, ${money(res.shortage_value, locale)} short — posted as a loss.`)
        : tx(`استُلم ${tr.ref} كاملًا.`, `${tr.ref} received in full.`))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const known = Object.keys(fe).some((k) => k.startsWith('lots') || ['received_on', 'shortage_note'].includes(k))
  const over = data.lots.some((l) => num(got[l.id]) > num(l.qty_sent))
  return (
    <Modal open wide onClose={onClose} busy={busy} title={tx(`استلام ${tr.ref} في ${pick(tr, 'to')}`, `Arrival of ${tr.ref} at ${pick(tr, 'to')}`)}
      description={tx('عُدّ ما وصل من كل دفعة. أي نقص يُكتب سببه ويُقيّد في خسائر المخزون.', 'Count what arrived from each lot. Anything missing needs a reason and is posted to Stock losses.')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="checkCircle" loading={busy} disabled={over || !day || (shortage > 0 && note.trim().length < 5)} onClick={submit}>{shortage > 0 ? tx('تأكيد الاستلام بالعجز', 'Confirm with shortage') : tx('تأكيد الاستلام', 'Confirm arrival')}</Button></>}>
      <div className="form">
        {error && !known && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <TextField label={tx('تاريخ الاستلام', 'Arrived on')} type="date" value={day} min={tr.dispatched_on} max={today()} onChange={(e) => setDay(e.target.value)} error={fieldText('received_on', fe.received_on, t)} />
        <ul className="pack-list">
          {data.lots.map((l) => {
            const i = stored.indexOf(l)
            const short = num(got[l.id]) < num(l.qty_sent)
            return (
              <li key={l.id} className={short ? 'is-short' : ''}>
                <div><strong>{pick(l)}</strong><small className="muted">{tx('دفعة', 'Lot')} <bdi dir="ltr">{l.lot_no || '—'}</bdi>{l.expiry && <> · {tx('تنتهي', 'exp.')} <bdi>{dayLabelShort(l.expiry, locale)}</bdi></>} · {tx(`أُرسل ${qty(l.qty_sent, locale)}`, `sent ${qty(l.qty_sent, locale)}`)}</small></div>
                <TextField label={tx(`وصل (${pick(l, 'unit')})`, `Arrived (${pick(l, 'unit')})`)} inputMode="decimal" dir="ltr" value={got[l.id]}
                  onChange={(e) => setGot((g) => ({ ...g, [l.id]: cleanQty(e.target.value) }))}
                  error={fieldText('qty_received', fe[`lots.${i}.qty_received`], t) || (num(got[l.id]) > num(l.qty_sent) ? fieldText('qty', 'more_than_sent', t) : undefined)} />
              </li>
            )
          })}
        </ul>
        <div className={`limit-note ${shortage > 0 ? 'over' : ''}`}>
          <Icon name={shortage > 0 ? 'alert' : 'checkCircle'} size={18} />
          <span>{shortage > 0
            ? tx(`عجز بقيمة ${money(shortage, locale)} (بالتكلفة) سيُقيّد في خسائر المخزون.`, `${money(shortage, locale)} short (at cost) will be posted to Stock losses.`)
            : tx(`وصل كل شيء: ${money(tr.sent_value, locale)} تدخل رصيد ${pick(tr, 'to')}.`, `Everything arrived: ${money(tr.sent_value, locale)} goes into ${pick(tr, 'to')}.`)}</span>
        </div>
        {shortage > 0 && <TextArea label={tx('ماذا حدث؟', 'What happened?')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx('مثال: علبة مكسورة أثناء النقل', 'e.g. one box crushed on the way')} error={fieldText('shortage_note', fe.shortage_note, t)} />}
      </div>
    </Modal>
  )
}

function CancelModal({ t: tr, onClose, onDone }) {
  const { t, tx } = useI18n()
  const { api } = useInventory()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.cancelTransfer(tr.id, { reason: reason.trim() })
      toast.success(tx('أُلغي الطلب.', 'Request cancelled.'))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={tx(`إلغاء ${tr.ref}`, `Cancel ${tr.ref}`)}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="x" loading={busy} disabled={reason.trim().length < 5} onClick={submit}>{tx('إلغاء الطلب', 'Cancel request')}</Button></>}>
      <div className="form">
        {error && !error.fields?.reason && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <TextArea label={tx('السبب', 'Reason')} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus error={fieldText('reason', error?.fields?.reason, t)} />
      </div>
    </Modal>
  )
}
