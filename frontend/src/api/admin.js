import { api } from './client'

export const adminApi = {
  overview: () => api('/admin/overview'),

  users: (query) => api('/admin/users', { query }),
  staffOptions: () => api('/admin/staff-options'),
  user: (id) => api(`/admin/users/${id}`),
  createUser: (body) => api('/admin/users', { method: 'POST', body }),
  updateUser: (id, body) => api(`/admin/users/${id}`, { method: 'PUT', body }),
  setRoles: (id, roles) => api(`/admin/users/${id}/roles`, { method: 'PUT', body: { roles } }),
  deactivate: (id, reason) => api(`/admin/users/${id}/deactivate`, { method: 'POST', body: { reason } }),
  activate: (id) => api(`/admin/users/${id}/activate`, { method: 'POST' }),
  unlock: (id) => api(`/admin/users/${id}/unlock`, { method: 'POST' }),
  resetPassword: (id) => api(`/admin/users/${id}/reset-password`, { method: 'POST' }),
  resetMfa: (id) => api(`/admin/users/${id}/reset-mfa`, { method: 'POST' }),
  endSession: (id, sessionId) => api(`/admin/users/${id}/sessions/${sessionId}/end`, { method: 'POST' }),

  roles: () => api('/admin/roles'),
  updateRole: (code, requires_mfa) => api(`/admin/roles/${code}`, { method: 'PATCH', body: { requires_mfa } }),
  setPermissions: (code, permissions) =>
    api(`/admin/roles/${code}/permissions`, { method: 'PUT', body: { permissions } }),

  branches: () => api('/admin/branches'),
  createBranch: (body) => api('/admin/branches', { method: 'POST', body }),
  updateBranch: (id, body) => api(`/admin/branches/${id}`, { method: 'PUT', body }),

  delegations: (status) => api('/admin/delegations', { query: { status } }),
  createDelegation: (body) => api('/admin/delegations', { method: 'POST', body }),
  revokeDelegation: (id) => api(`/admin/delegations/${id}/revoke`, { method: 'POST' }),

  resets: () => api('/admin/password-resets'),
  resolveReset: (id, action) => api(`/admin/password-resets/${id}/${action}`, { method: 'POST' }),

  activity: (query) => api('/admin/activity', { query }),
}
