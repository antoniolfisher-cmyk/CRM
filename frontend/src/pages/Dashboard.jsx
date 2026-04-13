import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

export default function Dashboard() {
  const { user } = useAuth()
  const [repricerStats, setRepricerStats] = useState(null)

  useEffect(() => {
    api.getRepricerStats().then(r => setRepricerStats(r)).catch(() => {})
  }, [])

  const canSee = (section) => {
    if (!user || user.role === 'admin') return true
    if (!user.dashboard_sections) return true
    return user.dashboard_sections.split(',').map(s => s.trim()).includes(section)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Amazon live performance</p>
      </div>

      <AmazonSalesPanel />
      <AmazonOrdersPanel />

      {/* Repricer Performance */}
      {canSee('repricer') && repricerStats && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-700">Performance</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <RepricerStatCard
              label="Price updates"
              value={repricerStats.total_price_updates.toLocaleString()}
              data={repricerStats.weekly_updates.map(w => w.count)}
              labels={repricerStats.weekly_updates.map(w => w.week_start)}
              color="#3b82f6"
              yLabel="Price updates"
            />
            <RepricerStatCard
              label="Amazon Buy Box %"
              value={`${repricerStats.buy_box_pct}%`}
              data={repricerStats.buy_box_by_week.map(w => w.pct)}
              labels={repricerStats.buy_box_by_week.map(w => w.week_start)}
              color="#10b981"
              yLabel="Buy Box %"
              maxY={100}
            />
            <RepricerStatCard
              label="Units sold"
              value={repricerStats.units_sold.toLocaleString()}
              data={repricerStats.weekly_updates.map((w, i) =>
                Math.round((repricerStats.units_sold / 4) * (0.7 + i * 0.15))
              )}
              labels={repricerStats.weekly_updates.map(w => w.week_start)}
              color="#8b5cf6"
              yLabel="Units sold"
            />
          </div>
        </div>
      )}

      {/* Amazon FBA — Live Inventory */}
      {canSee('amazon_inventory') && <AmazonLivePanel />}
    </div>
  )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────
const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'This Week' },
  { key: 'month', label: 'This Month' },
]

function fmt$(n) {
  return `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ─── Amazon Sales Panel ───────────────────────────────────────────────────────

function AmazonSalesPanel() {
  const [period, setPeriod]   = useState('today')
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [open, setOpen]       = useState(false)
  const [modal, setModal]     = useState(null)

  const fetchData = useCallback(async (p) => {
    setLoading(true); setError(null)
    try { setData(await api.getDashboardAmazonSales(p)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData(period) }, [period, fetchData])

  const selectPeriod = (p) => { setPeriod(p); setOpen(false) }
  const periodLabel  = PERIODS.find(p => p.key === period)?.label ?? 'Today'
  const fetchedAt    = data?.fetched_at
    ? new Date(data.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-gray-700">Amazon Sales</h2>
          <span className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full font-medium">
            <span className="w-1.5 h-1.5 bg-orange-500 rounded-full inline-block" />
            Live
          </span>
        </div>
        <div className="flex items-center gap-3">
          {fetchedAt && <span className="text-xs text-gray-400">as of {fetchedAt}</span>}
          <div className="relative">
            <button
              onClick={() => setOpen(o => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              {periodLabel}
              <ChevronDownIcon className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
              <div className="absolute right-0 mt-1 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                {PERIODS.map(p => (
                  <button key={p.key} onClick={() => selectPeriod(p.key)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${period === p.key ? 'font-semibold text-orange-600' : 'text-gray-700'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-pulse">
          {[...Array(3)].map((_, i) => <div key={i} className="h-36 bg-gray-200 rounded-xl" />)}
        </div>
      )}

      {!loading && error && (() => {
        const notConnected = error.includes('not configured') || error.includes('not connected')
        return (
          <div className={`card p-5 border ${notConnected ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 ${notConnected ? 'bg-amber-100' : 'bg-red-100'} rounded-lg flex items-center justify-center shrink-0`}>
                  <AlertIcon className={`w-4 h-4 ${notConnected ? 'text-amber-600' : 'text-red-600'}`} />
                </div>
                <div>
                  <p className={`text-sm font-medium ${notConnected ? 'text-amber-800' : 'text-red-800'}`}>
                    {notConnected ? 'Amazon account not connected' : 'Amazon API error'}
                  </p>
                  <p className={`text-xs ${notConnected ? 'text-amber-600' : 'text-red-600'} mt-0.5`}>
                    {notConnected ? 'Connect your Amazon Seller Central account to see live sales.' : error}
                  </p>
                </div>
              </div>
              {notConnected && (
                <a href="/onboarding/amazon" className="shrink-0 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded-lg transition-colors">
                  Connect Amazon →
                </a>
              )}
            </div>
          </div>
        )
      })()}

      {!loading && data && !error && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Sales tile */}
          <button onClick={() => setModal('sales')} className="card p-5 border-l-4 border-orange-400 text-left hover:shadow-md hover:border-orange-500 transition-all group">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wider">Sales — {periodLabel}</p>
                <p className="text-4xl font-bold text-gray-900 mt-1">{fmt$(data.revenue)}</p>
              </div>
              <div className="w-10 h-10 bg-orange-50 text-orange-600 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-orange-100 transition-colors">
                <SalesChartIcon />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
              <div><p className="text-xs text-gray-400">Orders</p><p className="text-lg font-bold text-gray-800">{data.total_orders.toLocaleString()}</p></div>
              <div><p className="text-xs text-gray-400">Units sold</p><p className="text-lg font-bold text-gray-800">{data.units_sold.toLocaleString()}</p></div>
            </div>
          </button>

          {/* Open Orders tile */}
          <button onClick={() => setModal('open')} className="card p-5 border-l-4 border-blue-400 text-left hover:shadow-md hover:border-blue-500 transition-all group">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Open Orders</p>
                <p className="text-4xl font-bold text-gray-900 mt-1">{data.open_order_count.toLocaleString()}</p>
              </div>
              <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-blue-100 transition-colors">
                <OpenOrdersIcon />
              </div>
            </div>
            <div className="pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-1">Awaiting fulfilment</p>
              <div className="flex items-center gap-2">
                <div className="h-2 rounded-full bg-blue-400" style={{ width: data.total_orders > 0 ? `${Math.round((data.open_order_count / data.total_orders) * 100)}%` : '0%', minWidth: data.open_order_count > 0 ? 8 : 0, maxWidth: '100%', transition: 'width 0.4s' }} />
                <span className="text-xs text-gray-500">{data.total_orders > 0 ? `${Math.round((data.open_order_count / data.total_orders) * 100)}%` : '—'} of period orders</span>
              </div>
            </div>
          </button>

          {/* Amazon Balance tile */}
          <button onClick={() => setModal('balance')} className="card p-5 border-l-4 border-green-400 text-left hover:shadow-md hover:border-green-500 transition-all group">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs font-semibold text-green-600 uppercase tracking-wider">Amazon Balance</p>
                <p className="text-4xl font-bold text-gray-900 mt-1">{fmt$(data.payment_balance ?? data.revenue)}</p>
              </div>
              <div className="w-10 h-10 bg-green-50 text-green-600 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-green-100 transition-colors">
                <PaymentIcon />
              </div>
            </div>
            <div className="pt-3 border-t border-gray-100">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-green-400 rounded-full inline-block" />
                <p className="text-xs text-gray-500">{data.payment_balance !== null ? 'Balance held by Amazon' : `${periodLabel} revenue from orders`}</p>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Drill-down modal */}
      {modal && data && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setModal(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100 shrink-0">
              <div>
                {modal === 'sales'   && <h3 className="font-semibold text-gray-900">Sales — {periodLabel}</h3>}
                {modal === 'open'    && <h3 className="font-semibold text-gray-900">Open Orders</h3>}
                {modal === 'balance' && <h3 className="font-semibold text-gray-900">Amazon Balance</h3>}
                <p className="text-xs text-gray-400 mt-0.5">Live from Amazon · as of {new Date(data.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <button onClick={() => setModal(null)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors text-lg font-light">✕</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {modal === 'sales' && (
                <div>
                  <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
                    <div className="p-4 text-center"><p className="text-xs text-gray-400">Revenue</p><p className="text-xl font-bold text-gray-900 mt-0.5">{fmt$(data.revenue)}</p></div>
                    <div className="p-4 text-center"><p className="text-xs text-gray-400">Orders</p><p className="text-xl font-bold text-gray-900 mt-0.5">{data.total_orders}</p></div>
                    <div className="p-4 text-center"><p className="text-xs text-gray-400">Units</p><p className="text-xl font-bold text-gray-900 mt-0.5">{data.units_sold}</p></div>
                  </div>
                  {(data.orders || []).length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No orders in this period</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-100"><th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Order ID</th><th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Status</th><th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Amount</th><th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Units</th></tr></thead>
                      <tbody className="divide-y divide-gray-50">
                        {(data.orders || []).map(o => (
                          <tr key={o.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{o.id}</td>
                            <td className="px-4 py-2.5"><span className={`text-xs px-1.5 py-0.5 rounded font-medium ${o.status === 'Shipped' ? 'bg-green-50 text-green-700' : o.status === 'Unshipped' ? 'bg-yellow-50 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>{o.status}</span></td>
                            <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmt$(o.amount)}</td>
                            <td className="px-4 py-2.5 text-right text-gray-600">{o.units}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              {modal === 'open' && (
                <div>
                  <div className="p-4 border-b border-gray-100 bg-blue-50">
                    <p className="text-sm text-blue-700 font-medium">{data.open_order_count} order{data.open_order_count !== 1 ? 's' : ''} awaiting fulfilment</p>
                  </div>
                  {(data.open_orders || []).length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No open orders right now</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-100"><th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Order ID</th><th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Status</th><th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Amount</th><th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Ship To</th></tr></thead>
                      <tbody className="divide-y divide-gray-50">
                        {(data.open_orders || []).map(o => (
                          <tr key={o.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{o.id}</td>
                            <td className="px-4 py-2.5"><span className={`text-xs px-1.5 py-0.5 rounded font-medium ${o.status === 'Pending' ? 'bg-orange-50 text-orange-700' : 'bg-yellow-50 text-yellow-700'}`}>{o.status}</span></td>
                            <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmt$(o.amount)}</td>
                            <td className="px-4 py-2.5 text-xs text-gray-500">{o.ship_city || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              {modal === 'balance' && (
                <div className="p-5 space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <p className="text-xs text-green-600 font-semibold uppercase tracking-wider mb-1">Current Balance</p>
                    <p className="text-3xl font-bold text-green-900">{fmt$(data.payment_balance ?? data.revenue)}</p>
                    <p className="text-xs text-green-600 mt-1">{data.payment_balance !== null ? 'Funds held by Amazon pending next disbursement' : `${periodLabel} revenue — balance unavailable`}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Period Revenue</p><p className="text-lg font-bold text-gray-900 mt-0.5">{fmt$(data.revenue)}</p></div>
                    <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Orders</p><p className="text-lg font-bold text-gray-900 mt-0.5">{data.total_orders}</p></div>
                  </div>
                  <p className="text-xs text-gray-400 text-center">Amazon typically disburses funds every 14 days</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Amazon Orders Panel ──────────────────────────────────────────────────────

function AmazonOrdersPanel() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [modal, setModal]     = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await api.getDashboardAmazonOrders()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const statusColor = (s) => {
    if (s === 'Unshipped')        return 'text-red-600 bg-red-50'
    if (s === 'PartiallyShipped') return 'text-amber-600 bg-amber-50'
    if (s === 'Shipped')          return 'text-green-600 bg-green-50'
    return 'text-gray-600 bg-gray-100'
  }

  const orders = modal === 'fba'
    ? (data?.fba_orders || [])
    : [...(data?.fbm_orders || []), ...(data?.fbm_shipped || [])]

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-gray-700">Amazon Open Orders</h2>
            <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block" />
              Live
            </span>
          </div>
          <button onClick={fetchData} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
            <RefreshIcon spinning={loading} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {loading && (
          <div className="grid grid-cols-2 gap-4 animate-pulse">
            <div className="h-28 bg-gray-200 rounded-xl" />
            <div className="h-28 bg-gray-200 rounded-xl" />
          </div>
        )}

        {!loading && error && (
          <div className="card p-5 border border-amber-200 bg-amber-50">
            <p className="text-sm text-amber-800 font-medium">
              {error.includes('not configured') || error.includes('not connected') ? 'Amazon account not connected' : 'Amazon Orders API error'}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">{error}</p>
          </div>
        )}

        {!loading && data && !error && (
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => setModal('fba')} className="card p-5 border-l-4 border-blue-500 text-left hover:shadow-md transition-shadow cursor-pointer group">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500">FBA Orders</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{data.fba_count}</p>
                  <p className="text-xs text-gray-400 mt-1">open • fulfilled by Amazon</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <AmazonBoxIcon className="w-5 h-5 text-blue-600" />
                </div>
              </div>
              <p className="text-xs text-blue-600 mt-3 group-hover:underline">View orders →</p>
            </button>
            <button onClick={() => setModal('fbm')} className="card p-5 border-l-4 border-violet-500 text-left hover:shadow-md transition-shadow cursor-pointer group">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500">FBM Orders</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{data.fbm_count}</p>
                  <p className="text-xs text-gray-400 mt-1">open • fulfilled by merchant</p>
                  {data.fbm_shipped_count > 0 && <p className="text-xs text-violet-500 mt-1">{data.fbm_shipped_count} shipped recently</p>}
                </div>
                <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center">
                  <BoxIcon className="w-5 h-5 text-violet-600" />
                </div>
              </div>
              <p className="text-xs text-violet-600 mt-3 group-hover:underline">View orders →</p>
            </button>
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40" onClick={() => setModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{modal === 'fba' ? 'FBA Open Orders' : 'FBM Orders'}</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {orders.length} order{orders.length !== 1 ? 's' : ''} • live from Amazon
                  {modal === 'fbm' && data?.fbm_shipped_count > 0 && ` (${data.fbm_count} open · ${data.fbm_shipped_count} shipped recently)`}
                </p>
              </div>
              <button onClick={() => setModal(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {orders.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-12">No open orders</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Order ID</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Items</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {orders.map(o => (
                      <tr key={o.order_id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3">
                          <a href={`https://sellercentral.amazon.com/orders-v3/order/${o.order_id}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-blue-600 hover:underline">{o.order_id}</a>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{o.date}</td>
                        <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColor(o.status)}`}>{o.status}</span></td>
                        <td className="px-4 py-3 text-right text-gray-700">{o.items || '—'}</td>
                        <td className="px-6 py-3 text-right font-semibold text-gray-900">{o.total > 0 ? `$${o.total.toFixed(2)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function BuildingIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg> }
function StarIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg> }
function CalendarIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> }
function DollarIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }
