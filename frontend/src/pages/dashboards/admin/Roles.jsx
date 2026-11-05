import { Fragment, useEffect, useState } from 'react'
import Button from '../../../components/Button'
import { Alert, Badge, ErrorState, PageHeader, SkeletonRows } from '../../../components/ui'
import { useToast } from '../../../components/Toast'
import { useAsync } from '../../../components/useAsync'
import { adminApi } from '../../../api/admin'
import { useAuth } from '../../../auth/AuthContext'
import { roleName } from '../../../auth/roles'
import { useI18n } from '../../../i18n/I18nContext'
import { errorText } from '../../../lib/errors'

// Matrix of roles × permissions, plus whether each role must use 2-step verification.
export default function Roles() {
  const { can, refresh } = useAuth()
  const { t, tx, lang, pick } = useI18n()
  const toast = useToast()
  const { data, error, loading, reload, setData } = useAsync(() => adminApi.roles(), [])
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(null)
  const editable = can('roles.manage')

  useEffect(() => {
    if (!data) return
    const next = {}
    for (const r of data.roles) next[r.code] = { permissions: [...r.permissions], requires_mfa: r.requires_mfa }
    setDraft(next)
  }, [data])

  if (error) return <ErrorState error={error} onRetry={reload} />

  const roles = (data?.roles || []).filter((r) => r.kind === 'staff')
  const locked = new Set(data?.locked?.admin || [])
  const isDirty = (r) => {
    const d = draft[r.code]
    if (!d) return false
    return d.requires_mfa !== r.requires_mfa || [...d.permissions].sort().join() !== [...r.permissions].sort().join()
  }
  const toggle = (code, perm) =>
    setDraft((all) => {
      const set = new Set(all[code].permissions)
      set.has(perm) ? set.delete(perm) : set.add(perm)
      return { ...all, [code]: { ...all[code], permissions: [...set] } }
    })

  const save = async (role) => {
    const d = draft[role.code]
    setSaving(role.code)
    try {
      let result = data
      if (d.requires_mfa !== role.requires_mfa) result = await adminApi.updateRole(role.code, d.requires_mfa)
      if ([...d.permissions].sort().join() !== [...role.permissions].sort().join()) {
        result = await adminApi.setPermissions(role.code, d.permissions)
      }
      setData(result)
      refresh()
      toast.success(tx(`تم حفظ دور «${roleName(role.code, lang)}».`, `Saved the “${roleName(role.code, lang)}” role.`))
    } catch (err) {
      toast.error(errorText(err, t))
    } finally {
      setSaving(null)
    }
  }

  const modules = [...new Set((data?.permissions || []).map((p) => p.module))]

  return (
    <div className="page reveal">
      <PageHeader
        eyebrow={tx('الحسابات', 'Accounts')}
        title={tx('الأدوار والصلاحيات', 'Roles & permissions')}
        description={tx(
          'كل دور له لوحة خاصة. هنا تحدد ما يُسمح لكل دور بفعله، وأي الأدوار يجب أن تستخدم التحقق بخطوتين. ستظهر صلاحيات كل قسم جديد هنا عند بنائه.',
          'Each role has its own dashboard. Here you decide what each role may do, and which roles must use 2-step verification. Permissions for each new module appear here as it is built.',
        )}
      />
      {!editable && <Alert tone="info">{tx('لديك صلاحية العرض فقط.', 'You have view-only access.')}</Alert>}

      <section className="card">
        {loading && !data ? (
          <SkeletonRows rows={10} cols={6} />
        ) : (
          <div className="table-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th scope="col">{tx('الدور', 'Role')}</th>
                  <th scope="col">{tx('التحقق بخطوتين إلزامي', '2-step required')}</th>
                  {modules.map((m) => (
                    <Fragment key={m}>
                      {data.permissions
                        .filter((p) => p.module === m)
                        .map((p) => (
                          <th scope="col" key={p.code} title={p.code}>
                            {pick(p)}
                          </th>
                        ))}
                    </Fragment>
                  ))}
                  <th scope="col">
                    <span className="sr-only">{t('actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => {
                  const d = draft[r.code]
                  if (!d) return null
                  const dirty = isDirty(r)
                  return (
                    <tr key={r.code} className={dirty ? 'dirty' : ''}>
                      <th scope="row" style={{ textAlign: 'start', fontWeight: 500 }}>
                        {roleName(r.code, lang)}
                        <small className="muted" style={{ display: 'block', fontWeight: 400 }}>
                          {tx(`${r.users} شخص`, `${r.users} people`)}
                        </small>
                      </th>
                      <td>
                        <label className="check" style={{ justifyContent: 'center' }}>
                          <input
                            type="checkbox"
                            checked={d.requires_mfa}
                            disabled={!editable || r.code === 'admin'}
                            onChange={() => setDraft((all) => ({ ...all, [r.code]: { ...d, requires_mfa: !d.requires_mfa } }))}
                            aria-label={`${roleName(r.code, lang)}: ${tx('التحقق بخطوتين إلزامي', '2-step required')}`}
                          />
                        </label>
                      </td>
                      {data.permissions.map((p) => {
                        const fixed = r.code === 'admin' && locked.has(p.code)
                        return (
                          <td key={p.code}>
                            <label className="check" style={{ justifyContent: 'center' }}>
                              <input
                                type="checkbox"
                                checked={d.permissions.includes(p.code)}
                                disabled={!editable || fixed}
                                onChange={() => toggle(r.code, p.code)}
                                aria-label={`${roleName(r.code, lang)}: ${pick(p)}`}
                              />
                            </label>
                          </td>
                        )
                      })}
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {dirty && editable && (
                          <Button size="sm" loading={saving === r.code} onClick={() => save(r)}>
                            {t('save')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="muted" style={{ fontSize: '.84rem' }}>
        <Badge tone="neutral" plain>{tx('ملاحظة', 'Note')}</Badge>{' '}
        {tx(
          'دور مدير النظام يحتفظ دائمًا بإدارة الحسابات والأدوار والتحقق بخطوتين، حتى لا تُغلق العيادة خارج نظامها.',
          'The system admin role always keeps account and role management and 2-step verification, so the clinic can never lock itself out.',
        )}
      </p>
    </div>
  )
}
