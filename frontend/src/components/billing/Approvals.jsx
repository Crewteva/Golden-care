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
import { APPROVAL_KIND, APPROVAL_STATE, METHODS, StateBadge, money, num, useBilling } from './meta'

// Management's queue: discounts above the limit, voids, refunds and package cancellations.
export default function Approvals() {
  const { tx } = useI18n()
  const { api } = useBilling()
  const [state, setState] = useState('pending')
  const [deciding, setDeciding] = useState(null)
  const { data, error, loading, reload, setData } = useAsync(() => api.approvals(state), [state, api])

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الحسابات', 'Billing')} title={tx('الاعتمادات', 'Approvals')}
        description={tx('ما يحتاج قرارك: خصومات فوق الحد، إلغاء فواتير، استرداد مبالغ وإلغاء باقات. كل قرار يُسجَّل باسمك.', 'What needs your decision: discounts above the limit, voids, refunds and package cancellations. Every decision is recorded under your name.')} />
      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('الحالة', 'State')}>
            <button type="button" role="tab" aria-selected={state === 'pending'} onClick={() => setState('pending')}>
              {tx('بانتظار القرار', 'Pending')}{data && <span className="tab-count num">{data.pending}</span>}
            </button>
            <button type="button" role="tab" aria-selected={state === 'decided'} onClick={() => setState('decided')}>{tx('آخر 60 يومًا', 'Last 60 days')}</button>
          </div>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={4} cols={4} /> : !data.items.length ? (
          <EmptyState icon="checkCircle" title={state === 'pending' ? tx('لا شيء بانتظارك', 'Nothing waiting for you') : tx('لا توجد قرارات', 'No decisions yet')} />
        ) : (
          <ul className="appr-list">
            {data.items.map((a) => <ApprovalCard key={a.id} a={a} onDecide={state === 'pending' ? (approve) => setDeciding({ a, approve }) : null} />)}
          </ul>
        )}
      </section>
      {deciding && <DecideModal {...deciding} onClose={() => setDeciding(null)} onDone={(res) => { setDeciding(null); if (state === 'pending') setData(res); else reload() }} />}
    </div>
  )
}

function ApprovalCard({ a, onDecide }) {
  const { tx, lang, pick, locale } = useI18n()
  const { bill } = useBilling()
  const k = APPROVAL_KIND[a.kind]
  const p = a.payload || {}
  return (
    <li className={`appr-card k-${a.kind}`}>
      <span className="appr-icon" aria-hidden="true"><Icon name={k.icon} size={20} /></span>
      <div className="appr-main">
        <div className="appr-title">
          <strong>{k[lang]}</strong>
          <span className="num appr-amount">{money(a.amount, locale)}</span>
          {a.status !== 'pending' && <StateBadge state={a.status} map={APPROVAL_STATE} />}
        </div>
        <p className="appr-who">
          <Link to={`${bill}/patients/${a.patient_id}`}>{pick(a, 'patient_name')}</Link> <span className="mrn muted">{a.mrn}</span>
          {a.invoice_ref && <> · <Link to={`${bill}/invoices/${a.invoice_id}`} className="mrn">{a.invoice_ref}</Link></>}
          {!a.invoice_ref && a.invoice_id && <> · <Link to={`${bill}/invoices/${a.invoice_id}`}>{tx('مسودة الفاتورة', 'Draft invoice')}</Link></>}
          {a.refund_ref && <> · <span className="mrn">{a.refund_ref}</span></>}
          {a.package_ref && <> · {a[`package_name_${lang}`]} <span className="mrn">{a.package_ref}</span></>}
        </p>
        <ul className="appr-facts">
          {a.kind === 'discount' && <>
            <li>{tx('قبل الخصم', 'Subtotal')} <strong className="num">{money(a.invoice_subtotal ?? p.subtotal, locale)}</strong></li>
            <li>{tx('نسبة الخصم', 'Discount')} <strong className="num">{p.pct}%</strong></li>
            <li>{tx('بعد الخصم', 'Total after')} <strong className="num">{money(a.invoice_total, locale)}</strong></li>
            <li>{num(p.installments) > 0 ? tx(`على ${p.installments} أقساط`, `In ${p.installments} installments`) : tx('دفعة واحدة', 'Paid in full')}</li>
          </>}
          {a.kind === 'void' && <>
            <li>{tx('المدفوع', 'Paid')} <strong className="num">{money(a.invoice_paid ?? p.paid, locale)}</strong></li>
            <li>{p.refund_method ? tx(`يُسترد ${METHODS[p.refund_method]?.ar}`, `Refund by ${METHODS[p.refund_method]?.en}`) : tx('المدفوع يبقى رصيدًا', 'What was paid stays as credit')}</li>
          </>}
          {a.kind === 'refund' && <li>{tx('طريقة الصرف', 'Pay out by')} <strong>{METHODS[a.refund_method]?.[lang]}</strong></li>}
          {a.kind === 'package_cancel' && <>
            <li>{tx(`استُخدم ${p.used} من ${p.sessions}`, `${p.used} of ${p.sessions} sessions used`)}</li>
            <li>{p.refund_method ? tx(`يُسترد ${METHODS[p.refund_method]?.ar}`, `Refund by ${METHODS[p.refund_method]?.en}`) : tx('يعود رصيدًا', 'Goes back as credit')}</li>
          </>}
        </ul>
        <p className="appr-reason">«{a.reason}» <small className="muted">— {pick(a, 'requested_by')}, <bdi>{fmtDateTime(a.requested_at, locale)}</bdi></small></p>
        {a.status !== 'pending' && a.decided_at && (
          <p className="appr-decision muted"><Icon name={a.status === 'approved' ? 'check' : 'x'} size={14} /> {pick(a, 'decided_by')}, <bdi>{fmtDateTime(a.decided_at, locale)}</bdi>{a.decision_note && <>: «{a.decision_note}»</>}</p>
        )}
      </div>
      {onDecide && (
        <div className="appr-act">
          <Button size="sm" icon="check" onClick={() => onDecide(true)}>{tx('اعتماد', 'Approve')}</Button>
          <Button size="sm" variant="ghost" icon="x" onClick={() => onDecide(false)}>{tx('رفض', 'Reject')}</Button>
        </div>
      )}
    </li>
  )
}

function DecideModal({ a, approve, onClose, onDone }) {
  const { t, tx, lang, locale } = useI18n()
  const { api } = useBilling()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.decide(a.id, { approve, note: note.trim() || null })
      toast.success(approve ? tx('تم الاعتماد.', 'Approved.') : tx('تم الرفض.', 'Rejected.'))
      onDone(res)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={approve ? tx('اعتماد الطلب', 'Approve the request') : tx('رفض الطلب', 'Reject the request')}
      description={<>{APPROVAL_KIND[a.kind][lang]} · <span className="num">{money(a.amount, locale)}</span></>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button variant={approve ? 'primary' : 'danger'} icon={approve ? 'check' : 'x'} loading={busy} disabled={!approve && note.trim().length < 3} onClick={submit}>
          {approve ? tx('اعتماد', 'Approve') : tx('رفض', 'Reject')}</Button></>}>
      <div className="form">
        {error && !error.fields?.note && <Alert tone="danger">{errorText(error, t)}</Alert>}
        {approve && a.kind === 'discount' && <p className="muted">{tx('ستصدر الفاتورة فورًا بالخصم وطريقة الدفع المطلوبة.', 'The invoice is issued right away with the discount and payment plan asked for.')}</p>}
        {approve && a.kind === 'void' && <p className="muted">{tx('الإلغاء نهائي ويعيد المدفوع لرصيد المريض.', "Voiding is final and puts what was paid back on the patient's credit.")}</p>}
        <TextArea label={approve ? tx('ملاحظة', 'Note') : tx('سبب الرفض', 'Why it is rejected')} optional={approve} rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus
          error={fieldText('note', error?.fields?.note, t)} hint={approve ? null : tx('يراه من طلب.', 'The person who asked sees it.')} />
      </div>
    </Modal>
  )
}
