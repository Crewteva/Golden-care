import { api } from './client'

// Billing, payments & cashier of the role you're working in: /api/<role>/billing/...
export function billingApi(slug) {
  const base = `/${slug}/billing`
  const post = (path, body) => api(`${base}${path}`, { method: 'POST', body })
  const put = (path, body) => api(`${base}${path}`, { method: 'PUT', body })
  const del = (path) => api(`${base}${path}`, { method: 'DELETE' })
  return {
    options: () => api(`${base}/options`),
    queue: (on) => api(`${base}/queue`, { query: { on } }),
    findPatients: (q) => api(`${base}/patients`, { query: { q } }),
    account: (patientId) => api(`${base}/patient/${patientId}`),

    invoices: (query) => api(`${base}/invoices`, { query }),
    createInvoice: (body) => post('/invoices', body),
    invoice: (id) => api(`${base}/invoices/${id}`),
    saveInvoice: (id, body) => put(`/invoices/${id}`, body),
    issue: (id, body) => post(`/invoices/${id}/issue`, body),
    cancel: (id) => post(`/invoices/${id}/cancel`),
    void: (id, body) => post(`/invoices/${id}/void`, body),
    cancelPackage: (ppId, body) => post(`/packages/${ppId}/cancel`, body),

    pay: (body) => post('/payments', body),
    receipt: (id) => api(`${base}/receipts/${id}`),
    installmentsDue: (days) => api(`${base}/installments/due`, { query: { days } }),

    shift: () => api(`${base}/shift`),
    openShift: (body) => post('/shift/open', body),
    closeShift: (body) => post('/shift/close', body),
    shifts: (query) => api(`${base}/shifts`, { query }),
    shiftReport: (id) => api(`${base}/shifts/${id}`),

    refunds: (state) => api(`${base}/refunds`, { query: { state } }),
    requestRefund: (body) => post('/refunds', body),
    payRefund: (id, body) => post(`/refunds/${id}/pay`, body),
    approvals: (state) => api(`${base}/approvals`, { query: { state } }),
    decide: (id, body) => post(`/approvals/${id}/decide`, body),

    packages: () => api(`${base}/setup/packages`),
    savePackage: (id, body) => (id ? put(`/setup/packages/${id}`, body) : post('/setup/packages', body)),
    deletePackage: (id) => del(`/setup/packages/${id}`),
    shares: () => api(`${base}/setup/shares`),
    saveShare: (id, body) => (id ? put(`/setup/shares/${id}`, body) : post('/setup/shares', body)),
    deleteShare: (id) => del(`/setup/shares/${id}`),
    rules: () => api(`${base}/setup/rules`),
    saveRules: (body) => put('/setup/rules', body),
  }
}

// The patient's own bills: /api/patient/billing
export const myBillingApi = {
  overview: () => api('/patient/billing'),
  receipt: (id) => api(`/patient/billing/receipts/${id}`),
}
