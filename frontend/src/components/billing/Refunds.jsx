import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button'
import Modal from '../Modal'
import { TextField } from '../Fields'
import { Alert, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { fmtDateTime, fmtPhone } from '../../lib/format'
import { Methods, REFUND_STATE, StateBadge, money, useBilling } from './meta'

const TABS = ['open', 'paid', 'rejected']

// Refunds out of patient credit: asked for, approved by management, then paid out by a cashier from their shift.
export default function Refunds() {
  const { tx, pick, locale } = useI18n()
  const { api, bill, can } = useBilling()
  const [state, setState] = useState('open')
  const [paying, setPaying] = useState(null)
  const { data, error, loading, reload } = useAsync(() => api.refunds(state), [state, api])
  const labels = { open: tx('مفتوحة', 'Open'), paid: tx('صُرفت', 'Paid out'), rejected: tx('مرفوضة', 'Rejected') }

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الخزينة', 'Cashier')} title={tx('المرتجعات', 'Refunds')}
        description={tx('تُطلب من حساب المريض، تعتمدها الإدارة، ثم يصرفها الكاشير من ورديته.', "Asked for from the patient's account, approved by management, then paid out by a cashier from their shift.")} />
      <section className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('الحالة', 'State')}>
            {TABS.map((k) => <button key={k} type="button" role="tab" aria-selected={state === k} onClick={() => setState(k)}>{labels[k]}</button>)}
          </div>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={4} cols={6} /> : !data.length ? (
          <EmptyState icon="refresh" title={tx('لا توجد مرتجعات هنا', 'No refunds here')}>{tx('يُطلب الاسترداد من حساب المريض عندما يكون له رصيد.', 'A refund is asked for from the account of a patient who has credit.')}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tx('الطلب', 'Refund')}</th><th>{tx('المريض', 'Patient')}</th><th>{tx('السبب', 'Reason')}</th><th>{tx('الطريقة', 'Method')}</th><th className="num">{tx('المبلغ', 'Amount')}</th><th>{tx('الحالة', 'State')}</th><th><span className="sr-only">{tx('إجراء', 'Action')}</span></th></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td><span className="mrn">{r.ref}</span><small className="muted" style={{ display: 'block' }}><bdi>{fmtDateTime(r.paid_at || r.requested_at, locale)}</bdi></small></td>
                    <td><Link to={`${bill}/patients/${r.patient_id}`} className="person-name">{pick(r, 'patient_name')}</Link>
                      <small className="muted" style={{ display: 'block' }}><span className="mrn">{r.mrn}</span>{r.patient_phone && <> · <bdi className="ltr">{fmtPhone(r.patient_phone)}</bdi></>}</small></td>
                    <td className="cell-wrap">{r.reason}<small className="muted" style={{ display: 'block' }}>{pick(r, 'requested_by')}{r.decided_by_en && <> → {pick(r, 'decided_by')}</>}{r.paid_by_en && <> → {pick(r, 'paid_by')}</>}</small></td>
                    <td><Methods payments={[{ method: r.method }]} />{r.reference && <small className="muted" dir="ltr" style={{ display: 'block' }}>#{r.reference}</small>}</td>
                    <td className="num">{money(r.amount, locale)}</td>
                    <td><StateBadge state={r.status} map={REFUND_STATE} /></td>
                    <td>{r.status === 'approved' && can('billing.collect') && <Button size="sm" icon="cash" onClick={() => setPaying(r)}>{tx('صرف', 'Pay out')}</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {paying && <PayRefundModal r={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload() }} />}
    </div>
  )
}

function PayRefundModal({ r, onClose, onDone }) {
  const { t, tx, pick, locale } = useI18n()
  const { api, bill } = useBilling()
  const toast = useToast()
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const cash = r.method === 'cash'
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.payRefund(r.id, { reference: reference.trim() || null })
      toast.success(tx('صُرف المبلغ وخُصم من رصيد المريض.', "Paid out and taken off the patient's credit."))
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={tx('صرف استرداد', 'Pay out a refund')}
      description={<>{pick(r, 'patient_name')} · <span className="mrn">{r.ref}</span></>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="cash" loading={busy} disabled={!cash && !reference.trim()} onClick={submit}>{tx(`صرف ${money(r.amount, locale)}`, `Pay out ${money(r.amount, locale)}`)}</Button></>}>
      <div className="form">
        {error?.code === 'no_open_shift' ? (
          <Alert tone="warn" title={tx('لا توجد وردية مفتوحة.', 'No open shift.')}><Link to={`${bill}/shift`}>{tx('افتح ورديتك أولًا', 'Open your shift first')}</Link></Alert>
        ) : error && !error.fields?.reference ? <Alert tone="danger">{errorText(error, t)}</Alert> : null}
        <p>{cash ? tx('يُصرف نقدًا من درج ورديتك ويُخصم من النقدية المتوقعة.', 'Paid in cash from your drawer and taken off the expected cash.') : tx('أدخل رقم العملية بعد التحويل للمريض.', 'Enter the transaction number after sending it to the patient.')}</p>
        {!cash && <TextField label={tx('رقم العملية', 'Transaction no.')} value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" data-autofocus
          error={fieldText('reference', error?.fields?.reference, t)} />}
      </div>
    </Modal>
  )
}
