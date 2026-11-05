// One fetch wrapper for every backend call: JSON in/out, session cookie, CSRF header, typed errors.

export class ApiError extends Error {
  constructor(status, body) {
    const error = body?.error || {}
    super(error.code || 'error')
    this.status = status
    this.code = error.code || (status >= 500 ? 'server_error' : 'generic')
    this.fields = error.fields || {}
    this.data = error
  }
}

let unauthorizedHandler = null
export function onUnauthorized(handler) {
  unauthorizedHandler = handler
}

export async function api(path, { method = 'GET', body, query } = {}) {
  let url = `/api${path}`
  if (query) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, value)
    }
    const qs = params.toString()
    if (qs) url += `?${qs}`
  }
  const headers = { Accept: 'application/json' }
  const init = { method, headers, credentials: 'same-origin' }
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json'
    headers['X-Requested-With'] = 'GoldenCare'
    init.body = JSON.stringify(body ?? {})
  }

  let response
  try {
    response = await fetch(url, init)
  } catch {
    throw new ApiError(0, { error: { code: 'network' } })
  }
  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok) {
    const error = new ApiError(response.status, data)
    if (response.status === 401 && unauthorizedHandler && !path.startsWith('/auth/')) unauthorizedHandler(error)
    throw error
  }
  return data
}
