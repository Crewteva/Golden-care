import { api } from './client'

// Laser sessions of the role you're working in: /api/<role>/laser/...
export function laserApi(slug) {
  const base = `/${slug}/laser`
  return {
    today: () => api(`${base}/today`),
    devices: (all) => api(`${base}/devices`, { query: { all } }),
    saveDevice: (id, body) => api(id ? `${base}/devices/${id}` : `${base}/devices`, { method: id ? 'PUT' : 'POST', body }),
    forPatient: (patientId) => api(`${base}/patient/${patientId}`),
    start: (appointmentId) => api(`${base}/start/${appointmentId}`, { method: 'POST' }),
    get: (id) => api(`${base}/${id}`),
    save: (id, body) => api(`${base}/${id}`, { method: 'PUT', body }),
    sign: (id) => api(`${base}/${id}/sign`, { method: 'POST' }),
  }
}

// Dental: tooth chart, treatment plans, labs and lab cases: /api/<role>/dental/...
export function dentalApi(slug) {
  const base = `/${slug}/dental`
  const post = (path, body) => api(`${base}${path}`, { method: 'POST', body })
  return {
    chart: (patientId) => api(`${base}/chart/${patientId}`),
    addEntry: (patientId, body) => post(`/chart/${patientId}`, body),
    voidEntry: (patientId, entryId, reason) => post(`/chart/${patientId}/${entryId}/void`, { reason }),
    plans: (query) => api(`${base}/plans`, { query }),
    patientPlans: (patientId) => api(`${base}/plans/patient/${patientId}`),
    createPlan: (body) => post('/plans', body),
    plan: (id) => api(`${base}/plans/${id}`),
    editPlan: (id, body) => api(`${base}/plans/${id}`, { method: 'PUT', body }),
    addItem: (id, body) => post(`/plans/${id}/items`, body),
    removeItem: (id, itemId) => api(`${base}/plans/${id}/items/${itemId}`, { method: 'DELETE' }),
    quote: (id, validDays) => post(`/plans/${id}/quote`, { valid_days: validDays }),
    revise: (id) => post(`/plans/${id}/revise`),
    accept: (id) => post(`/plans/${id}/accept`, { signed_paper: true }),
    decline: (id, reason) => post(`/plans/${id}/decline`, { reason }),
    cancel: (id, reason) => post(`/plans/${id}/cancel`, { reason }),
    itemDone: (id, itemId, body) => post(`/plans/${id}/items/${itemId}/done`, body),
    itemCancel: (id, itemId, reason) => post(`/plans/${id}/items/${itemId}/cancel`, { reason }),
    labs: (all) => api(`${base}/labs`, { query: { all } }),
    saveLab: (id, body) => api(id ? `${base}/labs/${id}` : `${base}/labs`, { method: id ? 'PUT' : 'POST', body }),
    cases: (query) => api(`${base}/lab-cases`, { query }),
    createCase: (body) => post('/lab-cases', body),
    getCase: (id) => api(`${base}/lab-cases/${id}`),
    editCase: (id, body) => api(`${base}/lab-cases/${id}`, { method: 'PUT', body }),
    moveCase: (id, body) => post(`/lab-cases/${id}/move`, body),
  }
}

// Complaints & requests desk: /api/<role>/complaints/...
export function complaintsApi(slug) {
  const base = `/${slug}/complaints`
  return {
    list: (query) => api(base, { query }),
    staff: () => api(`${base}/staff`),
    create: (body) => api(base, { method: 'POST', body }),
    get: (id) => api(`${base}/${id}`),
    update: (id, body) => api(`${base}/${id}`, { method: 'PATCH', body }),
  }
}
