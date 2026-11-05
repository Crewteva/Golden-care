import { api } from './client'

export const patientApi = {
  register: (body) => api('/patient/register', { method: 'POST', body }),
  home: () => api('/patient/home'),
  profile: () => api('/patient/profile'),
  updateProfile: (body) => api('/patient/profile', { method: 'PUT', body }),
}

export const auditorApi = {
  activity: (query) => api('/auditor/activity', { query }),
}
