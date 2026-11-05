import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Button from '../../../components/Button'
import Icon from '../../../components/Icon'
import Modal from '../../../components/Modal'
import { TextArea, TextField } from '../../../components/Fields'
import { Alert, Avatar, Badge, ErrorState, PageHeader, StatusBadge } from '../../../components/ui'
import { useToast } from '../../../components/Toast'
import { useAsync } from '../../../components/useAsync'
import PageLoader from '../../../components/PageLoader'
import { adminApi } from '../../../api/admin'
import { useAuth } from '../../../auth/AuthContext'
import { roleName } from '../../../auth/roles'
import { useI18n } from '../../../i18n/I18nContext'
import { actionMeta } from '../../../lib/activity'
import { errorText, fieldErrors } from '../../../lib/errors'
import { fmtDateTime, fmtPhone, fmtRelative } from '../../../lib/format'
import { RoleAssignments, TempPasswordNotice, validateAssignments } from './shared'

function ProfileCard({ detail, onSaved, canManage }) {
  const { t, tx } = useI18n()
  const toast = useToast()
  const u = detail.user
  const initial = { full_name_ar: u.full_name_ar, full_name_en: u.full_name_en || '', email: u.email || '', phone: u.phone ? `0${u.phone.slice(3)}` : '' }
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => setForm(initial), [u.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      onSaved(await adminApi.updateUser(u.id, { ...form, phone: form.phone.trim() || null }))
      toast.success(tx('تم حفظ البيانات.', 'Details saved.'))
    } catch (err) {
      setErrors(fieldErrors(err, t))
      if (!err.fields || !Object.keys(err.fields).length) toast.error(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{tx('البيانات الأساسية', 'Basic details')}</h2>
      </div>
      <form className="card-body form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <TextField label={tx('الاسم بالعربية', 'Name in Arabic')} value={form.full_name_ar} onChange={set('full_name_ar')} error={errors.full_name_ar} dir="rtl" disabled={!canManage} />
          <TextField label={tx('الاسم بالإنجليزية', 'Name in English')} value={form.full_name_en} onChange={set('full_name_en')} error={errors.full_name_en} dir="ltr" disabled={!canManage} />
          <TextField label={tx('بريد العمل', 'Work e-mail')} type="email" value={form.email} onChange={set('email')} error={errors.email} dir="ltr" disabled={!canManage} />
          <TextField label={tx('الموبايل', 'Mobile')} optional type="tel" value={form.phone} onChange={set('phone')} error={errors.phone} dir="ltr" disabled={!canManage} />
        </div>
        {canManage && (
          <div>
            <Button type="submit" loading={busy} disabled={!dirty}>
              {t('save_changes')}
            </Button>
          </div>
        )}
      </form>
    </section>
  )
}

function RolesCard({ detail, branches, onSaved, canManage }) {
  const { t, tx } = useI18n()
  const toast = useToast()
  const initial = detail.roles.map((r) => ({ role: r.role, branch_id: r.branch_id }))
  const [rows, setRows] = useState(initial)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setRows(initial), [JSON.stringify(initial)]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial)

  const save = async () => {
    const problem = validateAssignments(rows, tx)
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      onSaved(await adminApi.setRoles(detail.user.id, rows))
      toast.success(tx('تم تحديث الأدوار. ستنطبق فورًا.', 'Roles updated. They apply immediately.'))
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{tx('الأدوار والصلاحيات', 'Roles & access')}</h2>
          <p className="muted" style={{ fontSize: '.84rem' }}>
            {tx('كل دور يفتح لوحة خاصة به. الفرع يحدد بيانات أي فرع يراها.', 'Each role opens its own dashboard. The branch decides whose data they see.')}
          </p>
        </div>
      </div>
      <div className="card-body form">
        <RoleAssignments value={rows} onChange={setRows} branches={branches} error={error} disabled={!canManage} />
        {canManage && (
          <div style={{ display: 'flex', gap: 10 }}>
            <Button onClick={save} loading={busy} disabled={!dirty}>
              {tx('حفظ الأدوار', 'Save roles')}
            </Button>
            {dirty && (
              <Button variant="quiet" onClick={() => { setRows(initial); setError(null) }}>
                {t('cancel')}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function SecurityCard({ detail, onSaved, canManage, isSelf }) {
  const { t, tx, locale } = useI18n()
  const toast = useToast()
  const u = detail.user
  const [dialog, setDialog] = useState(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(null)
  const [temp, setTemp] = useState(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn, message) => {
    setBusy(true)
    try {
      const result = await fn()
      if (result?.user) onSaved(result)
      if (message) toast.success(message)
      return result
    } catch (err) {
      toast.error(errorText(err, t))
      return null
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setDialog(null)
    setReason('')
    setReasonError(null)
    setTemp(null)
  }

  const resetPassword = async () => {
    const result = await run(() => adminApi.resetPassword(u.id))
    if (result) {
      setTemp(result.temp_password)
      onSaved(await adminApi.user(u.id))
    }
  }

  const deactivate = async (event) => {
    event.preventDefault()
    if (reason.trim().length < 3) {
      setReasonError(t('field.required'))
      return
    }
    const result = await run(() => adminApi.deactivate(u.id, reason.trim()), tx('تم إيقاف الحساب وإنهاء جلساته.', 'Account deactivated and signed out everywhere.'))
    if (result) close()
  }

  const actions = [
    {
      key: 'password',
      icon: 'key',
      title: tx('إصدار كلمة مرور مؤقتة', 'Issue a temporary password'),
      text: tx('ينهي كل جلساته، ويُطلب منه اختيار كلمة جديدة عند الدخول.', 'Ends all their sessions; they must choose a new password at sign-in.'),
      button: tx('إعادة التعيين', 'Reset'),
      show: !isSelf && u.is_active,
    },
    {
      key: 'unlock',
      icon: 'unlock',
      title: tx('فك القفل المؤقت', 'Unlock account'),
      text: tx('الحساب مقفل بعد محاولات خاطئة متكررة.', 'Locked after repeated wrong passwords.'),
      button: tx('فك القفل', 'Unlock'),
      show: u.locked,
      run: () => run(() => adminApi.unlock(u.id), tx('تم فك القفل.', 'Account unlocked.')),
    },
    {
      key: 'mfa',
      icon: 'smartphone',
      title: tx('إعادة ضبط التحقق بخطوتين', 'Reset 2-step verification'),
      text: tx('عند فقدان الهاتف. سيعيد الإعداد عند الدخول التالي.', 'If they lost their phone. They set it up again at next sign-in.'),
      button: tx('إعادة الضبط', 'Reset'),
      show: !isSelf && u.mfa_enabled,
      confirm: true,
    },
  ].filter((a) => a.show)

  return (
    <section className="card">
      <div className="card-head">
        <h2>{tx('الأمان والدخول', 'Security & sign-in')}</h2>
        <Icon name="shield" />
      </div>
      <div className="card-body">
        <dl className="dl">
          <dt>{tx('آخر دخول', 'Last sign-in')}</dt>
          <dd className="num">{u.last_login_at ? `${fmtDateTime(u.last_login_at, locale)} · ${u.last_login_ip || ''}` : t('never')}</dd>
          <dt>{tx('كلمة المرور', 'Password')}</dt>
          <dd>
            {u.must_change_password
              ? <Badge tone="gold">{tx('مؤقتة، بانتظار التغيير', 'Temporary, awaiting change')}</Badge>
              : u.password_changed_at ? <bdi className="num">{fmtDateTime(u.password_changed_at, locale)}</bdi> : '—'}
          </dd>
          <dt>{tx('التحقق بخطوتين', '2-step')}</dt>
          <dd>{u.mfa_enabled ? <Badge tone="success">{tx('مفعّل', 'On')}</Badge> : <Badge tone="neutral">{tx('غير مفعّل', 'Off')}</Badge>}</dd>
          <dt>{tx('أُنشئ', 'Created')}</dt>
          <dd className="num">{fmtDateTime(u.created_at, locale)}{u.created_by && ` · ${u.created_by.full_name_en || u.created_by.full_name_ar}`}</dd>
        </dl>

        {canManage && actions.length > 0 && (
          <div className="action-list" style={{ marginTop: 14, borderTop: '1px solid var(--line)' }}>
            {actions.map((a) => (
              <div className="action-row" key={a.key}>
                <div>
                  <strong>{a.title}</strong>
                  <small>{a.text}</small>
                </div>
                <Button variant="ghost" size="sm" icon={a.icon} disabled={busy} onClick={() => (a.run ? a.run() : setDialog(a.key))}>
                  {a.button}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {canManage && !isSelf && (
        <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
          {u.is_active ? (
            <div className="action-row" style={{ padding: 0 }}>
              <div>
                <strong style={{ color: 'var(--danger)' }}>{tx('إيقاف الحساب', 'Deactivate account')}</strong>
                <small>{tx('عند ترك العمل. يُحفظ السجل ولا يُحذف شيء.', 'When someone leaves. History is kept; nothing is deleted.')}</small>
              </div>
              <Button variant="danger-ghost" size="sm" icon="power" onClick={() => setDialog('deactivate')}>
                {tx('إيقاف', 'Deactivate')}
              </Button>
            </div>
          ) : (
            <div className="action-row" style={{ padding: 0 }}>
              <div>
                <strong>{tx('الحساب موقوف', 'Account is deactivated')}</strong>
                <small>{u.deactivated_reason}</small>
              </div>
              <Button size="sm" icon="power" loading={busy} onClick={() => run(() => adminApi.activate(u.id), tx('تمت إعادة تفعيل الحساب.', 'Account reactivated.'))}>
                {tx('إعادة التفعيل', 'Reactivate')}
              </Button>
            </div>
          )}
        </div>
      )}

      <Modal
        open={dialog === 'password'}
        onClose={close}
        busy={busy}
        title={temp ? tx('كلمة مرور مؤقتة جديدة', 'New temporary password') : tx('إصدار كلمة مرور مؤقتة؟', 'Issue a temporary password?')}
        footer={
          temp ? (
            <Button onClick={close}>{tx('تم', 'Done')}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={busy}>{t('cancel')}</Button>
              <Button onClick={resetPassword} loading={busy} icon="key">{tx('إصدار', 'Issue')}</Button>
            </>
          )
        }
      >
        {temp ? (
          <TempPasswordNotice password={temp} name={u.full_name_ar} identifier={u.email} />
        ) : (
          <p>{tx('ستُنهى كل جلساته الحالية وسيُطلب منه اختيار كلمة مرور جديدة.', 'All their current sessions will end and they will have to choose a new password.')}</p>
        )}
      </Modal>

      <Modal
        open={dialog === 'mfa'}
        onClose={close}
        busy={busy}
        title={tx('إعادة ضبط التحقق بخطوتين؟', 'Reset 2-step verification?')}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>{t('cancel')}</Button>
            <Button variant="danger" loading={busy} onClick={async () => {
              const result = await run(() => adminApi.resetMfa(u.id), tx('تمت إعادة الضبط.', '2-step verification reset.'))
              if (result) close()
            }}>
              {tx('إعادة الضبط', 'Reset')}
            </Button>
          </>
        }
      >
        <Alert tone="warn">
          {tx('تأكد من هوية الشخص أولًا. سيتمكن من ربط هاتف جديد عند الدخول التالي.', "Confirm the person's identity first. They'll link a new phone at their next sign-in.")}
        </Alert>
      </Modal>

      <Modal
        open={dialog === 'deactivate'}
        onClose={close}
        busy={busy}
        title={tx('إيقاف الحساب', 'Deactivate account')}
        description={tx('سيُمنع من الدخول فورًا وتُلغى أي تغطية مؤقتة مرتبطة به.', "They'll be signed out at once and any temporary cover involving them ends.")}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>{t('cancel')}</Button>
            <Button variant="danger" type="submit" form="deactivate-form" loading={busy} icon="power">{tx('إيقاف الحساب', 'Deactivate')}</Button>
          </>
        }
      >
        <form id="deactivate-form" onSubmit={deactivate} noValidate>
          <TextArea
            label={tx('السبب (يُحفظ في السجل)', 'Reason (kept in the log)')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={reasonError}
            placeholder={tx('مثال: انتهاء التعاقد في ٣٠ نوفمبر', 'e.g. Contract ended on 30 November')}
            data-autofocus
          />
        </form>
      </Modal>
    </section>
  )
}

export default function UserDetail() {
  const { id } = useParams()
  const { me, can } = useAuth()
  const { t, tx, lang, pick, locale } = useI18n()
  const toast = useToast()
  const { data, error, loading, reload, setData } = useAsync(() => adminApi.user(id), [id])
  const branches = useAsync(() => adminApi.branches(), [])

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (loading && !data) return <PageLoader />

  const u = data.user
  const name = pick(u, 'full_name')
  const isSelf = me.user.id === u.id
  const canManage = can('users.manage')

  const endSession = async (sessionId) => {
    try {
      setData(await adminApi.endSession(u.id, sessionId))
      toast.success(tx('تم إنهاء الجلسة.', 'Session ended.'))
    } catch (err) {
      toast.error(errorText(err, t))
    }
  }

  return (
    <div className="page reveal">
      <PageHeader
        back={
          <Link to="/dashboard/admin/users" className="back-link">
            <Icon name="arrowLeft" size={16} />
            {tx('كل الموظفين', 'All staff')}
          </Link>
        }
        eyebrow={tx('ملف موظف', 'Staff profile')}
        title={
          <span className="person" style={{ gap: 16 }}>
            <Avatar name={name} size="lg" muted={!u.is_active} />
            <span>
              {name}
              <span style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <StatusBadge user={u} />
                {isSelf && <Badge tone="gold">{t('you')}</Badge>}
                <span className="muted ltr" style={{ fontSize: '.86rem', fontFamily: 'var(--font-body)', fontWeight: 400 }}>
                  {u.email}{u.phone && ` · ${fmtPhone(u.phone)}`}
                </span>
              </span>
            </span>
          </span>
        }
      />

      {isSelf && (
        <Alert tone="info">
          {tx('هذا حسابك. لتغيير كلمة المرور أو التحقق بخطوتين استخدم صفحة «حسابي».', 'This is your account. To change your password or 2-step verification, use “My account”.')}{' '}
          <Link to="/dashboard/admin/account">{t('my_account')}</Link>
        </Alert>
      )}

      <div className="split">
        <div className="page" style={{ gap: 20 }}>
          <ProfileCard detail={data} onSaved={setData} canManage={canManage} />
          <RolesCard detail={data} branches={branches.data || []} onSaved={setData} canManage={canManage} />
          <section className="card">
            <div className="card-head">
              <h2>{tx('آخر النشاط', 'Recent activity')}</h2>
            </div>
            <div className="card-body" style={{ paddingBlock: 6 }}>
              {!data.activity.length ? (
                <p className="muted" style={{ padding: '14px 0' }}>{tx('لا يوجد نشاط بعد.', 'No activity yet.')}</p>
              ) : (
                <ul className="feed">
                  {data.activity.map((row) => {
                    const meta = actionMeta(row.action)
                    return (
                      <li key={row.id}>
                        <span className={`dot ${meta.tone || ''}`}>
                          <Icon name={meta.icon} size={16} />
                        </span>
                        <span>
                          {meta[lang]}
                          <small>
                            {row.actor_label || t('system')} · <bdi className="num">{fmtDateTime(row.at, locale)}</bdi>
                            {row.ip && <> · <bdi className="ltr">{row.ip}</bdi></>}
                          </small>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>

        <div className="page" style={{ gap: 20 }}>
          <SecurityCard detail={data} onSaved={setData} canManage={canManage} isSelf={isSelf} />

          <section className="card">
            <div className="card-head">
              <h2>{tx('الجلسات المفتوحة', 'Open sessions')}</h2>
              <Badge tone="neutral" plain>{data.sessions.length}</Badge>
            </div>
            <div className="card-body" style={{ paddingBlock: 4 }}>
              {!data.sessions.length ? (
                <p className="muted" style={{ padding: '14px 0' }}>{tx('غير مسجّل الدخول حاليًا.', 'Not signed in anywhere right now.')}</p>
              ) : (
                <ul className="list">
                  {data.sessions.map((s) => (
                    <li key={s.id} className="row-between">
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block' }}>{s.active_role ? roleName(s.active_role, lang) : '—'}</span>
                        <small className="muted">
                          <bdi className="ltr">{s.ip}</bdi> · {tx('نشط', 'active')} <bdi>{fmtRelative(s.last_seen_at, locale)}</bdi>
                        </small>
                      </span>
                      {canManage && !isSelf && (
                        <Button variant="quiet" size="sm" onClick={() => endSession(s.id)}>
                          {tx('إنهاء', 'End')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {data.cover.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h2>{tx('التغطية المؤقتة', 'Temporary cover')}</h2>
                <Link to="/dashboard/admin/cover" style={{ fontSize: '.86rem' }}>{tx('إدارة', 'Manage')}</Link>
              </div>
              <ul className="list card-body" style={{ paddingBlock: 4 }}>
                {data.cover.map((c) => (
                  <li key={c.id}>
                    <strong style={{ fontWeight: 500 }}>
                      {c.direction === 'received' ? tx('يغطي عن', 'Covers for') : tx('يغطي عنه', 'Covered by')} {pick(c, 'other_name')}
                    </strong>
                    <small className="muted num" style={{ display: 'block' }}>
                      {roleName(c.role, lang)} · {fmtDateTime(c.starts_at, locale)} → {fmtDateTime(c.ends_at, locale)}
                      {c.revoked_at && ` · ${t('status.revoked')}`}
                    </small>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
