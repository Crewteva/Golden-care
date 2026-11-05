import { useRef, useState } from 'react'
import Button from '../Button'
import Icon from '../Icon'
import Modal from '../Modal'
import { SelectField, TextArea, TextField } from '../Fields'
import { Alert, Badge, EmptyState, ErrorState, SkeletonRows } from '../ui'
import { useToast } from '../Toast'
import { useAsync } from '../useAsync'
import { useI18n } from '../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../lib/errors'
import { fmtDateTime } from '../../lib/format'
import { CATEGORIES, NEEDS_REVIEW, RELEASABLE, fileSize } from './meta'
import { useWorkspace } from './useWorkspace'

const MAX_MB = 15
const TYPES = ['application/pdf', 'image/jpeg', 'image/png']

export function UploadModal({ patientId, open, onClose, onDone }) {
  const { t, tx, lang } = useI18n()
  const { api, canUpload } = useWorkspace()
  const toast = useToast()
  const allowed = Object.entries(CATEGORIES).filter(([, c]) => canUpload(null, c.admin))
  const [category, setCategory] = useState(allowed[0]?.[0] || '')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(null)
  const [over, setOver] = useState(false)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const pickFile = (f) => {
    if (!f) return
    const e = {}
    if (!TYPES.includes(f.type)) e.file = t('field.unsupported_type')
    else if (f.size > MAX_MB * 1024 * 1024) e.file = t('field.too_large')
    setErrors(e)
    setFile(e.file ? null : f)
    if (!e.file && !title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 120))
  }
  const close = () => { setFile(null); setTitle(''); setErrors({}); onClose() }

  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (!file) e.file = t('field.required')
    if (title.trim().length < 2) e.title = t('field.required')
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      await api.upload(patientId, { category, title: title.trim(), file })
      toast.success(NEEDS_REVIEW.includes(category)
        ? tx('رُفع المستند وينتظر مراجعة الطبيب.', 'Uploaded. It now waits for a doctor to review.')
        : tx('رُفع المستند.', 'Document uploaded.'))
      close()
      onDone()
    } catch (err) {
      setErrors(fieldErrors(err, t))
      if (!err.fields || !Object.keys(err.fields).length) toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} busy={busy} title={tx('رفع مستند', 'Upload a document')}
      description={tx('PDF أو JPG أو PNG حتى ١٥ ميجابايت. يُحفظ في تخزين خاص ولا يُفتح إلا من النظام.', 'PDF, JPG or PNG up to 15 MB. Stored privately; only opened through the system.')}
      footer={<><Button variant="ghost" onClick={close} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="upload-form" loading={busy} icon="inbox">{tx('رفع', 'Upload')}</Button></>}>
      <form id="upload-form" className="form" onSubmit={submit} noValidate>
        <SelectField label={tx('نوع المستند', 'Document type')} value={category} onChange={(e) => setCategory(e.target.value)}
          options={allowed.map(([k, c]) => ({ value: k, label: c[lang] }))}
          hint={NEEDS_REVIEW.includes(category) ? tx('النتائج والتقارير تنتظر مراجعة الطبيب قبل أن يراها المريض.', 'Results and reports wait for a doctor before the patient can see them.') : undefined} />
        <div className="field">
          <div className={`dropzone ${over ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files[0]) }}>
            <Icon name="inbox" size={28} />
            <strong>{tx('اسحب الملف هنا أو اضغط للاختيار', 'Drop the file here or click to choose')}</strong>
            <span style={{ fontSize: '.82rem' }}>PDF · JPG · PNG — {tx('حتى ١٥ ميجابايت', 'up to 15 MB')}</span>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" aria-label={tx('اختر ملفًا', 'Choose a file')}
              onChange={(e) => pickFile(e.target.files[0])} />
          </div>
          {file && (
            <div className="picked">
              <Icon name={file.type === 'application/pdf' ? 'fileSearch' : 'eye'} size={18} />
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{file.name}</span>
              <span className="muted">{fileSize(file.size)}</span>
            </div>
          )}
          {errors.file && <p className="field-error" role="alert"><Icon name="alert" size={14} />{errors.file}</p>}
        </div>
        <TextField label={tx('العنوان', 'Title')} value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} maxLength={120}
          placeholder={tx('مثال: صورة دم كاملة — معمل المختبر', 'e.g. CBC — Al Mokhtabar lab')} />
      </form>
    </Modal>
  )
}

export function ReviewModal({ file, patientId, onClose, onDone }) {
  const { t, tx, lang, pick } = useI18n()
  const { api } = useWorkspace()
  const toast = useToast()
  const pending = file?.review_status === 'pending'
  const canRelease = file && RELEASABLE.includes(file.category) && !file.released_at
  const [decision, setDecision] = useState(canRelease ? 'release' : 'internal')
  const [patientNote, setPatientNote] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  if (!file) return null

  const submit = async (event) => {
    event.preventDefault()
    if (decision === 'release' && patientNote.trim().length < 5) {
      setErrors({ patient_note: t('field.patient_note.required') })
      return
    }
    setBusy(true)
    try {
      await api.review(patientId, file.id, { decision, patient_note: patientNote.trim() || null, internal_note: internalNote.trim() || null })
      toast.success(decision === 'release' ? tx('أصبح المستند متاحًا للمريض في حسابه.', 'The patient can now see it in their account.') : tx('تمت المراجعة، ويبقى داخليًا.', 'Reviewed and kept internal.'))
      onDone()
    } catch (err) {
      setErrors(fieldErrors(err, t))
      if (!err.fields || !Object.keys(err.fields).length) toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} busy={busy} wide title={pending ? tx('مراجعة المستند', 'Review document') : tx('إتاحة للمريض', 'Release to patient')}
      description={`${CATEGORIES[file.category][lang]} · ${file.title}${file.patient ? ` · ${pick(file.patient, 'full_name')}` : ''}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button><Button type="submit" form="review-form" loading={busy} icon="check">{t('confirm')}</Button></>}>
      <form id="review-form" className="form" onSubmit={submit} noValidate>
        <a className="btn btn-ghost btn-sm" href={api.fileUrl(patientId, file.id)} target="_blank" rel="noopener noreferrer" style={{ justifySelf: 'start' }}>
          <Icon name="eye" size={16} />{tx('افتح المستند لقراءته', 'Open the document to read it')}
        </a>
        <div className="decision" role="radiogroup" aria-label={tx('القرار', 'Decision')}>
          {canRelease && (
            <label>
              <input type="radio" name="decision" checked={decision === 'release'} onChange={() => setDecision('release')} />
              <span>
                <strong>{tx('إتاحة للمريض مع شرح مبسّط', 'Release to the patient with a simple note')}</strong>
                <small>{tx('يظهر في حسابه مع ملاحظتك. لا تظهر الملاحظات الداخلية أبدًا.', 'Appears in their account with your note. Internal notes are never shown.')}</small>
              </span>
            </label>
          )}
          {pending && (
            <label>
              <input type="radio" name="decision" checked={decision === 'internal'} onChange={() => setDecision('internal')} />
              <span>
                <strong>{tx('تمت المراجعة، يبقى داخليًا', 'Reviewed — keep internal')}</strong>
                <small>{tx('يراه الفريق الطبي فقط.', 'Only the medical team can see it.')}</small>
              </span>
            </label>
          )}
        </div>
        {decision === 'release' && (
          <TextArea label={tx('ملاحظة للمريض (بكلمات بسيطة)', 'Note for the patient (plain words)')} value={patientNote}
            onChange={(e) => setPatientNote(e.target.value)} error={errors.patient_note} maxLength={600}
            placeholder={tx('مثال: نتيجة التحليل طبيعية ولا تحتاج أي إجراء.', 'e.g. Your result is normal; nothing needs to be done.')} />
        )}
        <TextArea label={tx('ملاحظة داخلية للفريق', 'Internal note for the team')} optional value={internalNote}
          onChange={(e) => setInternalNote(e.target.value)} maxLength={1000} />
      </form>
    </Modal>
  )
}

function statusBadges(f, tx) {
  const out = []
  if (f.voided_at) out.push(<Badge key="v" tone="danger">{tx('ملغى', 'Voided')}</Badge>)
  else {
    if (f.review_status === 'pending') out.push(<Badge key="p" tone="gold">{tx('بانتظار مراجعة الطبيب', 'Awaiting doctor review')}</Badge>)
    if (f.review_status === 'reviewed' && !f.released_at) out.push(<Badge key="r" tone="neutral">{tx('تمت المراجعة · داخلي', 'Reviewed · internal')}</Badge>)
    if (f.released_at) out.push(<Badge key="s" tone="success">{tx('متاح للمريض', 'Visible to patient')}</Badge>)
    if (f.category === 'consent') out.push(<Badge key="c" tone="info">{tx('يراه المريض', 'Patient can see')}</Badge>)
  }
  return out
}

// Documents tab of the patient file.
export default function Documents({ patientId, onCounts }) {
  const { t, tx, lang, pick, locale } = useI18n()
  const { api, can, canUpload } = useWorkspace()
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(() => api.files(patientId), [patientId, api])
  const [filter, setFilter] = useState('all')
  const [uploading, setUploading] = useState(false)
  const [reviewing, setReviewing] = useState(null)
  const [voiding, setVoiding] = useState(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(null)
  const [busy, setBusy] = useState(false)
  const canAnyUpload = can('patient_files.upload_admin') || can('patient_files.upload_clinical')
  const refreshed = useRef(onCounts)
  refreshed.current = onCounts

  const after = () => { reload(); refreshed.current?.() }

  const voidFile = async (event) => {
    event.preventDefault()
    if (reason.trim().length < 3) {
      setReasonError(t('field.required'))
      return
    }
    setBusy(true)
    try {
      await api.voidFile(patientId, voiding.id, reason.trim())
      toast.success(tx('أُلغي المستند وحُفظ السبب.', 'Document voided; the reason was kept.'))
      setVoiding(null)
      setReason('')
      after()
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  const items = (data?.items || []).filter((f) => {
    if (filter === 'pending') return f.review_status === 'pending' && !f.voided_at
    if (filter === 'released') return f.released_at && !f.voided_at
    if (filter === 'admin') return CATEGORIES[f.category].admin
    return true
  })
  const tabs = [
    ['all', t('all')],
    ['pending', tx('بانتظار المراجعة', 'Awaiting review')],
    ['released', tx('متاح للمريض', 'Released')],
    ['admin', tx('هويات وإقرارات', 'IDs & consents')],
  ]

  return (
    <section className="card">
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <div className="tabs" role="tablist" aria-label={tx('تصفية المستندات', 'Filter documents')}>
          {tabs.map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={filter === v} onClick={() => setFilter(v)}>{l}</button>)}
        </div>
        {canAnyUpload && <Button icon="plus" onClick={() => setUploading(true)}>{tx('رفع مستند', 'Upload document')}</Button>}
      </div>
      {data?.hidden > 0 && (
        <div style={{ padding: '14px 20px 0' }}>
          <Alert tone="info" icon="lock">
            {tx(`يوجد ${data.hidden} مستند طبي لا يملك دورك صلاحية فتحه.`, `${data.hidden} medical document(s) are hidden from your role.`)}
          </Alert>
        </div>
      )}
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows rows={4} cols={3} />
      ) : !items.length ? (
        <EmptyState icon="inbox" title={tx('لا توجد مستندات هنا', 'No documents here')}
          action={canAnyUpload && filter === 'all' ? <Button variant="ghost" icon="plus" onClick={() => setUploading(true)}>{tx('رفع أول مستند', 'Upload the first document')}</Button> : null}>
          {tx('ارفع التحاليل والتقارير والصور والإقرارات الموقعة.', 'Upload lab results, reports, photos and signed consents.')}
        </EmptyState>
      ) : (
        <ul className="doc-list">
          {items.map((f) => {
            const meta = CATEGORIES[f.category]
            const canReview = can('patient_files.review') && !f.voided_at &&
              (f.review_status === 'pending' || (RELEASABLE.includes(f.category) && !f.released_at))
            return (
              <li key={f.id} className={`doc ${f.voided_at ? 'voided' : ''}`}>
                <span className={`doc-ico ${f.review_status === 'pending' && !f.voided_at ? 'pending' : meta.admin ? '' : 'clinical'}`}>
                  <Icon name={meta.icon} size={20} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="doc-title">{f.title}</div>
                  <div className="doc-meta">
                    {meta[lang]} · {pick(f, 'uploaded_by')} · <bdi>{fmtDateTime(f.uploaded_at, locale)}</bdi> · {fileSize(f.size_bytes)}
                  </div>
                  <div className="doc-badges">{statusBadges(f, tx)}</div>
                  {f.released_at && f.patient_note && (
                    <div className="doc-note">
                      <small>{tx('ملاحظة للمريض', 'Note to patient')} · {pick(f, 'released_by')}</small>
                      {f.patient_note}
                    </div>
                  )}
                  {f.internal_note && (
                    <div className="doc-note internal">
                      <small>{tx('ملاحظة داخلية', 'Internal note')}{f.reviewed_by_en ? ` · ${pick(f, 'reviewed_by')}` : ''}</small>
                      {f.internal_note}
                    </div>
                  )}
                  {f.voided_at && <div className="doc-meta" style={{ marginTop: 6 }}>{tx('سبب الإلغاء:', 'Void reason:')} {f.void_reason}</div>}
                </div>
                <div className="doc-actions">
                  <a className="btn btn-ghost btn-sm" href={api.fileUrl(patientId, f.id)} target="_blank" rel="noopener noreferrer">
                    <Icon name="eye" size={16} />{tx('فتح', 'Open')}
                  </a>
                  {canReview && (
                    <Button size="sm" icon={f.review_status === 'pending' ? 'check' : 'sparkle'} onClick={() => setReviewing(f)}>
                      {f.review_status === 'pending' ? tx('مراجعة', 'Review') : tx('إتاحة للمريض', 'Release')}
                    </Button>
                  )}
                  {!f.voided_at && canUpload(null, meta.admin) && (
                    <Button variant="quiet" size="sm" className="btn-icon" aria-label={tx('إلغاء المستند', 'Void document')}
                      onClick={() => { setReasonError(null); setVoiding(f) }}>
                      <Icon name="x" size={16} />
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {uploading && <UploadModal patientId={patientId} open onClose={() => setUploading(false)} onDone={after} />}
      {reviewing && (
        <ReviewModal file={reviewing} patientId={patientId} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); after() }} />
      )}
      <Modal open={Boolean(voiding)} onClose={() => setVoiding(null)} busy={busy} title={tx('إلغاء المستند', 'Void document')}
        description={voiding ? `${voiding.title}. ${tx('لا يُحذف شيء؛ يُعلَّم كملغى ويختفي من حساب المريض.', 'Nothing is deleted; it is marked void and hidden from the patient.')}` : ''}
        footer={<><Button variant="ghost" onClick={() => setVoiding(null)} disabled={busy}>{t('cancel')}</Button><Button variant="danger" type="submit" form="void-form" loading={busy}>{tx('إلغاء المستند', 'Void')}</Button></>}>
        <form id="void-form" onSubmit={voidFile} noValidate>
          <TextArea label={tx('السبب', 'Reason')} value={reason} onChange={(e) => setReason(e.target.value)} error={reasonError}
            placeholder={tx('مثال: رُفع في ملف المريض الخطأ', 'e.g. Uploaded to the wrong patient')} data-autofocus />
        </form>
      </Modal>
    </section>
  )
}
