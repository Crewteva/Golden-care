import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../../../components/Button'
import Icon from '../../../components/Icon'
import { Checkbox, TextArea } from '../../../components/Fields'
import { Alert, Avatar, PageHeader } from '../../../components/ui'
import { useToast } from '../../../components/Toast'
import { useDebounced } from '../../../components/useAsync'
import DuplicatePanel from '../../../components/patients/DuplicatePanel'
import PatientForm, { EMPTY_PATIENT, formToBody, validatePatient } from '../../../components/patients/PatientForm'
import { RELATIONSHIPS } from '../../../components/patients/meta'
import { useWorkspace } from '../../../components/patients/useWorkspace'
import { useI18n } from '../../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../../lib/errors'
import { nidDigits } from '../../../lib/nationalId'

// Reception opens a new patient file. Possible duplicates show live; a family link lets relatives share a mobile.
export default function NewPatient() {
  const { t, tx, lang, pick } = useI18n()
  const { api, patientsBase } = useWorkspace()
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [form, setForm] = useState(EMPTY_PATIENT)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [checking, setChecking] = useState(false)
  const [link, setLink] = useState(null)
  const [needReason, setNeedReason] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  // Opened from a parent's file ("Register a child"): link the guardian and copy the address.
  useEffect(() => {
    const guardian = params.get('guardian')
    if (!guardian) return
    api.get(guardian).then(({ patient }) => {
      setLink({ relative: patient, relationship: 'parent', is_guardian: true })
      setForm((f) => ({ ...f, area: patient.area || '', address: patient.address || '' }))
    }).catch(() => {})
  }, [params, api])

  const probe = useDebounced(
    JSON.stringify({ n: form.full_name_ar, e: form.full_name_en, d: form.date_of_birth, p: form.phone, i: nidDigits(form.national_id) }), 400,
  )
  useEffect(() => {
    const { n, e, d, p, i } = JSON.parse(probe)
    const enough = (n.trim().length >= 3 && d) || p.replace(/\D/g, '').length >= 10 || i.length === 14 || n.trim().length >= 8
    if (!enough) {
      setCandidates([])
      return undefined
    }
    let alive = true
    setChecking(true)
    api.checkDuplicates({ full_name_ar: n, full_name_en: e || null, date_of_birth: d || null, phone: p || null, national_id: i || null })
      .then((rows) => alive && setCandidates(rows))
      .catch(() => {})
      .finally(() => alive && setChecking(false))
    return () => { alive = false }
  }, [probe, api])

  const linkAsFamily = (patient) =>
    setLink({ relative: patient, relationship: 'spouse', is_guardian: false })

  const submit = async (event) => {
    event.preventDefault()
    const e = validatePatient(form, t, { phoneOptional: Boolean(link?.is_guardian) })
    if (needReason && reason.trim().length < 5) e.duplicate_reason = tx('اكتب لماذا هذا شخص مختلف (٥ أحرف على الأقل).', 'Explain why this is a different person (at least 5 characters).')
    setErrors(e)
    setFormError(null)
    if (Object.keys(e).length) {
      document.querySelector('[aria-invalid="true"]')?.focus()
      return
    }
    setBusy(true)
    try {
      const body = {
        ...formToBody(form),
        family_link: link ? { relative_id: link.relative.id, relationship: link.relationship, is_guardian: link.is_guardian } : null,
        duplicate_reason: needReason ? reason.trim() : null,
      }
      const created = await api.create(body)
      toast.success(tx(`تم فتح الملف ${created.mrn}.`, `File ${created.mrn} opened.`))
      navigate(`${patientsBase}/${created.id}`, { replace: true })
    } catch (err) {
      if (err.data?.candidates) setCandidates(err.data.candidates)
      if (err.code === 'possible_duplicates') {
        setNeedReason(true)
        setFormError(tx('وجدنا ملفًا قد يكون لنفس الشخص. افتحه إن كان هو، أو اكتب سبب فتح ملف جديد.', 'We found a file that may be the same person. Open it if so, or give a reason to open a new one.'))
      } else {
        setErrors(fieldErrors(err, t))
        setFormError(errorText(err, t))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page reveal">
      <PageHeader
        back={<Link to={patientsBase} className="back-link"><Icon name="arrowLeft" size={16} />{tx('ملفات المرضى', 'Patient files')}</Link>}
        eyebrow={tx('الاستقبال', 'Reception')}
        title={tx('فتح ملف مريض جديد', 'Open a new patient file')}
        description={tx('قبل الحفظ، راجع الملفات المقترحة على الجانب حتى لا يكون للمريض ملفان.', 'Before saving, check the suggested files on the side so no patient ends up with two files.')}
      />
      <form className="split" onSubmit={submit} noValidate>
        <section className="card card-pad" style={{ display: 'grid', gap: 20 }}>
          {formError && <Alert tone={needReason ? 'warn' : 'danger'}>{formError}</Alert>}
          <PatientForm value={form} onChange={setForm} errors={errors} phoneOptional={Boolean(link?.is_guardian)} />
          {needReason && (
            <TextArea label={tx('لماذا هذا شخص مختلف؟', 'Why is this a different person?')} value={reason} onChange={(e) => setReason(e.target.value)}
              error={errors.duplicate_reason} placeholder={tx('مثال: تشابه أسماء، والمريض أكد أنه لم يزر العيادة من قبل', 'e.g. Same name; the patient confirmed they never visited before')} />
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button type="submit" size="lg" loading={busy} icon="userPlus">{tx('فتح الملف', 'Open file')}</Button>
            <Link to={patientsBase} className="btn btn-ghost btn-lg">{t('cancel')}</Link>
          </div>
        </section>

        <aside className="sticky-side">
          {link && (
            <section className="card">
              <div className="card-head">
                <h2>{tx('مرتبط بالعائلة', 'Family link')}</h2>
                <Button variant="quiet" size="sm" icon="x" onClick={() => setLink(null)}>{tx('إزالة', 'Remove')}</Button>
              </div>
              <div className="card-body form">
                <div className="person">
                  <Avatar name={pick(link.relative, 'full_name')} />
                  <div>
                    <strong style={{ fontWeight: 500 }}>{pick(link.relative, 'full_name')}</strong>
                    <small className="muted mrn" style={{ display: 'block' }}>{link.relative.mrn}</small>
                  </div>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="link-rel">{tx('صلته بالمريض الجديد', 'Who they are to the new patient')}</label>
                  <select id="link-rel" className="select" value={link.relationship}
                    onChange={(e) => setLink({ ...link, relationship: e.target.value, is_guardian: e.target.value === 'parent' ? link.is_guardian : false })}>
                    {Object.entries(RELATIONSHIPS).map(([k, v]) => <option key={k} value={k}>{v[lang]}</option>)}
                  </select>
                </div>
                {link.relationship === 'parent' && (
                  <Checkbox checked={link.is_guardian} onChange={(e) => setLink({ ...link, is_guardian: e.target.checked })}
                    label={tx('ولي الأمر: يدير ملف المريض ويتابعه من حسابه', 'Guardian: manages this file and follows it from their account')} />
                )}
              </div>
            </section>
          )}
          <DuplicatePanel candidates={candidates} checking={checking} linkedId={link?.relative.id} onLink={linkAsFamily} patientsBase={patientsBase} />
        </aside>
      </form>
    </div>
  )
}
