import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

const ACTION_COLORS = {
  'auth.login':               'bg-blue-100 text-blue-700',
  'user.create':              'bg-green-100 text-green-700',
  'user.delete':              'bg-red-100 text-red-700',
  'user.unlock':              'bg-yellow-100 text-yellow-700',
  'tenant.suspend':           'bg-red-100 text-red-700',
  'tenant.activate':          'bg-green-100 text-green-700',
  'tenant.grant_access':      'bg-purple-100 text-purple-700',
  'tenant.plan_change':       'bg-orange-100 text-orange-700',
  'amazon.credentials.save':  'bg-teal-100 text-teal-700',
}

function ActionBadge({ action }) {
  const cls = ACTION_COLORS[action] || 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {action}
    </span>
  )
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default function AuditLog() {
  const [rows, setRows]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [tenantFilter, setTenantFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [offset, setOffset]       = useState(0)
  const LIMIT = 100

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = { limit: LIMIT, offset }
      if (tenantFilter) params.tenant_id = tenantFilter
      if (actionFilter) params.action    = actionFilter
      const data = await api.getAuditLog(params)
      setRows(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [tenantFilter, actionFilter, offset])

  useEffect(() => { load() }, [load])

  const handleFilter = (e) => {
    e.preventDefault()
    setOffset(0)
    load()
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-0.5">Platform-wide security and admin activity log</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Filters */}
      <form onSubmit={handleFilter} className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Tenant ID</label>
          <input
            type="number"
            value={tenantFilter}
            onChange={e => setTenantFilter(e.target.value)}
            placeholder="Any"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Action contains</label>
          <input
            type="text"
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            placeholder="e.g. login"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <button type="submit" className="px-4 py-1.5 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600">
          Filter
        </button>
        {(tenantFilter || actionFilter) && (
          <button
            type="button"
            onClick={() => { setTenantFilter(''); setActionFilter(''); setOffset(0) }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        )}
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Time</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tenant</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Target</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Detail</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-sm">
                      No audit log entries yet. Actions like logins, credential saves, and user management will appear here.
                    </td>
                  </tr>
                )}
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-2.5"><ActionBadge action={r.action} /></td>
                    <td className="px-4 py-2.5 text-xs font-medium text-gray-700">{r.username || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{r.tenant_id ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{r.target || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-400 max-w-xs truncate" title={r.detail}>{r.detail || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">{r.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50">
            <span className="text-xs text-gray-400">Showing {rows.length} entries</span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                disabled={offset === 0}
                className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setOffset(offset + LIMIT)}
                disabled={rows.length < LIMIT}
                className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
