import { api } from './client'

// Stock, purchasing & devices of the role you're working in: /api/<role>/inventory/...
export function inventoryApi(slug) {
  const base = `/${slug}/inventory`
  const get = (path, query) => api(`${base}${path}`, { query })
  const post = (path, body) => api(`${base}${path}`, { method: 'POST', body })
  const put = (path, body) => api(`${base}${path}`, { method: 'PUT', body })
  const del = (path) => api(`${base}${path}`, { method: 'DELETE' })
  return {
    base: `/api${base}`,
    overview: () => get('/overview'),
    options: () => get('/options'),

    list: (kind) => get(`/setup/${kind}`),
    saveRow: (kind, id, body) => (id ? put(`/setup/${kind}/${id}`, body) : post(`/setup/${kind}`, body)),
    deleteRow: (kind, id) => del(`/setup/${kind}/${id}`),
    saveLimit: (body) => put('/approval-limit', body),

    stock: (query) => get('/stock', query),
    alerts: () => get('/stock/alerts'),
    item: (id) => get(`/stock/items/${id}`),
    moves: (query) => get('/stock/moves', query),
    receive: (body) => post('/stock/receive', body),
    useOptions: () => get('/stock/use-options'),
    issue: (body) => post('/stock/issue', body),
    issues: (query) => get('/stock/issues', query),

    counts: () => get('/counts'),
    startCount: (body) => post('/counts', body),
    count: (id) => get(`/counts/${id}`),
    saveCount: (id, body) => put(`/counts/${id}`, body),
    decideCount: (id, body) => post(`/counts/${id}/decide`, body),

    orders: (query) => get('/orders', query),
    order: (id) => get(`/orders/${id}`),
    saveOrder: (id, body) => (id ? put(`/orders/${id}`, body) : post('/orders', body)),
    decideOrder: (id, body) => post(`/orders/${id}/decide`, body),
    cancelOrder: (id, body) => post(`/orders/${id}/cancel`, body),

    suppliers: () => get('/suppliers'),
    supplier: (id) => get(`/suppliers/${id}`),
    payables: () => get('/payables'),
    addBill: (body) => post('/bills', body),
    pay: (body) => post('/payments', body),

    devices: () => get('/devices'),
    device: (id) => get(`/devices/${id}`),
    saveDevice: (id, body) => (id ? put(`/devices/${id}`, body) : post('/devices', body)),
    deleteDevice: (id) => del(`/devices/${id}`),
    setStatus: (id, body) => post(`/devices/${id}/status`, body),
    addMaintenance: (id, form) => post(`/devices/${id}/maintenance`, form),

    faults: (status) => get('/faults', { status }),
    reportFault: (body) => post('/faults', body),
    fixFault: (id, body) => post(`/faults/${id}/fix`, body),
  }
}
