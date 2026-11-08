import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText } from '../../lib/errors'
import { clock } from '../../lib/clinicTime'
import { PAY_STATE, StateBadge, money, num, useBilling } from './meta'
import { PatientFinder } from './meta'
import { ShiftStrip } from './Shift'

const FILTERS = ['', 'unbilled', 'draft', 'pending_approval', 'unpaid', 'partly', 'paid']

// The cashier's desk: today's arrived patients and where each bill stands, plus a search for anyone else.
export default function Desk() {
  const { t, tx, lang, pick, locale } = useI18n()
  const { api, bill, can } = useBilling()
  const navigate = useNavigate()
  const toast = useToast()
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(null)
  const { data, error, loading, reload } = useAsync(() => api.queue(), [api])
  const items = (data?.items || []).filter((r) => !filter || r.bill === filter)
  const open = (data?.items || []).filter((r) => r.bill !== 'paid').length

  const start = async (row) => {
    setBusy(row.id)
    try {
      const res = await api.createInvoice({ patient_id: row.patient_id, appointment_id: row.id })
      navigate(`${bill}/invoices/${res.invoice.id}`)
    } catch (err) {
      if (err.code === 'already_invoiced' && err.data?.invoice_id) navigate(`${bill}/invoices/${err.data.invoice_id}`)
      else toast.error(errorText(err, t))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('الخزينة', 'Cashier')} title={tx('مكتب التحصيل', 'Cashier desk')}
        description={tx('مرضى اليوم من لحظة الوصول. افتح فاتورة الزيارة، حصّل، واطبع الإيصال.', "Today's patients from the moment they arrive. Open the visit's invoice, take the payment and print the receipt.")}
        actions={<Button variant="ghost" icon="refresh" onClick={reload} loading={loading && !!data}>{tx('تحديث', 'Refresh')}</Button>} />

      {can('billing.collect') && <ShiftStrip />}

      <section className="card card-pad desk-search">
        <div>
          <h2>{tx('مريض آخر؟', 'Someone else?')}</h2>
          <p className="muted">{tx('ابحث لفتح حسابه: فواتير سابقة، أقساط، رصيد، باقات، أو إيداع مقدم.', 'Search to open their account: past invoices, installments, credit, packages or a deposit.')}</p>
        </div>
        <PatientFinder />
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>{tx('مرضى اليوم', "Today's patients")}</h2>
            <p className="muted" style={{ fontSize: '.86rem' }}>{data ? tx(`${open} بحاجة لإجراء من ${data.items.length}`, `${open} need action of ${data.items.length}`) : ' '}</p>
          </div>
        </div>
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label={tx('تصفية', 'Filter')}>
            {FILTERS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
                {k ? PAY_STATE[k][lang] : tx('الكل', 'All')}
                {data && <span className="tab-count num">{k ? data.counts[k] : data.items.length}</span>}
              </button>
            ))}
          </div>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={6} cols={5} /> : !items.length ? (
          <EmptyState icon="cash" title={filter ? tx('لا أحد في هذه القائمة', 'Nobody in this list') : tx('لم يصل أحد بعد', 'Nobody has arrived yet')}>
            {tx('يظهر المريض هنا بمجرد تسجيل وصوله في الاستقبال.', 'Patients appear here as soon as reception checks them in.')}
          </EmptyState>
        ) : (
          <ul className="desk-list">
            {items.map((r) => (
              <li key={r.id} className={`desk-row bill-${r.bill}`}>
                <span className="desk-time"><bdi className="num">{clock(r.starts_at, locale)}</bdi>{r.queue_no && <small>#{r.queue_no}</small>}</span>
                <div className="desk-who">
                  <Link to={`${bill}/patients/${r.patient_id}`} className="person-name">{pick(r, 'patient_name')}</Link>
                  <small className="muted"><span className="mrn">{r.mrn}</span> · {pick(r, 'doctor_name')}</small>
                  <small className="desk-services">{r.services.map((s) => s[`name_${lang}`]).join(' · ') || tx('بدون خدمات محددة', 'No services booked')}</small>
                </div>
                <div className="desk-money">
                  {r.invoice_id ? (
                    <>
                      <strong className="num">{money(r.invoice_total, locale)}</strong>
                      {num(r.invoice_paid) > 0 && r.bill !== 'paid' && <small className="muted">{tx('دُفع', 'paid')} <span className="num">{money(r.invoice_paid, locale)}</span></small>}
                    </>
                  ) : <><strong className="num muted-num">{money(r.booked_total, locale)}</strong><small className="muted">{tx('حسب الحجز', 'as booked')}</small></>}
                </div>
                <StateBadge state={r.bill} />
                <div className="desk-act">
                  {r.bill === 'unbilled' && can('billing.invoice') ? (
                    <Button size="sm" icon="plus" loading={busy === r.id} onClick={() => start(r)}>{tx('فاتورة', 'Invoice')}</Button>
                  ) : r.invoice_id ? (
                    <Link className={`btn btn-sm ${['unpaid', 'partly', 'draft'].includes(r.bill) ? 'btn-primary' : 'btn-ghost'}`} to={`${bill}/invoices/${r.invoice_id}`}>
                      {r.bill === 'draft' ? tx('أكمل', 'Continue') : ['unpaid', 'partly'].includes(r.bill) ? tx('تحصيل', 'Collect') : tx('عرض', 'View')}
                      <Icon name={lang === 'ar' ? 'chevronLeft' : 'chevronRight'} size={16} />
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
