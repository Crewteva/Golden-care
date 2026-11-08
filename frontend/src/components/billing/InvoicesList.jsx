import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { Checkbox, TextField } from '../Fields'
import { EmptyState, ErrorState, PageHeader, Pagination, SkeletonRows, SortTh } from '../ui'
import { useAsync, useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtDate } from '../../lib/format'
import { InvoiceBadge, money, num, useBilling } from './meta'

const STATUSES = ['', 'issued', 'draft', 'pending_approval', 'void']

export default function InvoicesList() {
  const { tx, pick, locale } = useI18n()
  const { api, bill } = useBilling()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [unpaid, setUnpaid] = useState(false)
  const [sort, setSort] = useState({ column: 'date', desc: true })
  const [page, setPage] = useState(1)
  const term = useDebounced(q.trim(), 300)
  const query = { status, q: term, date_from: from, date_to: to, unpaid: unpaid || undefined, sort: sort.column, desc: sort.desc, page }
  const { data, error, loading, reload } = useAsync(() => api.invoices(query), [JSON.stringify(query), api])
  const reset = (fn) => (v) => { fn(v); setPage(1) }
  const onSort = (column) => { setSort((s) => ({ column, desc: s.column === column ? !s.desc : column !== 'patient' && column !== 'ref' })); setPage(1) }
  const sortProps = { sort: sort.column, direction: sort.desc ? 'desc' : 'asc', onSort }
  const labels = { '': tx('الكل', 'All'), issued: tx('صادرة', 'Issued'), draft: tx('مسودات', 'Drafts'), pending_approval: tx('بانتظار الاعتماد', 'Awaiting approval'), void: tx('ملغاة', 'Void') }

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الحسابات', 'Billing')} title={tx('الفواتير', 'Invoices')}
        description={tx('كل فواتير العيادة، ابحث برقم الفاتورة أو المريض، وتابع المتبقي.', "Every invoice in the clinic. Search by invoice or patient and follow what's still owed.")} />

      {data && (
        <div className="sum-strip">
          <div><small>{tx('عدد الفواتير', 'Invoices')}</small><strong className="num">{data.sums.n}</strong></div>
          <div><small>{tx('إجمالي الصادر', 'Issued total')}</small><strong className="num">{money(data.sums.total, locale)}</strong></div>
          <div><small>{tx('المحصّل', 'Collected')}</small><strong className="num">{money(data.sums.paid, locale)}</strong></div>
          <div className={num(data.sums.balance) > 0 ? 'owed' : ''}><small>{tx('المتبقي', 'Outstanding')}</small><strong className="num">{money(data.sums.balance, locale)}</strong></div>
        </div>
      )}

      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('الحالة', 'Status')}>
            {STATUSES.map((s) => <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => reset(setStatus)(s)}>{labels[s]}</button>)}
          </div>
        </div>
        <div className="toolbar filters">
          <TextField label={tx('بحث', 'Search')} icon="search" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder={tx('رقم الفاتورة، الاسم، الملف، الموبايل', 'Invoice no., name, file no., mobile')} />
          <TextField label={tx('من', 'From')} type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
          <TextField label={tx('إلى', 'To')} type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} />
          <Checkbox label={tx('عليها متبقي فقط', 'Unpaid only')} checked={unpaid} onChange={(e) => reset(setUnpaid)(e.target.checked)} />
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={8} cols={6} /> : !data.items.length ? (
          <EmptyState icon="clipboard" title={tx('لا توجد فواتير مطابقة', 'No matching invoices')} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortTh label={tx('الفاتورة', 'Invoice')} column="ref" {...sortProps} />
                    <SortTh label={tx('التاريخ', 'Date')} column="date" {...sortProps} />
                    <SortTh label={tx('المريض', 'Patient')} column="patient" {...sortProps} />
                    <th>{tx('الحالة', 'Status')}</th>
                    <SortTh label={tx('الإجمالي', 'Total')} column="total" {...sortProps} />
                    <SortTh label={tx('المتبقي', 'Balance')} column="balance" {...sortProps} />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i) => (
                    <tr key={i.id}>
                      <td><Link to={`${bill}/invoices/${i.id}`} className="mrn">{i.ref || tx('مسودة', 'Draft')}</Link></td>
                      <td><bdi>{fmtDate(i.issued_at || i.created_at, locale)}</bdi></td>
                      <td><Link to={`${bill}/patients/${i.patient_id}`} className="person-name">{pick(i, 'patient_name')}</Link><small className="mrn muted" style={{ display: 'block' }}>{i.mrn}</small></td>
                      <td><InvoiceBadge invoice={i} /></td>
                      <td className="num">{money(i.total, locale)}</td>
                      <td className="num">{i.status === 'issued' ? <span className={num(i.balance) > 0 ? 'neg' : 'muted'}>{money(i.balance, locale)}</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </section>
      <p className="muted foot-note"><Icon name="info" size={14} /> {tx('الإيصال الإلكتروني لمصلحة الضرائب غير مفعّل بعد.', 'Tax Authority e-receipts are not connected yet.')}</p>
    </div>
  )
}
