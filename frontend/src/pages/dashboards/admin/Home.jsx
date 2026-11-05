import { Link } from 'react-router-dom'
import Icon from '../../../components/Icon'
import { Welcome } from '../../../components/RoleHome'
import { ErrorState, EmptyState } from '../../../components/ui'
import { useAsync } from '../../../components/useAsync'
import { adminApi } from '../../../api/admin'
import { roleName } from '../../../auth/roles'
import { useAuth } from '../../../auth/AuthContext'
import { useI18n } from '../../../i18n/I18nContext'
import { actionMeta } from '../../../lib/activity'
import { fmtDay, fmtNumber, fmtRelative } from '../../../lib/format'

const BASE = '/dashboard/admin'

function Stat({ icon, label, value, foot, to, tone }) {
  const body = (
    <>
      <div className="stat-label">
        <Icon name={icon} size={17} />
        {label}
      </div>
      <div className="stat-value num">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </>
  )
  const className = `stat ${tone || ''}`
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

export default function AdminHome() {
  const { can } = useAuth()
  const { tx, lang, locale } = useI18n()
  const { data, error, loading, reload } = useAsync(() => adminApi.overview(), [])

  if (error) return <ErrorState error={error} onRetry={reload} />
  const s = data?.stats
  const n = (v) => (loading && !data ? '—' : fmtNumber(v, locale))
  const maxRole = Math.max(1, ...(data?.by_role || []).map((r) => r.users))
  const maxDay = Math.max(1, ...(data?.sign_ins || []).map((d) => d.ok + d.failed))

  return (
    <div className="page reveal">
      <Welcome>
        <div className="page-actions">
          {can('users.manage') && (
            <Link to={`${BASE}/users?new=1`} className="btn btn-gold">
              <Icon name="userPlus" size={18} />
              {tx('إضافة موظف', 'Add staff member')}
            </Link>
          )}
          {can('audit.view') && (
            <Link to={`${BASE}/activity`} className="btn btn-ghost" style={{ '--btn-fg': '#f3ead3', '--btn-border': 'rgba(255,255,255,.2)' }}>
              <Icon name="activity" size={18} />
              {tx('سجل النشاط', 'Activity log')}
            </Link>
          )}
        </div>
      </Welcome>

      <div className="stats">
        <Stat icon="users" tone="feature" label={tx('موظفون نشطون', 'Active staff')} value={n(s?.active_staff)}
          foot={s ? tx(`${s.inactive_staff} حساب موقوف`, `${s.inactive_staff} deactivated`) : null} to={`${BASE}/users`} />
        <Stat icon="heart" label={tx('مرضى مسجّلون', 'Registered patients')} value={n(s?.patients)}
          foot={s ? tx(`${s.patients_today} اليوم`, `${s.patients_today} today`) : null} />
        <Stat icon="logIn" label={tx('دخلوا اليوم', 'Signed in today')} value={n(s?.signed_in_today)}
          foot={s ? tx(`${s.failed_24h} محاولة فاشلة خلال ٢٤ ساعة`, `${s.failed_24h} failed attempts in 24 h`) : null} />
        <Stat icon="swap" label={tx('تغطية مؤقتة سارية', 'Active temporary cover')} value={n(s?.active_cover)} to={`${BASE}/cover`} />
      </div>

      {s && (s.pending_resets > 0 || s.locked > 0 || s.mfa_pending > 0) && (
        <section aria-label={tx('يحتاج انتباهك', 'Needs your attention')}>
          <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>{tx('يحتاج انتباهك', 'Needs your attention')}</h2>
          <div className="stats">
            {s.pending_resets > 0 && can('password_resets.manage') && (
              <Stat icon="inbox" tone="attention" label={tx('طلبات استعادة كلمة المرور', 'Password reset requests')}
                value={n(s.pending_resets)} foot={tx('تحقق من الهوية ثم أصدر كلمة مؤقتة', 'Verify identity, then issue a temporary password')} to={`${BASE}/resets`} />
            )}
            {s.locked > 0 && (
              <Stat icon="lock" tone="attention" label={tx('حسابات مقفلة مؤقتًا', 'Temporarily locked accounts')}
                value={n(s.locked)} foot={tx('بعد ٥ محاولات خاطئة', 'After 5 wrong passwords')} to={`${BASE}/users?status=locked`} />
            )}
            {s.mfa_pending > 0 && (
              <Stat icon="smartphone" tone="attention" label={tx('لم يفعّلوا التحقق بخطوتين', "Haven't set up 2-step yet")}
                value={n(s.mfa_pending)} foot={tx('سيُطلب منهم عند الدخول التالي', "They'll be asked at their next sign-in")} to={`${BASE}/users?status=mfa_pending`} />
            )}
          </div>
        </section>
      )}

      <div className="split">
        <div className="page" style={{ gap: 20 }}>
          <section className="card">
            <div className="card-head">
              <h2>{tx('عمليات الدخول خلال ٧ أيام', 'Sign-ins over 7 days')}</h2>
              <div className="legend">
                <span>
                  <i style={{ background: 'var(--ink-700)' }} />
                  {tx('ناجحة', 'Successful')}
                </span>
                <span>
                  <i style={{ background: 'var(--gold-400)' }} />
                  {tx('فاشلة', 'Failed')}
                </span>
              </div>
            </div>
            <div className="card-body">
              <div className="spark" role="img" aria-label={tx('رسم بياني لعمليات الدخول اليومية', 'Daily sign-ins chart')}>
                {(data?.sign_ins || Array.from({ length: 7 }, (_, i) => ({ day: i, ok: 0, failed: 0 }))).map((d) => (
                  <div className="col" key={String(d.day)}>
                    <div className="stack" title={`${d.ok} / ${d.failed}`}>
                      {d.ok > 0 && <div className="ok" style={{ height: `${(d.ok / maxDay) * 100}%` }} />}
                      {d.failed > 0 && <div className="bad" style={{ height: `${(d.failed / maxDay) * 100}%` }} />}
                    </div>
                    <small>{data ? fmtDay(d.day, locale) : ''}</small>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>{tx('الموظفون حسب الدور', 'Staff by role')}</h2>
              <Link to={`${BASE}/roles`} style={{ fontSize: '.86rem' }}>
                {tx('الأدوار والصلاحيات', 'Roles & permissions')}
              </Link>
            </div>
            <div className="card-body bars">
              {(data?.by_role || []).map((r) => (
                <div className="bar-row" key={r.role}>
                  <span>{roleName(r.role, lang)}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(r.users / maxRole) * 100}%` }} />
                  </div>
                  <span className="num muted" style={{ textAlign: 'end' }}>
                    {r.users}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="card">
          <div className="card-head">
            <h2>{tx('آخر النشاط', 'Latest activity')}</h2>
            {can('audit.view') && (
              <Link to={`${BASE}/activity`} style={{ fontSize: '.86rem' }}>
                {tx('عرض الكل', 'View all')}
              </Link>
            )}
          </div>
          <div className="card-body" style={{ paddingBlock: 6 }}>
            {data && !data.recent.length ? (
              <EmptyState icon="activity" title={tx('لا يوجد نشاط بعد', 'No activity yet')} />
            ) : (
              <ul className="feed">
                {(data?.recent || []).map((row) => {
                  const meta = actionMeta(row.action)
                  return (
                    <li key={row.id}>
                      <span className={`dot ${meta.tone || ''}`}>
                        <Icon name={meta.icon} size={16} />
                      </span>
                      <span>
                        {meta[lang]}
                        <small>
                          {row.actor_label || tx('النظام', 'System')} · <bdi>{fmtRelative(row.at, locale)}</bdi>
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
    </div>
  )
}
