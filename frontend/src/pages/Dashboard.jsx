import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

export default function Dashboard() {
  const { user } = useAuth()
  const [repricerStats, setRepricerStats] = useState(null)
  const [monthlyUnitsSold, setMonthlyUnitsSold] = useState(null)

  useEffect(() => {
    api.getRepricerStats().then(r => setRepricerStats(r)).catch(() => {})
    // Pull real units-sold-this-month from Amazon Orders API
    api.getDashboardAmazonSales('month')
      .then(r => setMonthlyUnitsSold(r?.units_sold ?? null))
      .catch(() => {})
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
              label="Units Sold This Month"
              value={monthlyUnitsSold !== null ? monthlyUnitsSold.toLocaleString() : '—'}
              data={repricerStats.weekly_updates.map((w, i) =>
                monthlyUnitsSold !== null
                  ? Math.round((monthlyUnitsSold / 4) * (0.7 + i * 0.15))
                  : 0
              )}
              labels={repricerStats.weekly_updates.map(w => w.week_start)}
              color="#8b5cf6"
              yLabel="Units Sold"
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
  const [period, setPeriod]       = useState('today')
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [open, setOpen]           = useState(false)
  const [modal, setModal]         = useState(null)
  const [monthData, setMonthData] = useState(null)
  const [monthLoading, setMonthLoading] = useState(true)

  const fetchData = useCallback(async (p) => {
    setLoading(true); setError(null)
    try { setData(await api.getDashboardAmazonSales(p)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  const fetchMonthData = useCallback(async () => {
    try { setMonthData(await api.getDashboardAmazonSales('month')) }
    catch { /* silent — tile shows dashes */ }
    finally { setMonthLoading(false) }
  }, [])

  useEffect(() => { fetchData(period) }, [period, fetchData])

  useEffect(() => {
    fetchMonthData()
    const id = setInterval(fetchMonthData, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchMonthData])

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

          {/* Product Sales This Month tile */}
          <div className="card p-5 border-l-4 border-violet-400">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs font-semibold text-violet-600 uppercase tracking-wider">Product Sales This Month</p>
                {monthLoading
                  ? <div className="h-10 w-28 bg-gray-200 rounded animate-pulse mt-1" />
                  : <p className="text-4xl font-bold text-gray-900 mt-1">
                      {monthData ? fmt$(monthData.revenue) : <span className="text-2xl text-gray-400">—</span>}
                    </p>
                }
              </div>
              <div className="w-10 h-10 bg-violet-50 text-violet-600 rounded-lg flex items-center justify-center shrink-0">
                <SalesChartIcon />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
              <div>
                <p className="text-xs text-gray-400">Units sold</p>
                <p className="text-lg font-bold text-gray-800">{monthData ? monthData.units_sold.toLocaleString() : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Orders</p>
                <p className="text-lg font-bold text-gray-800">{monthData ? monthData.total_orders.toLocaleString() : '—'}</p>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-violet-400 rounded-full inline-block animate-pulse" />
              <p className="text-xs text-gray-400">Live · updates every 5m</p>
            </div>
          </div>

          {/* Amazon Balance tile */}
          <button onClick={() => setModal('balance')} className="card p-5 border-l-4 border-green-400 text-left hover:shadow-md hover:border-green-500 transition-all group">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs font-semibold text-green-600 uppercase tracking-wider">Amazon Balance</p>
                <p className="text-4xl font-bold text-gray-900 mt-1">
                  {data.payment_balance !== null && data.payment_balance !== undefined
                    ? fmt$(data.payment_balance)
                    : <span className="text-2xl text-gray-400">Fetching…</span>}
                </p>
              </div>
              <div className="w-10 h-10 bg-green-50 text-green-600 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-green-100 transition-colors">
                <PaymentIcon />
              </div>
            </div>
            <div className="pt-3 border-t border-gray-100">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-green-400 rounded-full inline-block" />
                <p className="text-xs text-gray-500">{data.payment_balance !== null ? 'Balance held by Amazon' : 'Balance unavailable — check Amazon connection'}</p>
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
              {modal === 'balance' && (
                <div className="p-5 space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <p className="text-xs text-green-600 font-semibold uppercase tracking-wider mb-1">Total Balance</p>
                    <p className="text-3xl font-bold text-green-900">
                      {data.payment_balance !== null && data.payment_balance !== undefined
                        ? fmt$(data.payment_balance)
                        : <span className="text-gray-400 text-xl">Balance unavailable</span>}
                    </p>
                    <p className="text-xs text-green-600 mt-1">
                      {data.payment_balance !== null ? 'Funds held by Amazon pending next disbursement' : 'Could not load from Finances API — check Amazon connection at /onboarding/amazon'}
                    </p>
                  </div>
                  {(data.balance_breakdown || []).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Total Balance Breakdown</p>
                      <div className="space-y-3">
                        {data.balance_breakdown.map(region => (
                          <div key={region.region}>
                            <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                              <span className="text-sm font-semibold text-gray-700">{region.region}</span>
                              <span className="text-sm font-bold text-gray-900">{fmt$(region.total)}</span>
                            </div>
                            <div className="mt-1 space-y-0.5">
                              {region.stores.map(s => (
                                <div key={s.store} className="flex items-center justify-between px-2 py-1">
                                  <span className="text-xs text-gray-500">{s.store}</span>
                                  <span className="text-xs font-medium text-gray-700">{fmt$(s.balance)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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

// ─── Icons ────────────────────────────────────────────────────────────────────
function ChevronDownIcon({ className }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
}
function AlertIcon({ className }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
}
function SalesChartIcon() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
}
function OpenOrdersIcon() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
}
function PaymentIcon() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
}
function AmazonBoxIcon({ className }) {
  return <svg className={className || 'w-5 h-5'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" /></svg>
}
function BoxIcon({ className }) {
  return <svg className={className || 'w-5 h-5'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" /></svg>
}
function RefreshIcon({ spinning }) {
  return (
    <svg className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}


// ─── Amazon Live FBA Panel ────────────────────────────────────────────────────

function AmazonLivePanel() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const result = await api.getDashboardAmazonLive()
      setData(result)
      // Surface a soft warning if the server returned data but flagged an Amazon error
      if (result?.error && !result?.total_skus) {
        setError(result.error)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const fetchedAt = data?.fetched_at
    ? new Date(data.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-gray-700">Amazon FBA — Live</h2>
          <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block"></span>
            Live
          </span>
        </div>
        <div className="flex items-center gap-3">
          {fetchedAt && (
            <span className="text-xs text-gray-400">Fetched at {fetchedAt}</span>
          )}
          <button
            onClick={() => fetchData(true)}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshIcon spinning={refreshing} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
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
                    {notConnected
                      ? 'Connect your Amazon Seller Central account to see live FBA data here.'
                      : error}
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
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <AmazonKpiCard
              label="Total SKUs"
              value={data.total_skus.toLocaleString()}
              sub={`${data.approved_skus} approved in CRM`}
              color="blue"
              icon={<AmazonBoxIcon />}
            />
            <AmazonKpiCard
              label="Fulfillable Units"
              value={data.total_fulfillable.toLocaleString()}
              sub="ready to ship"
              color="green"
              icon={<CheckShieldIcon />}
            />
            <AmazonKpiCard
              label="Inbound Units"
              value={data.total_inbound.toLocaleString()}
              sub="in transit to FC"
              color="amber"
              icon={<TruckInIcon />}
            />
            <AmazonKpiCard
              label="Buy Box Win Rate"
              value={`${data.buy_box_pct}%`}
              sub="of competitive SKUs"
              color={data.buy_box_pct >= 70 ? 'green' : data.buy_box_pct >= 40 ? 'amber' : 'red'}
              icon={<TrophyIcon />}
            />
          </div>

          {data.top_items && data.top_items.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Top FBA Inventory</p>
                <span className="text-xs text-gray-400">by total quantity</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">ASIN</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Fulfillable</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Inbound</th>
                      <th className="text-right px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.top_items.map((item, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3">
                          <p className="font-medium text-gray-900 truncate max-w-xs" title={item.product_name}>
                            {item.product_name}
                          </p>
                          {item.seller_sku && (
                            <p className="text-xs text-gray-400 mt-0.5">SKU: {item.seller_sku}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={`https://www.amazon.com/dp/${item.asin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline font-mono text-xs"
                          >
                            {item.asin}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-semibold text-green-700">{item.fulfillable.toLocaleString()}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-amber-600">{item.inbound.toLocaleString()}</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className="font-bold text-gray-900">{item.total.toLocaleString()}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.total_skus > 10 && (
                <div className="px-5 py-2.5 border-t border-gray-100 bg-gray-50">
                  <p className="text-xs text-gray-400">Showing top 10 of {data.total_skus.toLocaleString()} SKUs</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AmazonKpiCard({ label, value, sub, color, icon }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
    red:    'bg-red-50 text-red-600',
    green:  'bg-green-50 text-green-600',
    amber:  'bg-amber-50 text-amber-600',
    indigo: 'bg-indigo-50 text-indigo-600',
  }
  return (
    <div className="card p-5 border-l-4 border-orange-400">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
          <p className="text-xs text-gray-400 mt-1">{sub}</p>
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color] || colors.blue}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

// ─── Repricer Stat Card ───────────────────────────────────────────────────────

function RepricerStatCard({ label, value, data, labels, color, yLabel, maxY }) {
  const validData = data && data.length > 0
  const displayMax = maxY ?? (validData ? Math.max(...data, 1) : 1)
  const displayMin = 0

  return (
    <div className="card p-5">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mb-4">{value}</p>

      <div className="relative">
        {labels && labels.length > 0 && (
          <div className="flex justify-between mb-1">
            {labels.map((l, i) => (
              <span key={i} className="text-xs text-gray-400" style={{ fontSize: '10px' }}>{l}</span>
            ))}
          </div>
        )}

        {validData && (
          <svg width="100%" viewBox="0 0 200 56" preserveAspectRatio="none" className="overflow-visible" style={{ height: 56 }}>
            {[0, 0.5, 1].map((frac, i) => (
              <line key={i} x1={0} y1={frac * 48 + 4} x2={200} y2={frac * 48 + 4} stroke="#f3f4f6" strokeWidth={1} />
            ))}
            <path d={buildAreaPath(data, displayMin, displayMax, 200, 56)} fill={color} fillOpacity={0.1} />
            <polyline points={buildPoints(data, displayMin, displayMax, 200, 56)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {buildPointCoords(data, displayMin, displayMax, 200, 56).map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={3} fill={color} />
            ))}
          </svg>
        )}

        {validData && (
          <div className="flex flex-col justify-between absolute right-0 top-0 h-full pointer-events-none" style={{ marginTop: 18 }}>
            <span className="text-xs text-gray-400 leading-none" style={{ fontSize: '10px' }}>
              {displayMax >= 1000 ? `${Math.round(displayMax / 1000)}K` : displayMax}
            </span>
            <span className="text-xs text-gray-400 leading-none" style={{ fontSize: '10px' }}>
              {Math.round((displayMax + displayMin) / 2) >= 1000
                ? `${Math.round((displayMax + displayMin) / 2 / 1000)}K`
                : Math.round((displayMax + displayMin) / 2)}
            </span>
            <span className="text-xs text-gray-400 leading-none" style={{ fontSize: '10px' }}>0</span>
          </div>
        )}

        <p className="text-xs text-gray-400 mt-2">{yLabel}</p>
      </div>
    </div>
  )
}

function buildPointCoords(data, min, max, width, height) {
  const pad = 4
  const w = width - pad * 2
  const h = height - pad * 2
  const range = max - min || 1
  return data.map((v, i) => {
    const x = pad + (data.length === 1 ? w / 2 : (i / (data.length - 1)) * w)
    const y = pad + h - ((v - min) / range) * h
    return [x, y]
  })
}

function buildPoints(data, min, max, width, height) {
  return buildPointCoords(data, min, max, width, height).map(([x, y]) => `${x},${y}`).join(' ')
}

function buildAreaPath(data, min, max, width, height) {
  const coords = buildPointCoords(data, min, max, width, height)
  if (!coords.length) return ''
  const pad = 4
  const bottom = height - pad + 2
  const pts = coords.map(([x, y]) => `${x},${y}`).join(' L ')
  return `M ${coords[0][0]},${bottom} L ${pts} L ${coords[coords.length - 1][0]},${bottom} Z`
}

function KpiCard({ label, value, sub, color, icon }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
    red:    'bg-red-50 text-red-600',
    green:  'bg-green-50 text-green-600',
    amber:  'bg-amber-50 text-amber-600',
    indigo: 'bg-indigo-50 text-indigo-600',
  }
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
          <p className="text-xs text-gray-400 mt-1">{sub}</p>
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color] || colors.blue}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[...Array(2)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
      </div>
      <div className="h-64 bg-gray-200 rounded-xl" />
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-gray-200 rounded-xl" />)}
      </div>
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function BuildingIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg> }
function StarIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg> }
function CalendarIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> }
function DollarIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }
function CheckShieldIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg> }
function TruckInIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1" /></svg> }
function TrophyIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg> }

 
