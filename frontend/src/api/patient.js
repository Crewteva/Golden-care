import { api } from './client'

export const patientApi = {
  register: (body) => api('/patient/register', { method: 'POST', body }),
  home: () => api('/patient/home'),
  profile: () => api('/patient/profile'),
  updateProfile: (body) => api('/patient/profile', { method: 'PUT', body }),
  files: () => api('/patient/files'),
  fileUrl: (id) => `/api/patient/files/${id}/download`,
  family: () => api('/patient/family'),
  appointments: () => api('/patient/appointments'),
  bookingOptions: () => api('/patient/booking/options'),
  bookingSlots: (query) => api('/patient/booking/slots', { query }),
  book: (body) => api('/patient/appointments', { method: 'POST', body }),
  cancel: (id, reason) => api(`/patient/appointments/${id}/cancel`, { method: 'POST', body: { reason } }),
}

export const auditorApi = {
  activity: (query) => api('/auditor/activity', { query }),
}
