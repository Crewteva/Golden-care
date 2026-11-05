import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../../components/Button'
import Modal from '../../../components/Modal'
import { SelectField, TextArea, TextField } from '../../../components/Fields'
import { Alert, Badge, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../../components/ui'
import { useToast } from '../../../components/Toast'
import { useAsync } from '../../../components/useAsync'
import { adminApi } from '../../../api/admin'
import { useAuth } from '../../../auth/AuthContext'
import { roleName } from '../../../auth/roles'
import { useI18n } from '../../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../../lib/errors'
import { fmtDateTime, toLocalInput } from '../../../lib/format'

const TONES = { active: 'success', scheduled: 'info', ended: 'neutral', revoked: 'danger' }

function CreateCover({ onClose, onSaved, branches }) {
  const { t, tx, lang, pick } = useI18n()
  const toast = useToast()
  const staff = useAsync(() => adminApi.staffOptions(), [])
  const now = new Date()
  const week = new Date(now.getTime() + 7 * 86400000)
  const [form, setForm] = useState({
    from_user_id: '',
    to_user_id: '',
    roleKey: '',
    starts_at: toLocalInput(now),
    ends_at: toLocalInput(week),
    reason: '',
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value, ...(key === 'from_user_id' ? { roleKey: '' } : {}) }))

  const people = staff.data || []
  const giver = people.find((p) => p.id === form.from_user_id)
  const branchName = (id) => (id ? pick(branches.find((b) => b.id === id) || {}) : t('all_branches'))
  const roleOptions = useMemo(
    () => (giver?.roles || []).map((r) => ({ value: `${r.role}|${r.branch_id ?? ''}`, label: `${roleName(r.role, lang)} · ${branchName(r.branch_id)}` })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [giver, lang, branches],
  )
  const personOptions = (exclude) =>
    people.filter((p) => p.id !== exclude).map((p) => ({ value: p.id, label: `${pick(p, 'full_name')} — ${p.email}` }))

  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (!form.from_user_id) e.from_user_id = t('field.required')
    if (!form.roleKey) e.role = t('field.required')
    if (!form.to_user_id) e.to_user_id = t('field.required')
    if (!form.starts_at) e.starts_at = t('field.required')
    if (!form.ends_at) e.ends_at = t('field.required')
    else if (form.starts_at && new Date(form.ends_at) <= new Date(form.starts_at)) e.ends_at = t('field.before_start')
    if (form.reason.trim().length < 5) e.reason = tx('اكتب سببًا واضحًا (٥ أحرف على الأقل).', 'Write a clear reason (at least 5 characters).')
    setErrors(e)
    setFormError(null)
    if (Object.keys(e).length) return
    const [role, branch] = form.roleKey.split('|')
    setBusy(true)
    try {
      await adminApi.createDelegation({
        from_user_id: form.from_user_id,
        to_user_id: form.to_user_id,
        role,
        branch_id: branch ? Number(branch) : null,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        reason: form.reason.trim(),
      })
      toast.success(tx('تم إنشاء التغطية المؤقتة.', 'Temporary cover created.'))
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
      title={tx('تغطية مؤقتة جديدة', 'New temporary cover')}
      description={tx(
        'يحصل الموظف البديل على صلاحيات الدور خلال الفترة المحددة فقط، ثم تُسحب تلقائيًا.',
        'The stand-in gets the role only during this period; it is removed automatically afterwards.',
      )}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
          <Button type="submit" form="cover-form" loading={busy} icon="swap">{tx('إنشاء التغطية', 'Create cover')}</Button>
        </>
      }
    >
      <form id="cover-form" className="form" onSubmit={submit} noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="form-grid">
          <SelectField label={tx('الموظف الغائب', 'Person away')} value={form.from_user_id} onChange={set('from_user_id')}
            error={errors.from_user_id} options={personOptions(null)} placeholder={staff.loading ? t('loading') : tx('اختر…', 'Choose…')} />
          <SelectField label={tx('الدور الذي سيُغطّى', 'Role to cover')} value={form.roleKey} onChange={set('roleKey')}
            error={errors.role} options={roleOptions} placeholder={giver ? tx('اختر الدور…', 'Choose role…') : tx('اختر الموظف أولًا', 'Choose the person first')} disabled={!giver} />
          <SelectField className="span-2" label={tx('الموظف البديل', 'Stand-in')} value={form.to_user_id} onChange={set('to_user_id')}
            error={errors.to_user_id} options={personOptions(form.from_user_id)} placeholder={tx('اختر…', 'Choose…')} />
          <TextField label={tx('من', 'From')} type="datetime-local" value={form.starts_at} onChange={set('starts_at')} error={errors.starts_at} />
          <TextField label={tx('إلى', 'Until')} type="datetime-local" value={form.ends_at} onChange={set('ends_at')} error={errors.ends_at}
            hint={tx('٩٠ يومًا كحد أقصى', '90 days at most')} />
          <TextArea className="span-2" label={tx('السبب', 'Reason')} value={form.reason} onChange={set('reason')} error={errors.reason}
            placeholder={tx('مثال: إجازة سنوية للدكتورة رانيا', 'e.g. Dr. Rania on annual leave')} />
        </div>
      </form>
    </Modal>
  )
}

export default function Delegations() {
  const { can } = useAuth()
  const { t, tx, lang, pick, locale } = useI18n()
  const toast = useToast()
  const [status, setStatus] = useState('')
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState(null)
  const [busy, setBusy] = useState(false)
  const list = useAsync(() => adminApi.delegations(status || undefined), [status])
  const branches = useAsync(() => adminApi.branches(), [])
  const editable = can('delegations.manage')
  const branchName = (id) => (id ? pick((branches.data || []).find((b) => b.id === id) || {}) : t('all_branches'))

  const revoke = async () => {
    setBusy(true)
    try {
      await adminApi.revokeDelegation(revoking.id)
      toast.success(tx('تم إلغاء التغطية.', 'Cover revoked.'))
      setRevoking(null)
      list.reload()
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  const tabs = [
    ['', t('all')],
    ['active', t('status.active')],
    ['scheduled', t('status.scheduled')],
    ['ended', t('status.ended')],
    ['revoked', t('status.revoked')],
  ]

  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('الحسابات', 'Accounts')}
        title={tx('التغطية المؤقتة', 'Temporary cover')}
        description={tx(
          'عندما يغيب موظف، أعِر دوره لزميل لفترة محددة بدلًا من مشاركة كلمة المرور. كل ما يفعله البديل يُسجَّل باسمه.',
          'When someone is away, lend their role to a colleague for a set period instead of sharing passwords. Everything the stand-in does is logged under their own name.',
        )}
        actions={editable && <Button icon="plus" variant="gold" onClick={() => setCreating(true)}>{tx('تغطية جديدة', 'New cover')}</Button>}
      />

      <div className="tabs" role="tablist" aria-label={t('status')}>
        {tabs.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={status === value} onClick={() => setStatus(value)}>
            {label}
          </button>
        ))}
      </div>

      <section className="card">
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <SkeletonRows rows={4} cols={5} />
        ) : !list.data.length ? (
          <EmptyState icon="swap" title={tx('لا توجد تغطيات', 'No cover here')}
            action={editable && !status ? <Button variant="ghost" icon="plus" onClick={() => setCreating(true)}>{tx('تغطية جديدة', 'New cover')}</Button> : null}>
            {tx('أنشئ تغطية عندما يكون أحد الموظفين في إجازة أو غائبًا.', 'Create cover when someone is on leave or away.')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table stack">
              <thead>
                <tr>
                  <th>{tx('من ← إلى', 'From → to')}</th>
                  <th>{tx('الدور', 'Role')}</th>
                  <th>{tx('الفترة', 'Period')}</th>
                  <th>{tx('السبب', 'Reason')}</th>
                  <th>{t('status')}</th>
                  <th><span className="sr-only">{t('actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((d) => (
                  <tr key={d.id}>
                    <td className="cell-main">
                      <Link to={`/dashboard/admin/users/${d.from_user_id}`} className="person-name">{pick(d, 'from_name')}</Link>
                      <span className="muted"> → </span>
                      <Link to={`/dashboard/admin/users/${d.to_user_id}`} className="person-name">{pick(d, 'to_name')}</Link>
                    </td>
                    <td data-label={tx('الدور', 'Role')}>
                      {roleName(d.role, lang)}
                      <small className="muted" style={{ display: 'block' }}>{branchName(d.branch_id)}</small>
                    </td>
                    <td data-label={tx('الفترة', 'Period')} className="num" style={{ fontSize: '.84rem' }}>
                      {fmtDateTime(d.starts_at, locale)}
                      <br />
                      {fmtDateTime(d.ends_at, locale)}
                    </td>
                    <td data-label={tx('السبب', 'Reason')} className="muted" style={{ maxWidth: 260 }}>{d.reason}</td>
                    <td data-label={t('status')}><Badge tone={TONES[d.status]}>{t(`status.${d.status}`)}</Badge></td>
                    <td style={{ textAlign: 'end' }}>
                      {editable && (d.status === 'active' || d.status === 'scheduled') && (
                        <Button variant="danger-ghost" size="sm" onClick={() => setRevoking(d)}>{tx('إلغاء', 'Revoke')}</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <CreateCover
          branches={branches.data || []}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            list.reload()
          }}
        />
      )}
      <Modal
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        busy={busy}
        title={tx('إلغاء التغطية؟', 'Revoke this cover?')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoking(null)} disabled={busy}>{t('cancel')}</Button>
            <Button variant="danger" loading={busy} onClick={revoke}>{tx('إلغاء التغطية', 'Revoke cover')}</Button>
          </>
        }
      >
        {revoking && (
          <p>
            {tx(
              `سيفقد ${pick(revoking, 'to_name')} دور «${roleName(revoking.role, lang)}» فورًا.`,
              `${pick(revoking, 'to_name')} will lose the “${roleName(revoking.role, lang)}” role immediately.`,
            )}
          </p>
        )}
      </Modal>
    </div>
  )
}
