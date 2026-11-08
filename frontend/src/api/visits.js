import { api } from './client'

// Visit API of the role you're working in: /api/<role>/visits/...
export function visitsApi(slug) {
  const base = `/${slug}/visits`
  return {
    list: (query) => api(base, { query }),
    get: (id) => api(`${base}/${id}`),
    start: (appointmentId) => api(`${base}/start/${appointmentId}`, { method: 'POST' }),
    save: (id, body) => api(`${base}/${id}`, { method: 'PUT', body }),
    saveRx: (id, items) => api(`${base}/${id}/rx`, { method: 'PUT', body: { items } }),
    sign: (id) => api(`${base}/${id}/sign`, { method: 'POST' }),
    release: (id, patientSummary) => api(`${base}/${id}/release`, { method: 'POST', body: { patient_summary: patientSummary } }),
    addendum: (id, body) => api(`${base}/${id}/addenda`, { method: 'POST', body: { body } }),
    forPatient: (patientId) => api(`${base}/patient/${patientId}`),
    followUps: () => api(`${base}/follow-ups`),
    vitalsToday: () => api(`${base}/vitals/today`),
    recordVitals: (body) => api(`${base}/vitals`, { method: 'POST', body }),
    patientVitals: (patientId) => api(`${base}/vitals/patient/${patientId}`),
    drugs: (query) => api(`${base}/lists/drugs`, { query }),
    saveDrug: (id, body) => api(id ? `${base}/lists/drugs/${id}` : `${base}/lists/drugs`, { method: id ? 'PUT' : 'POST', body }),
    deleteDrug: (id) => api(`${base}/lists/drugs/${id}`, { method: 'DELETE' }),
    diagnoses: (query) => api(`${base}/lists/diagnoses`, { query }),
    saveDiagnosis: (id, body) => api(id ? `${base}/lists/diagnoses/${id}` : `${base}/lists/diagnoses`, { method: id ? 'PUT' : 'POST', body }),
    deleteDiagnosis: (id) => api(`${base}/lists/diagnoses/${id}`, { method: 'DELETE' }),
  }
}
