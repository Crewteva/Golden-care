import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import PageLoader from '../PageLoader'
import { TextArea, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { clock } from '../../lib/clinicTime'
import { METHODS, Methods, cleanAmount, money, num, useBilling } from './meta'

// A line at the top of the desk: is my drawer open, and what's in it.
export function ShiftStrip() {
  const { tx, locale } = useI18n()
  const { api, bill } = useBilling()
  const { data } = useAsync(() => api.shift(), [api])
  if (!data) return <div className="shift-strip skeleton" style={{ height: 64 }} aria-hidden="true" />
  const s = data.shift
  return (
    <div className={`shift-strip ${s ? 'open' : 'closed'}`}>
      <span className="shift-dot" aria-hidden="true" />
      {s ? (
        <>
          <div><strong>{tx('ورديتك مفتوحة', 'Your shift is open')}</strong> <span className="mrn">{s.ref}</span>
            <small>{tx('منذ', 'since')} <bdi>{clock(s.opened_at, locale)}</bdi> · {tx(`${s.totals.receipts} إيصال`, `${s.totals.receipts} receipts`)}</small></div>
          <div className="shift-figs">
            <span><small>{tx('المحصّل', 'Collected')}</small><strong className="num">{money(s.totals.collected, locale)}</strong></span>
            <span><small>{tx('النقدية المتوقعة بالدرج', 'Cash expected in drawer')}</small><strong className="num">{money(s.expected_cash, locale)}</strong></span>
          </div>
          <Link to={`${bill}/shift`} className="btn btn-ghost btn-sm">{tx('الوردية والإغلاق', 'Shift & closing')}</Link>
        </>
      ) : (
        <>
          <div><strong>{tx('لا توجد وردية مفتوحة', 'No open shift')}</strong><small>{tx('افتح ورديتك قبل استلام أي مبلغ.', 'Open your shift before taking any money.')}</small></div>
          <Link to={`${bill}/shift`} className="btn btn-gold btn-sm"><Icon name="cash" size={16} />{tx('فتح الوردية', 'Open shift')}</Link>
        </>
      )}
    </div>
  )
}

function Totals({ shift }) {
  const { tx, lang, locale } = useI18n()
  const t = shift.totals || { in: {}, refunds: {} }
  const closed = shift.status === 'closed'
  const expected = closed ? shift.expected_cash : shift.expected_cash
  return (
    <div className="shift-totals">
      <div className="shift-methods">
        {Object.keys(METHODS).map((m) => (
          <div key={m} className={num(t.in?.[m]) ? '' : 'zero'}>
            <small><Icon name={METHODS[m].icon} size={13} /> {METHODS[m][lang]}</small>
            <strong className="num">{money(t.in?.[m], locale)}</strong>
            {num(t.refunds?.[m]) > 0 && <span className="num neg">− {money(t.refunds[m], locale)} {tx('مرتجع', 'refunded')}</span>}
          </div>
        ))}
      </div>
      <dl className="drawer-math">
        <div><dt>{tx('عهدة البداية', 'Opening float')}</dt><dd className="num">{money(shift.opening_float, locale)}</dd></div>
        <div><dt>+ {tx('نقدي مستلم', 'Cash taken')}</dt><dd className="num">{money(t.in?.cash, locale)}</dd></div>
        <div><dt>− {tx('مرتجع نقدي', 'Cash refunded')}</dt><dd className="num">{money(t.refunds?.cash, locale)}</dd></div>
        <div className="eq"><dt>{tx('المتوقع في الدرج', 'Expected in drawer')}</dt><dd className="num">{money(expected, locale)}</dd></div>
        {closed && (
          <>
            <div><dt>{tx('المعدود فعليًا', 'Counted')}</dt><dd className="num">{money(shift.counted_cash, locale)}</dd></div>
            <div className={`eq ${num(shift.difference) === 0 ? 'ok' : 'bad'}`}><dt>{tx('الفرق', 'Difference')}</dt>
              <dd className="num">{num(shift.difference) > 0 ? '+' : ''}{money(shift.difference, locale)}</dd></div>
          </>
        )}
      </dl>
    </div>
  )
}

function ReceiptsTable({ receipts, refunds }) {
  const { tx, pick, locale } = useI18n()
  const { bill } = useBilling()
  if (!receipts.length && !refunds.length) return <p className="card-body muted">{tx('لا توجد حركات في هذه الوردية.', 'No movements in this shift.')}</p>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>{tx('الوقت', 'Time')}</th><th>{tx('الإيصال', 'Receipt')}</th><th>{tx('المريض', 'Patient')}</th><th>{tx('الطريقة', 'Method')}</th><th className="num">{tx('المبلغ', 'Amount')}</th></tr></thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={r.id}>
              <td><bdi className="num">{clock(r.created_at, locale)}</bdi></td>
              <td><Link to={`${bill}/receipts/${r.id}/print`} className="mrn">{r.ref}</Link>{r.invoice_ref && <small className="muted" style={{ display: 'block' }}>{r.invoice_ref}</small>}</td>
              <td>{pick(r, 'patient_name')}<small className="mrn muted" style={{ display: 'block' }}>{r.mrn}</small></td>
              <td><Methods payments={r.payments} /></td>
              <td className="num">{money(r.total, locale)}{num(r.to_credit) > 0 && <small className="ok-text" style={{ display: 'block' }}>{tx('للرصيد', 'to credit')} {money(r.to_credit, locale)}</small>}</td>
            </tr>
          ))}
          {refunds.map((f) => (
            <tr key={f.id} className="refund-row">
              <td><bdi className="num">{clock(f.paid_at, locale)}</bdi></td>
              <td><span className="mrn">{f.ref}</span><small className="muted" style={{ display: 'block' }}>{tx('استرداد', 'Refund')}</small></td>
              <td>{pick(f, 'patient_name')}<small className="mrn muted" style={{ display: 'block' }}>{f.mrn}</small></td>
              <td><Methods payments={[{ method: f.method }]} /></td>
              <td className="num neg">− {money(f.amount, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The cashier's own shift: open with a float, follow it live, count the drawer and close.
export function MyShift() {
  const { t, tx, pick, locale } = useI18n()
  const { api, bill } = useBilling()
  const toast = useToast()
  const { data, error, reload, setData } = useAsync(() => api.shift(), [api])
  const report = useAsync(() => (data?.shift ? api.shiftReport(data.shift.id) : Promise.resolve(null)), [data?.shift?.id, api])
  const [float, setFloat] = useState('1000')
  const [counted, setCounted] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [closed, setClosed] = useState(null)

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const s = data.shift
  const diff = s && counted !== '' ? Math.round((num(counted) - num(s.expected_cash)) * 100) / 100 : null

  const open = async () => {
    setBusy(true)
    setErr(null)
    try {
      setData(await api.openShift({ opening_float: num(float) }))
      setClosed(null)
      toast.success(tx('فُتحت الوردية.', 'Shift opened.'))
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  const close = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await api.closeShift({ counted_cash: num(counted), difference_reason: reason.trim() || null, note: note.trim() || null })
      setClosed(res)
      setData({ shift: null })
      setCounted('')
      setReason('')
      toast.success(tx('أُغلقت الوردية.', 'Shift closed.'))
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الخزينة', 'Cashier')} title={tx('ورديتي', 'My shift')}
        description={tx('افتح الوردية بعهدة البداية، وعند الإغلاق اعدد الدرج. أي فرق يحتاج سببًا ويُسجَّل ولا يمكن تعديله.', 'Open the shift with the starting float; at closing, count the drawer. Any difference needs a reason and is recorded for good.')}
        actions={<Link to={`${bill}/shifts`} className="btn btn-ghost"><Icon name="clock" size={18} />{tx('وردياتي السابقة', 'Past shifts')}</Link>} />

      {closed && (
        <section className="card card-pad shift-closed-note">
          <Alert tone={num(closed.shift.difference) === 0 ? 'success' : 'warn'} title={tx(`أُغلقت الوردية ${closed.shift.ref}.`, `Shift ${closed.shift.ref} closed.`)}>
            {num(closed.shift.difference) === 0 ? tx('الدرج مطابق.', 'The drawer matches.') : tx(`فرق ${money(closed.shift.difference, locale)} مسجّل بالسبب.`, `A difference of ${money(closed.shift.difference, locale)} was recorded with its reason.`)}{' '}
            <Link to={`${bill}/shifts/${closed.shift.id}`}>{tx('عرض التقرير', 'View the report')}</Link>
          </Alert>
        </section>
      )}

      {!s ? (
        <section className="card card-pad shift-open-card">
          <div className="shift-open-art" aria-hidden="true"><Icon name="cash" size={34} /></div>
          <div className="form" style={{ maxWidth: 420 }}>
            <h2>{tx('فتح وردية جديدة', 'Open a new shift')}</h2>
            <p className="muted">{tx('أدخل النقدية الموجودة في الدرج الآن (الفكة).', 'Enter the cash in the drawer right now (the float for change).')}</p>
            {err && <Alert tone="danger">{errorText(err, t)}</Alert>}
            <TextField label={tx('عهدة البداية (ج.م)', 'Opening float (EGP)')} value={float} onChange={(e) => setFloat(cleanAmount(e.target.value))} inputMode="decimal" dir="ltr" inputClassName="num" data-autofocus />
            <Button icon="check" loading={busy} onClick={open} style={{ justifySelf: 'start' }}>{tx('فتح الوردية', 'Open shift')}</Button>
          </div>
        </section>
      ) : (
        <div className="visit-grid">
          <div className="visit-main">
            <section className="card">
              <div className="card-head">
                <div><h2>{tx('الوردية الحالية', 'Current shift')} <span className="mrn">{s.ref}</span></h2>
                  <p className="muted" style={{ fontSize: '.86rem' }}>{pick(s, 'branch_name')} · {tx('فُتحت', 'opened')} <bdi>{fmtDateTime(s.opened_at, locale)}</bdi></p></div>
                <Badge tone="success">{tx('مفتوحة', 'Open')}</Badge>
              </div>
              <div className="card-body"><Totals shift={s} /></div>
            </section>
            <section className="card">
              <div className="card-head"><h2>{tx('حركات الوردية', 'Shift movements')}</h2></div>
              {report.data ? <ReceiptsTable receipts={report.data.receipts} refunds={report.data.refunds} /> : <SkeletonRows rows={3} cols={5} />}
            </section>
          </div>
          <aside className="visit-side">
            <section className="card">
              <div className="card-head"><h2>{tx('إغلاق الوردية', 'Close the shift')}</h2></div>
              <div className="card-body form">
                <p className="muted" style={{ fontSize: '.88rem' }}>{tx('اعدد النقدية في الدرج كلها (مع العهدة) وأدخل المبلغ.', 'Count all the cash in the drawer (float included) and enter it.')}</p>
                {err && <Alert tone="danger">{errorText(err, t)}</Alert>}
                <TextField label={tx('النقدية المعدودة (ج.م)', 'Cash counted (EGP)')} value={counted} onChange={(e) => setCounted(cleanAmount(e.target.value))} inputMode="decimal" dir="ltr" inputClassName="num" />
                {diff !== null && (
                  <div className={`count-diff ${diff === 0 ? 'ok' : 'bad'}`} aria-live="polite">
                    {diff === 0 ? <><Icon name="checkCircle" size={16} />{tx('مطابق للمتوقع', 'Matches the expected cash')}</>
                      : <><Icon name="alert" size={16} />{diff < 0 ? tx(`عجز ${money(-diff, locale)}`, `Short by ${money(-diff, locale)}`) : tx(`زيادة ${money(diff, locale)}`, `Over by ${money(diff, locale)}`)}</>}
                  </div>
                )}
                {diff !== null && diff !== 0 && (
                  <TextArea label={tx('سبب الفرق', 'Reason for the difference')} value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                    error={fieldText('difference_reason', err?.fields?.difference_reason, t)} hint={tx('يراه المدير والمحاسب.', 'Management and accounting see it.')} />
                )}
                <TextField label={tx('ملاحظة', 'Note')} optional value={note} onChange={(e) => setNote(e.target.value)} />
                <Button variant="gold" icon="lock" loading={busy} disabled={counted === '' || (diff !== 0 && reason.trim().length < 5)} onClick={close}>{tx('إغلاق الوردية', 'Close shift')}</Button>
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}

// Past shifts: the cashier sees their own; management, accounting and audit see everyone's.
export function ShiftsList() {
  const { tx, pick, locale } = useI18n()
  const { api, bill, me } = useBilling()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const { data, error, loading, reload } = useAsync(() => api.shifts({ date_from: from, date_to: to }), [from, to, api])
  const mine = me.active_role === 'cashier'
  const sums = (data || []).filter((s) => s.status === 'closed').reduce((a, s) => ({ collected: a.collected + num(s.totals?.collected), diff: a.diff + num(s.difference) }), { collected: 0, diff: 0 })
  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الخزينة', 'Cashier')} title={mine ? tx('وردياتي', 'My shifts') : tx('ورديات الخزينة', 'Cash shifts')}
        description={tx('كل وردية بعهدتها وتحصيلها حسب طريقة الدفع، والنقدية المعدودة والفرق.', 'Each shift with its float, takings by method, the cash counted and any difference.')} />
      <section className="card">
        <div className="toolbar">
          <TextField label={tx('من', 'From')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label={tx('إلى', 'To')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          {data && data.length > 0 && (
            <div className="toolbar-sums">
              <span><small>{tx('المحصّل', 'Collected')}</small><strong className="num">{money(sums.collected, locale)}</strong></span>
              <span><small>{tx('صافي الفروق', 'Net differences')}</small><strong className={`num ${sums.diff < 0 ? 'neg' : ''}`}>{money(sums.diff, locale)}</strong></span>
            </div>
          )}
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={5} cols={6} /> : !data.length ? (
          <EmptyState icon="clock" title={tx('لا توجد ورديات', 'No shifts')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tx('الوردية', 'Shift')}</th>{!mine && <th>{tx('الكاشير', 'Cashier')}</th>}<th>{tx('الوقت', 'Time')}</th><th className="num">{tx('المحصّل', 'Collected')}</th><th className="num">{tx('النقدية المتوقعة', 'Expected cash')}</th><th className="num">{tx('الفرق', 'Difference')}</th></tr></thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id}>
                    <td><Link to={`${bill}/shifts/${s.id}`} className="mrn">{s.ref}</Link>{s.status === 'open' && <> <Badge tone="success">{tx('مفتوحة', 'Open')}</Badge></>}</td>
                    {!mine && <td>{pick(s, 'cashier_name')}<small className="muted" style={{ display: 'block' }}>{pick(s, 'branch_name')}</small></td>}
                    <td><bdi>{fmtDate(s.opened_at, locale)}</bdi><small className="muted num" style={{ display: 'block' }}>{clock(s.opened_at, locale)} → {s.closed_at ? clock(s.closed_at, locale) : '…'}</small></td>
                    <td className="num">{money(s.totals?.collected, locale)}</td>
                    <td className="num">{money(s.expected_cash, locale)}</td>
                    <td className="num">{s.status === 'closed' ? (num(s.difference) === 0 ? <Badge tone="success">{tx('مطابق', 'Matches')}</Badge>
                      : <span className="neg" title={s.difference_reason || ''}>{money(s.difference, locale)}</span>) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export function ShiftReport() {
  const { id } = useParams()
  const { tx, pick, locale } = useI18n()
  const { api, bill } = useBilling()
  const { data, error, reload } = useAsync(() => api.shiftReport(id), [id, api])
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const s = data.shift
  return (
    <div className="page reveal">
      <Link to={`${bill}/shifts`} className="back-link no-print"><Icon name="arrowLeft" size={16} />{tx('الورديات', 'Shifts')}</Link>
      <PageHeader eyebrow={<><span className="mrn">{s.ref}</span> · {pick(s, 'branch_name')}</>} title={tx(`وردية ${pick(s, 'cashier_name')}`, `${pick(s, 'cashier_name')}'s shift`)}
        description={<><bdi>{fmtDateTime(s.opened_at, locale)}</bdi> → {s.closed_at ? <bdi>{fmtDateTime(s.closed_at, locale)}</bdi> : tx('ما زالت مفتوحة', 'still open')}</>}
        actions={<Button variant="ghost" icon="printer" onClick={() => window.print()}>{tx('طباعة', 'Print')}</Button>} />
      <section className="card"><div className="card-body"><Totals shift={s} />
        {s.difference_reason && <Alert tone="warn" title={tx('سبب الفرق:', 'Difference reason:')}>{s.difference_reason}</Alert>}
        {s.note && <p className="muted" style={{ marginTop: 10 }}>{s.note}</p>}
      </div></section>
      <section className="card">
        <div className="card-head"><h2>{tx('الإيصالات والمرتجعات', 'Receipts & refunds')}</h2><span className="muted num">{data.receipts.length + data.refunds.length}</span></div>
        <ReceiptsTable receipts={data.receipts} refunds={data.refunds} />
      </section>
    </div>
  )
}
