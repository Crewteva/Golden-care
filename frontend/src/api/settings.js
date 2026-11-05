import { api } from './client'

// Clinic-setup API of the role you're working in: /api/<role>/settings/...
export function settingsApi(slug) {
  const base = `/${slug}/settings`
  const crud = (path) => ({
    add: (body) => api(`${base}/${path}`, { method: 'POST', body }),
    edit: (id, body) => api(`${base}/${path}/${id}`, { method: 'PUT', body }),
    remove: (id) => api(`${base}/${path}/${id}`, { method: 'DELETE' }),
  })
  return {
    catalog: () => api(`${base}/catalog`),
    specialties: crud('specialties'),
    services: crud('services'),
    roomTypes: crud('room-types'),
    rooms: { list: () => api(`${base}/rooms`), ...crud('rooms') },
    prices: {
      list: (serviceId) => api(`${base}/services/${serviceId}/prices`),
      add: (serviceId, body) => api(`${base}/services/${serviceId}/prices`, { method: 'POST', body }),
      edit: (serviceId, id, body) => api(`${base}/services/${serviceId}/prices/${id}`, { method: 'PUT', body }),
      remove: (serviceId, id) => api(`${base}/services/${serviceId}/prices/${id}`, { method: 'DELETE' }),
    },
    doctors: () => api(`${base}/doctors`),
    saveProfile: (id, body) => api(`${base}/doctors/${id}/profile`, { method: 'PUT', body }),
    saveServices: (id, serviceIds) => api(`${base}/doctors/${id}/services`, { method: 'PUT', body: { service_ids: serviceIds } }),
    schedule: {
      add: (doctorId, body) => api(`${base}/doctors/${doctorId}/schedule`, { method: 'POST', body }),
      edit: (doctorId, id, body) => api(`${base}/doctors/${doctorId}/schedule/${id}`, { method: 'PUT', body }),
      remove: (doctorId, id) => api(`${base}/doctors/${doctorId}/schedule/${id}`, { method: 'DELETE' }),
    },
    leave: { list: () => api(`${base}/leave`), ...crud('leave') },
    holidays: { list: () => api(`${base}/holidays`), ...crud('holidays') },
    week: (query) => api(`${base}/week`, { query }),
  }
}
