import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

// ── helpers ──────────────────────────────────────────────────────────────────

const fmt$ = (n) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const PLAN_META = {
  starter:    { label: 'Starter',    bg: 'bg-gray-100',    text: 'text-gray-600'   },
  pro:        { label: 'Pro',        bg: 'bg-orange-100',  text: 'text-orange-700' },
  enterprise: { label: 'Enterprise', bg: 'bg-purple-100',  text: 'text-purple-700' },
}

const STATUS_META = {
  active:    { label: 'Active',    bg: 'bg-green-100',  text: 'text-green-700'  },
  trialing:  { label: 'Trial',     bg: 'bg-blue-100',   text: 'text-blue-700'   },
  past_due:  { label: 'Past Due',  bg: 'bg-red-100',    text: 'text-red-700'    },
  canceled:  { label: 'Canceled',  bg: 'bg-gray-100',   text: 'text-gray-500'   },
  free:      { label: 'Free',      bg: 'bg-slate-100',  text: 'text-slate-500'  },
}

function PlanBadge({ plan }) {
  const m = PLAN_META[plan] || PLAN_META.starter
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  )
}

function StatusBadge({ status }) {
  const key = status || 'free'
  const m   = STATUS_META[key] || STATUS_META.free
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  )
}

function StatCard({ label, value, sub, color = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Tenant users panel ───────────────────────────────────────────────────────
function TenantUsersPanel({ tenantId }) {
  const [users, setUsers]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [unlocking, setUnlocking] = useState({})
  const [pwInputs, setPwInputs]   = useState({})

  useEffect(() => {
    setLoading(true)
    api.adminTenantUsers(tenantId)
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }, [tenantId])

  const unlock = async (userId) => {
    const pw = pwInputs[userId] || ''
    setUnlocking(p => ({ ...p, [userId]: true }))
    try {
      await api.adminUnlockUser(tenantId, userId, pw)
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_active: true, email_verified: true } : u))
      setPwInputs(p => ({ ...p, [userId]: '' }))
    } catch (e) {
      alert(e.message)
    } finally {
      setUnlocking(p => ({ ...p, [userId]: false }))
    }
  }

  if (loading) return <div className="px-6 py-3 text-xs text-gray-400">Loading users…</div>
  if (!users?.length) return <div className="px-6 py-3 text-xs text-gray-400">No users found for this tenant.</div>

  return (
    <div className="px-6 py-3 bg-slate-50 border-t border-gray-100">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Users</p>
      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="flex items-center gap-3 flex-wrap">
            <span className={`w-2 h-2 rounded-full shrink-0 ${u.is_active ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-xs font-medium text-gray-800 w-36 truncate">{u.username}</span>
            <span className="text-xs text-gray-400 w-44 truncate">{u.email || '—'}</span>
            <span className="text-xs text-gray-400 w-12">{u.role}</span>
            {!u.is_active && <span className="text-xs bg-red-50 text-red-500 px-1.5 py-0.5 rounded">Disabled</span>}
            {!u.email_verified && <span className="text-xs bg-yellow-50 text-yellow-600 px-1.5 py-0.5 rounded">Unverified</span>}
            <input
              type="text"
              placeholder="New password (optional)"
              value={pwInputs[u.id] || ''}
              onChange={e => setPwInputs(p => ({ ...p, [u.id]: e.target.value }))}
              className="text-xs border border-gray-300 rounded px-2 py-0.5 w-44 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button
              onClick={() => unlock(u.id)}
              disabled={unlocking[u.id]}
              className="text-xs px-2.5 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 disabled:opacity-40 font-medium"
            >
              {unlocking[u.id] ? '…' : (!u.is_active ? 'Enable & Unlock' : 'Reset Password')}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Plan change dropdown ─────────────────────────────────────────────────────
function PlanDropdown({ tenantId, currentPlan, onChanged }) {
  const [open, setOpen]     = useState(false)
  const [loading, setLoading] = useState(false)

  const change = async (plan) => {
    if (plan === currentPlan) { setOpen(false); return }
    setLoading(true)
    try {
      await api.adminChangePlan(tenantId, plan)
      onChanged(tenantId, plan)
    } catch (e) {
      alert(e.message)
    } finally {
      setLoading(false)
      setOpen(false)
    }
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={loading}
        className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
      >
        {loading ? '…' : 'Change plan'}
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-20 bg-white border border-gray-200 rounded-lg shadow-lg w-36 py-1">
          {['starter', 'pro', 'enterprise'].map(p => (
            <button
              key={p}
              onClick={() => change(p)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${p === currentPlan ? 'font-bold text-orange-600' : 'text-gray-700'}`}
            >
              {PLAN_META[p]?.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function AdminBilling() {
  const [overview, setOverview]     = useState(null)
  const [tenants, setTenants]       = useState([])
  const [invoices, setInvoices]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState('sellers')   // 'sellers' | 'invoices' | 'waitlist'
  const [waitlist, setWaitlist]     = useState(null)
  const [actionLoading, setActionLoading] = useState({})
  const [expandedTenant, setExpandedTenant] = useState(null)
  const [planFilter, setPlanFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch]         = useState('')
  const [invStatusFilter, setInvStatusFilter] = useState('')

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [ov, ts, invs] = await Promise.all([
        api.getAdminBillingOverview(),
        api.getAdminBillingTenants(),
        api.getAdminBillingInvoices({ limit: 200 }),
      ])
      setOverview(ov)
      setTenants(ts)
      setInvoices(invs)
    } catch (e) {
      // If 403, show a friendly message below
      if (e.message?.includes('403') || e.message?.includes('Platform admin')) {
        setOverview({ _forbidden: true })
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const doAction = async (tenantId, action) => {
    setActionLoading(p => ({ ...p, [tenantId]: action }))
    try {
      if (action === 'suspend')      await api.suspendTenant(tenantId)
      if (action === 'activate')     await api.activateTenant(tenantId)
      if (action === 'grant-access') await api.grantTenantAccess(tenantId)
      setTenants(prev => prev.map(t => {
        if (t.id !== tenantId) return t
        if (action === 'suspend')      return { ...t, is_active: false }
        if (action === 'activate')     return { ...t, is_active: true }
        if (action === 'grant-access') return { ...t, is_active: true, stripe_status: null }
        return t
      }))
    } catch (e) {
      alert(e.message)
    } finally {
      setActionLoading(p => { const n = { ...p }; delete n[tenantId]; return n })
    }
  }

  const handlePlanChanged = (tenantId, newPlan) => {
    setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, plan: newPlan } : t))
  }

  // Filtered tenant list
  const filteredTenants = tenants.filter(t => {
    if (planFilter   && t.plan !== planFilter)               return false
    if (statusFilter && (t.stripe_status || 'free') !== statusFilter) return false
    if (search) {
      const s = search.toLowerCase()
      if (!t.name?.toLowerCase().includes(s) &&
          !t.admin_email?.toLowerCase().includes(s) &&
          !t.store_name?.toLowerCase().includes(s)) return false
    }
    return true
  })

  const filteredInvoices = invStatusFilter
    ? invoices.filter(i => i.status === invStatusFilter)
    : invoices

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm">Loading billing dashboard…</div>
      </div>
    )
  }

  if (overview?._forbidden) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <LockIcon className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Platform Admin Only</h2>
        <p className="text-gray-500 text-sm">
          This dashboard is restricted to the platform superadmin account.<br />
          Sign in as <strong>admin</strong> (or the account named in <code>SUPERADMIN_USERNAME</code>) to access it.
        </p>
      </div>
    )
  }

  const mrr = overview?.mrr ?? 0

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Seller Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Platform-wide billing, subscriptions &amp; seller overview
          </p>
        </div>
        <button
          onClick={loadAll}
          className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshIcon className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {!overview?.billing_enabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <strong>Billing not configured.</strong> Set <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_PRICE_PRO</code>,
          and <code>STRIPE_PRICE_ENTERPRISE</code> in Railway to enable subscription payments.
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Monthly Recurring Revenue"
          value={fmt$(mrr)}
          sub={`${overview?.active_subscribers ?? 0} paying seller${(overview?.active_subscribers ?? 0) !== 1 ? 's' : ''}`}
          color="text-green-600"
        />
        <StatCard
          label="Active Subscribers"
          value={overview?.active_subscribers ?? 0}
          sub="Paid plans"
        />
        <StatCard
          label="On Trial"
          value={overview?.trial_subscribers ?? 0}
          sub="14-day trial"
          color="text-blue-600"
        />
        <StatCard
          label="Past Due"
          value={overview?.past_due_subscribers ?? 0}
          sub="Payment failed"
          color={(overview?.past_due_subscribers ?? 0) > 0 ? 'text-red-600' : 'text-gray-900'}
        />
      </div>

      {/* Secondary stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Sellers"    value={overview?.total_tenants ?? 0}   sub="All time" />
        <StatCard label="Free Tier"        value={overview?.free_subscribers ?? 0} sub="Starter plan" />
        <StatCard label="Total Revenue"    value={fmt$(overview?.total_revenue)}   sub="All paid invoices" color="text-green-600" />
        <StatCard label="Failed Payments"  value={overview?.failed_invoices ?? 0}
          color={(overview?.failed_invoices ?? 0) > 0 ? 'text-red-600' : 'text-gray-900'} />
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200">
        <div className="flex gap-6">
          {[
            { key: 'sellers',  label: `Sellers (${tenants.length})` },
            { key: 'invoices', label: `Payment History (${invoices.length})` },
            { key: 'waitlist', label: `Waitlist${waitlist ? ` (${waitlist.length})` : ''}` },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* SELLERS TAB */}
      {tab === 'sellers' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <input
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="Search name, email, store…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
              value={planFilter}
              onChange={e => setPlanFilter(e.target.value)}
            >
              <option value="">All plans</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <select
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="trialing">Trial</option>
              <option value="past_due">Past Due</option>
              <option value="canceled">Canceled</option>
              <option value="free">Free</option>
            </select>
            {(search || planFilter || statusFilter) && (
              <button
                onClick={() => { setSearch(''); setPlanFilter(''); setStatusFilter('') }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Clear filters
              </button>
            )}
            <span className="text-xs text-gray-400 ml-auto">
              {filteredTenants.length} of {tenants.length} sellers
            </span>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Seller</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Plan</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">MRR</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Joined</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Amazon</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Payment</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredTenants.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">
                        No sellers match your filters.
                      </td>
                    </tr>
                  )}

                  {filteredTenants.map(t => (
                    <React.Fragment key={t.id}>
                    <tr className={`hover:bg-gray-50 transition-colors ${!t.is_active ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {(t.name || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 leading-tight">{t.name}</p>
                            {t.admin_email && (
                              <p className="text-xs text-gray-400">{t.admin_email}</p>
                            )}
                            {t.store_name && (
                              <p className="text-xs text-green-600">{t.store_name}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <PlanBadge plan={t.plan} />
                          <PlanDropdown tenantId={t.id} currentPlan={t.plan} onChanged={handlePlanChanged} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={t.stripe_status || 'free'} />
                        {!t.is_active && (
                          <div className="mt-1">
                            <span className="text-xs bg-red-50 text-red-500 px-1.5 py-0.5 rounded font-medium">Suspended</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-semibold ${t.mrr > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                          {t.mrr > 0 ? fmt$(t.mrr) : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {fmtDate(t.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {t.amazon_connected ? (
                          <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                            Connected
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">Not connected</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {t.last_payment ? (
                          <div>
                            <p className={`text-xs font-semibold ${
                              t.last_payment.status === 'paid'   ? 'text-green-600' :
                              t.last_payment.status === 'failed' ? 'text-red-600' : 'text-gray-500'
                            }`}>
                              {t.last_payment.status === 'paid' ? fmt$(t.last_payment.amount) : t.last_payment.status}
                            </p>
                            <p className="text-xs text-gray-400">{fmtDate(t.last_payment.created_at)}</p>
                          </div>
                        ) : (
                          <span className="text-gray-300 text-xs">No payments</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 flex-wrap">
                          {t.is_active ? (
                            <button
                              onClick={() => doAction(t.id, 'suspend')}
                              disabled={!!actionLoading[t.id]}
                              className="text-xs px-2.5 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 disabled:opacity-40 font-medium"
                            >
                              {actionLoading[t.id] === 'suspend' ? '…' : 'Suspend'}
                            </button>
                          ) : (
                            <button
                              onClick={() => doAction(t.id, 'activate')}
                              disabled={!!actionLoading[t.id]}
                              className="text-xs px-2.5 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100 disabled:opacity-40 font-medium"
                            >
                              {actionLoading[t.id] === 'activate' ? '…' : 'Reactivate'}
                            </button>
                          )}
                          {t.stripe_status && t.stripe_status !== 'active' && (
                            <button
                              onClick={() => doAction(t.id, 'grant-access')}
                              disabled={!!actionLoading[t.id]}
                              className="text-xs px-2.5 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 disabled:opacity-40 font-medium"
                            >
                              {actionLoading[t.id] === 'grant-access' ? '…' : 'Grant Access'}
                            </button>
                          )}
                          <button
                            onClick={() => setExpandedTenant(expandedTenant === t.id ? null : t.id)}
                            className="text-xs px-2.5 py-1 bg-slate-50 text-slate-600 rounded hover:bg-slate-100 font-medium"
                          >
                            {expandedTenant === t.id ? 'Hide Users' : 'Users'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedTenant === t.id && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <TenantUsersPanel tenantId={t.id} />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* INVOICES TAB */}
      {tab === 'invoices' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <select
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
              value={invStatusFilter}
              onChange={e => setInvStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="paid">Paid</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
              <option value="open">Open</option>
            </select>
            <span className="text-xs text-gray-400 ml-auto">
              {filteredInvoices.length} records
            </span>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Seller</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Plan</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Period</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Invoice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredInvoices.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">
                        {invoices.length === 0
                          ? 'No payments yet. Invoices will appear here once sellers subscribe.'
                          : 'No invoices match your filter.'}
                      </td>
                    </tr>
                  )}
                  {filteredInvoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center text-orange-700 text-xs font-bold">
                            {(inv.tenant_name || '?')[0].toUpperCase()}
                          </div>
                          <span className="font-medium text-gray-800">{inv.tenant_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">
                        {fmt$(inv.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          inv.status === 'paid'     ? 'bg-green-100 text-green-700' :
                          inv.status === 'failed'   ? 'bg-red-100 text-red-700' :
                          inv.status === 'refunded' ? 'bg-gray-100 text-gray-500' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {inv.plan ? <PlanBadge plan={inv.plan} /> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {inv.period_start ? (
                          <>{fmtDate(inv.period_start)} – {fmtDate(inv.period_end)}</>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {fmtDate(inv.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {inv.invoice_url ? (
                          <a
                            href={inv.invoice_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-orange-600 hover:underline"
                          >
                            View →
                          </a>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invoices.length > 0 && (
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50">
                <p className="text-xs text-gray-400">
                  Total revenue: <strong className="text-green-600">
                    {fmt$(invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0))}
                  </strong>
                </p>
                <p className="text-xs text-gray-400">
                  Showing {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? 's' : ''}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* WAITLIST TAB */}
      {tab === 'waitlist' && (
        <WaitlistPanel waitlist={waitlist} setWaitlist={setWaitlist} />
      )}
    </div>
  )
}

// ── Waitlist panel ────────────────────────────────────────────────────────────
function WaitlistPanel({ waitlist, setWaitlist }) {
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (waitlist !== null) return
    setLoading(true)
    fetch('/api/admin/waitlist', { headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` } })
      .then(r => r.json())
      .then(setWaitlist)
      .catch(() => setWaitlist([]))
      .finally(() => setLoading(false))
  }, [waitlist, setWaitlist])

  const exportCSV = async () => {
    const t = localStorage.getItem('crm_token')
    const res = await fetch('/api/admin/waitlist/export.csv', { headers: { Authorization: `Bearer ${t}` } })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'waitlist.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="py-10 text-center text-sm text-gray-400">Loading waitlist…</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{waitlist?.length ?? 0} signups</p>
        <button onClick={exportCSV} className="text-xs px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 font-medium border border-green-200">
          ↓ Export CSV
        </button>
      </div>
      {!waitlist?.length ? (
        <div className="py-10 text-center text-sm text-gray-400">No waitlist signups yet. Share <span className="font-medium text-gray-600">sellers-pulse.com/waitlist</span> to start collecting.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Company</th>
                <th className="pb-2 pr-4">Monthly GMV</th>
                <th className="pb-2 pr-4">Notes</th>
                <th className="pb-2">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {waitlist.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="py-2.5 pr-4 font-medium text-gray-800">{e.name || '—'}</td>
                  <td className="py-2.5 pr-4 text-blue-600">{e.email}</td>
                  <td className="py-2.5 pr-4 text-gray-600">{e.company || '—'}</td>
                  <td className="py-2.5 pr-4 text-gray-600">{e.monthly_gmv || '—'}</td>
                  <td className="py-2.5 pr-4 text-gray-500 max-w-xs truncate">{e.notes || '—'}</td>
                  <td className="py-2.5 text-gray-400 text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function LockIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  )
}
function RefreshIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}
