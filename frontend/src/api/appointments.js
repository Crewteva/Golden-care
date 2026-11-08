import { api } from './client'

// Appointment API of the role you're working in: /api/<role>/appointments/...
export function appointmentsApi(slug) {
  const base = `/${slug}/appointments`
  const act = (action) => (id, body) => api(`${base}/${id}/${action}`, { method: 'POST', body })
  return {
    rules: () => api(`${base}/rules`),
    day: (query) => api(`${base}/day`, { query }),
    week: (start) => api(`${base}/week`, { query: { start } }),
    doctors: (serviceIds) => api(`${base}/doctors`, { query: { service_ids: serviceIds.join(',') } }),
    slots: ({ serviceIds, on, doctorId, exclude }) =>
      api(`${base}/slots`, { query: { service_ids: serviceIds.join(','), on, doctor_id: doctorId, exclude } }),
    book: (body) => api(base, { method: 'POST', body }),
    get: (id) => api(`${base}/${id}`),
    forPatient: (patientId) => api(`${base}/patient/${patientId}`),
    confirm: act('confirm'),
    arrive: act('arrive'),
    noShow: act('no-show'),
    cancel: act('cancel'),
    reschedule: act('reschedule'),
    notes: act('notes'),
    call: act('call'),
    finish: act('finish'),
  }
}
