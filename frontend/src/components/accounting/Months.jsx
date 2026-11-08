import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { TextArea } from '../Fields'
import { Alert, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'
import { Checks, PERIOD_STATE, State, monthEnd, monthLabel, money, num, useAccounting } from './meta'

// Month close: the accountant asks once the month is over and checked, management approves, and the month is locked.
export default function Months() {
  const { tx, pick, locale } = useI18n()
  const { api, base, canPost, canApprove } = useAccounting()
  const [modal, setModal] = useState(null)
  const { data, error, loading, reload } = useAsync(() => api.periods(), [api])
  const done = () => { setModal(null); reload() }

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الحسابات العامة', 'Accounting')} title={tx('إقفال الأشهر', 'Month close')}
        description={tx('بعد انتهاء الشهر ومراجعته يطلب المحاسب إقفاله، وتعتمده الإدارة. الشهر المُقفل لا يقبل قيودًا جديدة؛ أي تصحيح يُسجّل في شهر مفتوح.', 'Once a month is over and checked, the accountant asks to close it and management approves. A closed month takes no new entries; corrections go into an open month.')} />
      {data && (
        <p className="muted foot-note"><Icon name="calendar" size={14} />
          {tx('السنة المالية تبدأ في يناير.', 'The financial year starts in January.')} {data.last_closed
            ? tx(`آخر شهر مُقفل: ${monthLabel(data.last_closed, locale)}.`, `Last closed: ${monthLabel(data.last_closed, locale)}.`)
            : tx('لم يُقفل أي شهر بعد.', 'No month has been closed yet.')}
        </p>
      )}
      <section className="card">
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={5} cols={6} /> : !data.months.length ? (
          <EmptyState icon="calendar" title={tx('لا توجد أشهر بعد', 'No months yet')} />
        ) : (
          <ul className="period-list">
            {data.months.map((p) => {
              const latestClosed = p.status === 'closed' && p.month === data.last_closed
              const blocked = p.checks.some((c) => c.level === 'block')
              return (
                <li key={p.month} className={`period p-${p.status}`}>
                  <div className="period-head">
                    <div>
                      <h2>{monthLabel(p.month, locale)}</h2>
                      <State state={p.status} map={PERIOD_STATE} />
                      {!p.ended && <span className="badge badge-neutral">{tx('الشهر الحالي', 'Current month')}</span>}
                    </div>
                    <div className="row-actions">
                      {p.status === 'open' && p.ended && canPost && (
                        <Button size="sm" icon="lock" disabled={blocked} onClick={() => setModal({ kind: 'request', p })}>{tx('طلب الإقفال', 'Request close')}</Button>
                      )}
                      {p.status === 'close_requested' && canApprove && (
                        <Button size="sm" icon="shieldCheck" onClick={() => setModal({ kind: 'decide', p })}>{tx('مراجعة الإقفال', 'Review close')}</Button>
                      )}
                      {latestClosed && canApprove && (
                        <Button size="sm" variant="ghost" icon="unlock" onClick={() => setModal({ kind: 'reopen', p })}>{tx('إعادة فتح', 'Reopen')}</Button>
                      )}
                      <Link className="btn btn-quiet btn-sm" to={`${base}/reports?r=pnl&from=${p.month}&to=${monthEnd(p.month)}`}><Icon name="pie" size={15} />{tx('الأرباح والخسائر', 'P&L')}</Link>
                    </div>
                  </div>
                  <dl className="period-figs">
                    <div><dt>{tx('القيود', 'Entries')}</dt><dd className="num">{p.entries}</dd></div>
                    <div><dt>{tx('الإيرادات', 'Income')}</dt><dd className="num">{money(p.income, locale)}</dd></div>
                    <div><dt>{tx('المصروفات', 'Expenses')}</dt><dd className="num">{money(p.expenses, locale)}</dd></div>
                    <div className="net"><dt>{tx('الصافي', 'Net')}</dt><dd className={`num ${num(p.net) < 0 ? 'neg' : ''}`}>{money(p.net, locale)}</dd></div>
                  </dl>
                  {p.ended && p.status !== 'closed' && <Checks checks={p.checks} />}
                  <PeriodTrail p={p} pick={pick} tx={tx} locale={locale} />
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {modal?.kind === 'request' && <RequestModal p={modal.p} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'decide' && <DecideModal p={modal.p} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'reopen' && <ReopenModal p={modal.p} onClose={() => setModal(null)} onDone={done} />}
    </div>
  )
}

function PeriodTrail({ p, pick, tx, locale }) {
  if (!p.requested_at && !p.decided_at) return null
  return (
    <ul className="period-trail">
      {p.requested_at && (
        <li><Icon name="clock" size={13} />{tx(`طلب الإقفال ${pick(p, 'requested_by')}`, `Close requested by ${pick(p, 'requested_by')}`)} · <bdi>{fmtDateTime(p.requested_at, locale)}</bdi>{p.request_note && <em> “{p.request_note}”</em>}</li>
      )}
      {p.decided_at && (
        <li><Icon name={p.status === 'closed' ? 'lock' : 'refresh'} size={13} />
          {p.status === 'closed' ? tx(`أقفله ${pick(p, 'decided_by')}`, `Closed by ${pick(p, 'decided_by')}`) : tx(`أعاده للفتح ${pick(p, 'decided_by')}`, `Sent back / reopened by ${pick(p, 'decided_by')}`)} · <bdi>{fmtDateTime(p.decided_at, locale)}</bdi>
          {p.decision_note && <em> “{p.decision_note}”</em>}</li>
      )}
    </ul>
  )
}

function useSubmit(onDone) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const run = async (key, fn) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      onDone()
    } catch (err) {
      setError(err)
      setBusy(null)
    }
  }
  return { busy, error, run }
}

function BlockedChecks({ error }) {
  return error?.code === 'close_blocked' && error.data?.checks ? <Checks checks={error.data.checks} /> : null
}

function RequestModal({ p, onClose, onDone }) {
  const { t, tx, locale } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const [note, setNote] = useState('')
  const { busy, error, run } = useSubmit(onDone)
  const warns = p.checks.filter((c) => c.level === 'warn')
  return (
    <Modal open onClose={onClose} busy={!!busy} title={tx(`طلب إقفال ${monthLabel(p.month, locale)}`, `Request to close ${monthLabel(p.month, locale)}`)}
      description={tx('يُرسل الطلب للإدارة. حتى يُعتمد يبقى الشهر مفتوحًا.', 'The request goes to management. The month stays open until it is approved.')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={!!busy}>{t('cancel')}</Button>
        <Button icon="lock" loading={!!busy} onClick={() => run('go', async () => {
          await api.requestClose(p.month, { note: note.trim() || null })
          toast.success(tx('أُرسل طلب الإقفال للإدارة.', 'Close request sent to management.'))
        })}>{tx('إرسال الطلب', 'Send request')}</Button></>}>
      <div className="form">
        {error && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <BlockedChecks error={error} />
        {warns.length > 0 && <Alert tone="warn" title={tx('للعلم:', 'Heads up:')}>{tx('هذه الملاحظات لا تمنع الإقفال لكنها ستظهر للإدارة.', "These don't stop the close, but management will see them.")}</Alert>}
        {warns.length > 0 && <Checks checks={warns} />}
        <TextArea label={tx('ملاحظة للإدارة', 'Note for management')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} optional />
      </div>
    </Modal>
  )
}

function DecideModal({ p, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const [note, setNote] = useState('')
  const { busy, error, run } = useSubmit(onDone)
  const decide = (approve) => run(approve ? 'yes' : 'no', async () => {
    await api.decideClose(p.month, { approve, note: note.trim() || null })
    toast.success(approve ? tx(`أُقفل ${monthLabel(p.month, locale)}.`, `${monthLabel(p.month, locale)} is closed.`) : tx('رُفض الطلب وعاد الشهر مفتوحًا.', 'Request rejected; the month is open again.'))
  })
  return (
    <Modal open onClose={onClose} busy={!!busy} title={tx(`إقفال ${monthLabel(p.month, locale)}`, `Close ${monthLabel(p.month, locale)}`)}
      description={tx(`طلبه ${pick(p, 'requested_by')}`, `Requested by ${pick(p, 'requested_by')}`)}
      footer={<><Button variant="ghost" icon="x" loading={busy === 'no'} disabled={!!busy || note.trim().length < 5} onClick={() => decide(false)}>{tx('رفض', 'Reject')}</Button>
        <Button icon="lock" loading={busy === 'yes'} disabled={!!busy} onClick={() => decide(true)}>{tx('اعتماد وإقفال', 'Approve & close')}</Button></>}>
      <div className="form">
        {error && !error.fields?.note && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <BlockedChecks error={error} />
        {p.request_note && <blockquote className="quote-note">“{p.request_note}”</blockquote>}
        <dl className="drawer-math">
          <div><dt>{tx('الإيرادات', 'Income')}</dt><dd className="num">{money(p.income, locale)}</dd></div>
          <div><dt>{tx('المصروفات', 'Expenses')}</dt><dd className="num">{money(p.expenses, locale)}</dd></div>
          <div className="eq ok"><dt>{tx('الصافي', 'Net')}</dt><dd className="num">{money(p.net, locale)}</dd></div>
        </dl>
        <Checks checks={p.checks} />
        <Alert tone="info">{tx('بعد الإقفال لا يمكن تسجيل أي قيد بتاريخ هذا الشهر. إعادة الفتح ممكنة لآخر شهر مُقفل فقط، مع ذكر السبب.', 'After closing, nothing can be posted with a date in this month. Only the latest closed month can be reopened, with a reason.')}</Alert>
        <TextArea label={tx('ملاحظة (مطلوبة عند الرفض)', 'Note (required to reject)')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} error={fieldText('note', error?.fields?.note, t)} />
      </div>
    </Modal>
  )
}

function ReopenModal({ p, onClose, onDone }) {
  const { t, tx, locale } = useI18n()
  const { api } = useAccounting()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const { busy, error, run } = useSubmit(onDone)
  return (
    <Modal open onClose={onClose} busy={!!busy} title={tx(`إعادة فتح ${monthLabel(p.month, locale)}`, `Reopen ${monthLabel(p.month, locale)}`)}
      description={tx('يُسجَّل السبب في سجل التدقيق.', 'The reason is kept in the audit log.')}
      footer={<><Button variant="ghost" onClick={onClose} disabled={!!busy}>{t('cancel')}</Button>
        <Button icon="unlock" loading={!!busy} disabled={reason.trim().length < 5} onClick={() => run('go', async () => {
          await api.reopen(p.month, { reason: reason.trim() })
          toast.success(tx('أُعيد فتح الشهر.', 'The month is open again.'))
        })}>{tx('إعادة الفتح', 'Reopen')}</Button></>}>
      <div className="form">
        {error && !error.fields?.reason && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <TextArea label={tx('السبب', 'Reason')} rows={3} value={reason} data-autofocus onChange={(e) => setReason(e.target.value)}
          hint={tx('٥ أحرف على الأقل', 'At least 5 characters')} error={fieldText('reason', error?.fields?.reason, t)} />
      </div>
    </Modal>
  )
}
