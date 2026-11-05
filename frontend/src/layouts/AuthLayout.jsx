import { Outlet } from 'react-router-dom'
import Icon from '../components/Icon'
import Logo, { Orbits } from '../components/Logo'
import { LangToggle } from '../components/ui'
import { useI18n } from '../i18n/I18nContext'

// Sign-in screens: the brand panel on one side, the form on the other (stacked on phones).
export default function AuthLayout({ wide = false }) {
  const { tx } = useI18n()
  const year = new Date().getFullYear()
  return (
    <div className="auth">
      <aside className="auth-brand">
        <Orbits />
        <Logo to="/login" size={44} />
        <div className="brand-mid reveal">
          <div className="auth-eyebrow">{tx('عيادات جولدن كير', 'Golden Care Clinics')}</div>
          <h2 className="auth-title">
            {tx('نرعاك', 'Caring for')}
            <br />
            <em>{tx('لحياة أفضل', 'a better life')}</em>
          </h2>
          <p className="auth-lede">
            {tx(
              'مساحة عمل واحدة للفريق الطبي والإداري، وبوابة خاصة لكل مريض.',
              'One workspace for the medical and admin team, and a private portal for every patient.',
            )}
          </p>
          <ul className="assurances">
            <li>
              <span className="ico">
                <Icon name="lock" size={17} />
              </span>
              {tx('جلسات مشفّرة تنتهي تلقائيًا عند عدم النشاط', 'Encrypted sessions that end after inactivity')}
            </li>
            <li>
              <span className="ico">
                <Icon name="smartphone" size={17} />
              </span>
              {tx('تحقق بخطوتين للأدوار الحساسة', '2-step verification for sensitive roles')}
            </li>
            <li>
              <span className="ico">
                <Icon name="activity" size={17} />
              </span>
              {tx('كل إجراء مسجّل في سجل لا يمكن تعديله', 'Every action recorded in a log nobody can edit')}
            </li>
          </ul>
        </div>
        <div className="auth-brand-foot">
          <span>
            <Icon name="mapPin" size={14} /> {tx('مدينة الشروق، القاهرة', 'Madinat El Shorouk, Cairo')}
          </span>
          <span className="num">© {year}</span>
        </div>
      </aside>

      <div className="auth-main">
        <div className="auth-top">
          <LangToggle />
        </div>
        <main id="main" className={`auth-body ${wide ? 'wide' : ''}`}>
          <Outlet />
        </main>
        <p className="auth-foot">
          {tx('بياناتك الطبية محمية ولا يطّلع عليها إلا المصرّح لهم.', 'Your medical data is protected and seen only by authorised staff.')}
        </p>
      </div>
    </div>
  )
}
