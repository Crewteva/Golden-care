import { api } from './client'

// Accounting of the role you're working in: /api/<role>/accounting/...
export function accountingApi(slug) {
  const base = `/${slug}/accounting`
  const get = (path, query) => api(`${base}${path}`, { query })
  const post = (path, body) => api(`${base}${path}`, { method: 'POST', body })
  const put = (path, body) => api(`${base}${path}`, { method: 'PUT', body })
  return {
    base: `/api${base}`,
    overview: () => get('/overview'),
    options: () => get('/options'),

    accounts: (asOf) => get('/accounts', { as_of: asOf }),
    saveAccount: (id, body) => (id ? put(`/accounts/${id}`, body) : post('/accounts', body)),

    journal: (query) => get('/journal', query),
    entry: (id) => get(`/journal/${id}`),
    postEntry: (body) => post('/journal', body),
    reverse: (id, body) => post(`/journal/${id}/reverse`, body),

    expenses: (query) => get('/expenses', query),
    addExpense: (form) => post('/expenses', form),
    voidExpense: (id, body) => post(`/expenses/${id}/void`, body),

    transfers: (kind) => get('/transfers', { kind }),
    addTransfer: (body) => post('/transfers', body),
    unsettled: () => get('/settlements/unsettled'),
    settle: (body) => post('/settlements', body),

    payouts: (query) => get('/payouts', query),
    statement: (doctorId, month) => get('/payouts/statement', { doctor_id: doctorId, month }),
    payout: (id) => get(`/payouts/${id}`),
    preparePayout: (body) => post('/payouts', body),
    decidePayout: (id, body) => post(`/payouts/${id}/decide`, body),
    payPayout: (id, body) => post(`/payouts/${id}/pay`, body),

    labs: () => get('/labs'),
    payLab: (body) => post('/lab-payments', body),

    periods: () => get('/periods'),
    requestClose: (month, body) => post(`/periods/${month}/request`, body),
    decideClose: (month, body) => post(`/periods/${month}/decide`, body),
    reopen: (month, body) => post(`/periods/${month}/reopen`, body),

    report: (name, query) => get(`/reports/${name}`, query),
  }
}
