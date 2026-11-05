import { api } from './client'

export const authApi = {
  me: () => api('/auth/me'),
  login: (identifier, password) => api('/auth/login', { method: 'POST', body: { identifier, password } }),
  logout: () => api('/auth/logout', { method: 'POST' }),
  logoutOthers: () => api('/auth/logout-others', { method: 'POST' }),
  mfaSetup: () => api('/auth/mfa/setup', { method: 'POST' }),
  mfaVerify: (code) => api('/auth/mfa/verify', { method: 'POST', body: { code } }),
  mfaDisable: (password, code) => api('/auth/mfa/disable', { method: 'POST', body: { password, code } }),
  changePassword: (current_password, new_password) =>
    api('/auth/password', { method: 'POST', body: { current_password, new_password } }),
  chooseRole: (role, branch_id) => api('/auth/role', { method: 'POST', body: { role, branch_id } }),
  forgot: (identifier) => api('/auth/forgot', { method: 'POST', body: { identifier } }),
  preferences: (preferred_lang) => api('/auth/preferences', { method: 'POST', body: { preferred_lang } }),
}

// Each role's own API lives under /api/<role-slug>.
export const workspaceApi = {
  home: (slug) => api(`/${slug}/home`),
}
