const BASE = '/api'

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  // Dashboard
  getDashboard: () => req('GET', '/dashboard'),

  // Accounts
  getAccounts: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
    return req('GET', `/accounts${qs ? '?' + qs : ''}`)
  },
  getAccount: (id) => req('GET', `/accounts/${id}`),
  createAccount: (data) => req('POST', '/accounts', data),
  updateAccount: (id, data) => req('PUT', `/accounts/${id}`, data),
  deleteAccount: (id) => req('DELETE', `/accounts/${id}`),

  // Contacts
  getContacts: (accountId) => req('GET', `/contacts${accountId ? `?account_id=${accountId}` : ''}`),
  createContact: (data) => req('POST', '/contacts', data),
  updateContact: (id, data) => req('PUT', `/contacts/${id}`, data),
  deleteContact: (id) => req('DELETE', `/contacts/${id}`),

  // Follow-ups
  getFollowUps: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== false)).toString()
    return req('GET', `/follow-ups${qs ? '?' + qs : ''}`)
  },
  getFollowUp: (id) => req('GET', `/follow-ups/${id}`),
  createFollowUp: (data) => req('POST', '/follow-ups', data),
  updateFollowUp: (id, data) => req('PUT', `/follow-ups/${id}`, data),
  deleteFollowUp: (id) => req('DELETE', `/follow-ups/${id}`),

  // Orders
  getOrders: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
    return req('GET', `/orders${qs ? '?' + qs : ''}`)
  },
  getOrder: (id) => req('GET', `/orders/${id}`),
  createOrder: (data) => req('POST', '/orders', data),
  updateOrder: (id, data) => req('PUT', `/orders/${id}`, data),
  deleteOrder: (id) => req('DELETE', `/orders/${id}`),
}
