import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../../../components/Button'
import Icon from '../../../components/Icon'
import Modal from '../../../components/Modal'
import { TextField } from '../../../components/Fields'
import {
  Alert, Avatar, Badge, EmptyState, ErrorState, PageHeader, Pagination, SkeletonRows, SortTh, StatusBadge,
} from '../../../components/ui'
import { useAsync, useDebounced } from '../../../components/useAsync'
import { adminApi } from '../../../api/admin'
import { useAuth } from '../../../auth/AuthContext'
import { STAFF_ROLES, roleName } from '../../../auth/roles'
import { useI18n } from '../../../i18n/I18nContext'
import { errorText, fieldErrors } from '../../../lib/errors'
import { fmtRelative } from '../../../lib/format'
import { RoleAssignments, TempPasswordNotice, validateAssignments } from './shared'

const BASE = '/dashboard/admin/users'

function CreateStaff({ open, onClose, branches, onCreated }) {
  const { t, tx } = useI18n()
  const navigate = useNavigate()
  const blank = () => ({
    full_name_ar: '',
    full_name_en: '',
    email: '',
    phone: '',
    roles: [{ role: '', branch_id: branches.find((b) => b.is_active)?.id ?? null }],
  })
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)

  useEffect(() => {
    if (open) {
      setForm(blank())
      setErrors({})
      setFormError(null)
      setCreated(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    const e = {}
    if (form.full_name_ar.trim().length < 2) e.full_name_ar = t('field.required')
    if (form.full_name_en.trim().length < 2) e.full_name_en = t('field.required')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(form.email.trim())) e.email = t('field.invalid')
    const rolesError = validateAssignments(form.roles, tx)
    if (rolesError) e.roles = rolesError
    setErrors(e)
    setFormError(null)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const result = await adminApi.createUser({ ...form, phone: form.phone.trim() || null })
      setCreated({ ...result, name: form.full_name_ar, email: form.email.trim().toLowerCase() })
      onCreated()
    } catch (err) {
      setErrors(fieldErrors(err, t))
      setFormError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={tx('تم إنشاء الحساب', 'Account created')}
        footer={
          <>
            <Button variant="ghost" onClick={() => navigate(`${BASE}/${created.id}`)}>
              {tx('فتح ملف الموظف', 'Open profile')}
            </Button>
            <Button onClick={onClose}>{tx('تم', 'Done')}</Button>
          </>
        }
      >
        <TempPasswordNotice password={created.temp_password} name={created.name} identifier={created.email} />
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      wide
      title={tx('إضافة موظف', 'Add a staff member')}
      description={tx('سيحصل على كلمة مرور مؤقتة يغيّرها عند أول دخول.', "They'll get a temporary password to change at first sign-in.")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="submit" form="create-staff" loading={busy} icon="userPlus">
            {tx('إنشاء الحساب', 'Create account')}
          </Button>
        </>
      }
    >
      <form id="create-staff" className="form" onSubmit={submit} noValidate>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="form-grid">
          <TextField label={tx('الاسم بالعربية', 'Name in Arabic')} value={form.full_name_ar} onChange={set('full_name_ar')}
            error={errors.full_name_ar} dir="rtl" lang="ar" data-autofocus />
          <TextField label={tx('الاسم بالإنجليزية', 'Name in English')} value={form.full_name_en} onChange={set('full_name_en')}
            error={errors.full_name_en} dir="ltr" lang="en" />
          <TextField label={tx('بريد العمل', 'Work e-mail')} hint={tx('يُستخدم لتسجيل الدخول', 'Used to sign in')} type="email"
            value={form.email} onChange={set('email')} error={errors.email} dir="ltr" icon="mail" />
          <TextField label={tx('الموبايل', 'Mobile')} optional type="tel" value={form.phone} onChange={set('phone')}
            error={errors.phone} dir="ltr" icon="smartphone" placeholder="01X XXXX XXXX" />
        </div>
        <RoleAssignments value={form.roles} onChange={(roles) => setForm((f) => ({ ...f, roles }))} branches={branches}
          error={errors.roles} />
      </form>
    </Modal>
  )
}

export default function Users() {
  const { can } = useAuth()
  const { t, tx, lang, pick, locale } = useI18n()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [branch, setBranch] = useState('')
  const [status, setStatus] = useState(params.get('status') || '')
  const [sort, setSort] = useState(lang === 'ar' ? 'name_ar' : 'name_en')
  const [direction, setDirection] = useState('asc')
  const [page, setPage] = useState(1)
  const search = useDebounced(q)
  const creating = params.get('new') === '1' && can('users.manage')

  const branches = useAsync(() => adminApi.branches(), [])
  const list = useAsync(
    () => adminApi.users({ q: search, role, branch_id: branch, status, sort, direction, page, page_size: 20 }),
    [search, role, branch, status, sort, direction, page],
  )

  const onSort = (column) => {
    if (column === sort) setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(column)
      setDirection(column === 'last_login' || column === 'created' ? 'desc' : 'asc')
    }
    setPage(1)
  }
  const filtered = search || role || branch || status
  const branchName = (id) => {
    const b = branches.data?.find((x) => x.id === id)
    return b ? pick(b) : t('all_branches')
  }
  const resetFilters = () => {
    setQ('')
    setRole('')
    setBranch('')
    setStatus('')
    setPage(1)
    setParams({})
  }
  const nameSort = lang === 'ar' ? 'name_ar' : 'name_en'

  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('الحسابات', 'Accounts')}
        title={tx('الموظفون', 'Staff')}
        description={tx('أنشئ الحسابات، وحدّد أدوار كل شخص وفروعه، وأوقف الحساب عند ترك العمل.', 'Create accounts, set each person’s roles and branches, and deactivate accounts when people leave.')}
        actions={
          can('users.manage') && (
            <Button icon="userPlus" variant="gold" onClick={() => setParams({ new: '1' })}>
              {tx('إضافة موظف', 'Add staff member')}
            </Button>
          )
        }
      />

      <section className="card">
        <div className="toolbar">
          <div className="search">
            <label className="sr-only" htmlFor="users-q">
              {t('search')}
            </label>
            <div className="input-wrap">
              <span className="input-start">
                <Icon name="search" size={18} />
              </span>
              <input id="users-q" className="input has-start" value={q}
                placeholder={tx('ابحث بالاسم أو البريد أو الموبايل…', 'Search name, e-mail or mobile…')}
                onChange={(e) => {
                  setQ(e.target.value)
                  setPage(1)
                }} />
            </div>
          </div>
          <label className="sr-only" htmlFor="users-role">{tx('الدور', 'Role')}</label>
          <select id="users-role" className="select" value={role} onChange={(e) => { setRole(e.target.value); setPage(1) }}>
            <option value="">{tx('كل الأدوار', 'All roles')}</option>
            {STAFF_ROLES.map((code) => (
              <option key={code} value={code}>{roleName(code, lang)}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="users-branch">{tx('الفرع', 'Branch')}</label>
          <select id="users-branch" className="select" value={branch} onChange={(e) => { setBranch(e.target.value); setPage(1) }}>
            <option value="">{t('all_branches')}</option>
            {(branches.data || []).map((b) => (
              <option key={b.id} value={b.id}>{pick(b)}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="users-status">{t('status')}</label>
          <select id="users-status" className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
            <option value="">{tx('كل الحالات', 'Any status')}</option>
            <option value="active">{t('status.active')}</option>
            <option value="locked">{t('status.locked')}</option>
            <option value="mfa_pending">{t('status.mfa_pending')}</option>
            <option value="inactive">{t('status.inactive')}</option>
          </select>
          {filtered && (
            <Button variant="quiet" size="sm" icon="x" onClick={resetFilters}>{t('clear_filters')}</Button>
          )}
        </div>

        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <SkeletonRows rows={8} cols={5} />
        ) : !list.data.items.length ? (
          <EmptyState icon="users" title={filtered ? tx('لا يوجد موظف مطابق', 'No matching staff') : tx('لا يوجد موظفون بعد', 'No staff yet')}
            action={filtered ? <Button variant="ghost" onClick={resetFilters}>{t('clear_filters')}</Button> : null}>
            {filtered ? tx('جرّب بحثًا أو فلترًا مختلفًا.', 'Try a different search or filter.') : tx('ابدأ بإضافة أول موظف.', 'Start by adding your first staff member.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap" style={{ opacity: list.loading ? 0.6 : 1, transition: 'opacity .2s' }}>
              <table className="table stack">
                <thead>
                  <tr>
                    <SortTh label={tx('الموظف', 'Person')} column={nameSort} sort={sort} direction={direction} onSort={onSort} />
                    <th>{tx('الأدوار', 'Roles')}</th>
                    <th>{t('status')}</th>
                    <th>{tx('التحقق بخطوتين', '2-step')}</th>
                    <SortTh label={tx('آخر دخول', 'Last sign-in')} column="last_login" sort={sort} direction={direction} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((u) => (
                    <tr key={u.id} className="row-link" onClick={() => navigate(`${BASE}/${u.id}`)}>
                      <td className="cell-main">
                        <div className="person">
                          <Avatar name={pick(u, 'full_name')} muted={!u.is_active} />
                          <div style={{ minWidth: 0 }}>
                            <Link to={`${BASE}/${u.id}`} className="person-name" onClick={(e) => e.stopPropagation()}>
                              {pick(u, 'full_name')}
                            </Link>
                            <small className="ltr">{u.email}</small>
                          </div>
                        </div>
                      </td>
                      <td data-label={tx('الأدوار', 'Roles')}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {u.roles.map((r) => (
                            <span key={`${r.role}:${r.branch_id}`} className="chip">
                              {roleName(r.role, lang)}
                              <small>· {branchName(r.branch_id)}</small>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td data-label={t('status')}>
                        <StatusBadge user={u} />
                      </td>
                      <td data-label={tx('التحقق بخطوتين', '2-step')}>
                        {u.mfa_enabled ? (
                          <Badge tone="success" plain>
                            <Icon name="shieldCheck" size={14} /> {tx('مفعّل', 'On')}
                          </Badge>
                        ) : (
                          <span className="muted">{u.mfa_required ? tx('مطلوب', 'Required') : '—'}</span>
                        )}
                      </td>
                      <td data-label={tx('آخر دخول', 'Last sign-in')} className="muted">
                        {u.last_login_at ? <bdi>{fmtRelative(u.last_login_at, locale)}</bdi> : t('never')}
                        {u.must_change_password && (
                          <small style={{ display: 'block', color: 'var(--gold-700)' }}>
                            {tx('بانتظار تغيير كلمة المرور المؤقتة', 'Temporary password not changed yet')}
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data.page} pageSize={list.data.page_size} total={list.data.total} onPage={setPage} />
          </>
        )}
      </section>

      <CreateStaff
        open={creating}
        branches={branches.data || []}
        onClose={() => setParams(status ? { status } : {})}
        onCreated={list.reload}
      />
    </div>
  )
}
