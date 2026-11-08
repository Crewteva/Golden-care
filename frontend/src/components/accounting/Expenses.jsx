import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, EmptyState, ErrorState, PageHeader, Pagination, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync, useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { EXPENSE_STATE, State, accountOptions, cleanAmount, dayLabelShort, money, num, payingAccounts, today, useAccounting } from './meta'

const STATUSES = ['', 'posted', 'void']

export default function Expenses() {
  const { tx, pick, locale } = useI18n()
  const { api, base, canPost } = useAccounting()
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [status, setStatus] = useState('')
  const [accountId, setAccountId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(canPost && params.get('new') === '1')
  const [voiding, setVoiding] = useState(null)
  const term = useDebounced(q.trim(), 300)
  const query = { q: term, status, account_id: accountId, date_from: from, date_to: to, page }
  const { data, error, loading, reload } = useAsync(() => api.expenses(query), [JSON.stringify(query), api])
  const options = useAsync(() => api.options(), [api])
  const categories = useMemo(() => (options.data ? options.data.accounts.filter((a) => a.type === 'expense' && !options.data.auto_expenses.includes(a.system_key)) : []), [options.data])
  const reset = (fn) => (v) => { fn(v); setPage(1) }
  const labels = { '': tx('الكل', 'All'), posted: tx('مسجلة', 'Posted'), void: tx('ملغاة', 'Void') }
  const maxCat = data ? Math.max(...data.by_category.map((c) => num(c.amount)), 1) : 1

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الحسابات العامة', 'Accounting')} title={tx('المصروفات', 'Expenses')}
        description={tx('الإيجار والمرافق والمستلزمات وغيرها، مع صورة الفاتورة. تُدفع من البنك أو من العهدة النثرية.', 'Rent, utilities, supplies and the rest, with the bill attached. Paid from the bank or petty cash.')}
        actions={canPost && <Button icon="plus" onClick={() => setAdding(true)} disabled={!options.data}>{tx('مصروف جديد', 'New expense')}</Button>} />

      {data && data.by_category.length > 0 && (
        <section className="card cat-card" aria-label={tx('حسب البند', 'By category')}>
          <div className="cat-total"><small>{tx('إجمالي المعروض', 'Total shown')}</small><strong className="num">{money(data.amount, locale)}</strong><small className="muted">{tx(`${data.total} مصروف`, `${data.total} expense(s)`)}</small></div>
          <ul className="cat-bars">
            {data.by_category.map((c) => (
              <li key={c.id}>
                <button type="button" aria-pressed={accountId === String(c.id)} onClick={() => reset(setAccountId)(accountId === String(c.id) ? '' : String(c.id))}>
                  <span>{pick(c)}</span><strong className="num">{money(c.amount, locale)}</strong>
                  <i style={{ '--w': `${(num(c.amount) / maxCat) * 100}%` }} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('الحالة', 'Status')}>
            {STATUSES.map((s) => <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => reset(setStatus)(s)}>{labels[s]}</button>)}
          </div>
        </div>
        <div className="toolbar filters">
          <TextField label={tx('بحث', 'Search')} icon="search" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder={tx('الرقم، الجهة، الوصف', 'Number, payee, description')} />
          <SelectField label={tx('البند', 'Category')} value={accountId} onChange={(e) => reset(setAccountId)(e.target.value)} placeholder={tx('كل البنود', 'All categories')} options={accountOptions(categories, pick)} />
          <TextField label={tx('من', 'From')} type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
          <TextField label={tx('إلى', 'To')} type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} />
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={6} cols={6} /> : !data.items.length ? (
          <EmptyState icon="briefcase" title={tx('لا توجد مصروفات مطابقة', 'No matching expenses')}
            action={canPost && options.data && <Button icon="plus" onClick={() => setAdding(true)}>{tx('مصروف جديد', 'New expense')}</Button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table acc-table">
                <thead><tr><th>{tx('المصروف', 'Expense')}</th><th>{tx('التاريخ', 'Date')}</th><th>{tx('البند والجهة', 'Category & payee')}</th><th>{tx('دُفع من', 'Paid from')}</th><th className="num">{tx('المبلغ', 'Amount')}</th><th>{tx('الحالة', 'Status')}</th><th><span className="sr-only">{tx('إجراء', 'Action')}</span></th></tr></thead>
                <tbody>
                  {data.items.map((x) => (
                    <tr key={x.id} className={x.status === 'void' ? 'row-muted' : ''}>
                      <td><span className="mrn">{x.ref}</span>{x.entry_id && <small style={{ display: 'block' }}><Link to={`${base}/journal/${x.entry_id}`}>{tx('القيد', 'Entry')}</Link></small>}</td>
                      <td><bdi>{dayLabelShort(x.spent_on, locale)}</bdi></td>
                      <td className="cell-wrap"><strong className="exp-cat">{pick(x, 'account_name')}</strong>{x.payee && <> · {x.payee}</>}
                        <small className="muted" style={{ display: 'block' }}>{x.description}{x.reference && <> · #<bdi dir="ltr">{x.reference}</bdi></>}</small>
                        {x.status === 'void' && <small className="neg" style={{ display: 'block' }}>{tx('سبب الإلغاء:', 'Voided:')} {x.void_reason}</small>}</td>
                      <td>{pick(x, 'paid_from')}</td>
                      <td className="num">{money(x.amount, locale)}</td>
                      <td><State state={x.status} map={EXPENSE_STATE} /></td>
                      <td className="row-actions">
                        {x.file_name && <a className="btn btn-quiet btn-sm" href={`${api.base}/expenses/${x.id}/attachment`} target="_blank" rel="noreferrer" title={x.file_name}><Icon name="eye" size={15} />{tx('الفاتورة', 'Bill')}</a>}
                        {canPost && x.status === 'posted' && <Button variant="quiet" size="sm" icon="x" onClick={() => setVoiding(x)}>{tx('إلغاء', 'Void')}</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </section>
      {adding && options.data && <ExpenseModal options={options.data} categories={categories} onClose={() => setAdding(false)} onDone={() => { setAdding(false); setPage(1); reload() }} />}
      {voiding && <VoidModal x={voiding} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); reload() }} />}
    </div>
  )
}

function ExpenseModal({ options, categories, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const sources = payingAccounts(options)
  const petty = sources.find((a) => a.system_key === 'petty_cash')
  const [f, setF] = useState({ spent_on: today(), account_id: '', paid_from_id: String((petty || sources[0])?.id || ''), amount: '', payee: '', description: '', reference: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const input = useRef(null)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: k === 'amount' ? cleanAmount(e.target.value) : e.target.value }))
  const fe = error?.fields || {}
  const tooBig = file && file.size > options.max_upload_mb * 1024 * 1024
  const submit = async () => {
    setBusy(true)
    setError(null)
    const form = new FormData()
    Object.entries(f).forEach(([k, v]) => { if (v.trim()) form.append(k, v.trim()) })
    if (file) form.append('file', file)
    try {
      const row = await api.addExpense(form)
      toast.success(tx(`سُجّل المصروف ${row.ref}.`, `Expense ${row.ref} entered.`))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const known = ['spent_on', 'account_id', 'paid_from_id', 'amount', 'description', 'payee', 'reference', 'file']
  return (
    <Modal open wide onClose={onClose} busy={busy} title={tx('مصروف جديد', 'New expense')}
      description={tx('يُقيَّد تلقائيًا: مدين بند المصروف، دائن الحساب الذي دُفع منه.', 'Posted for you: the category is debited, the account it was paid from is credited.')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="check" loading={busy} disabled={!f.account_id || !num(f.amount) || f.description.trim().length < 3 || tooBig} onClick={submit}>{num(f.amount) ? tx(`تسجيل ${money(f.amount, locale)}`, `Enter ${money(f.amount, locale)}`) : tx('تسجيل', 'Enter')}</Button></>}>
      <div className="form">
        {error && !known.some((k) => fe[k]) && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <div className="form-grid">
          <SelectField label={tx('البند', 'Category')} value={f.account_id} onChange={set('account_id')} placeholder={tx('اختر البند', 'Choose a category')} options={accountOptions(categories.filter((a) => a.is_active), pick)} data-autofocus error={fieldText('account_id', fe.account_id, t)} />
          <TextField label={tx('المبلغ (ج.م)', 'Amount (EGP)')} inputMode="decimal" dir="ltr" value={f.amount} onChange={set('amount')} placeholder="0.00" error={fieldText('amount', fe.amount, t)} />
          <TextField label={tx('التاريخ', 'Date')} type="date" value={f.spent_on} max={today()} min={options.first_open_day || undefined} onChange={set('spent_on')} error={fieldText('spent_on', fe.spent_on, t)} />
          <SelectField label={tx('دُفع من', 'Paid from')} value={f.paid_from_id} onChange={set('paid_from_id')} options={accountOptions(sources, pick)} error={fieldText('paid_from_id', fe.paid_from_id, t)}
            hint={tx('درج الكاشير لا يُصرف منه؛ تُستخدم العهدة النثرية.', "Not from the cashier's drawer: use petty cash.")} />
          <TextField label={tx('الجهة / المورد', 'Payee / supplier')} value={f.payee} onChange={set('payee')} optional error={fieldText('payee', fe.payee, t)} />
          <TextField label={tx('رقم الفاتورة أو الإيصال', 'Bill or receipt no.')} value={f.reference} onChange={set('reference')} dir="auto" optional error={fieldText('reference', fe.reference, t)} />
        </div>
        <TextArea label={tx('الوصف', 'Description')} rows={2} value={f.description} onChange={set('description')} error={fieldText('description', fe.description, t)} />
        <div className={`file-drop ${file ? 'has-file' : ''} ${fe.file || tooBig ? 'bad' : ''}`}>
          <Icon name={file ? 'checkCircle' : 'clipboard'} size={20} />
          <div>
            <strong>{file ? file.name : tx('صورة الفاتورة', 'Bill attachment')}</strong>
            <small className="muted">{file ? `${(file.size / 1024).toFixed(0)} KB` : tx(`PDF أو JPG أو PNG حتى ${options.max_upload_mb} ميجابايت (اختياري)`, `PDF, JPG or PNG up to ${options.max_upload_mb} MB (optional)`)}</small>
            {(fe.file || tooBig) && <small className="neg">{tooBig ? t('field.too_large') : fieldText('file', fe.file, t)}</small>}
          </div>
          <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" id="exp-file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <label htmlFor="exp-file" className="btn btn-ghost btn-sm">{file ? tx('تغيير', 'Change') : tx('اختر ملفًا', 'Choose file')}</label>
          {file && <button type="button" className="btn btn-quiet btn-icon" onClick={() => { setFile(null); if (input.current) input.current.value = '' }} aria-label={tx('إزالة الملف', 'Remove file')}><Icon name="x" size={16} /></button>}
        </div>
      </div>
    </Modal>
  )
}

function VoidModal({ x, onClose, onDone }) {
  const { t, tx, locale } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.voidExpense(x.id, { reason: reason.trim() })
      toast.success(tx('أُلغي المصروف وسُجّل القيد العكسي.', 'Expense voided and the reversal posted.'))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('إلغاء مصروف', 'Void an expense')}
      description={<><span className="mrn">{x.ref}</span> · {money(x.amount, locale)} · {x.description}</>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="x" loading={busy} disabled={reason.trim().length < 5} onClick={submit}>{tx('إلغاء المصروف', 'Void expense')}</Button></>}>
      <div className="form">
        {error && !error.fields?.reason && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <p>{tx('يعود المبلغ إلى الحساب الذي دُفع منه بقيد عكسي، ويبقى المصروف ظاهرًا كملغى.', 'The money goes back to the account it was paid from with a reversal; the expense stays listed as void.')}</p>
        <TextArea label={tx('السبب', 'Reason')} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus error={fieldText('reason', error?.fields?.reason, t)} />
      </div>
    </Modal>
  )
}
