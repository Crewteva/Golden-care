import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import Logo from '../components/Logo'
import { Avatar, LangToggle } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { roleName, slugFor } from '../auth/roles'
import { useI18n } from '../i18n/I18nContext'
import { fmtLongDate, fmtPhone } from '../lib/format'

// Frame for every role's dashboard: dark sidebar with that role's pages, top bar, content.
export default function DashboardLayout({ config }) {
  const { me, can, signOut } = useAuth()
  const { t, tx, lang, pick, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const base = `/dashboard/${slugFor(config.role)}`

  useEffect(() => setOpen(false), [location.pathname])

  const pages = config.pages.filter((p) => p.nav !== false && (!p.permission || can(p.permission)))
  const active = me.active
  const branch = active?.branch_id ? pick(active, 'branch_name') : t('all_branches')
  const name = pick(me.user, 'full_name')

  const onSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        {t('skip_to_content')}
      </a>
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label={t('menu')}>
        <Logo to={base} size={38} />

        <div className="sidebar-role">
          <span className="lbl">{tx('تعمل الآن بصفة', 'Working as')}</span>
          <strong>{roleName(config.role, lang)}</strong>
          {config.role !== 'patient' && <small>{branch}</small>}
          {active?.delegated && (
            <small>
              {tx('تغطية مؤقتة عن', 'Covering for')} {pick(active, 'from_name')}
            </small>
          )}
          {me.roles.length > 1 && (
            <Link to="/choose-role">
              <Icon name="swap" size={14} /> {t('switch_role')}
            </Link>
          )}
        </div>

        <nav aria-label={roleName(config.role, lang)}>
          <div className="nav-title">{tx('مساحة العمل', 'Workspace')}</div>
          <div className="nav">
            {pages.map((p) => (
              <NavLink key={p.path} to={p.path ? `${base}/${p.path}` : base} end={!p.path || p.end}>
                <Icon name={p.icon} size={19} />
                <span>{p.label[lang]}</span>
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="sidebar-foot">
          <div className="nav">
            <NavLink to={`${base}/account`}>
              <Icon name="user" size={19} />
              <span>{t('my_account')}</span>
            </NavLink>
          </div>
          <button type="button" className="signout" onClick={onSignOut}>
            <Icon name="logOut" size={19} />
            {t('sign_out')}
          </button>
          <div className="sidebar-user">
            <Avatar name={name} />
            <div className="who">
              <strong>{name}</strong>
              <small className="ltr" style={{ textAlign: 'start' }}>{me.user.email || fmtPhone(me.user.phone)}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />

      <div style={{ minWidth: 0 }}>
        <header className="topbar">
          <button
            type="button"
            className="btn btn-ghost btn-icon menu-btn"
            onClick={() => setOpen(true)}
            aria-label={t('menu')}
            aria-expanded={open}
          >
            <Icon name="menu" />
          </button>
          <div className="crumbs">
            <strong>{roleName(config.role, lang)}</strong>
            {config.role !== 'patient' && <span className="branch">· {branch}</span>}
          </div>
          <div className="end">
            <span className="today">{fmtLongDate(null, locale)}</span>
            <LangToggle />
          </div>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
