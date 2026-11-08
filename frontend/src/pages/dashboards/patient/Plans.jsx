import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Button from '../../../components/Button'
import Icon from '../../../components/Icon'
import Modal from '../../../components/Modal'
import PageLoader from '../../../components/PageLoader'
import { Checkbox, TextArea } from '../../../components/Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../../components/ui'
import { useToast } from '../../../components/Toast'
import { useAsync } from '../../../components/useAsync'
import { PlanBadge, money } from '../../../components/clinical/meta'
import { Schedule } from '../../../components/dental/PlanPage'
import { QuotationSheet } from '../../../components/dental/Quotation'
import { PrintBar } from '../../../components/visits/RxSheet'
import { patientApi } from '../../../api/patient'
import { useI18n } from '../../../i18n/I18nContext'
import { errorText } from '../../../lib/errors'
import { fmtDate } from '../../../lib/format'

// My treatment plans: read the quotation, accept or decline it, follow the work and the installments.
export default function MyPlans() {
  const { t, tx, pick, locale } = useI18n()
  const toast = useToast()
  const { data, error, loading, reload, setData } = useAsync(() => patientApi.plans(), [])
  const [accepting, setAccepting] = useState(null)
  const [declining, setDeclining] = useState(null)
  const [agree, setAgree] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const people = new Set((data || []).map((p) => p.patient_id))

  const act = async (fn, ok) => {
    setBusy(true)
    try {
      setData(await fn())
      toast.success(ok)
      setAccepting(null)
      setDeclining(null)
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('حسابي', 'My account')} title={tx('خطط العلاج', 'My treatment plans')}
        description={tx('خطط العلاج التي اقترحها طبيبك مع عرض السعر وطريقة الدفع. يمكنك الموافقة من هنا.', 'The treatment plans your doctor proposed, with the quotation and payment plan. You can accept here.')} />
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <section className="card"><SkeletonRows rows={3} cols={2} /></section> : !data.length ? (
        <section className="card"><EmptyState icon="clipboard" title={tx('لا توجد خطط علاج', 'No treatment plans')} /></section>
      ) : (
        <div className="portal-visits">
          {data.map((p) => (
            <article key={p.id} className="card portal-visit">
              <header>
                <div><strong>{p.title}</strong><small className="muted">{pick(p, 'doctor_name')} · <span className="mrn">{p.ref}</span></small></div>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{people.size > 1 && <Badge tone="neutral">{pick(p, 'patient_name')}</Badge>}<PlanBadge state={p.state} /></span>
              </header>
              <ul className="portal-plan-items">
                {p.items.map((i) => (
                  <li key={i.id}>
                    <span>{i.tooth && <span className="tooth-tag">{i.tooth}</span>} {pick(i, 'service_name')}</span>
                    <span className="num">{money(i.price, locale)}</span>
                    {p.status !== 'quoted' && (i.status === 'done' ? <Badge tone="success">{tx('تم', 'Done')}</Badge> : <Badge tone="neutral">{tx('لم يتم بعد', 'To do')}</Badge>)}
                  </li>
                ))}
                <li className="total"><span>{tx('الإجمالي', 'Total')}</span><strong className="num">{money(p.quote_total, locale)}</strong></li>
              </ul>
              {p.patient_note && <div className="doc-note prewrap" dir="auto" style={{ marginTop: 0 }}><small>{tx('من طبيبك', 'From your doctor')}</small>{p.patient_note}</div>}
              <Schedule rows={p.installments.length ? p.installments : p.schedule_preview} preview={!p.installments.length} />
              <footer>
                {p.state === 'quoted' && <span className="muted"><Icon name="clock" size={14} /> {tx('العرض صالح حتى', 'Valid until')} <bdi>{fmtDate(p.valid_until, locale)}</bdi></span>}
                {p.state === 'expired' && <span className="danger-text">{tx('انتهت صلاحية العرض. تواصل مع العيادة لعرض جديد.', 'This quotation has expired. Contact the clinic for a new one.')}</span>}
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Link to={`/dashboard/patient/plans/${p.id}/print`} className="btn btn-ghost btn-sm"><Icon name="printer" size={16} />{tx('طباعة', 'Print')}</Link>
                  {p.state === 'quoted' && <Button size="sm" variant="ghost" onClick={() => { setDeclining(p); setReason('') }}>{tx('لا أرغب', 'Decline')}</Button>}
                  {p.state === 'quoted' && <Button size="sm" variant="gold" icon="check" onClick={() => { setAccepting(p); setAgree(false) }}>{tx('أوافق على الخطة', 'Accept the plan')}</Button>}
                </span>
              </footer>
            </article>
          ))}
        </div>
      )}
      {accepting && (
        <Modal open onClose={() => setAccepting(null)} busy={busy} title={tx('الموافقة على خطة العلاج', 'Accept the treatment plan')}
          footer={<><Button variant="ghost" onClick={() => setAccepting(null)}>{t('cancel')}</Button><Button variant="gold" loading={busy} disabled={!agree} onClick={() => act(() => patientApi.acceptPlan(accepting.id), tx('شكرًا، سُجّلت موافقتك.', 'Thank you, your acceptance is recorded.'))}>{tx('أوافق', 'I accept')}</Button></>}>
          <div className="form">
            <p><strong>{accepting.title}</strong> — {money(accepting.quote_total, locale)}</p>
            <Alert tone="info">{tx('يُحاسب كل بند عند تنفيذه. تبدأ الأقساط من يوم الموافقة.', 'Each item is billed when it is done. Installments start from today.')}</Alert>
            <Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)} label={tx('قرأت الخطة والأسعار وطريقة الدفع وأوافق عليها', 'I have read the plan, the prices and the payment plan, and I agree')} />
          </div>
        </Modal>
      )}
      {declining && (
        <Modal open onClose={() => setDeclining(null)} busy={busy} title={tx('رفض الخطة', 'Decline the plan')}
          footer={<><Button variant="ghost" onClick={() => setDeclining(null)}>{t('cancel')}</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => act(() => patientApi.declinePlan(declining.id, reason.trim()), tx('سُجّل ردك. ستتواصل معك العيادة.', 'Your answer is recorded. The clinic will contact you.'))}>{tx('تأكيد', 'Confirm')}</Button></>}>
          <TextArea label={tx('لماذا؟ (يساعدنا على خدمتك)', 'Why? (helps us serve you better)')} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
        </Modal>
      )}
    </div>
  )
}

export function MyPlanPrint() {
  const { id } = useParams()
  const { tx } = useI18n()
  const { data, error, reload } = useAsync(() => patientApi.plans(), [])
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const plan = data.find((p) => p.id === id)
  if (!plan) return <ErrorState error={{ code: 'plan_not_found' }} />
  return (
    <div className="page print-page">
      <PrintBar back="/dashboard/patient/plans" label={tx('خطط العلاج', 'My treatment plans')} />
      <QuotationSheet plan={plan} items={plan.items} schedule={plan.installments.length ? plan.installments : plan.schedule_preview} />
    </div>
  )
}
