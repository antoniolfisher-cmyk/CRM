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
  getRepricerStats: () => req('GET', '/dashboard/repricer-stats'),
  getDashboardAmazonLive: () => req('GET', '/dashboard/amazon-live'),
  getDashboardAmazonSales: (period = 'today') => req('GET', `/dashboard/amazon-sales?period=${period}`),
  getDashboardAmazonOrders: () => req('GET', '/dashboard/amazon-orders'),

  // Tenant & Multi-tenancy
  getTenantMe: () => req('GET', '/tenant/me'),
  getTenantUsers: () => req('GET', '/tenant/users'),

  // Amazon credentials (multi-tenant)
  getAmazonOAuthUrl: () => req('GET', '/amazon/oauth/url'),
  getAmazonCredentials: () => req('GET', '/amazon/credentials'),
  saveAmazonCredentials: (data) => req('PUT', '/amazon/credentials', data),
  disconnectAmazon: () => req('DELETE', '/amazon/credentials'),
  purgeAndResyncAmazon: () => req('POST', '/admin/purge-system-products'),
  triggerInitialSync: () => req('POST', '/amazon/trigger-initial-sync', {}),
  getOnboardingSyncStatus: () => req('GET', '/onboarding/sync-status'),

  // Billing (Stripe) — tenant self-service
  getBillingPlans: () => req('GET', '/billing/plans'),
  createBillingCheckout: (plan) => req('POST', '/billing/checkout', { plan }),
  getBillingPortal: () => req('GET', '/billing/portal'),

  // Admin Billing Dashboard (superadmin only)
  getAdminBillingOverview: () => req('GET', '/admin/billing/overview'),
  getAdminBillingTenants: () => req('GET', '/admin/billing/tenants'),
  getAdminBillingInvoices: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString()
    return req('GET', `/admin/billing/invoices${qs ? '?' + qs : ''}`)
  },
  suspendTenant: (id) => req('POST', `/admin/billing/tenants/${id}/suspend`),
  activateTenant: (id) => req('POST', `/admin/billing/tenants/${id}/activate`),
  adminChangePlan: (id, plan) => req('PUT', `/admin/billing/tenants/${id}/plan`, { plan }),

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
  setProductStrategy: (id, strategyId) => req('PUT', `/products/${id}/strategy`, { strategy_id: strategyId }),
  keepaStatus: () => req('GET', '/keepa/status'),
  keepaLookup: (asin) => req('GET', `/keepa/lookup/${asin}`),
  keepaUpcLookup: (code) => req('GET', `/keepa/upc/${encodeURIComponent(code)}`),
  keepaBatch: (mode, codes) => req('POST', '/keepa/batch', { mode, codes }),
  keepaAmazonSearch: (query) => req('POST', '/keepa/amazon-search', { query }),
  keepaRefreshOne: (id) => req('POST', `/products/${id}/keepa-refresh`),
  keepaBulkRefresh: () => req('POST', '/keepa/bulk-refresh'),
  amazonStatus: () => req('GET', '/amazon/status'),
  checkAmazonUngated: (id) => req('POST', `/products/${id}/check-ungated`),
  checkAmazonUngatedAsin: (asin) => req('GET', `/amazon/check-asin/${asin}`),
  getAmazonInventory: () => req('GET', '/amazon/inventory'),
  importAmazonInventory: () => req('POST', '/amazon/inventory/import', {}),
  amazonInventorySyncStatus: () => req('GET', '/amazon/inventory/sync-status'),
  amazonInventorySyncNow: () => req('POST', '/amazon/inventory/sync-now', {}),

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

  // Support
  supportChat: (messages) => req('POST', '/support/chat', { messages }),

  // Ungate
  getUngateTemplates: () => req('GET', '/ungate/templates'),
  updateUngateTemplate: (id, data) => req('PUT', `/ungate/templates/${id}`, data),
  aiGenerateTemplate: (data) => req('POST', '/ungate/templates/ai-generate', data),
  getUngateRequirements: (asin) => req('GET', `/ungate/requirements/${asin}`),
  getUngateRequests: () => req('GET', '/ungate/requests'),
  createUngateRequest: (data) => req('POST', '/ungate/requests', data),
  getUngateRequest: (id) => req('GET', `/ungate/requests/${id}`),
  submitUngateRequest: (id, data) => req('POST', `/ungate/requests/${id}/submit`, data),
  recordRejection: (id, data) => req('POST', `/ungate/requests/${id}/rejection`, data),
  approveUngateRequest: (id) => req('POST', `/ungate/requests/${id}/approve`, {}),
  deleteUngateRequest: (id) => req('DELETE', `/ungate/requests/${id}`),
  renderTemplate: (num, params) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v)).toString()
    return req('GET', `/ungate/render-template/${num}${qs ? '?' + qs : ''}`)
  },
  sendUngateEmail: (id, data) => req('POST', `/ungate/requests/${id}/send-email`, data),
  uploadUngateInvoice: (id, file) => {
    const token = localStorage.getItem(TOKEN_KEY)
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/ungate/requests/${id}/invoice`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: fd,
    }).then(async r => {
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || r.statusText) }
      return r.json()
    })
  },
  deleteUngateInvoice: (id) => req('DELETE', `/ungate/requests/${id}/invoice`),

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
