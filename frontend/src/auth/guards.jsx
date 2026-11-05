import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { pathFor } from './roles'
import PageLoader from '../components/PageLoader'
import Forbidden from '../pages/Forbidden'

// Signed-out pages (login, register…): a signed-in person is sent where they belong.
export function GuestOnly({ children }) {
  const { me, loading } = useAuth()
  if (loading) return <PageLoader full />
  if (me) return <Navigate to={pathFor(me)} replace />
  return children
}

// Sign-in steps (2FA, password change, role choice): need a session; `step` lists when the page applies.
export function RequireStep({ steps, children }) {
  const { me, loading } = useAuth()
  if (loading) return <PageLoader full />
  if (!me) return <Navigate to="/login" replace />
  if (!steps.includes(me.next_step)) return <Navigate to={pathFor(me)} replace />
  return children
}

// A role's dashboard: fully signed in and working in that role.
export function RequireRole({ role, children }) {
  const { me, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageLoader full />
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (me.next_step !== 'ready') return <Navigate to={pathFor(me)} replace />
  if (me.active_role !== role) return <Forbidden role={role} />
  return children
}
