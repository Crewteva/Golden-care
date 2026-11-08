import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, Pagination, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync, useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'
import { GROUPS, SourceChip, SourceLink, accountLabel, amt, cleanAmount, dayLabelShort, money, num, today, useAccounting } from './meta'

export default function Journal() {
  const { tx, pick, locale } = useI18n()
  const { api, base, canPost } = useAccounting()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [group, setGroup] = useState(params.get('group') || '')
  const [accountId, setAccountId] = useState(params.get('account_id') || '')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const term = useDebounced(q.trim(), 300)
  const query = { q: term, group, account_id: accountId, date_from: from, date_to: to, page }
  const { data, error, loading, reload } = useAsync(() => api.journal(query), [JSON.stringify(query), api])
  const options = useAsync(() => api.options(), [api])
  const reset = (fn) => (v) => { fn(v); setPage(1); if (params.toString()) setParams({}, { replace: true }) }

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الحسابات العامة', 'Accounting')} title={tx('دفتر اليومية', 'Journal')}
        description={tx('كل قيد في الدفاتر، تلقائي من الفوترة أو يدوي. القيود لا تُعدَّل: الخطأ يُصحَّح بقيد عكسي.', "Every entry in the books, posted from billing or by hand. Entries can't be edited: a mistake is put right with a reversal.")}
        actions={canPost && <Button icon="plus" onClick={() => setAdding(true)} disabled={!options.data}>{tx('قيد يدوي', 'Manual entry')}</Button>} />

      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('المصدر', 'Source')}>
            {Object.keys(GROUPS).map((g) => <button key={g} type="button" role="tab" aria-selected={group === g} onClick={() => reset(setGroup)(g)}>{tx(GROUPS[g].ar, GROUPS[g].en)}</button>)}
          </div>
        </div>
        <div className="toolbar filters">
          <TextField label={tx('بحث', 'Search')} icon="search" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder={tx('رقم القيد، المرجع، البيان', 'Entry no., reference, memo')} />
          <SelectField label={tx('الحساب', 'Account')} value={accountId} onChange={(e) => reset(setAccountId)(e.target.value)} placeholder={tx('كل الحسابات', 'All accounts')}
            options={(options.data?.accounts || []).map((a) => ({ value: String(a.id), label: accountLabel(a, pick) }))} />
          <TextField label={tx('من', 'From')} type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
          <TextField label={tx('إلى', 'To')} type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} />
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={8} cols={5} /> : !data.items.length ? (
          <EmptyState icon="calculator" title={tx('لا توجد قيود مطابقة', 'No matching entries')} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table jr-table">
                <thead><tr>
                  <th>{tx('القيد', 'Entry')}</th><th>{tx('التاريخ', 'Date')}</th><th>{tx('البيان', 'Memo')}</th>
                  <th>{tx('الحسابات', 'Accounts')}</th><th className="num">{tx('المبلغ', 'Amount')}</th>
                </tr></thead>
                <tbody>
                  {data.items.map((e) => (
                    <tr key={e.id} className={e.reversed_by_id ? 'row-muted' : ''}>
                      <td><Link to={`${base}/journal/${e.id}`} className="mrn">{e.ref}</Link><div><SourceChip type={e.source_type} /></div></td>
                      <td><bdi>{dayLabelShort(e.entry_date, locale)}</bdi></td>
                      <td className="cell-wrap">{e.memo}
                        <small className="muted" style={{ display: 'block' }}>{e.source_ref && <span className="mrn">{e.source_ref}</span>}
                          {e.reverses_ref && <> · {tx('يعكس', 'reverses')} <span className="mrn">{e.reverses_ref}</span></>}
                          {e.reversed_by_ref && <> · {tx('عُكس بـ', 'reversed by')} <span className="mrn">{e.reversed_by_ref}</span></>}</small></td>
                      <td>
                        <ul className="jr-accts">
                          {e.accounts.slice(0, 4).map((a) => (
                            <li key={a.code} className={num(a.debit) > 0 ? 'dr' : 'cr'}><span className="mrn">{a.code}</span>{pick(a)}</li>
                          ))}
                          {e.accounts.length > 4 && <li className="more">+{e.accounts.length - 4}</li>}
                        </ul>
                      </td>
                      <td className="num">{money(e.amount, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </section>
      <p className="muted foot-note"><Icon name="info" size={14} />{tx('المدين يمينًا والدائن يسارًا في القيد؛ في القائمة: الحسابات المدينة باللون الأخضر والدائنة بالذهبي.', 'In the list, debited accounts are marked green and credited ones gold.')}</p>
      {adding && <EntryModal options={options.data} onClose={() => setAdding(false)} onDone={() => { setAdding(false); setPage(1); reload() }} />}
    </div>
  )
}

const blankLine = () => ({ key: Math.random().toString(36).slice(2), account_id: '', debit: '', credit: '', memo: '' })

function EntryModal({ options, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const [date, setDate] = useState(today())
  const [memo, setMemo] = useState('')
  const [lines, setLines] = useState([blankLine(), blankLine()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const accounts = useMemo(() => options.accounts.filter((a) => a.is_active && !options.controlled.includes(a.system_key)), [options])
  const debit = lines.reduce((s, l) => s + num(l.debit), 0)
  const credit = lines.reduce((s, l) => s + num(l.credit), 0)
  const diff = Math.round((debit - credit) * 100) / 100
  const set = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const [sent, setSent] = useState([])
  const fe = error?.fields || {}
  // errors come back by position in what was sent, which skips blank lines
  const lineErr = (i, f) => {
    const n = sent.indexOf(i)
    return n < 0 ? undefined : fe[`lines.${n}.${f}`] || (f === 'account_id' ? fe[`lines.${n}`] : undefined)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const used = lines.map((l, i) => (l.account_id || num(l.debit) || num(l.credit) ? i : -1)).filter((i) => i >= 0)
      setSent(used)
      const body = {
        entry_date: date, memo: memo.trim(),
        lines: used.map((i) => lines[i]).map((l) => ({ account_id: Number(l.account_id) || null, debit: l.debit || 0, credit: l.credit || 0, memo: l.memo.trim() || null })),
      }
      const row = await api.postEntry(body)
      toast.success(tx(`سُجّل القيد ${row.ref}.`, `Entry ${row.ref} posted.`))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const generic = error && !Object.keys(fe).some((k) => k === 'memo' || k === 'entry_date' || k.startsWith('lines.'))
  return (
    <Modal open wide onClose={onClose} busy={busy} title={tx('قيد يدوي', 'Manual entry')}
      description={tx('للتسويات والاستحقاقات والأرصدة الافتتاحية. حسابات المرضى (المستحقات، الأرصدة، الباقات) تُدار من الفوترة فقط.', 'For adjustments, accruals and opening balances. Patient accounts (receivables, credit, packages) are only moved by billing.')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="check" loading={busy} disabled={diff !== 0 || debit === 0 || memo.trim().length < 5} onClick={submit}>{tx('تسجيل القيد', 'Post entry')}</Button></>}>
      <div className="form">
        {generic && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <div className="form-grid">
          <TextField label={tx('تاريخ القيد', 'Entry date')} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} error={fieldText('entry_date', fe.entry_date, t)} />
          <TextField label={tx('البيان', 'Memo')} value={memo} onChange={(e) => setMemo(e.target.value)} data-autofocus placeholder={tx('مثال: استحقاق إيجار أكتوبر', 'e.g. October rent accrual')} error={fieldText('memo', fe.memo, t)} />
        </div>
        <div className="entry-lines" role="group" aria-label={tx('سطور القيد', 'Entry lines')}>
          <div className="el-head" aria-hidden="true"><span>{tx('الحساب', 'Account')}</span><span>{tx('مدين', 'Debit')}</span><span>{tx('دائن', 'Credit')}</span><span>{tx('ملاحظة', 'Note')}</span><span /></div>
          {lines.map((l, i) => (
            <div className="el-row" key={l.key}>
              <SelectField label={tx(`حساب السطر ${i + 1}`, `Line ${i + 1} account`)} className="el-acct" value={l.account_id} onChange={(e) => set(i, { account_id: e.target.value })}
                placeholder={tx('اختر حسابًا', 'Choose an account')} options={accounts.map((a) => ({ value: String(a.id), label: accountLabel(a, pick) }))}
                error={fieldText('account_id', lineErr(i, 'account_id'), t)} />
              <TextField label={tx('مدين', 'Debit')} inputMode="decimal" dir="ltr" value={l.debit} onChange={(e) => set(i, { debit: cleanAmount(e.target.value), credit: '' })} placeholder="0.00" error={fieldText('debit', lineErr(i, 'debit'), t)} />
              <TextField label={tx('دائن', 'Credit')} inputMode="decimal" dir="ltr" value={l.credit} onChange={(e) => set(i, { credit: cleanAmount(e.target.value), debit: '' })} placeholder="0.00" error={fieldText('credit', lineErr(i, 'credit'), t)} />
              <TextField label={tx('ملاحظة', 'Note')} value={l.memo} onChange={(e) => set(i, { memo: e.target.value })} optional />
              <button type="button" className="btn btn-quiet btn-icon" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={tx(`حذف السطر ${i + 1}`, `Remove line ${i + 1}`)}><Icon name="x" size={16} /></button>
            </div>
          ))}
          <div className="el-foot">
            <Button variant="ghost" size="sm" icon="plus" disabled={lines.length >= 40} onClick={() => setLines((ls) => [...ls, blankLine()])}>{tx('سطر', 'Line')}</Button>
            <span className="num">{amt(debit, locale)}</span>
            <span className="num">{amt(credit, locale)}</span>
            <span className={`el-diff ${diff === 0 && debit > 0 ? 'ok' : 'bad'}`} aria-live="polite">
              {debit === 0 ? tx('أدخل المبالغ', 'Enter the amounts') : diff === 0 ? <><Icon name="checkCircle" size={15} />{tx('متوازن', 'Balanced')}</> : tx(`فرق ${amt(Math.abs(diff), locale)}`, `Off by ${amt(Math.abs(diff), locale)}`)}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export function EntryPage() {
  const { id } = useParams()
  const { tx, pick, locale } = useI18n()
  const { api, base, canPost } = useAccounting()
  const navigate = useNavigate()
  const [reversing, setReversing] = useState(false)
  const { data: e, error, loading, reload } = useAsync(() => api.entry(id), [id, api])
  const back = <Link to={`${base}/journal`} className="back-link"><Icon name="arrowLeft" size={16} />{tx('دفتر اليومية', 'Journal')}</Link>
  if (error) return <div className="page">{back}<section className="card"><ErrorState error={error} onRetry={reload} /></section></div>
  if (loading && !e) return <div className="page">{back}<section className="card"><SkeletonRows rows={6} cols={4} /></section></div>
  const debit = e.lines.reduce((s, l) => s + num(l.debit), 0)
  const credit = e.lines.reduce((s, l) => s + num(l.credit), 0)
  const canReverse = canPost && !e.reversed_by_id && (e.source_type === 'manual')
  return (
    <div className="page reveal">
      <PageHeader back={back} eyebrow={<SourceChip type={e.source_type} />} title={<>{tx('قيد', 'Entry')} <span className="mrn title-ref">{e.ref}</span></>}
        description={e.memo}
        actions={<>
          <Button variant="ghost" icon="printer" onClick={() => window.print()}>{tx('طباعة', 'Print')}</Button>
          {canReverse && <Button variant="ghost" icon="refresh" onClick={() => setReversing(true)}>{tx('قيد عكسي', 'Reverse')}</Button>}
        </>} />
      <section className="card">
        <dl className="entry-facts">
          <div><dt>{tx('تاريخ القيد', 'Entry date')}</dt><dd><bdi>{dayLabelShort(e.entry_date, locale)}</bdi></dd></div>
          <div><dt>{tx('المرجع', 'Reference')}</dt><dd>{e.source_ref ? <SourceLink entry={e} /> : '—'}</dd></div>
          <div><dt>{tx('سجّله', 'Posted by')}</dt><dd>{pick(e, 'created_by') || tx('النظام (تلقائي)', 'System (automatic)')}<small className="muted"><bdi>{fmtDateTime(e.created_at, locale)}</bdi></small></dd></div>
          {e.branch_name_en && <div><dt>{tx('الفرع', 'Branch')}</dt><dd>{pick(e, 'branch_name')}</dd></div>}
        </dl>
        {(e.reverses_id || e.reversed_by_id) && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            {e.reverses_id && <Alert tone="info">{tx('هذا القيد يعكس القيد', 'This entry reverses')} <Link to={`${base}/journal/${e.reverses_id}`} className="mrn">{e.reverses_ref}</Link></Alert>}
            {e.reversed_by_id && <Alert tone="warn">{tx('عُكس هذا القيد بالقيد', 'This entry was reversed by')} <Link to={`${base}/journal/${e.reversed_by_id}`} className="mrn">{e.reversed_by_ref}</Link></Alert>}
          </div>
        )}
        <div className="table-wrap">
          <table className="table entry-table">
            <thead><tr><th>{tx('الحساب', 'Account')}</th><th>{tx('التفاصيل', 'Details')}</th><th className="num">{tx('مدين', 'Debit')}</th><th className="num">{tx('دائن', 'Credit')}</th></tr></thead>
            <tbody>
              {e.lines.map((l, i) => (
                <tr key={i}>
                  <td><span className="mrn">{l.code}</span> {pick(l)}</td>
                  <td className="cell-wrap muted">
                    {[l.memo, l.patient_name_en && `${pick(l, 'patient_name')} (${l.mrn})`, l.doctor_name_en && pick(l, 'doctor_name'), l.service_name_en && pick(l, 'service_name')].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="num">{amt(l.debit, locale)}</td>
                  <td className="num">{amt(l.credit, locale)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th colSpan={2}>{tx('الإجمالي', 'Total')} {Math.abs(debit - credit) < 0.005 && <Badge tone="success">{tx('متوازن', 'Balanced')}</Badge>}</th><th className="num">{amt(debit, locale)}</th><th className="num">{amt(credit, locale)}</th></tr></tfoot>
          </table>
        </div>
      </section>
      {!canReverse && canPost && !e.reversed_by_id && e.source_type !== 'manual' && (
        <p className="muted foot-note"><Icon name="info" size={14} />{tx('القيود التلقائية تُصحَّح من مصدرها (إلغاء الفاتورة أو المصروف…) فيُنشئ النظام القيد العكسي.', 'Automatic entries are put right at their source (void the invoice, the expense…) and the reversal is posted for you.')}</p>
      )}
      {reversing && <ReverseModal entry={e} onClose={() => setReversing(false)} onDone={(row) => { setReversing(false); navigate(`${base}/journal/${row.id}`) }} />}
    </div>
  )
}

function ReverseModal({ entry, onClose, onDone }) {
  const { t, tx } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(today())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = await api.reverse(entry.id, { reason: reason.trim(), entry_date: date })
      toast.success(tx(`سُجّل القيد العكسي ${row.ref}.`, `Reversal ${row.ref} posted.`))
      onDone(row)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  const fe = error?.fields || {}
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('قيد عكسي', 'Reverse this entry')}
      description={<>{tx('يُسجَّل قيد بنفس السطور معكوسة، ويبقى القيد الأصلي للمراجعة.', 'An entry with the same lines the other way round is posted; the original stays for the audit trail.')} <span className="mrn">{entry.ref}</span></>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="refresh" loading={busy} disabled={reason.trim().length < 5} onClick={submit}>{tx('تسجيل القيد العكسي', 'Post reversal')}</Button></>}>
      <div className="form">
        {error && !fe.reason && !fe.entry_date && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <TextArea label={tx('السبب', 'Reason')} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus error={fieldText('reason', fe.reason, t)} />
        <TextField label={tx('تاريخ القيد العكسي', 'Reversal date')} type="date" value={date} min={entry.entry_date} max={today()} onChange={(e) => setDate(e.target.value)} error={fieldText('entry_date', fe.entry_date, t)} />
      </div>
    </Modal>
  )
}
