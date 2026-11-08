import { useState } from 'react'
import Button from '../../../components/Button'
import Icon from '../../../components/Icon'
import { SelectField, TextArea, TextField } from '../../../components/Fields'
import { Alert, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../../components/ui'
import { useToast } from '../../../components/Toast'
import { useAsync } from '../../../components/useAsync'
import { CATEGORY, TICKET_KIND, TicketBadge } from '../../../components/clinical/meta'
import { patientApi } from '../../../api/patient'
import { useI18n } from '../../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../../lib/errors'
import { fmtDateTime } from '../../../lib/format'

const EMPTY = { kind: 'complaint', category: 'other', subject: '', details: '' }

// Send a complaint, request, suggestion or thanks, and see what the clinic did about it.
export default function MyRequests() {
  const { t, tx, lang, locale } = useI18n()
  const toast = useToast()
  const { data, error, loading, reload, setData } = useAsync(() => patientApi.requests(), [])
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (form.subject.trim().length < 3) errs.subject = t('field.required')
    if (form.details.trim().length < 5) errs.details = t('field.required')
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      setData(await patientApi.sendRequest(form))
      setForm(EMPTY)
      toast.success(tx('وصلتنا رسالتك. سنرد عليك في أقرب وقت.', "We've received your message and will get back to you soon."))
    } catch (err) {
      setErrors({ ...fieldErrors(err, t), form: errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('حسابي', 'My account')} title={tx('الشكاوى والطلبات', 'Complaints & requests')}
        description={tx('أرسل شكوى أو طلبًا أو اقتراحًا أو شكرًا. يتابعها فريق علاقات المرضى، وتجد الرد هنا.', 'Send a complaint, request, suggestion or thanks. Our patient relations team follows up and you will find the answer here.')} />
      <div className="split">
        <section className="card">
          <div className="card-head"><h2>{tx('رسالة جديدة', 'New message')}</h2></div>
          <form className="card-body form" onSubmit={submit} noValidate>
            {errors.form && errors.form !== t('err.generic') && <Alert tone="danger">{errors.form}</Alert>}
            <div className="choice-group">
              {Object.entries(TICKET_KIND).map(([k, l]) => (
                <label key={k} className="choice"><input type="radio" name="kind" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} /><span>{l[lang]}</span></label>
              ))}
            </div>
            <SelectField label={tx('عن ماذا؟', 'About')} value={form.category} onChange={set('category')} options={Object.entries(CATEGORY).map(([value, c]) => ({ value, label: c[lang] }))} />
            <TextField label={tx('العنوان', 'Subject')} value={form.subject} onChange={set('subject')} error={errors.subject} maxLength={120} />
            <TextArea label={tx('التفاصيل', 'Details')} value={form.details} onChange={set('details')} error={errors.details} rows={5} maxLength={3000} />
            <Button type="submit" icon="mail" loading={busy} style={{ justifySelf: 'start' }}>{tx('إرسال', 'Send')}</Button>
          </form>
        </section>
        <section className="card">
          <div className="card-head"><h2>{tx('رسائلي', 'My messages')}</h2></div>
          {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={3} cols={2} /> : !data.length ? (
            <EmptyState icon="inbox" title={tx('لم ترسل أي رسالة بعد', "You haven't sent anything yet")} />
          ) : (
            <ul className="my-requests">
              {data.map((r) => (
                <li key={r.id}>
                  <div className="row-between"><strong dir="auto">{r.subject}</strong><TicketBadge status={r.status} /></div>
                  <small className="muted">{TICKET_KIND[r.kind][lang]} · {CATEGORY[r.category][lang]} · <bdi>{fmtDateTime(r.created_at, locale)}</bdi> · <span className="mrn">{r.ref}</span></small>
                  {r.resolution && <div className="doc-note" dir="auto"><small>{tx('رد العيادة', "The clinic's answer")}</small>{r.resolution}</div>}
                  {!r.resolution && <small className="muted"><Icon name="clock" size={13} /> {tx('قيد المتابعة', 'Being followed up')}</small>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
