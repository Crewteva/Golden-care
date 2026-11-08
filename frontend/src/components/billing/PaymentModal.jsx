import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { TextField } from '../Fields'
import { Alert } from '../ui'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { METHODS, cleanAmount, money, num, useBilling } from './meta'

const NEEDS_REF = ['card', 'instapay', 'wallet']

// Take a payment: against an invoice (split between methods, part from credit) or as a deposit to the patient's credit.
export default function PaymentModal({ patient, invoice, credit = 0, onClose, onDone }) {
  const { t, tx, lang, pick, locale } = useI18n()
  const { api, bill } = useBilling()
  const shift = useAsync(() => api.shift(), [api])
  const due = invoice ? num(invoice.balance) : 0
  const [rows, setRows] = useState([{ method: 'cash', amount: invoice ? String(due) : '', reference: '' }])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  const total = rows.reduce((s, r) => s + num(r.amount), 0)
  const fromCredit = rows.filter((r) => r.method === 'credit').reduce((s, r) => s + num(r.amount), 0)
  const extra = invoice ? Math.max(0, Math.round((total - due) * 100) / 100) : total
  const left = invoice ? Math.max(0, Math.round((due - total) * 100) / 100) : 0
  const methods = Object.keys(METHODS).filter((m) => m !== 'credit' || (invoice && num(credit) > 0))
  const set = (i, patch) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const fields = error?.fields || {}
  const noShift = shift.data && !shift.data.shift

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const receipt = await api.pay({
        patient_id: patient.id, invoice_id: invoice?.id || null, note: note.trim() || null,
        payments: rows.map((r) => ({ method: r.method, amount: num(r.amount), reference: r.reference.trim() || null })),
      })
      setDone(receipt)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  const finish = () => {
    onDone?.(done)
    onClose()
  }

  if (done) {
    return (
      <Modal open onClose={finish} title={tx('تم استلام المبلغ', 'Payment received')}
        footer={<><Button variant="ghost" onClick={finish}>{tx('تم', 'Done')}</Button>
          <Link className="btn btn-primary" to={`${bill}/receipts/${done.id}/print`}><Icon name="printer" size={18} />{tx('طباعة الإيصال', 'Print receipt')}</Link></>}>
        <div className="pay-done">
          <span className="pay-done-mark"><Icon name="checkCircle" size={30} /></span>
          <strong className="num">{money(done.total, locale)}</strong>
          <span className="mrn">{done.ref}</span>
          <dl className="dl">
            {num(done.applied) > 0 && <><dt>{tx('على الفاتورة', 'To the invoice')}</dt><dd className="num">{money(done.applied, locale)}</dd></>}
            {num(done.to_credit) > 0 && <><dt>{tx('أُضيف للرصيد', 'Added to credit')}</dt><dd className="num">{money(done.to_credit, locale)}</dd></>}
            {done.invoice_ref && <><dt>{tx('الباقي على الفاتورة', 'Left on the invoice')}</dt><dd className="num">{money(done.invoice_balance, locale)}</dd></>}
            <dt>{tx('رصيد المريض الآن', 'Patient credit now')}</dt><dd className="num">{money(done.credit_balance, locale)}</dd>
          </dl>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} busy={busy} wide
      title={invoice ? tx('تحصيل فاتورة', 'Take a payment') : tx('إيداع في رصيد المريض', 'Deposit to patient credit')}
      description={<>{pick(patient, 'full_name') || pick(patient, 'patient_name')}{invoice?.ref && <> · <span className="mrn">{invoice.ref}</span></>}</>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button icon="check" loading={busy} disabled={noShift || total <= 0} onClick={submit}>{tx(`استلام ${money(total, locale)}`, `Receive ${money(total, locale)}`)}</Button></>}>
      <div className="form">
        {noShift && (
          <Alert tone="warn" title={tx('لا توجد وردية مفتوحة.', 'No open shift.')}>
            {tx('كل إيصال يتبع وردية الكاشير. ', 'Every receipt belongs to a cashier shift. ')}<Link to={`${bill}/shift`}>{tx('افتح ورديتك أولًا', 'Open your shift first')}</Link>.
          </Alert>
        )}
        {error && <Alert tone="danger">{fields.payments ? fieldText('payments', fields.payments, t) : errorText(error, t)}</Alert>}
        {invoice && (
          <div className="pay-due">
            <div><small>{tx('المستحق', 'Due')}</small><strong className="num">{money(due, locale)}</strong></div>
            {num(credit) > 0 && <div><small>{tx('رصيد المريض', 'Patient credit')}</small><strong className="num">{money(credit, locale)}</strong></div>}
          </div>
        )}
        <div className="pay-rows">
          {rows.map((r, i) => (
            <div className="pay-row" key={i}>
              <div className="pay-method" role="radiogroup" aria-label={tx('طريقة الدفع', 'Payment method')}>
                {methods.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={r.method === m} onClick={() => set(i, { method: m, ...(m === 'credit' && !r.amount ? { amount: String(Math.min(num(credit), due)) } : {}) })}>
                    <Icon name={METHODS[m].icon} size={15} />{METHODS[m][lang]}
                  </button>
                ))}
              </div>
              <TextField label={tx('المبلغ (ج.م)', 'Amount (EGP)')} value={r.amount} inputMode="decimal" dir="ltr" inputClassName="num"
                onChange={(e) => set(i, { amount: cleanAmount(e.target.value) })} error={fieldText('amount', fields[`payments.${i}.amount`], t)} data-autofocus={i === 0 || undefined} />
              {NEEDS_REF.includes(r.method) ? (
                <TextField label={r.method === 'card' ? tx('رقم عملية الماكينة', 'POS approval no.') : tx('رقم العملية', 'Transaction no.')} value={r.reference} dir="ltr"
                  onChange={(e) => set(i, { reference: e.target.value })} error={fieldText('reference', fields[`payments.${i}.reference`], t)} />
              ) : <span />}
              {rows.length > 1 && <Button variant="quiet" size="sm" icon="x" aria-label={tx('حذف هذا الجزء', 'Remove this part')} onClick={() => setRows(rows.filter((_, k) => k !== i))} />}
            </div>
          ))}
        </div>
        {rows.length < 5 && (
          <Button variant="ghost" size="sm" icon="plus" style={{ justifySelf: 'start' }}
            onClick={() => setRows([...rows, { method: rows.some((r) => r.method === 'cash') ? 'card' : 'cash', amount: left ? String(left) : '', reference: '' }])}>
            {tx('تقسيم على طريقة أخرى', 'Split with another method')}
          </Button>
        )}
        <TextField label={tx('ملاحظة', 'Note')} optional value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        <div className="pay-summary" aria-live="polite">
          <span>{tx('الإجمالي', 'Total')} <strong className="num">{money(total, locale)}</strong></span>
          {fromCredit > 0 && <span>{tx('منها من الرصيد', 'of which from credit')} <strong className="num">{money(fromCredit, locale)}</strong></span>}
          {invoice && left > 0 && <span className="warn-text">{tx('سيتبقى على الفاتورة', 'Left on the invoice')} <strong className="num">{money(left, locale)}</strong></span>}
          {extra > 0 && <span className="ok-text">{invoice ? tx('الزيادة تُضاف لرصيد المريض', 'The extra goes to patient credit') : tx('يُضاف لرصيد المريض', 'Goes to patient credit')} <strong className="num">{money(extra, locale)}</strong></span>}
        </div>
      </div>
    </Modal>
  )
}
