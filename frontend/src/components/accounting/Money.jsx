import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { SelectField, TextField } from '../Fields'
import { Alert, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'
import { Methods } from '../billing/meta'
import { accountOptions, cleanAmount, dayLabelShort, money, num, payingAccounts, today, transferAccounts, useAccounting } from './meta'

const METHODS = ['card', 'instapay', 'wallet']
const METHOD_LABEL = { card: { ar: 'البطاقات (POS)', en: 'Cards (POS)' }, instapay: { ar: 'إنستاباي', en: 'InstaPay' }, wallet: { ar: 'المحافظ الإلكترونية', en: 'Mobile wallets' } }

// Cash and bank: what's in each money account, moves between them, and card / InstaPay money arriving at the bank.
export default function Money() {
  const { tx, pick, locale } = useI18n()
  const { api, base, canPost } = useAccounting()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'balances'
  const setTab = (t) => setParams(t === 'balances' ? {} : { tab: t }, { replace: true })
  const [moving, setMoving] = useState(false)
  const options = useAsync(() => api.options(), [api])
  const accounts = useAsync(() => api.accounts(), [api])
  const transfers = useAsync(() => api.transfers(), [api])
  const unsettled = useAsync(() => api.unsettled(), [api])
  const reloadAll = () => { accounts.reload(); transfers.reload(); unsettled.reload() }
  const moneyAccounts = (accounts.data || []).filter((a) => a.is_money && (a.is_active || num(a.balance)))
  const total = moneyAccounts.reduce((s, a) => s + num(a.balance), 0)
  const unsettledCount = unsettled.data ? METHODS.reduce((s, m) => s + (unsettled.data.totals[m]?.count || 0), 0) : 0
  const tabs = [
    ['balances', tx('الأرصدة', 'Balances')],
    ['transfers', tx('التحويلات', 'Transfers')],
    ['settle', <>{tx('تسوية البطاقات والتحويلات', 'Card & transfer settlement')}{unsettledCount > 0 && <span className="tab-count">{unsettledCount}</span>}</>],
  ]

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الحسابات العامة', 'Accounting')} title={tx('الخزينة والبنك', 'Cash & bank')}
        description={tx('أرصدة النقدية والبنك والعهدة، التحويل بينها، وتسوية مدفوعات البطاقات وإنستاباي عند وصولها للبنك بعد خصم العمولة.', "Cash, bank and petty cash balances, moving money between them, and settling card and InstaPay payments when they reach the bank, less the provider's fee.")}
        actions={canPost && <Button icon="swap" onClick={() => setMoving(true)} disabled={!options.data}>{tx('تحويل بين الحسابات', 'Move money')}</Button>} />

      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('القسم', 'Section')}>
            {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
          </div>
        </div>

        {tab === 'balances' && (accounts.error ? <ErrorState error={accounts.error} onRetry={accounts.reload} /> : !accounts.data ? <SkeletonRows rows={5} cols={3} /> : (
          <div className="card-body">
            <ul className="money-tiles">
              {moneyAccounts.map((a) => {
                const clearing = options.data?.clearing.includes(a.system_key)
                return (
                  <li key={a.id} className={`${clearing ? 'clearing' : ''} ${a.system_key === 'bank' ? 'bank' : ''}`}>
                    <small><span className="mrn">{a.code}</span>{clearing ? tx('بانتظار التسوية', 'Waiting to settle') : a.system_key === 'cash_drawer' ? tx('درج الكاشير', "Cashier's drawer") : tx('متاح', 'Available')}</small>
                    <strong>{pick(a)}</strong>
                    <span className={`num ${num(a.balance) < 0 ? 'neg' : ''}`}>{money(a.balance, locale)}</span>
                    <Link to={`${base}/reports?r=ledger&account=${a.id}`} className="link-btn">{tx('كشف الحساب', 'Ledger')}<Icon name="arrowRight" size={13} /></Link>
                  </li>
                )
              })}
            </ul>
            <p className="money-total">{tx('الإجمالي', 'Total')} <strong className="num">{money(total, locale)}</strong></p>
          </div>
        ))}

        {tab === 'transfers' && (transfers.error ? <ErrorState error={transfers.error} onRetry={transfers.reload} /> : !transfers.data ? <SkeletonRows rows={5} cols={5} /> : !transfers.data.length ? (
          <EmptyState icon="swap" title={tx('لا تحويلات بعد', 'No transfers yet')}>{tx('إيداع النقدية في البنك، تعبئة العهدة النثرية، وتسويات البطاقات تظهر هنا.', 'Cash deposits, petty cash top-ups and card settlements show here.')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tx('الرقم', 'No.')}</th><th>{tx('التاريخ', 'Date')}</th><th>{tx('من ← إلى', 'From → to')}</th><th>{tx('المرجع', 'Reference')}</th><th className="num">{tx('المبلغ', 'Amount')}</th><th className="num">{tx('العمولة', 'Fee')}</th></tr></thead>
              <tbody>
                {transfers.data.map((r) => (
                  <tr key={r.id}>
                    <td>{r.entry_id ? <Link to={`${base}/journal/${r.entry_id}`} className="mrn">{r.ref}</Link> : <span className="mrn">{r.ref}</span>}
                      {r.kind === 'settlement' && <small className="muted" style={{ display: 'block' }}>{tx(`تسوية · ${r.payments} دفعة`, `Settlement · ${r.payments} payment(s)`)}</small>}</td>
                    <td><bdi>{dayLabelShort(r.moved_on, locale)}</bdi></td>
                    <td className="cell-wrap"><span className="flow">{pick(r, 'from')}<Icon name="arrowRight" size={14} />{pick(r, 'to')}</span>{r.note && <small className="muted" style={{ display: 'block' }}>{r.note}</small>}</td>
                    <td>{r.reference ? <bdi dir="ltr">{r.reference}</bdi> : '—'}<small className="muted" style={{ display: 'block' }}>{pick(r, 'created_by')}</small></td>
                    <td className="num">{money(r.amount, locale)}</td>
                    <td className="num">{num(r.fee) ? <span className="neg">{money(r.fee, locale)}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {tab === 'settle' && (unsettled.error ? <ErrorState error={unsettled.error} onRetry={unsettled.reload} /> : !unsettled.data || !options.data ? <SkeletonRows rows={5} cols={4} /> : (
          <Settle data={unsettled.data} options={options.data} canPost={canPost} onDone={reloadAll} />
        ))}
      </section>
      {moving && <TransferModal options={options.data} balances={accounts.data || []} onClose={() => setMoving(false)} onDone={() => { setMoving(false); reloadAll(); setTab('transfers') }} />}
    </div>
  )
}

function Settle({ data, options, canPost, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const first = METHODS.find((m) => data.totals[m]?.count) || 'card'
  const [method, setMethod] = useState(first)
  const items = useMemo(() => data.items.filter((p) => p.method === method), [data, method])
  const [picked, setPicked] = useState(() => new Set())
  const [form, setForm] = useState({ moved_on: today(), to_id: '', fee: '', reference: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const targets = payingAccounts(options)
  const toId = form.to_id || String(targets.find((a) => a.system_key === 'bank')?.id || targets[0]?.id || '')
  const sel = items.filter((p) => picked.has(p.id))
  const gross = sel.reduce((s, p) => s + num(p.amount), 0)
  const fee = num(form.fee)
  const choose = (m) => { setMethod(m); setPicked(new Set()); setError(null) }
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const all = items.length > 0 && sel.length === items.length
  const fe = error?.fields || {}
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.settle({ method, moved_on: form.moved_on, to_id: Number(toId), payment_ids: sel.map((p) => p.id), fee: form.fee || 0, reference: form.reference.trim() || null, note: form.note.trim() || null })
      toast.success(tx(`سُجّلت التسوية ${row.ref}.`, `Settlement ${row.ref} recorded.`))
      setPicked(new Set())
      setForm((f) => ({ ...f, fee: '', reference: '', note: '' }))
      setBusy(false)
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <div className="settle">
      <div className="settle-methods" role="radiogroup" aria-label={tx('طريقة الدفع', 'Payment method')}>
        {METHODS.map((m) => {
          const tt = data.totals[m] || { count: 0, amount: 0, balance: 0 }
          return (
            <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => choose(m)}>
              <small>{tx(METHOD_LABEL[m].ar, METHOD_LABEL[m].en)}</small>
              <strong className="num">{money(tt.amount, locale)}</strong>
              <span>{tx(`${tt.count} دفعة لم تُسوَّ`, `${tt.count} not settled`)}</span>
            </button>
          )
        })}
      </div>
      {!items.length ? (
        <EmptyState icon="checkCircle" title={tx('كل المدفوعات بهذه الطريقة تمت تسويتها', 'Everything paid this way is settled')} />
      ) : (
        <div className="settle-grid">
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th className="chk">{canPost && <input type="checkbox" aria-label={tx('تحديد الكل', 'Select all')} checked={all} onChange={() => setPicked(all ? new Set() : new Set(items.map((p) => p.id)))} />}</th>
                <th>{tx('الإيصال', 'Receipt')}</th><th>{tx('المريض', 'Patient')}</th><th>{tx('رقم العملية', 'Transaction')}</th><th className="num">{tx('المبلغ', 'Amount')}</th>
              </tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className={picked.has(p.id) ? 'row-picked' : ''} onClick={canPost ? () => toggle(p.id) : undefined}>
                    <td className="chk">{canPost && <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} onClick={(e) => e.stopPropagation()} aria-label={tx(`تحديد ${p.receipt_ref}`, `Select ${p.receipt_ref}`)} />}</td>
                    <td><span className="mrn">{p.receipt_ref}</span><small className="muted" style={{ display: 'block' }}><bdi>{fmtDateTime(p.created_at, locale)}</bdi></small></td>
                    <td>{pick(p, 'full_name')}<small className="muted mrn" style={{ display: 'block' }}>{p.mrn}</small></td>
                    <td><Methods payments={[{ method: p.method }]} />{p.reference && <small className="muted" dir="ltr" style={{ display: 'block' }}>#{p.reference}</small>}</td>
                    <td className="num">{money(p.amount, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canPost && (
            <aside className="settle-form" aria-label={tx('تسجيل التسوية', 'Record the settlement')}>
              <h3>{tx('وصل للبنك', 'Arrived at the bank')}</h3>
              {error && !['moved_on', 'to_id', 'fee', 'reference', 'note'].some((k) => fe[k]) && <Alert tone="danger">{errorText(error, t)}</Alert>}
              <TextField label={tx('تاريخ الوصول', 'Date received')} type="date" value={form.moved_on} max={today()} onChange={(e) => setForm({ ...form, moved_on: e.target.value })} error={fieldText('moved_on', fe.moved_on, t)} />
              <SelectField label={tx('إلى حساب', 'Into')} value={toId} onChange={(e) => setForm({ ...form, to_id: e.target.value })} options={accountOptions(targets, pick)} error={fieldText('to_id', fe.to_id, t)} />
              <TextField label={tx('عمولة مقدم الخدمة (ج.م)', "Provider's fee (EGP)")} inputMode="decimal" dir="ltr" value={form.fee} placeholder="0.00" onChange={(e) => setForm({ ...form, fee: cleanAmount(e.target.value) })} error={fieldText('fee', fe.fee, t)}
                hint={gross ? tx(`${((fee / gross) * 100).toFixed(2)}٪ من المحدد`, `${((fee / gross) * 100).toFixed(2)}% of the selection`) : undefined} />
              <TextField label={tx('مرجع الدفعة', 'Batch reference')} value={form.reference} dir="auto" optional onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              <dl className="drawer-math">
                <div><dt>{tx(`المحدد (${sel.length})`, `Selected (${sel.length})`)}</dt><dd className="num">{money(gross, locale)}</dd></div>
                <div><dt>{tx('العمولة', 'Fee')}</dt><dd className="num neg">− {money(fee, locale)}</dd></div>
                <div className={`eq ${gross > 0 && fee <= gross ? 'ok' : ''}`}><dt>{tx('يصل للبنك', 'Into the bank')}</dt><dd className="num">{money(Math.max(gross - fee, 0), locale)}</dd></div>
              </dl>
              <Button icon="check" loading={busy} disabled={!sel.length || fee > gross} onClick={submit}>{tx('تسجيل التسوية', 'Record settlement')}</Button>
            </aside>
          )}
        </div>
      )}
    </div>
  )
}

function TransferModal({ options, balances, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const list = transferAccounts(options)
  const id = (key) => String(list.find((a) => a.system_key === key)?.id || '')
  const [f, setF] = useState({ moved_on: today(), from_id: id('bank'), to_id: id('petty_cash'), amount: '', reference: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: k === 'amount' ? cleanAmount(e.target.value) : e.target.value }))
  const fromBal = balances.find((a) => String(a.id) === f.from_id)?.balance
  const fe = error?.fields || {}
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.addTransfer({ ...f, from_id: Number(f.from_id), to_id: Number(f.to_id), reference: f.reference.trim() || null, note: f.note.trim() || null })
      toast.success(tx(`سُجّل التحويل ${row.ref}.`, `Transfer ${row.ref} recorded.`))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const presets = [
    [tx('إيداع النقدية بالبنك', 'Deposit cash at the bank'), 'cash_drawer', 'bank'],
    [tx('تعبئة العهدة', 'Top up petty cash'), 'bank', 'petty_cash'],
  ]
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('تحويل بين الحسابات', 'Move money')}
      description={tx('لا يغيّر الإيرادات أو المصروفات: ينقل المال من حساب لآخر.', "Doesn't change income or expenses: it moves money from one account to another.")}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="swap" loading={busy} disabled={!num(f.amount) || !f.from_id || !f.to_id || f.from_id === f.to_id} onClick={submit}>{tx('تسجيل التحويل', 'Record transfer')}</Button></>}>
      <div className="form">
        {error && !['moved_on', 'from_id', 'to_id', 'amount'].some((k) => fe[k]) && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <div className="add-kinds" role="group" aria-label={tx('اختصارات', 'Shortcuts')}>
          {presets.map(([label, a, b]) => <button key={label} type="button" aria-selected={f.from_id === id(a) && f.to_id === id(b)} onClick={() => setF((s) => ({ ...s, from_id: id(a), to_id: id(b) }))}>{label}</button>)}
        </div>
        <div className="form-grid">
          <SelectField label={tx('من', 'From')} value={f.from_id} onChange={set('from_id')} options={accountOptions(list, pick)} error={fieldText('from_id', fe.from_id, t)}
            hint={fromBal !== undefined ? tx(`الرصيد ${money(fromBal, locale)}`, `Balance ${money(fromBal, locale)}`) : undefined} />
          <SelectField label={tx('إلى', 'To')} value={f.to_id} onChange={set('to_id')} options={accountOptions(list, pick)} error={fieldText('to_id', fe.to_id, t)} />
          <TextField label={tx('المبلغ (ج.م)', 'Amount (EGP)')} inputMode="decimal" dir="ltr" value={f.amount} placeholder="0.00" onChange={set('amount')} data-autofocus error={fieldText('amount', fe.amount, t)} />
          <TextField label={tx('التاريخ', 'Date')} type="date" value={f.moved_on} max={today()} onChange={set('moved_on')} error={fieldText('moved_on', fe.moved_on, t)} />
          <TextField label={tx('المرجع (إيصال إيداع، شيك…)', 'Reference (deposit slip, cheque…)')} value={f.reference} dir="auto" optional onChange={set('reference')} />
          <TextField label={tx('ملاحظة', 'Note')} value={f.note} optional onChange={set('note')} />
        </div>
      </div>
    </Modal>
  )
}
