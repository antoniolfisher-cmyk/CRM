const BASE = '/api'
const TOKEN_KEY = 'crm_token'

async function req(method, path, body) {
  const token = localStorage.getItem(TOKEN_KEY)
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY)
    window.location.href = '/login'
    return
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Request failed (${res.status})`)
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
  sendAccountEmail: (id, data) => req('POST', `/accounts/${id}/send-email`, data),
  getAccountEmails: (id) => req('GET', `/accounts/${id}/emails`),
  getAccountUnreadCount: (id) => req('GET', `/accounts/${id}/emails/unread-count`),
  updateAccountStage: (id, stage) => req('PUT', `/accounts/${id}/stage`, { stage }),

  // Contacts
  getContacts: (accountId) => req('GET', `/contacts${accountId ? `?account_id=${accountId}` : ''}`),
  createContact: (data) => req('POST', '/contacts', data),
  updateContact: (id, data) => req('PUT', `/contacts/${id}`, data),
  deleteContact: (id) => req('DELETE', `/contacts/${id}`),

  // Follow-ups
  getFollowUps: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== false)
    ).toString()
    return req('GET', `/follow-ups${qs ? '?' + qs : ''}`)
  },
  getFollowUp: (id) => req('GET', `/follow-ups/${id}`),
  createFollowUp: (data) => req('POST', '/follow-ups', data),
  updateFollowUp: (id, data) => req('PUT', `/follow-ups/${id}`, data),
  deleteFollowUp: (id) => req('DELETE', `/follow-ups/${id}`),

  // Aura Repricer
  getAuraStatus: () => req('GET', '/aura/status'),
  syncAllToAura: () => req('POST', '/aura/sync'),
  syncOneToAura: (productId) => req('POST', `/aura/sync/${productId}`),

  // Products
  getProducts: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString()
    return req('GET', `/products${qs ? '?' + qs : ''}`)
  },
  getProduct: (id) => req('GET', `/products/${id}`),
  createProduct: (data) => req('POST', '/products', data),
  updateProduct: (id, data) => req('PUT', `/products/${id}`, data),
  deleteProduct: (id) => req('DELETE', `/products/${id}`),
  submitProduct: (id) => req('POST', `/products/${id}/submit`, {}),
  approveProduct: (id) => req('POST', `/products/${id}/approve`, {}),
  rejectProduct: (id) => req('POST', `/products/${id}/reject`, {}),
  keepaStatus: () => req('GET', '/keepa/status'),
  keepaLookup: (asin) => req('GET', `/keepa/lookup/${asin}`),
  keepaRefreshOne: (id) => req('POST', `/products/${id}/keepa-refresh`),
  keepaBulkRefresh: () => req('POST', '/keepa/bulk-refresh'),
  amazonStatus: () => req('GET', '/amazon/status'),
  checkAmazonUngated: (id) => req('POST', `/products/${id}/check-ungated`),
  checkAmazonUngatedAsin: (asin) => req('GET', `/amazon/check-asin/${asin}`),
  getAmazonInventory: () => req('GET', '/amazon/inventory'),
  importAmazonInventory: () => req('POST', '/amazon/inventory/import', {}),

  // Repricer strategies (admin only)
  getRepricerStrategies: () => req('GET', '/repricer/strategies'),
  createRepricerStrategy: (data) => req('POST', '/repricer/strategies', data),
  updateRepricerStrategy: (id, data) => req('PUT', `/repricer/strategies/${id}`, data),
  deleteRepricerStrategy: (id) => req('DELETE', `/repricer/strategies/${id}`),

  // Aria AI Repricer
  ariaStatus: () => req('GET', '/repricer/aria/status'),
  ariaRunOne: (productId) => req('POST', `/repricer/aria/run/${productId}`, {}),
  ariaRunAll: (force = true) => req('POST', `/repricer/aria/run-all?force=${force}`, {}),

  // Notifications (admin only)
  getNotificationStatus: () => req('GET', '/notifications/status'),
  sendTestEmail: () => req('POST', '/notifications/test', {}),
  sendDigestNow: () => req('POST', '/notifications/send-now', {}),
  saveMyEmail: (email) => req('POST', '/users/me/email', { email }),

  // Users (admin only)
  getUsers: () => req('GET', '/users'),
  createUser: (data) => req('POST', '/users', data),
  updateUser: (id, data) => req('PUT', `/users/${id}`, data),
  deleteUser: (id) => req('DELETE', `/users/${id}`),

  // Time Clock
  timeclockIn: () => req('POST', '/timeclock/in', {}),
  timeclockOut: (notes) => req('POST', '/timeclock/out', { notes: notes || null }),
  timeclockStatus: () => req('GET', '/timeclock/status'),
  timeclockMyEntries: () => req('GET', '/timeclock/my-entries'),
  timeclockReport: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
    return req('GET', `/timeclock/report${qs ? '?' + qs : ''}`)
  },

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
