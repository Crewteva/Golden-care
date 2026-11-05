import { api } from './client'

// Patient-file API of the role you're working in: /api/<role>/patients/...
export function patientsApi(slug) {
  const base = `/${slug}/patients`
  return {
    search: (query) => api(base, { query }),
    checkDuplicates: (body) => api(`${base}/check-duplicates`, { method: 'POST', body }),
    create: (body) => api(base, { method: 'POST', body }),
    get: (id) => api(`${base}/${id}`),
    update: (id, body) => api(`${base}/${id}`, { method: 'PUT', body }),
    history: (id, page) => api(`${base}/${id}/history`, { query: { page } }),
    addAlert: (id, body) => api(`${base}/${id}/alerts`, { method: 'POST', body }),
    removeAlert: (id, alertId, reason) => api(`${base}/${id}/alerts/${alertId}/remove`, { method: 'POST', body: { reason } }),
    linkFamily: (id, body) => api(`${base}/${id}/family`, { method: 'POST', body }),
    unlinkFamily: (id, linkId, reason) => api(`${base}/${id}/family/${linkId}/remove`, { method: 'POST', body: { reason } }),
    portalAccess: (id) => api(`${base}/${id}/portal-access`, { method: 'POST' }),
    files: (id) => api(`${base}/${id}/files`),
    upload: (id, { category, title, file }) => {
      const form = new FormData()
      form.append('category', category)
      form.append('title', title)
      form.append('file', file)
      return api(`${base}/${id}/files`, { method: 'POST', body: form })
    },
    fileUrl: (id, fileId) => `/api${base}/${id}/files/${fileId}/download`,
    review: (id, fileId, body) => api(`${base}/${id}/files/${fileId}/review`, { method: 'POST', body }),
    voidFile: (id, fileId, reason) => api(`${base}/${id}/files/${fileId}/void`, { method: 'POST', body: { reason } }),
    reviewQueue: () => api(`${base}/review-queue`),
  }
}
