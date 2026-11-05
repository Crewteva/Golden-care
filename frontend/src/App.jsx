import { Navigate, Route, Routes } from 'react-router-dom'
import AuthLayout from './layouts/AuthLayout'
import DashboardLayout from './layouts/DashboardLayout'
import { GuestOnly, RequireRole, RequireStep } from './auth/guards'
import { useAuth } from './auth/AuthContext'
import { pathFor, slugFor } from './auth/roles'
import PageLoader from './components/PageLoader'
import { EmptyState } from './components/ui'
import { useI18n } from './i18n/I18nContext'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'
import TwoFactor from './pages/auth/TwoFactor'
import ChangePassword from './pages/auth/ChangePassword'
import ChooseRole from './pages/auth/ChooseRole'
import NoAccess from './pages/auth/NoAccess'
import Account from './pages/account/Account'
import NotFound from './pages/NotFound'
import { DASHBOARDS } from './pages/dashboards'

function Home() {
  const { me, loading } = useAuth()
  if (loading) return <PageLoader full />
  return <Navigate to={pathFor(me)} replace />
}

// Pages inside a dashboard can also require a permission of the active role.
function NeedsPermission({ permission, children }) {
  const { can } = useAuth()
  const { tx } = useI18n()
  if (permission && !can(permission)) {
    return (
      <EmptyState icon="lock" title={tx('لا تملك صلاحية هذه الصفحة', "You don't have access to this page")}>
        {tx('اطلب من مدير النظام إضافة الصلاحية لدورك.', 'Ask the system admin to add this permission to your role.')}
      </EmptyState>
    )
  }
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />

      <Route element={<GuestOnly><AuthLayout /></GuestOnly>}>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Route>
      <Route element={<GuestOnly><AuthLayout wide /></GuestOnly>}>
        <Route path="/register" element={<Register />} />
      </Route>

      <Route element={<AuthLayout />}>
        <Route path="/two-factor" element={<RequireStep steps={['mfa_setup', 'mfa_verify']}><TwoFactor /></RequireStep>} />
        <Route path="/change-password" element={<RequireStep steps={['change_password']}><ChangePassword /></RequireStep>} />
        <Route path="/choose-role" element={<RequireStep steps={['choose_role', 'ready']}><ChooseRole /></RequireStep>} />
        <Route path="/no-access" element={<RequireStep steps={['no_role']}><NoAccess /></RequireStep>} />
      </Route>

      {DASHBOARDS.map((board) => (
        <Route
          key={board.role}
          path={`/dashboard/${slugFor(board.role)}`}
          element={
            <RequireRole role={board.role}>
              <DashboardLayout config={board} />
            </RequireRole>
          }
        >
          {board.pages.map((page) =>
            page.path ? (
              <Route key={page.path} path={page.path} element={<NeedsPermission permission={page.permission}>{page.element}</NeedsPermission>} />
            ) : (
              <Route key="index" index element={<NeedsPermission permission={page.permission}>{page.element}</NeedsPermission>} />
            ),
          )}
          <Route path="account" element={<Account />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      ))}

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
