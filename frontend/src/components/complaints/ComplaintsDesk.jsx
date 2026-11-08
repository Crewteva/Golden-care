import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import PageLoader from '../PageLoader'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync, useDebounced } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtDateTime, fmtPhone, fmtRelative } from '../../lib/format'
import { patientsApi } from '../../api/patients'
import { CATEGORY, CHANNEL, PRIORITY, TICKET_KIND, TICKET_STATUS, TicketBadge, useClinical } from '../clinical/meta'

const opts = (map, lang) => Object.entries(map).map(([value, l]) => ({ value, label: l[lang] }))

function PatientPicker({ value, onChange }) {
  const { tx, pick } = useI18n()
  const { slug, can } = useClinical()
  const [q, setQ] = useState('')
  const term = useDebounced(q, 250)
  const results = useAsync(() => (term.trim().length >= 2 && can('patients.view') ? patientsApi(slug).search({ q: term, page_size: 6 }) : Promise.resolve(null)), [term, slug])
  if (value) {
    return (
      <div className="picked-patient"><Icon name="user" size={16} /><strong>{pick(value, 'full_name')}</strong><span className="mrn muted">{value.mrn}</span>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onChange(null)}>{tx('تغيير', 'Change')}</button></div>
    )
  }
  if (!can('patients.view')) return null
  return (
    <div className="combo">
      <TextField label={tx('المريض', 'Patient')} optional icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('ابحث بالاسم أو الموبايل…', 'Search by name or mobile…')} />
      {results.data?.items?.length > 0 && (
        <ul className="combo-list" role="listbox">
          {results.data.items.map((p) => (
            <li key={p.id} role="option" aria-selected="false"><button type="button" onClick={() => { onChange(p); setQ('') }}><span>{pick(p, 'full_name')}</span><span className="mrn muted">{p.mrn}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NewTicket({ onClose, onCreated }) {
  const { t, tx, lang, pick } = useI18n()
  const { complaints, can } = useClinical()
  const toast = useToast()
  const staff = useAsync(() => (can('complaints.manage') ? complaints.staff() : Promise.resolve([])), [complaints])
  const [patient, setPatient] = useState(null)
  const [form, setForm] = useState({ kind: 'complaint', channel: 'in_person', category: 'waiting', priority: 'normal', contact_name: '', contact_phone: '', subject: '', details: '', assigned_to: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (form.subject.trim().length < 3) errs.subject = t('field.required')
    if (form.details.trim().length < 5) errs.details = t('field.required')
    if (!patient && !form.contact_name.trim()) errs.contact_name = tx('اختر مريضًا أو اكتب اسم صاحب الشكوى.', 'Pick a patient or write the person’s name.')
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const d = await complaints.create({ ...form, patient_id: patient?.id || null, contact_name: patient ? null : form.contact_name, contact_phone: patient ? null : form.contact_phone || null, assigned_to: form.assigned_to || null })
      toast.success(tx(`سُجّلت ${d.ticket.ref}.`, `${d.ticket.ref} logged.`))
      onCreated(d.ticket.id)
    } catch (err) {
      setErrors({ ...fieldErrors(err, t), form: errorText(err, t) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open wide onClose={onClose} busy={busy} title={tx('تسجيل شكوى أو طلب', 'Log a complaint or request')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button><Button type="submit" form="new-ticket" loading={busy}>{tx('تسجيل', 'Log it')}</Button></>}>
      <form id="new-ticket" className="form" onSubmit={submit} noValidate>
        {errors.form && errors.form !== t('err.generic') && <Alert tone="danger">{errors.form}</Alert>}
        <div className="choice-group">
          {Object.entries(TICKET_KIND).map(([k, l]) => (
            <label key={k} className="choice"><input type="radio" name="kind" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} /><span><Icon name={l.icon} size={15} /> {l[lang]}</span></label>
          ))}
        </div>
        <PatientPicker value={patient} onChange={setPatient} />
        {!patient && (
          <div className="form-grid">
            <TextField label={tx('الاسم (إن لم يكن مريضًا مسجّلًا)', 'Name (if not a registered patient)')} value={form.contact_name} onChange={set('contact_name')} error={errors.contact_name} />
            <TextField label={tx('الموبايل', 'Mobile')} optional value={form.contact_phone} onChange={set('contact_phone')} error={errors.contact_phone} dir="ltr" inputMode="tel" />
          </div>
        )}
        <div className="form-grid">
          <SelectField label={tx('وصلت عن طريق', 'Came in via')} value={form.channel} onChange={set('channel')} options={opts(CHANNEL, lang).filter((o) => o.value !== 'portal')} />
          <SelectField label={tx('الموضوع', 'Category')} value={form.category} onChange={set('category')} options={opts(CATEGORY, lang)} />
          <SelectField label={tx('الأولوية (مهلة الرد)', 'Priority (response time)')} value={form.priority} onChange={set('priority')} options={opts(PRIORITY, lang)} />
          {can('complaints.manage') && (
            <SelectField label={tx('تكليف', 'Assign to')} optional value={form.assigned_to} onChange={set('assigned_to')} placeholder={tx('بدون تكليف الآن', 'Not now')}
              options={(staff.data || []).map((s) => ({ value: s.id, label: `${pick(s, 'full_name')} — ${pick(s, 'roles')}` }))} />
          )}
        </div>
        <TextField label={tx('العنوان', 'Subject')} value={form.subject} onChange={set('subject')} error={errors.subject} maxLength={120} />
        <TextArea label={tx('التفاصيل', 'Details')} value={form.details} onChange={set('details')} error={errors.details} rows={4} maxLength={3000} />
      </form>
    </Modal>
  )
}

function TicketModal({ id, onClose, onChanged }) {
  const { t, tx, lang, pick, locale } = useI18n()
  const { complaints, base, can } = useClinical()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [comment, setComment] = useState('')
  const [resolution, setResolution] = useState('')
  const [resolving, setResolving] = useState(null)
  const [busy, setBusy] = useState(false)
  const staff = useAsync(() => (can('complaints.manage') ? complaints.staff() : Promise.resolve([])), [complaints])
  useEffect(() => { complaints.get(id).then((d) => { setData(d); setResolution(d.ticket.resolution || '') }).catch(setError) }, [id, complaints])

  const update = async (body, ok) => {
    setBusy(true)
    try {
      setData(await complaints.update(id, body))
      if (ok) toast.success(ok)
      setComment('')
      setResolving(null)
      onChanged()
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }
  if (error) return <Modal open onClose={onClose} title={tx('شكوى / طلب', 'Ticket')}><Alert tone="danger">{errorText(error, t)}</Alert></Modal>
  if (!data) return <Modal open onClose={onClose} title={tx('شكوى / طلب', 'Ticket')}><PageLoader /></Modal>
  const tk = data.ticket
  const active = ['open', 'in_progress'].includes(tk.status)
  const who = tk.patient_id ? pick(tk, 'patient_name') : tk.contact_name
  const phone = tk.patient_phone || tk.contact_phone

  const eventText = (e) => {
    if (e.action === 'created') return tx('سُجّلت', 'Logged')
    if (e.action === 'assigned') return e.to_value ? `${tx('كُلّف', 'Assigned to')} ${pick(e, 'to_name')}` : tx('أُلغي التكليف', 'Unassigned')
    if (e.action === 'priority') return `${tx('الأولوية', 'Priority')}: ${PRIORITY[e.to_value]?.[lang]}`
    if (e.action === 'status') return `${TICKET_STATUS[e.to_value]?.[lang]}`
    return tx('تعليق', 'Comment')
  }

  return (
    <Modal open wide onClose={onClose} busy={busy}
      title={<span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><Icon name={TICKET_KIND[tk.kind].icon} size={18} /> {TICKET_KIND[tk.kind][lang]} <span className="mrn muted" style={{ fontSize: '.9rem' }}>{tk.ref}</span> <TicketBadge status={tk.status} /></span>}
      footer={<Button variant="ghost" onClick={onClose}>{t('close')}</Button>}>
      <div className="form">
        <div>
          <h3 className="ticket-subject" dir="auto">{tk.subject}</h3>
          <p className="prewrap" dir="auto">{tk.details}</p>
        </div>
        <dl className="dl">
          <dt>{tx('صاحب الشكوى', 'From')}</dt><dd>{tk.patient_id ? <Link to={`${base}/patients/${tk.patient_id}`} className="person-name">{who}</Link> : who}{phone && <> · <bdi className="ltr">{fmtPhone(phone)}</bdi></>}</dd>
          <dt>{tx('وصلت عن طريق', 'Via')}</dt><dd>{CHANNEL[tk.channel][lang]} · {CATEGORY[tk.category][lang]}</dd>
          <dt>{tx('الرد مطلوب قبل', 'Answer due')}</dt><dd><bdi>{fmtDateTime(tk.due_at, locale)}</bdi> {tk.overdue && <Badge tone="danger">{tx('متأخرة', 'Overdue')}</Badge>}</dd>
          <dt>{tx('سجّلها', 'Logged by')}</dt><dd>{tk.created_by ? pick(tk, 'created_by') : tx('المريض من حسابه', 'The patient, online')} · <bdi>{fmtDateTime(tk.created_at, locale)}</bdi></dd>
        </dl>
        {data.can.manage && active && (
          <div className="form-grid">
            <SelectField label={tx('مكلّف بالمتابعة', 'Assigned to')} value={tk.assigned_to || ''} placeholder={tx('غير مكلّف', 'Nobody')}
              onChange={(e) => update(e.target.value ? { assigned_to: e.target.value } : { unassign: true }, tx('تم التكليف.', 'Assigned.'))}
              options={(staff.data || []).map((s) => ({ value: s.id, label: `${pick(s, 'full_name')} — ${pick(s, 'roles')}` }))} />
            <SelectField label={tx('الأولوية', 'Priority')} value={tk.priority} onChange={(e) => update({ priority: e.target.value }, tx('تغيّرت الأولوية والمهلة.', 'Priority and deadline changed.'))} options={opts(PRIORITY, lang)} />
          </div>
        )}
        {!data.can.manage && <p className="muted">{tx('مكلّف:', 'Assigned to:')} {tk.assigned_to ? pick(tk, 'assignee_name') : tx('لم يُكلَّف أحد بعد', 'nobody yet')}</p>}

        {tk.resolution && !resolving && <Alert tone="success" title={tx('الحل:', 'Resolution:')}><span dir="auto">{tk.resolution}</span></Alert>}

        {data.can.resolve && !resolving && (
          <div className="appt-actions">
            {tk.status === 'open' && <Button variant="ghost" icon="clock" loading={busy} onClick={() => update({ status: 'in_progress' }, tx('بدأت المتابعة.', 'Marked in progress.'))}>{tx('بدء المتابعة', 'Start working on it')}</Button>}
            {active && <Button icon="checkCircle" onClick={() => setResolving('resolved')}>{tx('تم الحل', 'Resolve')}</Button>}
            {tk.status === 'resolved' && data.can.manage && <Button variant="ghost" icon="lock" loading={busy} onClick={() => update({ status: 'closed' }, tx('أُغلقت.', 'Closed.'))}>{tx('إغلاق', 'Close')}</Button>}
            {['resolved', 'closed'].includes(tk.status) && data.can.manage && <Button variant="quiet" icon="refresh" loading={busy} onClick={() => update({ status: 'open' }, tx('أُعيد فتحها.', 'Reopened.'))}>{tx('إعادة فتح', 'Reopen')}</Button>}
          </div>
        )}
        {resolving && (
          <section className="card card-pad form">
            <TextArea label={tx('ماذا تم؟ (يراه المريض)', 'What was done? (the patient sees this)')} value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} data-autofocus />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button icon="checkCircle" loading={busy} disabled={resolution.trim().length < 5} onClick={() => update({ status: 'resolved', resolution: resolution.trim() }, tx('سُجّل الحل.', 'Resolved.'))}>{tx('تسجيل الحل', 'Save resolution')}</Button>
              <Button variant="ghost" onClick={() => setResolving(null)}>{t('back')}</Button>
            </div>
          </section>
        )}

        <div>
          <h3 className="schedule-title">{tx('المتابعة', 'Follow-up')}</h3>
          <ul className="feed">
            {data.events.map((e) => (
              <li key={e.id}>
                <span className="dot"><Icon name={e.action === 'comment' ? 'edit' : e.action === 'assigned' ? 'user' : 'clock'} size={15} /></span>
                <span>{eventText(e)}{e.body && <span className="feed-body" dir="auto">{e.body}</span>}<small>{e.actor_label || tx('المريض', 'Patient')} · <bdi>{fmtDateTime(e.at, locale)}</bdi></small></span>
              </li>
            ))}
          </ul>
          <div className="comment-box">
            <TextArea label={tx('إضافة تعليق داخلي', 'Add an internal comment')} value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
              hint={tx('لا يراه المريض.', "The patient doesn't see it.")} />
            <Button variant="ghost" icon="plus" loading={busy} disabled={!comment.trim()} onClick={() => update({ comment: comment.trim() }, tx('أُضيف التعليق.', 'Comment added.'))}>{tx('إضافة', 'Add')}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// The complaints & requests desk: everything logged, who follows it, and what's late.
export default function ComplaintsDesk() {
  const { tx, lang, pick, locale } = useI18n()
  const { complaints, can } = useClinical()
  const [params, setParams] = useSearchParams()
  const manager = can('complaints.manage')
  const [state, setState] = useState('open')
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const term = useDebounced(q, 300)
  const open = params.get('open')
  const { data, error, loading, reload } = useAsync(() => complaints.list({ state, kind, q: term }), [state, kind, term, complaints])
  const c = data?.counts || {}
  const tabs = [
    ['open', tx('مفتوحة', 'Open'), c.open], ['overdue', tx('متأخرة', 'Overdue'), c.overdue], ...(manager ? [['unassigned', tx('بدون تكليف', 'Unassigned'), c.unassigned]] : []),
    ['mine', tx('مكلّف بها أنا', 'Assigned to me'), c.mine], ['done', tx('تم حلها', 'Resolved')], ['', tx('الكل', 'All')],
  ]

  return (
    <div className="page reveal">
      <PageHeader eyebrow={tx('علاقات المرضى', 'Patient relations')} title={tx('الشكاوى والطلبات', 'Complaints & requests')}
        description={manager ? tx('كل شكوى أو طلب يُسجَّل ويُكلَّف به شخص ويُرد عليه قبل مهلة الأولوية، ويبقى سجلّه كاملًا.',
          'Every complaint or request is logged, assigned, answered before its priority deadline, and its history is kept.')
          : tx('سجّل ما يقوله المريض؛ فريق علاقات المرضى يتابع ويرد.', 'Log what the patient tells you; the patient relations team follows up.')}
        actions={<Button icon="plus" onClick={() => setCreating(true)}>{tx('تسجيل شكوى أو طلب', 'Log a complaint or request')}</Button>} />
      <div className="stats">
        <div className="stat feature"><div className="stat-label"><Icon name="inbox" size={17} />{tx('مفتوحة', 'Open')}</div><div className="stat-value num">{c.open ?? '—'}</div></div>
        <div className={`stat ${c.overdue ? 'attention' : ''}`}><div className="stat-label"><Icon name="alert" size={17} />{tx('تجاوزت المهلة', 'Past deadline')}</div><div className="stat-value num">{c.overdue ?? '—'}</div></div>
        {manager && <div className="stat"><div className="stat-label"><Icon name="user" size={17} />{tx('بدون تكليف', 'Unassigned')}</div><div className="stat-value num">{c.unassigned ?? '—'}</div></div>}
        <div className="stat"><div className="stat-label"><Icon name="checkCircle" size={17} />{tx('حُلّت هذا الأسبوع', 'Resolved this week')}</div><div className="stat-value num">{c.resolved_week ?? '—'}</div></div>
      </div>
      <section className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <div className="tabs" role="tablist">
            {tabs.map(([k, l, n]) => <button key={k} type="button" role="tab" aria-selected={state === k} onClick={() => setState(k)}>{l}{n > 0 && <span className="muted num"> ({n})</span>}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label={tx('النوع', 'Kind')}>
              <option value="">{tx('كل الأنواع', 'All kinds')}</option>
              {Object.entries(TICKET_KIND).map(([k, l]) => <option key={k} value={k}>{l[lang]}</option>)}
            </select>
            <div className="input-wrap" style={{ minWidth: 200 }}>
              <span className="input-start"><Icon name="search" size={18} /></span>
              <input className="input has-start" value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx('بحث', 'Search')} placeholder={tx('بحث…', 'Search…')} />
            </div>
          </div>
        </div>
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={5} cols={4} /> : !data.items.length ? (
          <EmptyState icon="checkCircle" title={tx('لا يوجد شيء هنا', 'Nothing here')} />
        ) : (
          <ul className="ticket-list">
            {data.items.map((tk) => (
              <li key={tk.id} className={`prio-${tk.priority} ${tk.overdue ? 'overdue' : ''}`}>
                <button type="button" onClick={() => setParams({ open: tk.id })}>
                  <span className="ticket-kind"><Icon name={TICKET_KIND[tk.kind].icon} size={18} /></span>
                  <span className="ticket-main">
                    <strong dir="auto">{tk.subject}</strong>
                    <small>{tk.patient_id ? pick(tk, 'patient_name') : tk.contact_name} · {CATEGORY[tk.category][lang]} · {CHANNEL[tk.channel][lang]} · <span className="mrn">{tk.ref}</span></small>
                  </span>
                  <span className="ticket-meta">
                    <TicketBadge status={tk.status} />
                    {['open', 'in_progress'].includes(tk.status) && (
                      <small className={tk.overdue ? 'danger-text' : 'muted'}>{tk.overdue ? tx('متأخرة ', 'late ') : tx('الرد ', 'due ')}{fmtRelative(tk.due_at, locale)}</small>
                    )}
                    <small className="muted">{tk.assigned_to ? pick(tk, 'assignee_name') : tx('غير مكلّف', 'Unassigned')}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {creating && <NewTicket onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); reload(); setParams({ open: id }) }} />}
      {open && <TicketModal id={open} onClose={() => setParams({})} onChanged={reload} />}
    </div>
  )
}
