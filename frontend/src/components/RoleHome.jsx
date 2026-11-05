import Icon from './Icon'
import { Orbits } from './Logo'
import { Badge } from './ui'
import { useAsync } from './useAsync'
import { workspaceApi } from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { ROLES, roleName, slugFor } from '../auth/roles'
import { useI18n } from '../i18n/I18nContext'
import { fmtDateTime, fmtLongDate } from '../lib/format'

function greeting(tx) {
  const hour = new Date().getHours()
  if (hour < 12) return tx('صباح الخير', 'Good morning')
  if (hour < 18) return tx('مساء الخير', 'Good afternoon')
  return tx('مساء الخير', 'Good evening')
}

// Welcome banner shared by every role's home page.
export function Welcome({ children }) {
  const { me } = useAuth()
  const { tx, lang, pick, locale, t } = useI18n()
  const role = me.active_role
  const branch = me.active?.branch_id ? pick(me.active, 'branch_name') : t('all_branches')
  return (
    <section className="welcome">
      <Orbits className="orbits" />
      <div className="hello">
        {greeting(tx)} · {fmtLongDate(null, locale)}
      </div>
      <h1>{pick(me.user, 'full_name')}</h1>
      <div className="meta">
        <span>
          <Icon name={ROLES[role]?.icon || 'user'} size={15} />
          {roleName(role, lang)}
        </span>
        <span>
          <Icon name="building" size={15} />
          {branch}
        </span>
        {me.user.previous_login_at && (
          <span>
            <Icon name="clock" size={15} />
            {tx('آخر دخول سابق:', 'Previous sign-in:')} <bdi className="num">{fmtDateTime(me.user.previous_login_at, locale)}</bdi>
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

export function CoverCard({ cover }) {
  const { tx, lang, pick, locale, t } = useI18n()
  if (!cover?.length) return null
  return (
    <section className="card">
      <div className="card-head">
        <h2>{tx('التغطية المؤقتة', 'Temporary cover')}</h2>
        <Icon name="swap" />
      </div>
      <div className="card-body" style={{ paddingBlock: 4 }}>
      <ul className="list">
        {cover.map((c) => {
          const now = Date.now()
          const started = new Date(c.starts_at).getTime() <= now
          return (
            <li key={c.id}>
              <div className="row-between">
                <div>
                  <strong style={{ fontWeight: 500 }}>
                    {c.direction === 'received'
                      ? tx(`تغطي عن ${pick(c, 'other_name')}`, `You cover for ${pick(c, 'other_name')}`)
                      : tx(`${pick(c, 'other_name')} يغطي عنك`, `${pick(c, 'other_name')} covers for you`)}
                  </strong>{' '}
                  <span className="muted">· {roleName(c.role, lang)}</span>
                  <div className="muted num" style={{ fontSize: '.84rem' }}>
                    {fmtDateTime(c.starts_at, locale)} → {fmtDateTime(c.ends_at, locale)}
                  </div>
                </div>
                <Badge tone={started ? 'success' : 'info'}>{started ? t('status.active') : t('status.scheduled')}</Badge>
              </div>
            </li>
          )
        })}
      </ul>
      </div>
    </section>
  )
}

// Home page for roles whose features come in later phases: welcome, cover, and what's coming.
export default function RoleHome({ upcoming = [] }) {
  const { me } = useAuth()
  const { tx, lang } = useI18n()
  const { data } = useAsync(() => workspaceApi.home(slugFor(me.active_role)), [me.active_role, me.active_branch_id])

  return (
    <div className="page reveal">
      <Welcome />
      <CoverCard cover={data?.cover} />
      {upcoming.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>{tx('قادم إلى مساحة عملك', 'Coming to your workspace')}</h2>
              <p className="muted" style={{ fontSize: '.86rem', marginTop: 2 }}>
                {tx('هذه الأدوات قيد البناء وستظهر هنا تباعًا.', 'These tools are being built and will appear here in turn.')}
              </p>
            </div>
            <Badge tone="gold">{tx('خطة العمل', 'Roadmap')}</Badge>
          </div>
          <div className="card-body">
            <ul className="roadmap">
              {upcoming.map((item) => (
                <li key={item.en}>
                  <span className="ico">
                    <Icon name={item.icon || 'sparkle'} size={17} />
                  </span>
                  <span>
                    <strong>{item[lang]}</strong>
                    {item.note && <small>{item.note[lang]}</small>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}
