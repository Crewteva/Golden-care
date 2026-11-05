import { useState } from 'react'
import Button from '../../../components/Button'
import Modal from '../../../components/Modal'
import { Checkbox, TextField } from '../../../components/Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../../components/ui'
import { useToast } from '../../../components/Toast'
import { useAsync } from '../../../components/useAsync'
import { adminApi } from '../../../api/admin'
import { useAuth } from '../../../auth/AuthContext'
import { useI18n } from '../../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../../lib/errors'

const EMPTY = { code: '', name_ar: '', name_en: '', address_ar: '', address_en: '', phone: '', is_active: true }

function BranchForm({ branch, onClose, onSaved }) {
  const { t, tx } = useI18n()
  const toast = useToast()
  const [form, setForm] = useState(branch ? { ...EMPTY, ...branch, address_ar: branch.address_ar || '', address_en: branch.address_en || '', phone: branch.phone || '' } : EMPTY)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (!/^[A-Za-z]{2,6}$/.test(form.code.trim())) e.code = tx('من ٢ إلى ٦ حروف إنجليزية، مثل SHR.', '2 to 6 English letters, e.g. SHR.')
    if (form.name_ar.trim().length < 2) e.name_ar = t('field.required')
    if (form.name_en.trim().length < 2) e.name_en = t('field.required')
    setErrors(e)
    setFormError(null)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const body = {
        code: form.code.trim().toUpperCase(),
        name_ar: form.name_ar,
        name_en: form.name_en,
        address_ar: form.address_ar || null,
        address_en: form.address_en || null,
        phone: form.phone || null,
        is_active: form.is_active,
      }
      if (branch) await adminApi.updateBranch(branch.id, body)
      else await adminApi.createBranch(body)
      toast.success(branch ? tx('تم حفظ الفرع.', 'Branch saved.') : tx('تمت إضافة الفرع.', 'Branch added.'))
      onSaved()
    } catch (err) {
      setErrors(fieldErrors(err, t))
      setFormError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      busy={busy}
      title={branch ? tx('تعديل الفرع', 'Edit branch') : tx('إضافة فرع', 'Add a branch')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
          <Button type="submit" form="branch-form" loading={busy}>{t('save')}</Button>
        </>
      }
    >
      <form id="branch-form" className="form" onSubmit={submit} noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="form-grid">
          <TextField label={tx('رمز الفرع', 'Branch code')} hint={tx('يظهر في التقارير والأرقام المرجعية', 'Used in reports and reference numbers')}
            value={form.code} onChange={set('code')} error={errors.code} dir="ltr" maxLength={6} style={{ textTransform: 'uppercase' }} data-autofocus />
          <TextField label={tx('هاتف الفرع', 'Branch phone')} optional value={form.phone} onChange={set('phone')} error={errors.phone} dir="ltr" type="tel" />
          <TextField label={tx('الاسم بالعربية', 'Name in Arabic')} value={form.name_ar} onChange={set('name_ar')} error={errors.name_ar} dir="rtl" />
          <TextField label={tx('الاسم بالإنجليزية', 'Name in English')} value={form.name_en} onChange={set('name_en')} error={errors.name_en} dir="ltr" />
          <TextField label={tx('العنوان بالعربية', 'Address in Arabic')} optional value={form.address_ar} onChange={set('address_ar')} dir="rtl" />
          <TextField label={tx('العنوان بالإنجليزية', 'Address in English')} optional value={form.address_en} onChange={set('address_en')} dir="ltr" />
        </div>
        {branch && (
          <Checkbox label={tx('الفرع نشط', 'Branch is active')} description={tx('الفروع غير النشطة لا يمكن إسنادها لموظفين جدد.', "Inactive branches can't be assigned to staff.")}
            checked={form.is_active} onChange={set('is_active')} />
        )}
      </form>
    </Modal>
  )
}

export default function Branches() {
  const { can } = useAuth()
  const { tx, pick } = useI18n()
  const { data, error, loading, reload } = useAsync(() => adminApi.branches(), [])
  const [editing, setEditing] = useState(null)
  const editable = can('branches.manage')

  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('المؤسسة', 'Organisation')}
        title={tx('الفروع', 'Branches')}
        description={tx('كل دور يُسند لفرع محدد أو لكل الفروع، فيرى الموظف بيانات فرعه فقط.', 'Each role is given for one branch or all branches, so people see only their branch’s data.')}
        actions={editable && <Button icon="plus" variant="gold" onClick={() => setEditing('new')}>{tx('إضافة فرع', 'Add branch')}</Button>}
      />
      <section className="card">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <SkeletonRows rows={3} cols={4} />
        ) : !data.length ? (
          <EmptyState icon="building" title={tx('لا توجد فروع', 'No branches')} />
        ) : (
          <div className="table-wrap">
            <table className="table stack">
              <thead>
                <tr>
                  <th>{tx('الفرع', 'Branch')}</th>
                  <th>{tx('الرمز', 'Code')}</th>
                  <th>{tx('العنوان', 'Address')}</th>
                  <th>{tx('الموظفون', 'Staff')}</th>
                  <th>{tx('الحالة', 'Status')}</th>
                  <th><span className="sr-only">{tx('إجراءات', 'Actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {data.map((b) => (
                  <tr key={b.id}>
                    <td className="cell-main" style={{ fontWeight: 500 }}>{pick(b)}</td>
                    <td data-label={tx('الرمز', 'Code')} className="mono">{b.code}</td>
                    <td data-label={tx('العنوان', 'Address')} className="muted">{pick(b, 'address') || '—'}</td>
                    <td data-label={tx('الموظفون', 'Staff')} className="num">{b.staff}</td>
                    <td data-label={tx('الحالة', 'Status')}>
                      {b.is_active ? <Badge tone="success">{tx('نشط', 'Active')}</Badge> : <Badge tone="neutral">{tx('غير نشط', 'Inactive')}</Badge>}
                    </td>
                    <td style={{ textAlign: 'end' }}>
                      {editable && <Button variant="quiet" size="sm" icon="edit" onClick={() => setEditing(b)}>{tx('تعديل', 'Edit')}</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && (
        <BranchForm
          branch={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}
