import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { SelectField, TextField } from '../Fields'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { fmtDateTime } from '../../lib/format'
import { SourceChip, accountLabel, amt, dayLabelShort, downloadCsv, memoText, monthLabel, monthStart, money, num, today, useAccounting } from './meta'

const REPORTS = [
  { key: 'pnl', icon: 'pie', ar: 'الأرباح والخسائر', en: 'Profit & loss', range: true },
  { key: 'income', icon: 'trending', ar: 'تحليل الإيرادات', en: 'Income analysis', range: true },
  { key: 'daily-cash', icon: 'cash', ar: 'النقدية اليومية', en: 'Daily cash', day: true },
  { key: 'trial-balance', icon: 'calculator', ar: 'ميزان المراجعة', en: 'Trial balance', asOf: true },
  { key: 'ledger', icon: 'layers', ar: 'دفتر الأستاذ', en: 'General ledger', range: true },
  { key: 'aging', icon: 'clock', ar: 'أعمار الديون', en: 'Receivables aging', asOf: true },
  { key: 'credit', icon: 'award', ar: 'أرصدة المرضى الدائنة', en: 'Patient credit' },
  { key: 'vat', icon: 'clipboard', ar: 'ضريبة القيمة المضافة', en: 'VAT', range: true },
]
const BY = [
  { value: 'service', ar: 'الخدمة', en: 'Service' },
  { value: 'doctor', ar: 'الطبيب', en: 'Doctor' },
  { value: 'specialty', ar: 'التخصص', en: 'Specialty' },
  { value: 'branch', ar: 'الفرع', en: 'Branch' },
]

export default function Reports() {
  const { tx, lang, locale } = useI18n()
  const [params, setParams] = useSearchParams()
  const r = REPORTS.find((x) => x.key === params.get('r')) || REPORTS[0]
  const set = (patch) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    setParams(next, { replace: true })
  }
  const yearStart = `${today().slice(0, 4)}-01-01`
  const f = {
    from: params.get('from') || (r.key === 'vat' ? yearStart : monthStart()),
    to: params.get('to') || today(),
    day: params.get('day') || today(),
    as_of: params.get('as_of') || today(),
    by: params.get('by') || 'service',
    account: params.get('account') || '',
  }
  const period = r.range ? `${dayLabelShort(f.from, locale)} – ${dayLabelShort(f.to, locale)}` : r.day ? dayLabelShort(f.day, locale) : r.asOf ? tx(`حتى ${dayLabelShort(f.as_of, locale)}`, `As of ${dayLabelShort(f.as_of, locale)}`) : tx(`في ${dayLabelShort(today(), locale)}`, `On ${dayLabelShort(today(), locale)}`)

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الحسابات العامة', 'Accounting')} title={tx('التقارير', 'Reports')}
        description={tx('كل الأرقام من دفتر اليومية مباشرة. كل تقرير قابل للطباعة والتصدير إلى Excel (CSV).', 'Every figure comes straight from the journal. Each report can be printed or exported to Excel (CSV).')} />
      <div className="report-layout">
        <nav className="report-nav no-print" aria-label={tx('التقارير', 'Reports')}>
          {REPORTS.map((x) => (
            <button key={x.key} type="button" aria-current={x.key === r.key ? 'page' : undefined}
              onClick={() => setParams(x.key === 'ledger' && f.account ? { r: x.key, account: f.account } : { r: x.key }, { replace: true })}>
              <Icon name={x.icon} size={16} />{x[lang]}
            </button>
          ))}
        </nav>
        <section className="card report-card">
          <div className="report-print-head">
            <strong>{tx('عيادات جولدن كير', 'Golden Care Clinics')}</strong>
            <span>{r[lang]} · {period}</span>
            <small>{tx('طُبع في', 'Printed')} {fmtDateTime(new Date().toISOString(), locale)}</small>
          </div>
          <div className="toolbar no-print">
            <div className="filters">
              {r.range && <>
                <TextField label={tx('من', 'From')} type="date" value={f.from} max={f.to} onChange={(e) => set({ from: e.target.value })} />
                <TextField label={tx('إلى', 'To')} type="date" value={f.to} min={f.from} max={today()} onChange={(e) => set({ to: e.target.value })} />
              </>}
              {r.day && <TextField label={tx('اليوم', 'Day')} type="date" value={f.day} max={today()} onChange={(e) => set({ day: e.target.value })} />}
              {r.asOf && <TextField label={tx('حتى تاريخ', 'As of')} type="date" value={f.as_of} max={today()} onChange={(e) => set({ as_of: e.target.value })} />}
              {r.key === 'income' && <SelectField label={tx('حسب', 'By')} value={f.by} onChange={(e) => set({ by: e.target.value })} options={BY.map((b) => ({ value: b.value, label: b[lang] }))} />}
            </div>
          </div>
          <Report key={r.key} r={r} f={f} set={set} period={period} />
        </section>
      </div>
    </div>
  )
}

// Columns drive both the table and the CSV: { key, label, num, total, cell(row), csv(row) }
function Report({ r, f, set, period }) {
  const { tx, pick, lang, locale } = useI18n()
  const { api, base } = useAccounting()
  const accounts = useAsync(() => (r.key === 'ledger' ? api.accounts() : Promise.resolve(null)), [r.key, api])
  const query = {
    pnl: { date_from: f.from, date_to: f.to },
    income: { by: f.by, date_from: f.from, date_to: f.to },
    'daily-cash': { day: f.day },
    'trial-balance': { as_of: f.as_of },
    ledger: { account_id: f.account, date_from: f.from, date_to: f.to },
    aging: { as_of: f.as_of },
    credit: {},
    vat: { date_from: f.from, date_to: f.to },
  }[r.key]
  const ready = r.key !== 'ledger' || f.account
  const { data, error, loading, reload } = useAsync(() => (ready ? api.report(r.key, query) : Promise.resolve(null)), [r.key, JSON.stringify(query), api])
  const jr = (row) => <Link to={`${base}/journal/${row.entry_id}`} className="mrn">{row.ref}</Link>
  const patient = (row) => <><span className="person-name">{pick(row, 'full_name')}</span> <small className="mrn">{row.mrn}</small></>
  const m = (v) => money(v, locale)

  const views = useMemo(() => !data ? null : ({
    pnl: () => [
      {
        title: tx('الإيرادات', 'Income'), rows: data.income, foot: [tx('إجمالي الإيرادات', 'Total income'), data.total_income],
        cols: [
          { label: tx('الحساب', 'Account'), cell: (x) => <Link to={`${base}/reports?r=ledger&account=${x.id}&from=${data.date_from}&to=${data.date_to}`}>{accountLabel(x, pick)}</Link>, csv: (x) => accountLabel(x, pick) },
          { label: tx('المبلغ', 'Amount'), num: true, cell: (x) => m(x.amount), csv: (x) => x.amount },
        ],
      },
      {
        title: tx('المصروفات', 'Expenses'), rows: data.expenses, foot: [tx('إجمالي المصروفات', 'Total expenses'), data.total_expenses],
        cols: [
          { label: tx('الحساب', 'Account'), cell: (x) => <Link to={`${base}/reports?r=ledger&account=${x.id}&from=${data.date_from}&to=${data.date_to}`}>{accountLabel(x, pick)}</Link>, csv: (x) => accountLabel(x, pick) },
          { label: tx('المبلغ', 'Amount'), num: true, cell: (x) => m(x.amount), csv: (x) => x.amount },
        ],
      },
    ],
    income: () => [{
      rows: data.items,
      cols: [
        { label: BY.find((b) => b.value === data.by)?.[lang], cell: (x) => pick(x) || <span className="muted">{tx('غير محدد', 'Not set')}</span>, csv: (x) => pick(x) || '' },
        { label: tx('الخدمات', 'Services'), num: true, total: 'services', cell: (x) => m(x.services), csv: (x) => x.services },
        { label: tx('الباقات', 'Packages'), num: true, total: 'packages', cell: (x) => m(x.packages), csv: (x) => x.packages },
        { label: tx('الإيراد', 'Income'), num: true, total: 'income', cell: (x) => <strong>{m(x.income)}</strong>, csv: (x) => x.income },
        { label: tx('حصص الأطباء', 'Doctor shares'), num: true, total: 'doctor_fees', cell: (x) => m(x.doctor_fees), csv: (x) => x.doctor_fees },
        { label: tx('صافي العيادة', 'Clinic net'), num: true, total: 'net', cell: (x) => m(x.net), csv: (x) => x.net },
      ],
      totals: data.total,
    }],
    'daily-cash': () => [
      {
        title: tx('الحسابات النقدية', 'Money accounts'), rows: data.accounts,
        cols: [
          { label: tx('الحساب', 'Account'), cell: (x) => accountLabel(x, pick), csv: (x) => accountLabel(x, pick) },
          { label: tx('أول اليوم', 'Opening'), num: true, total: 'opening', cell: (x) => m(x.opening), csv: (x) => x.opening },
          { label: tx('داخل', 'In'), num: true, total: 'money_in', cell: (x) => <span className="pos">{amt(x.money_in, locale)}</span>, csv: (x) => x.money_in },
          { label: tx('خارج', 'Out'), num: true, total: 'money_out', cell: (x) => <span className="neg">{amt(x.money_out, locale)}</span>, csv: (x) => x.money_out },
          { label: tx('آخر اليوم', 'Closing'), num: true, total: 'closing', cell: (x) => <strong>{m(x.closing)}</strong>, csv: (x) => x.closing },
        ],
        totals: data,
      },
      {
        title: tx('الحركات', 'Movements'), rows: data.entries,
        cols: [
          { label: tx('القيد', 'Entry'), cell: jr, csv: (x) => x.ref },
          { label: tx('المصدر', 'Source'), cell: (x) => <><SourceChip type={x.source_type} /> <small className="mrn">{x.source_ref}</small></>, csv: (x) => `${x.source_type} ${x.source_ref || ''}` },
          { label: tx('البيان', 'Memo'), cell: (x) => <span className="cell-wrap">{memoText(x, lang)}</span>, csv: (x) => memoText(x, lang) },
          { label: tx('الحساب', 'Account'), cell: (x) => accountLabel(x, pick), csv: (x) => accountLabel(x, pick) },
          { label: tx('داخل', 'In'), num: true, cell: (x) => amt(x.debit, locale), csv: (x) => x.debit },
          { label: tx('خارج', 'Out'), num: true, cell: (x) => amt(x.credit, locale), csv: (x) => x.credit },
        ],
      },
      {
        title: tx('ورديات الكاشير', 'Cashier shifts'), rows: data.shifts,
        cols: [
          { label: tx('الوردية', 'Shift'), cell: (x) => <span className="mrn">{x.ref}</span>, csv: (x) => x.ref },
          { label: tx('الكاشير', 'Cashier'), cell: (x) => pick(x, 'cashier'), csv: (x) => pick(x, 'cashier') },
          { label: tx('المتوقع', 'Expected'), num: true, cell: (x) => (x.expected_cash == null ? '—' : m(x.expected_cash)), csv: (x) => x.expected_cash },
          { label: tx('المعدود', 'Counted'), num: true, cell: (x) => (x.counted_cash == null ? <span className="muted">{tx('مفتوحة', 'Open')}</span> : m(x.counted_cash)), csv: (x) => x.counted_cash },
          { label: tx('الفرق', 'Difference'), num: true, cell: (x) => (num(x.difference) ? <span className={num(x.difference) < 0 ? 'neg' : 'pos'}>{m(x.difference)}</span> : '—'), csv: (x) => x.difference },
        ],
      },
    ],
    'trial-balance': () => [{
      rows: data.items,
      cols: [
        { label: tx('الحساب', 'Account'), cell: (x) => <Link to={`${base}/reports?r=ledger&account=${x.id}`}>{accountLabel(x, pick)}</Link>, csv: (x) => accountLabel(x, pick) },
        { label: tx('مدين', 'Debit'), num: true, total: 'debit', cell: (x) => amt(x.debit_balance, locale), csv: (x) => x.debit_balance },
        { label: tx('دائن', 'Credit'), num: true, total: 'credit', cell: (x) => amt(x.credit_balance, locale), csv: (x) => x.credit_balance },
      ],
      totals: data,
      note: num(data.debit) === num(data.credit)
        ? <span className="ok-text"><Icon name="checkCircle" size={15} />{tx('الميزان متوازن', 'The trial balance balances')}</span>
        : <span className="neg"><Icon name="alert" size={15} />{tx('الميزان غير متوازن', 'Out of balance')}</span>,
    }],
    ledger: () => [{
      rows: data.items,
      head: [tx('رصيد أول المدة', 'Opening balance'), data.opening],
      cols: [
        { label: tx('التاريخ', 'Date'), cell: (x) => <bdi>{dayLabelShort(x.entry_date, locale)}</bdi>, csv: (x) => x.entry_date },
        { label: tx('القيد', 'Entry'), cell: jr, csv: (x) => x.ref },
        { label: tx('البيان', 'Memo'), cell: (x) => <span className="cell-wrap">{(x.service_name_en && pick(x, 'service_name')) || x.line_memo || memoText(x, lang)}{(x.mrn || x.doctor_name_en) && <small className="muted" style={{ display: 'block' }}>{[x.mrn && `${pick(x, 'patient_name')} ${x.mrn}`, pick(x, 'doctor_name')].filter(Boolean).join(' · ')}</small>}</span>, csv: (x) => (x.service_name_en && pick(x, 'service_name')) || x.line_memo || memoText(x, lang) },
        { label: tx('مدين', 'Debit'), num: true, total: 'debit', cell: (x) => amt(x.debit, locale), csv: (x) => x.debit },
        { label: tx('دائن', 'Credit'), num: true, total: 'credit', cell: (x) => amt(x.credit, locale), csv: (x) => x.credit },
        { label: tx('الرصيد', 'Balance'), num: true, cell: (x) => m(x.balance), csv: (x) => x.balance },
      ],
      totals: data,
      foot: [tx('رصيد آخر المدة', 'Closing balance'), data.closing],
    }],
    aging: () => [{
      rows: data.items,
      cols: [
        { label: tx('المريض', 'Patient'), cell: patient, csv: (x) => `${pick(x, 'full_name')} ${x.mrn}` },
        { label: tx('فواتير', 'Invoices'), num: true, cell: (x) => x.invoices, csv: (x) => x.invoices },
        { label: tx('٠–٣٠ يوم', '0–30 days'), num: true, total: 'b0', cell: (x) => amt(x.b0, locale), csv: (x) => x.b0 },
        { label: tx('٣١–٦٠', '31–60'), num: true, total: 'b30', cell: (x) => amt(x.b30, locale), csv: (x) => x.b30 },
        { label: tx('٦١–٩٠', '61–90'), num: true, total: 'b60', cell: (x) => amt(x.b60, locale), csv: (x) => x.b60 },
        { label: tx('أكثر من ٩٠', '90+'), num: true, total: 'b90', cell: (x) => (num(x.b90) ? <span className="neg">{amt(x.b90, locale)}</span> : '—'), csv: (x) => x.b90 },
        { label: tx('الإجمالي', 'Total'), num: true, total: 'balance', cell: (x) => <strong>{m(x.balance)}</strong>, csv: (x) => x.balance },
      ],
      totals: data.total,
    }],
    credit: () => [{
      rows: data.items,
      cols: [
        { label: tx('المريض', 'Patient'), cell: patient, csv: (x) => `${pick(x, 'full_name')} ${x.mrn}` },
        { label: tx('الهاتف', 'Phone'), cell: (x) => <bdi dir="ltr">{x.phone}</bdi>, csv: (x) => x.phone },
        { label: tx('آخر حركة', 'Last movement'), cell: (x) => <bdi>{dayLabelShort(x.last_movement, locale)}</bdi>, csv: (x) => x.last_movement?.slice(0, 10) },
        { label: tx('استرداد معلّق', 'Refund pending'), cell: (x) => (x.refunds_pending ? <span className="badge badge-warn">{x.refunds_pending}</span> : '—'), csv: (x) => x.refunds_pending },
        { label: tx('الرصيد', 'Credit'), num: true, cell: (x) => <strong>{m(x.balance)}</strong>, csv: (x) => x.balance },
      ],
      foot: [tx('الإجمالي', 'Total'), data.total],
    }],
    vat: () => [{
      rows: data.items,
      cols: [
        { label: tx('الشهر', 'Month'), cell: (x) => monthLabel(x.month, locale), csv: (x) => x.month.slice(0, 7) },
        { label: tx('البنود الخاضعة', 'Taxable lines'), num: true, cell: (x) => x.lines, csv: (x) => x.lines },
        { label: tx('الوعاء (قبل الضريبة)', 'Taxable base'), num: true, total: 'base', cell: (x) => m(x.base), csv: (x) => x.base },
        { label: tx('الضريبة المستحقة', 'VAT due'), num: true, total: 'vat', cell: (x) => <strong>{m(x.vat)}</strong>, csv: (x) => x.vat },
      ],
      totals: data,
      note: <span className="muted"><Icon name="info" size={14} />{tx('للمراجعة الداخلية. الإيصال الإلكتروني لمصلحة الضرائب غير مربوط بعد.', 'For internal review. The Tax Authority e-receipt is not connected yet.')}</span>,
    }],
  })[r.key](), [data, lang, locale, base]) // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = () => {
    const out = [[tx('عيادات جولدن كير', 'Golden Care Clinics')], [r[lang], period], []]
    views.forEach((v) => {
      if (v.title) out.push([v.title])
      if (v.head) out.push([v.head[0], v.head[1]])
      out.push(v.cols.map((c) => c.label))
      v.rows.forEach((row) => out.push(v.cols.map((c) => c.csv(row))))
      if (v.totals) out.push(v.cols.map((c, i) => (i === 0 ? tx('الإجمالي', 'Total') : c.total ? v.totals[c.total] : '')))
      if (v.foot) out.push([v.foot[0], v.foot[1]])
      out.push([])
    })
    if (r.key === 'pnl') out.push([tx('صافي الربح', 'Net profit'), data.net])
    downloadCsv(`golden-care-${r.key}-${r.range ? `${f.from}_${f.to}` : r.day ? f.day : r.asOf ? f.as_of : today()}.csv`, out)
  }

  const accountPicker = r.key === 'ledger' && accounts.data && (
    <div className="toolbar no-print ledger-pick">
      <SelectField label={tx('الحساب', 'Account')} value={f.account} placeholder={tx('اختر حسابًا…', 'Choose an account…')} onChange={(e) => set({ account: e.target.value })}
        options={accounts.data.map((a) => ({ value: String(a.id), label: `${accountLabel(a, pick)}${a.is_active ? '' : ` (${tx('موقوف', 'inactive')})`}` }))} />
    </div>
  )

  if (!ready) return <>{accountPicker}<EmptyState icon="layers" title={tx('اختر حسابًا لعرض حركته', 'Choose an account to see its movements')} /></>
  if (error) return <>{accountPicker}<ErrorState error={error} onRetry={reload} /></>
  if (loading || !data) return <>{accountPicker}<SkeletonRows rows={6} cols={4} /></>

  return (
    <>
      {accountPicker}
      <div className="report-actions no-print">
        {r.key === 'ledger' && <h2 className="report-sub">{accountLabel(data.account, pick)}</h2>}
        <span className="spacer" />
        <Button variant="ghost" size="sm" icon="printer" onClick={() => window.print()}>{tx('طباعة', 'Print')}</Button>
        <Button variant="ghost" size="sm" icon="download" onClick={exportCsv}>{tx('تصدير CSV', 'Export CSV')}</Button>
      </div>
      {r.key === 'ledger' && <h2 className="report-sub print-only">{accountLabel(data.account, pick)}</h2>}
      {r.key === 'pnl' && (
        <div className="pnl-hero">
          <div><small>{tx('الإيرادات', 'Income')}</small><strong className="num">{m(data.total_income)}</strong></div>
          <span aria-hidden="true">−</span>
          <div><small>{tx('المصروفات', 'Expenses')}</small><strong className="num">{m(data.total_expenses)}</strong></div>
          <span aria-hidden="true">=</span>
          <div className={num(data.net) < 0 ? 'loss' : 'profit'}><small>{num(data.net) < 0 ? tx('صافي خسارة', 'Net loss') : tx('صافي ربح', 'Net profit')}</small><strong className="num">{m(data.net)}</strong></div>
        </div>
      )}
      {views.map((v, i) => <ReportTable key={i} v={v} locale={locale} tx={tx} />)}
    </>
  )
}

function ReportTable({ v, locale, tx }) {
  return (
    <div className="report-block">
      {v.title && <h3 className="report-title">{v.title}</h3>}
      {!v.rows.length ? (
        <p className="muted report-empty">{tx('لا توجد بيانات في هذه الفترة.', 'Nothing in this period.')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table report-table">
            <thead><tr>{v.cols.map((c, i) => <th key={i} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
            <tbody>
              {v.head && <tr className="row-muted"><td colSpan={v.cols.length - 1}>{v.head[0]}</td><td className="num">{money(v.head[1], locale)}</td></tr>}
              {v.rows.map((row, i) => <tr key={i}>{v.cols.map((c, j) => <td key={j} className={c.num ? 'num' : ''}>{c.cell(row)}</td>)}</tr>)}
            </tbody>
            {(v.totals || v.foot) && (
              <tfoot>
                {v.totals && <tr>{v.cols.map((c, i) => <td key={i} className={c.num ? 'num' : ''}>{i === 0 ? tx('الإجمالي', 'Total') : c.total ? money(v.totals[c.total], locale) : ''}</td>)}</tr>}
                {v.foot && <tr><td colSpan={v.cols.length - 1}>{v.foot[0]}</td><td className="num">{money(v.foot[1], locale)}</td></tr>}
              </tfoot>
            )}
          </table>
        </div>
      )}
      {v.note && <p className="report-note">{v.note}</p>}
    </div>
  )
}
