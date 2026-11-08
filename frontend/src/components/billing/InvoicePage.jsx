import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import PageLoader from '../PageLoader'
import { ChoiceGroup, SelectField, TextArea, TextField } from '../Fields'
import { Alert, Badge, ErrorState, PageHeader } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldText } from '../../lib/errors'
import { fmtDate, fmtDateTime, fmtPhone } from '../../lib/format'
import { addDays, dayKey } from '../../lib/clinicTime'
import PaymentModal from './PaymentModal'
import {
  APPROVAL_KIND, APPROVAL_STATE, INSTALLMENT_STATE, InvoiceBadge, LINE_KIND, METHODS, Methods, StateBadge, cleanAmount, money, num,
  previewSchedule, useBilling,
} from './meta'

const toBody = (l) => ({
  kind: l.kind, service_id: l.service_id || null, package_id: l.package_id || null, patient_package_id: l.patient_package_id || null,
  plan_item_id: l.plan_item_id || null, appointment_id: l.appointment_id || null, doctor_id: l.doctor_id || null, qty: l.qty || 1,
})

// One invoice: a draft you build line by line, then issue (paid in full or in installments), collect and, if needed, void.
export default function InvoicePage() {
  const { id } = useParams()
  const { t, tx, lang, pick, locale } = useI18n()
  const { api, bill } = useBilling()
  const toast = useToast()
  const navigate = useNavigate()
  const { data, error, reload, setData } = useAsync(() => api.invoice(id), [id, api])
  const editable = !!data?.can.edit
  const options = useAsync(() => (editable ? api.options() : Promise.resolve(null)), [editable, api])
  const patientId = data?.invoice.patient_id
  const account = useAsync(() => (editable && patientId ? api.account(patientId) : Promise.resolve(null)), [editable, patientId, api])
  const [saving, setSaving] = useState(false)
  const [modal, setModal] = useState(null)

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const { invoice: inv, lines, installments, receipts, approvals, can, rules } = data

  // Every change to the lines is saved straight away; the server prices them.
  const save = async (nextLines, extra = {}) => {
    setSaving(true)
    try {
      const res = await api.saveInvoice(inv.id, {
        lines: nextLines.map(toBody), discount_amount: num(inv.discount_amount), discount_reason: inv.discount_reason || null,
        notes: inv.notes || null, ...extra,
      })
      setData(res)
      return res
    } catch (err) {
      const f = Object.entries(err.fields || {})[0]
      toast.error(f ? fieldText(f[0].split('.').pop(), f[1], t) : errorText(err, t))
      throw err
    } finally {
      setSaving(false)
    }
  }
  const addLine = (line) => save([...lines, line]).catch(() => {})
  const removeLine = (i) => save(lines.filter((_, k) => k !== i)).catch(() => {})
  const patchLine = (i, patch) => save(lines.map((l, k) => (k === i ? { ...l, ...patch } : l))).catch(() => {})

  const cancelDraft = async () => {
    try {
      await api.cancel(inv.id)
      toast.success(tx('حُذفت المسودة.', 'Draft cancelled.'))
      navigate(`${bill}/patients/${inv.patient_id}`)
    } catch (err) {
      toast.error(errorText(err, t))
    }
  }

  const pendingVoid = approvals.find((a) => a.kind === 'void' && a.status === 'pending')
  const pendingDiscount = approvals.find((a) => a.kind === 'discount' && a.status === 'pending')
  const rejected = inv.status === 'draft' && [...approvals].reverse().find((a) => a.kind === 'discount')
  const name = pick(inv, 'patient_name')

  return (
    <div className="page reveal">
      <Link to={`${bill}/patients/${inv.patient_id}`} className="back-link"><Icon name="arrowLeft" size={16} />{tx('حساب المريض', 'Patient account')}</Link>
      <PageHeader
        eyebrow={<>{inv.ref ? <span className="mrn">{inv.ref}</span> : tx('فاتورة جديدة', 'New invoice')}{inv.appointment_ref && <> · {tx('زيارة', 'visit')} <span className="mrn">{inv.appointment_ref}</span></>}</>}
        title={name}
        description={<span className="inv-head-meta"><InvoiceBadge invoice={inv} /> <span className="mrn">{inv.mrn}</span>{inv.patient_phone && <> · <bdi className="ltr">{fmtPhone(inv.patient_phone)}</bdi></>}</span>}
        actions={<>
          {['issued', 'void'].includes(inv.status) && <Link className="btn btn-ghost" to={`${bill}/invoices/${inv.id}/print`}><Icon name="printer" size={18} />{tx('طباعة', 'Print')}</Link>}
          {can.cancel && <Button variant="quiet" icon="x" onClick={() => setModal('cancel')}>{tx('حذف المسودة', 'Cancel draft')}</Button>}
        </>} />

      {inv.status === 'pending_approval' && (
        <Alert tone="warn" title={tx('الخصم بانتظار اعتماد الإدارة.', 'The discount is waiting for management approval.')}>
          {pendingDiscount && tx(`طلبه ${pick(pendingDiscount, 'requested_by')} — خصم ${money(pendingDiscount.amount, locale)}. `, `Asked by ${pick(pendingDiscount, 'requested_by')} — a ${money(pendingDiscount.amount, locale)} discount. `)}
          {tx('تصدر الفاتورة تلقائيًا عند الاعتماد. أي تعديل الآن يسحب الطلب.', 'The invoice is issued automatically once approved. Editing it now withdraws the request.')}
          {can.approve && <> <Link to={`${bill}/approvals`}>{tx('اذهب للاعتمادات', 'Go to approvals')}</Link></>}
        </Alert>
      )}
      {rejected?.status === 'rejected' && (
        <Alert tone="danger" title={tx('رُفض الخصم.', 'The discount was rejected.')}>
          {rejected.decision_note && <>«{rejected.decision_note}» — {pick(rejected, 'decided_by')}. </>}{tx('عدّل الخصم ثم أصدر الفاتورة.', 'Change the discount, then issue the invoice.')}
        </Alert>
      )}
      {pendingVoid && (
        <Alert tone="warn" title={tx('طلب إلغاء بانتظار الإدارة.', 'A void request is waiting for management.')}>«{pendingVoid.reason}» — {pick(pendingVoid, 'requested_by')}</Alert>
      )}
      {inv.status === 'void' && (
        <Alert tone="danger" title={tx('فاتورة ملغاة', 'Void invoice')}>
          «{inv.void_reason}» — {pick(inv, 'voided_by')}, <bdi>{fmtDateTime(inv.voided_at, locale)}</bdi>. {num(inv.paid_total) > 0 && tx(`أُعيد المدفوع (${money(inv.paid_total, locale)}) لرصيد المريض.`, `What was paid (${money(inv.paid_total, locale)}) went back to the patient's credit.`)}
        </Alert>
      )}

      <div className="visit-grid">
        <div className="visit-main">
          <section className={`card inv-lines-card ${saving ? 'is-saving' : ''}`} aria-busy={saving}>
            <div className="card-head">
              <h2>{tx('البنود', 'Lines')}</h2>
              {saving ? <span className="muted save-note"><Icon name="refresh" size={14} />{tx('جارٍ الحفظ…', 'Saving…')}</span>
                : editable ? <span className="muted save-note"><Icon name="check" size={14} />{tx('يُحفظ تلقائيًا', 'Saved as you go')}</span> : null}
            </div>
            <Lines lines={lines} editable={editable} doctors={options.data?.doctors || []} onRemove={removeLine} onPatch={patchLine} />
            {editable && <AddLine options={options.data} account={account.data} lines={lines} onAdd={addLine} busy={saving} appointmentId={inv.appointment_id} />}
          </section>

          {editable && <DiscountCard inv={data} canDiscount={can.discount} rules={rules} onSave={(extra) => save(lines, extra)} />}

          {installments.length > 0 && (
            <section className="card">
              <div className="card-head"><h2>{tx('جدول الأقساط', 'Installment schedule')}</h2></div>
              <ul className="schedule inst-list">
                {installments.map((r) => (
                  <li key={r.seq} className={r.state}>
                    <span className="inst-seq num">{r.seq === 0 ? tx('مقدم', 'Down') : `#${r.seq}`}</span>
                    <span><bdi>{fmtDate(r.due_on, locale)}</bdi></span>
                    <strong className="num">{money(r.amount, locale)}</strong>
                    <span className="num muted">{num(r.paid) > 0 && r.state !== 'paid' ? tx(`دُفع ${money(r.paid, locale)}`, `${money(r.paid, locale)} paid`) : ''}</span>
                    <StateBadge state={r.state} map={INSTALLMENT_STATE} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {receipts.length > 0 && (
            <section className="card">
              <div className="card-head"><h2>{tx('المدفوعات', 'Payments')}</h2><span className="muted num">{receipts.length}</span></div>
              <ul className="receipt-list">
                {receipts.map((r) => (
                  <li key={r.id}>
                    <div><Link to={`${bill}/receipts/${r.id}/print`} className="mrn">{r.ref}</Link>
                      <small className="muted"><bdi>{fmtDateTime(r.created_at, locale)}</bdi> · {pick(r, 'received_by')}</small></div>
                    <Methods payments={r.payments} />
                    <strong className="num">{money(r.applied, locale)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {approvals.length > 0 && (
            <section className="card">
              <div className="card-head"><h2>{tx('سجل الاعتمادات', 'Approval history')}</h2></div>
              <ul className="plan-timeline">
                {approvals.map((a) => (
                  <li key={a.id} className={a.status === 'rejected' ? 'bad' : a.status === 'approved' ? 'done' : ''}>
                    <div><strong>{APPROVAL_KIND[a.kind]?.[lang]}</strong> · <span className="num">{money(a.amount, locale)}</span> <StateBadge state={a.status} map={APPROVAL_STATE} /></div>
                    <small className="muted">«{a.reason}» — {pick(a, 'requested_by')}, <bdi>{fmtDateTime(a.requested_at, locale)}</bdi></small>
                    {a.decided_at && a.status !== 'withdrawn' && <small className="muted">{pick(a, 'decided_by')}{a.decision_note && <>: «{a.decision_note}»</>}</small>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="visit-side">
          <section className="card inv-totals">
            <div className="card-body">
              <dl className="totals-dl">
                <div><dt>{tx('الإجمالي قبل الخصم', 'Subtotal')}</dt><dd className="num">{money(inv.subtotal, locale)}</dd></div>
                {num(inv.discount_amount) > 0 && <div className="disc"><dt>{tx('خصم', 'Discount')}<small>{inv.discount_reason}</small></dt><dd className="num">− {money(inv.discount_amount, locale)}</dd></div>}
                {num(inv.vat_total) > 0 && <div><dt>{tx('ضريبة القيمة المضافة', 'VAT')}</dt><dd className="num">{money(inv.vat_total, locale)}</dd></div>}
                <div className="grand"><dt>{tx('الإجمالي', 'Total')}</dt><dd className="num">{money(inv.total, locale)}</dd></div>
                {inv.status === 'issued' && (
                  <>
                    <div><dt>{tx('المدفوع', 'Paid')}</dt><dd className="num">{money(inv.paid_total, locale)}</dd></div>
                    <div className={`bal ${num(inv.balance) > 0 ? 'owed' : 'clear'}`}><dt>{tx('المتبقي', 'Balance')}</dt><dd className="num">{money(inv.balance, locale)}</dd></div>
                  </>
                )}
              </dl>
              <div className="inv-actions">
                {can.issue && <Button variant="gold" icon="check" disabled={!lines.length || saving} onClick={() => setModal('issue')}>{tx('إصدار الفاتورة', 'Issue invoice')}</Button>}
                {can.collect && <Button icon="cash" onClick={() => setModal('pay')}>{tx(`تحصيل ${money(inv.balance, locale)}`, `Collect ${money(inv.balance, locale)}`)}</Button>}
                {inv.status === 'issued' && num(inv.balance) <= 0 && <p className="ok-text paid-stamp"><Icon name="checkCircle" size={18} />{tx('مدفوعة بالكامل', 'Paid in full')}</p>}
                {can.void && <Button variant="quiet" size="sm" icon="x" onClick={() => setModal('void')}>{can.approve ? tx('إلغاء الفاتورة', 'Void invoice') : tx('طلب إلغاء الفاتورة', 'Ask to void')}</Button>}
              </div>
            </div>
          </section>
          <section className="card card-pad">
            <dl className="dl">
              {inv.issued_at && <><dt>{tx('أصدرها', 'Issued by')}</dt><dd>{pick(inv, 'issued_by')}<small className="muted" style={{ display: 'block' }}><bdi>{fmtDateTime(inv.issued_at, locale)}</bdi></small></dd></>}
              {!inv.issued_at && <><dt>{tx('أنشأها', 'Drafted by')}</dt><dd>{pick(inv, 'created_by')}<small className="muted" style={{ display: 'block' }}><bdi>{fmtDateTime(inv.created_at, locale)}</bdi></small></dd></>}
              {inv.discount_approved_by && <><dt>{tx('اعتمد الخصم', 'Discount approved by')}</dt><dd>{pick(inv, 'discount_approved_by')}</dd></>}
              <dt>{tx('الفرع', 'Branch')}</dt><dd>{pick(inv, 'branch_name')}</dd>
              <dt>{tx('رصيد المريض', 'Patient credit')}</dt><dd className="num">{money(data.credit, locale)}</dd>
              {inv.notes && <><dt>{tx('ملاحظات', 'Notes')}</dt><dd>{inv.notes}</dd></>}
            </dl>
            {inv.eta_status && inv.eta_status !== 'not_sent' && <p className="muted" style={{ fontSize: '.8rem', marginTop: 8 }}>ETA: {inv.eta_status}</p>}
          </section>
        </aside>
      </div>

      {modal === 'issue' && <IssueModal data={data} onClose={() => setModal(null)} onDone={(res) => {
        setData(res)
        if (res.status === 'issued' && res.can.collect) setModal('pay')
        else setModal(null)
      }} />}
      {modal === 'pay' && <PaymentModal patient={{ id: inv.patient_id, patient_name_ar: inv.patient_name_ar, patient_name_en: inv.patient_name_en }}
        invoice={inv} credit={data.credit} onClose={() => setModal(null)} onDone={() => reload()} />}
      {modal === 'void' && <VoidModal data={data} onClose={() => setModal(null)} onDone={(res) => { setData(res); setModal(null) }} />}
      <Modal open={modal === 'cancel'} onClose={() => setModal(null)} title={tx('حذف المسودة؟', 'Cancel this draft?')}
        footer={<><Button variant="ghost" onClick={() => setModal(null)}>{t('cancel')}</Button><Button variant="danger" icon="x" onClick={cancelDraft}>{tx('حذف المسودة', 'Cancel draft')}</Button></>}>
        <p>{tx('لم تصدر هذه الفاتورة بعد، ولا يوجد عليها أي دفع. ستعود الزيارة وبنود الخطة لقائمة "لم تُفوتر".', "This invoice hasn't been issued and has no payments. The visit and plan items go back to the not-billed list.")}</p>
      </Modal>
    </div>
  )
}

function Lines({ lines, editable, doctors, onRemove, onPatch }) {
  const { tx, pick, lang, locale } = useI18n()
  if (!lines.length) {
    return (
      <div className="lines-empty">
        <Icon name="clipboard" size={26} />
        <p>{editable ? tx('لا توجد بنود بعد. أضف خدمة أو باقة من الأسفل.', 'No lines yet. Add a service or a package below.') : tx('لا توجد بنود.', 'No lines.')}</p>
      </div>
    )
  }
  const doctorOptions = doctors.map((d) => ({ value: d.id, label: d[`full_name_${lang}`] }))
  return (
    <div className="table-wrap">
      <table className="table inv-table">
        <thead>
          <tr>
            <th>{tx('البند', 'Item')}</th>
            <th className="num">{tx('الكمية', 'Qty')}</th>
            <th className="num">{tx('السعر', 'Price')}</th>
            <th className="num hide-sm">{tx('خصم', 'Disc.')}</th>
            <th className="num hide-sm">{tx('ض.ق.م', 'VAT')}</th>
            <th className="num">{tx('الإجمالي', 'Total')}</th>
            {editable && <th><span className="sr-only">{tx('إجراءات', 'Actions')}</span></th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.id || i}`}>
              <td>
                <div className="line-name">
                  <span className={`kind-chip k-${l.kind}`}>{LINE_KIND[l.kind][lang]}</span>
                  <strong>{pick(l, 'name')}</strong>
                </div>
                {editable && l.kind !== 'package_sale' ? (
                  <select className="select select-sm line-doctor" value={l.doctor_id || ''} aria-label={tx('الطبيب', 'Doctor')}
                    onChange={(e) => onPatch(i, { doctor_id: e.target.value || null })}>
                    <option value="">{tx('بدون طبيب', 'No doctor')}</option>
                    {doctorOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : l.doctor_id ? <small className="muted">{pick(l, 'doctor_name')}</small> : null}
                {l.doctor_share !== undefined && num(l.doctor_share) > 0 && <small className="muted share-note">{tx('حصة الطبيب', 'Doctor share')} {money(l.doctor_share, locale)}</small>}
              </td>
              <td className="num">
                {editable && l.kind === 'service' ? (
                  <span className="qty-step">
                    <button type="button" aria-label={tx('أقل', 'Less')} disabled={l.qty <= 1} onClick={() => onPatch(i, { qty: l.qty - 1 })}>−</button>
                    <span>{l.qty}</span>
                    <button type="button" aria-label={tx('أكثر', 'More')} disabled={l.qty >= 50} onClick={() => onPatch(i, { qty: l.qty + 1 })}>+</button>
                  </span>
                ) : l.qty}
              </td>
              <td className="num">{l.kind === 'package_use' ? <Badge tone="success">{tx('مدفوعة', 'Prepaid')}</Badge> : money(l.unit_price, locale)}</td>
              <td className="num hide-sm">{num(l.discount) > 0 ? `− ${money(l.discount, locale)}` : '—'}</td>
              <td className="num hide-sm">{num(l.vat_amount) > 0 ? money(l.vat_amount, locale) : '—'}</td>
              <td className="num"><strong>{money(l.line_total, locale)}</strong></td>
              {editable && <td><Button variant="quiet" size="sm" icon="x" aria-label={tx('حذف البند', 'Remove line')} onClick={() => onRemove(i)} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const ADD_KINDS = ['service', 'package_sale', 'package_use', 'plan_item']

function AddLine({ options, account, lines, onAdd, busy, appointmentId }) {
  const { tx, lang, locale } = useI18n()
  const [kind, setKind] = useState('service')
  const [pickId, setPickId] = useState('')
  useEffect(() => setPickId(''), [kind])
  if (!options) return <div className="add-line muted">{tx('جارٍ تحميل قائمة الأسعار…', 'Loading the price list…')}</div>

  const usedPP = lines.filter((l) => l.kind === 'package_use').reduce((m, l) => ({ ...m, [l.patient_package_id]: (m[l.patient_package_id] || 0) + 1 }), {})
  const onInvoice = new Set(lines.filter((l) => l.kind === 'plan_item').map((l) => l.plan_item_id))
  const myPackages = (account?.packages || []).filter((p) => p.state === 'active' && p.remaining - (usedPP[p.id] || 0) > 0)
  const planItems = (account?.to_bill || []).filter((i) => !onInvoice.has(i.id))

  const choices = {
    service: options.services.map((s) => ({
      value: String(s.id), disabled: s.price == null,
      label: `${s[`name_${lang}`]} — ${s.price == null ? tx('بلا سعر', 'no price') : money(s.price, locale)}`,
      group: s[`specialty_${lang}`],
    })),
    package_sale: options.packages.map((p) => ({ value: String(p.id), label: `${p[`name_${lang}`]} — ${tx(`${p.sessions} جلسات`, `${p.sessions} sessions`)} — ${money(p.price, locale)}` })),
    package_use: myPackages.map((p) => ({ value: p.id, label: `${p[`name_${lang}`]} — ${tx(`متبقي ${p.remaining - (usedPP[p.id] || 0)} من ${p.sessions_total}`, `${p.remaining - (usedPP[p.id] || 0)} of ${p.sessions_total} left`)}` })),
    plan_item: planItems.map((i) => ({ value: String(i.id), label: `${i[`name_${lang}`]}${i.tooth ? ` #${i.tooth}` : ''} (${i.plan_ref}) — ${money(i.price, locale)}` })),
  }
  const list = choices[kind]
  const groups = kind === 'service' ? [...new Set(list.map((o) => o.group))] : null

  const add = () => {
    if (!pickId) return
    const base = { kind, qty: 1, appointment_id: kind === 'service' || kind === 'package_use' ? appointmentId : null }
    if (kind === 'service') onAdd({ ...base, service_id: Number(pickId) })
    else if (kind === 'package_sale') onAdd({ ...base, package_id: Number(pickId) })
    else if (kind === 'package_use') onAdd({ ...base, patient_package_id: pickId })
    else onAdd({ ...base, plan_item_id: Number(pickId) })
    setPickId('')
  }
  const count = (k) => (k === 'package_use' ? myPackages.length : k === 'plan_item' ? planItems.length : null)

  return (
    <div className="add-line">
      <div className="add-kinds" role="tablist" aria-label={tx('نوع البند', 'Line type')}>
        {ADD_KINDS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} disabled={count(k) === 0}>
            <Icon name={{ service: 'stethoscope', package_sale: 'package', package_use: 'layers', plan_item: 'clipboard' }[k]} size={15} />
            {LINE_KIND[k][lang]}{count(k) ? <span className="tab-count num">{count(k)}</span> : null}
          </button>
        ))}
      </div>
      <div className="add-pick">
        <label className="sr-only" htmlFor="add-line-pick">{LINE_KIND[kind][lang]}</label>
        <select id="add-line-pick" className="select" value={pickId} onChange={(e) => setPickId(e.target.value)}>
          <option value="">{list.length ? tx('اختر…', 'Choose…') : tx('لا يوجد ما يُضاف', 'Nothing to add')}</option>
          {groups ? groups.map((g) => (
            <optgroup key={g} label={g}>{list.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}</optgroup>
          )) : list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Button icon="plus" onClick={add} disabled={!pickId} loading={busy}>{tx('إضافة', 'Add')}</Button>
      </div>
      {kind === 'package_sale' && <p className="muted add-hint">{tx('بعد الإصدار تظهر الباقة في حساب المريض، وتُستخدم جلساتها في الزيارات التالية بدون دفع.', 'Once issued, the package shows on the patient account and its sessions are used on later visits at no charge.')}</p>}
    </div>
  )
}

function DiscountCard({ inv: data, canDiscount, rules, onSave }) {
  const { t, tx, locale } = useI18n()
  const inv = data.invoice
  const [amount, setAmount] = useState(num(inv.discount_amount) ? String(num(inv.discount_amount)) : '')
  const [mode, setMode] = useState('amount')
  const [reason, setReason] = useState(inv.discount_reason || '')
  const [notes, setNotes] = useState(inv.notes || '')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const subtotal = num(inv.subtotal)
  const value = mode === 'pct' ? Math.round(subtotal * Math.min(num(amount), 100)) / 100 : num(amount)
  const pct = subtotal ? (value / subtotal) * 100 : 0
  const overLimit = value > 0 && pct > num(rules.max_discount_pct) && !data.can.approve
  const dirty = value !== num(inv.discount_amount) || (reason || '') !== (inv.discount_reason || '') || (notes || '') !== (inv.notes || '')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      await onSave({ discount_amount: value, discount_reason: reason.trim() || null, notes: notes.trim() || null })
      setMode('amount')
      setAmount(value ? String(value) : '')
    } catch (err) {
      setErrors(err.fields || {})
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-head"><h2>{tx('الخصم والملاحظات', 'Discount & notes')}</h2></div>
      <form className="card-body form" onSubmit={submit}>
        {canDiscount ? (
          <div className="form-grid">
            <div className="disc-input">
              <TextField label={mode === 'pct' ? tx('الخصم (%)', 'Discount (%)') : tx('الخصم (ج.م)', 'Discount (EGP)')} value={amount} inputMode="decimal" dir="ltr" inputClassName="num"
                onChange={(e) => setAmount(cleanAmount(e.target.value))} error={fieldText('discount_amount', errors.discount_amount, t)}
                hint={value > 0 ? tx(`= ${money(value, locale)} (${pct.toFixed(1)}٪)`, `= ${money(value, locale)} (${pct.toFixed(1)}%)`) : tx(`الحد بدون اعتماد ${rules.max_discount_pct}٪`, `Up to ${rules.max_discount_pct}% without approval`)} />
              <div className="seg" role="radiogroup" aria-label={tx('نوع الخصم', 'Discount type')}>
                <button type="button" role="radio" aria-checked={mode === 'amount'} onClick={() => { setMode('amount'); setAmount(value ? String(value) : '') }}>{tx('ج.م', 'EGP')}</button>
                <button type="button" role="radio" aria-checked={mode === 'pct'} onClick={() => { setMode('pct'); setAmount(value && subtotal ? String(Math.round(pct * 10) / 10) : '') }}>%</button>
              </div>
            </div>
            <TextField label={tx('سبب الخصم', 'Discount reason')} value={reason} onChange={(e) => setReason(e.target.value)} disabled={!value}
              error={fieldText('discount_reason', errors.discount_reason, t)} placeholder={tx('مثال: عميل دائم، عرض الشهر', 'e.g. loyal patient, monthly offer')} />
          </div>
        ) : num(inv.discount_amount) > 0 ? <p className="muted">{tx('خصم مسجّل:', 'Discount on file:')} {money(inv.discount_amount, locale)}</p> : null}
        {overLimit && <Alert tone="warn">{tx(`الخصم أعلى من ${rules.max_discount_pct}٪ — عند الإصدار يُرسل للإدارة للاعتماد.`, `This is above ${rules.max_discount_pct}% — on issuing it goes to management for approval.`)}</Alert>}
        <TextArea label={tx('ملاحظات على الفاتورة', 'Invoice notes')} optional rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        <Button type="submit" variant="ghost" icon="check" loading={busy} disabled={!dirty || (value > 0 && reason.trim().length < 3)} style={{ justifySelf: 'start' }}>{tx('حفظ', 'Save')}</Button>
      </form>
    </section>
  )
}

function IssueModal({ data, onClose, onDone }) {
  const { t, tx, locale } = useI18n()
  const { api } = useBilling()
  const inv = data.invoice
  const max = Number(data.rules.max_installments) || 0
  const [mode, setMode] = useState('full')
  const [n, setN] = useState(String(Math.min(3, max) || ''))
  const [down, setDown] = useState('')
  const [first, setFirst] = useState(addDays(dayKey(), 30))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const pct = num(inv.subtotal) ? (num(inv.discount_amount) / num(inv.subtotal)) * 100 : 0
  const needsApproval = num(inv.discount_amount) > 0 && !data.can.approve && (!data.can.discount || pct > num(data.rules.max_discount_pct))
  const body = mode === 'full' ? { installments: 0, down_payment: 0, first_due_on: null } : { installments: Number(n), down_payment: num(down), first_due_on: first || null }
  const preview = mode === 'plan' ? previewSchedule(inv.total, body) : []
  const fields = error?.fields || {}

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.issue(inv.id, body)
      onDone(res)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} busy={busy} wide title={tx('إصدار الفاتورة', 'Issue the invoice')}
      description={tx(`الإجمالي ${money(inv.total, locale)}. بعد الإصدار لا تُعدّل الفاتورة؛ تُلغى فقط باعتماد.`, `Total ${money(inv.total, locale)}. Once issued it can't be edited, only voided with approval.`)}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button variant="gold" icon="check" loading={busy} onClick={submit} disabled={mode === 'plan' && !preview.length}>{needsApproval ? tx('إرسال للاعتماد', 'Send for approval') : tx('إصدار', 'Issue')}</Button></>}>
      <div className="form">
        {needsApproval && (
          <Alert tone="warn" title={tx('الخصم يحتاج اعتماد الإدارة.', 'The discount needs management approval.')}>
            {tx(`خصم ${pct.toFixed(1)}٪ أعلى من حدك (${data.rules.max_discount_pct}٪). ستصدر الفاتورة تلقائيًا بنفس طريقة الدفع عند الاعتماد.`, `A ${pct.toFixed(1)}% discount is above your limit (${data.rules.max_discount_pct}%). The invoice is issued automatically with this payment plan once approved.`)}
          </Alert>
        )}
        {error && !Object.keys(fields).length && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <ChoiceGroup legend={tx('طريقة السداد', 'How it will be paid')} name="pay-plan" value={mode} onChange={setMode}
          options={[
            { value: 'full', label: tx('دفعة واحدة', 'In full'), description: tx('يُحصّل الآن أو لاحقًا بالكامل.', 'Collected now or later, in one go.') },
            ...(max > 0 ? [{ value: 'plan', label: tx('على أقساط', 'In installments'), description: tx(`حتى ${max} أقساط شهرية، مع مقدم اختياري.`, `Up to ${max} monthly installments, with an optional down payment.`) }] : []),
          ]} />
        {mode === 'plan' && (
          <>
            <div className="form-grid three">
              <SelectField label={tx('عدد الأقساط', 'Installments')} value={n} onChange={(e) => setN(e.target.value)}
                options={Array.from({ length: max }, (_, k) => ({ value: String(k + 1), label: String(k + 1) }))} error={fieldText('installments', fields.installments, t)} />
              <TextField label={tx('المقدم (ج.م)', 'Down payment (EGP)')} optional value={down} onChange={(e) => setDown(cleanAmount(e.target.value))} inputMode="decimal" dir="ltr" inputClassName="num"
                error={fieldText('down_payment', fields.down_payment, t)} />
              <TextField label={tx('أول قسط في', 'First installment on')} type="date" value={first} min={dayKey()} onChange={(e) => setFirst(e.target.value)}
                error={fieldText('first_due_on', fields.first_due_on, t)} />
            </div>
            {preview.length > 0 ? (
              <ul className="schedule preview-schedule" aria-label={tx('معاينة الجدول', 'Schedule preview')}>
                {preview.map((r) => (
                  <li key={r.seq}><span className="inst-seq num">{r.seq === 0 ? tx('مقدم', 'Down') : `#${r.seq}`}</span><bdi>{fmtDate(r.due_on, locale)}</bdi><strong className="num">{money(r.amount, locale)}</strong></li>
                ))}
              </ul>
            ) : <p className="warn-text">{tx('المقدم يجب أن يكون أقل من الإجمالي.', 'The down payment must be less than the total.')}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}

function VoidModal({ data, onClose, onDone }) {
  const { t, tx, lang, locale } = useI18n()
  const { api } = useBilling()
  const toast = useToast()
  const inv = data.invoice
  const paid = num(inv.paid_total)
  const [reason, setReason] = useState('')
  const [refund, setRefund] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.void(inv.id, { reason: reason.trim(), refund_method: refund || null })
      toast.success(res.status === 'void' ? tx('أُلغيت الفاتورة.', 'Invoice voided.') : tx('أُرسل طلب الإلغاء للإدارة.', 'The void request was sent to management.'))
      onDone(res)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} busy={busy} title={data.can.approve ? tx('إلغاء الفاتورة', 'Void the invoice') : tx('طلب إلغاء الفاتورة', 'Ask to void the invoice')}
      description={<><span className="mrn">{inv.ref}</span> · {money(inv.total, locale)}</>}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button variant="danger" icon="x" loading={busy} disabled={reason.trim().length < 5} onClick={submit}>{data.can.approve ? tx('إلغاء الفاتورة', 'Void invoice') : tx('إرسال الطلب', 'Send request')}</Button></>}>
      <div className="form">
        {error && <Alert tone="danger">{errorText(error, t)}</Alert>}
        <p className="muted">{tx('الإلغاء نهائي: يعيد بنود الخطة لقائمة الفوترة، ويلغي أي باقة بيعت في الفاتورة.', 'Voiding is final: plan items go back to be billed and any package sold on it is cancelled.')}</p>
        <TextArea label={tx('السبب', 'Reason')} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus
          error={fieldText('reason', error?.fields?.reason, t)} hint={tx('5 أحرف على الأقل. يظهر في سجل التدقيق.', 'At least 5 characters. It shows in the audit log.')} />
        {paid > 0 && (
          <SelectField label={tx(`المدفوع (${money(paid, locale)}) يعود لرصيد المريض. استرداده؟`, `What was paid (${money(paid, locale)}) goes to the patient's credit. Refund it?`)}
            value={refund} onChange={(e) => setRefund(e.target.value)}
            options={[{ value: '', label: tx('لا — يبقى رصيدًا للمريض', 'No — keep it as credit') },
              ...['cash', 'card', 'instapay', 'wallet'].map((m) => ({ value: m, label: tx(`نعم — ${METHODS[m].ar}`, `Yes — ${METHODS[m][lang]}`) }))]} />
        )}
      </div>
    </Modal>
  )
}
