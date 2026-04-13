import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

export default function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [repricerStats, setRepricerStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tenantInfo, setTenantInfo] = useState(null)

  useEffect(() => {
    Promise.all([api.getDashboard(), api.getRepricerStats()])
      .then(([s, r]) => { setStats(s); setRepricerStats(r) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    api.getTenantMe().catch(() => {})
      .then(t => setTenantInfo(t))
  }, [])

  // Section visibility: admins and users with no restriction see everything.
  // Users with dashboard_sections set only see the listed sections.
  const canSee = (section) => {
    if (!user || user.role === 'admin') return true
    if (!user.dashboard_sections) return true
    return user.dashboard_sections.split(',').map(s => s.trim()).includes(section)
  }

  if (loading) return <LoadingSkeleton />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Wholesale distribution overview</p>
      </div>

      <SetupChecklist user={user} tenantInfo={tenantInfo} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Active Accounts"
          value={stats.active_accounts}
          sub={`${stats.total_accounts} total`}
          color="blue"
          icon={<BuildingIcon />}
        />
        <KpiCard
          label="Prospects"
          value={stats.prospect_accounts}
          sub="to convert"
          color="purple"
          icon={<StarIcon />}
        />
        <KpiCard
          label="Overdue Follow-Ups"
          value={stats.follow_ups_overdue}
          sub="need attention"
          color={stats.follow_ups_overdue > 0 ? 'red' : 'green'}
          icon={<AlertIcon />}
        />
        <KpiCard
          label="Due This Week"
          value={stats.follow_ups_this_week}
          sub={`${stats.follow_ups_due_today} due today`}
          color="amber"
          icon={<CalendarIcon />}
        />
      </div>

      {/* Order KPIs */}
      <div className="grid grid-cols-2 gap-4">
        <KpiCard
          label="Open Orders"
          value={stats.open_orders}
          sub="pending / confirmed"
          color="indigo"
          icon={<BoxIcon />}
        />
        <KpiCard
          label="Pipeline Value"
          value={`$${stats.total_order_value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub="active orders"
          color="green"
          icon={<DollarIcon />}
        />
      </div>

      {/* Amazon Sales Panel */}
      {canSee('amazon_sales') && <AmazonSalesPanel />}

      {/* Amazon FBA + FBM Open Orders */}
      {canSee('amazon_orders') && <AmazonOrdersPanel />}

      {/* Amazon Live FBA Section */}
      {canSee('amazon_inventory') && <AmazonLivePanel />}

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
    </div>
  )
}

// ─── Setup Checklist ─────────────────────────────────────────────────────────

function SetupChecklist({ user, tenantInfo }) {
  const items = [
    {
      done: !!(user?.store_name || (user?.tenant_name && user.tenant_name !== 'Default')),
      label: 'Set your store / business name',
      desc: 'Appears in the sidebar and email templates',
      link: '/profile',
      linkText: 'Go to Profile →',
    },
    {
      done: !!tenantInfo?.amazon_connected,
      label: 'Connect your Amazon Seller account',
      desc: 'Pulls live inventory, orders, and sales data',
      link: '/onboarding/amazon',
      linkText: 'Connect Amazon →',
    },
    {
      done: !!user?.email,
      label: 'Add your notification email',
      desc: 'Receive alerts for follow-ups and supplier replies',
      link: '/profile',
      linkText: 'Go to Profile →',
    },
  ]
  const incomplete = items.filter(i => !i.done)
  if (incomplete.length === 0) return null
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center">
          <span className="text-orange-600 text-xs font-bold">{incomplete.length}</span>
        </div>
        <h2 className="font-semibold text-gray-900">Complete your setup</h2>
        <span className="text-xs text-gray-400 ml-auto">{items.length - incomplete.length}/{items.length} done</span>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className={`flex items-start gap-3 p-3 rounded-lg ${item.done ? 'opacity-50' : 'bg-orange-50 border border-orange-100'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${item.done ? 'bg-green-500' : 'border-2 border-orange-300'}`}>
              {item.done && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${item.done ? 'text-gray-500 line-through' : 'text-gray-800'}`}>{item.label}</p>
              {!item.done && <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>}
            </div>
            {!item.done && (
              <a href={item.link} className="text-xs text-orange-600 hover:text-orange-700 font-medium shrink-0 mt-0.5">{item.linkText}</a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Amazon Sales Panel ───────────────────────────────────────────────────────

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'This Week' },
  { key: 'month', label: 'This Month' },
]

function AmazonSalesPanel() {
  const [period, setPeriod] = useState('today')
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [open, setOpen]     = useState(false)   // period dropdown

  const fetchData = useCallback(async (p) => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.getDashboardAmazonSales(p)
      setData(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(period) }, [period, fetchData])

  const selectPeriod = (p) => { setPeriod(p); setOpen(false) }
  const fmt$ = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const periodLabel = PERIODS.find(p => p.key === period)?.label ?? 'Today'
  const fetchedAt = data?.fetched_at
    ? new Date(data.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-gray-700">Amazon Sales</h2>
          <span className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full font-medium">
            <span className="w-1.5 h-1.5 bg-orange-500 rounded-full inline-block"></span>
            Live
          </span>
        </div>
        <div className="flex items-center gap-3">
          {fetchedAt && <span className="text-xs text-gray-400">as of {fetchedAt}</span>}
          {/* Period dropdown */}
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
                  <button
                    key={p.key}
                    onClick={() => selectPeriod(p.key)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${period === p.key ? 'font-semibold text-orange-600' : 'text-gray-700'}`}
                  >
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
                    {notConnected
                      ? 'Connect your Amazon Seller Central account to see live sales and orders here.'
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Sales tile */}
          <div className="card p-5 border-l-4 border-orange-400">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wider">Sales — {periodLabel}</p>
                <p className="text-4xl font-bold text-gray-900 mt-1">{fmt$(data.revenue)}</p>
              </div>
              <div className="w-10 h-10 bg-orange-50 text-orange-600 rounded-lg flex items-center justify-center shrink-0">
                <SalesChartIcon />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
              <div>
                <p className="text-xs text-gray-400">Orders</p>
                <p className="text-lg font-bold text-gray-800">{data.total_orders.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Units sold</p>
                <p className="text-lg font-bold text-gray-800">{data.units_sold.toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Open Orders tile */}
          <div className="card p-5 border-l-4 border-blue-400">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Open Orders</p>
                <p className="text-4xl font-bold text-gray-900 mt-1">{data.open_order_count.toLocaleString()}</p>
              </div>
              <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center shrink-0">
                <OpenOrdersIcon />
              </div>
            </div>
            <div className="pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-1">Awaiting fulfilment</p>
              <div className="flex items-center gap-2">
                <div
                  className="h-2 rounded-full bg-blue-400"
                  style={{ width: data.total_orders > 0 ? `${Math.round((data.open_order_count / data.total_orders) * 100)}%` : '0%', minWidth: data.open_order_count > 0 ? 8 : 0, maxWidth: '100%', transition: 'width 0.4s' }}
                />
                <span className="text-xs text-gray-500">
                  {data.total_orders > 0 ? `${Math.round((data.open_order_count / data.total_orders) * 100)}%` : '—'} of period orders
                </span>
              </div>
            </div>
          </div>

          {/* Payments tile */}
          <div className="card p-5 border-l-4 border-green-400">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs font-semibold text-green-600 uppercase tracking-wider">Payments</p>
                {data.payment_balance !== null ? (
                  <p className="text-4xl font-bold text-gray-900 mt-1">{fmt$(data.payment_balance)}</p>
                ) : (
                  <p className="text-lg font-semibold text-gray-400 mt-2">
                    {data.finances_error === 'Finances role not enabled'
                      ? 'Enable Finances role'
                      : data.finances_error
                        ? 'Unavailable'
                        : '—'}
                  </p>
                )}
              </div>
              <div className="w-10 h-10 bg-green-50 text-green-600 rounded-lg flex items-center justify-center shrink-0">
                <PaymentIcon />
              </div>
            </div>
            <div className="pt-3 border-t border-gray-100">
              {data.payment_balance !== null ? (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-green-400 rounded-full inline-block"></span>
                  <p className="text-xs text-gray-500">Total balance held by Amazon</p>
                </div>
              ) : (
                <p className="text-xs text-gray-400">
                  {data.finances_error === 'Finances role not enabled'
                    ? 'Grant Finances role in Seller Central → SP-API app permissions'
                    : 'Add Finances API role to your SP-API app'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
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

// ─── Amazon Orders Panel ─────────────────────────────────────────────────────

function AmazonOrdersPanel() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [modal, setModal]     = useState(null) // 'fba' | 'fbm' | null

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.getDashboardAmazonOrders())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const statusColor = (s) => {
    if (s === 'Unshipped')        return 'text-red-600 bg-red-50'
    if (s === 'PartiallyShipped') return 'text-amber-600 bg-amber-50'
    if (s === 'Shipped')          return 'text-green-600 bg-green-50'
    return 'text-gray-600 bg-gray-100'
  }

  const [shippingOrder, setShippingOrder] = useState(null)

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
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
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
              {error.includes('not configured') || error.includes('not connected')
                ? 'Amazon account not connected'
                : 'Amazon Orders API error'}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">{error}</p>
          </div>
        )}

        {!loading && data && !error && (
          <div className="grid grid-cols-2 gap-4">
            {/* FBA Orders */}
            <button
              onClick={() => setModal('fba')}
              className="card p-5 border-l-4 border-blue-500 text-left hover:shadow-md transition-shadow cursor-pointer group"
            >
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

            {/* FBM Orders */}
            <button
              onClick={() => setModal('fbm')}
              className="card p-5 border-l-4 border-violet-500 text-left hover:shadow-md transition-shadow cursor-pointer group"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500">FBM Orders</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{data.fbm_count}</p>
                  <p className="text-xs text-gray-400 mt-1">open • fulfilled by merchant</p>
                  {data.fbm_shipped_count > 0 && (
                    <p className="text-xs text-violet-500 mt-1">{data.fbm_shipped_count} shipped recently</p>
                  )}
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

      {/* Buy Shipping modal */}
      {shippingOrder && (
        <BuyShippingModal
          order={shippingOrder}
          onClose={() => setShippingOrder(null)}
        />
      )}

      {/* Orders modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40" onClick={() => setModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  {modal === 'fba' ? 'FBA Open Orders' : 'FBM Orders'}
                </h3>
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
                      {modal === 'fbm' && <th className="px-4 py-3" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {orders.map(o => (
                      <tr key={o.order_id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3">
                          <a
                            href={`https://sellercentral.amazon.com/orders-v3/order/${o.order_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-xs text-blue-600 hover:underline"
                          >
                            {o.order_id}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{o.date}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColor(o.status)}`}>
                            {o.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">{o.items || '—'}</td>
                        <td className="px-6 py-3 text-right font-semibold text-gray-900">
                          {o.total > 0 ? `$${o.total.toFixed(2)}` : '—'}
                        </td>
                        {modal === 'fbm' && (
                          <td className="px-4 py-3">
                            {(o.status === 'Unshipped' || o.status === 'Pending') && (
                              <button
                                onClick={() => setShippingOrder(o)}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors whitespace-nowrap"
                              >
                                <PrinterIcon className="w-3 h-3" /> Buy Shipping
                              </button>
                            )}
                          </td>
                        )}
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

// ─── Buy Shipping Modal ───────────────────────────────────────────────────────

function BuyShippingModal({ order, onClose }) {
  const [step, setStep]               = useState('address') // 'address' | 'rates' | 'label'
  const [shipFrom, setShipFrom]       = useState({ name: '', address1: '', address2: '', city: '', state: '', zip: '', country: 'US', phone: '' })
  const [pkg, setPkg]                 = useState({ length: '12', width: '9', height: '4', weight: '16', weight_unit: 'oz' })
  const [shipInfo, setShipInfo]       = useState(null)
  const [rates, setRates]             = useState([])
  const [selectedRate, setSelectedRate] = useState(null)
  const [label, setLabel]             = useState(null)
  const [loading, setLoading]         = useState(true)
  const [working, setWorking]         = useState(false)
  const [error, setError]             = useState(null)

  useEffect(() => {
    Promise.all([
      api.getShipFrom().catch(() => ({})),
      api.getOrderShipInfo(order.order_id).catch(e => ({ _error: e.message })),
    ]).then(([sf, info]) => {
      if (sf && Object.keys(sf).length) setShipFrom(prev => ({ ...prev, ...sf }))
      if (info && !info._error) setShipInfo(info)
      else if (info?._error) setError(info._error)
      setLoading(false)
    })
  }, [order.order_id])

  const getRates = async () => {
    if (!shipInfo) return
    setWorking(true); setError(null)
    try {
      await api.saveShipFrom(shipFrom).catch(() => {})
      const result = await api.getFbmRates({
        order_id:  order.order_id,
        items:     shipInfo.items,
        ship_from: shipFrom,
        package:   pkg,
      })
      setRates(result.services || [])
      setStep('rates')
    } catch (e) { setError(e.message) }
    finally { setWorking(false) }
  }

  const purchaseLabel = async () => {
    if (!selectedRate) return
    setWorking(true); setError(null)
    try {
      const result = await api.purchaseFbmLabel({
        order_id:   order.order_id,
        items:      shipInfo.items,
        ship_from:  shipFrom,
        package:    pkg,
        service_id: selectedRate.service_id,
        offer_id:   selectedRate.offer_id,
      })
      setLabel(result)
      setStep('label')
    } catch (e) { setError(e.message) }
    finally { setWorking(false) }
  }

  const printLabel = () => {
    const shipTo = shipInfo?.ship_to || {}
    const addrLines = [
      shipTo.address1,
      shipTo.address2,
      [shipTo.city, shipTo.state, shipTo.zip].filter(Boolean).join(', '),
      shipTo.country !== 'US' ? shipTo.country : '',
    ].filter(Boolean)
    const fromLines = [
      shipFrom.address1,
      shipFrom.address2,
      [shipFrom.city, shipFrom.state, shipFrom.zip].filter(Boolean).join(', '),
    ].filter(Boolean)

    let labelContent = ''
    if (label?.label_b64) {
      const isImg = label.label_type?.includes('png') || label.label_type?.includes('jpeg')
      labelContent = isImg
        ? `<img src="data:${label.label_type};base64,${label.label_b64}" style="max-width:100%;max-height:480px;object-fit:contain;" />`
        : `<iframe src="data:application/pdf;base64,${label.label_b64}" style="width:100%;height:480px;border:none;"></iframe>`
    }

    const win = window.open('', '_blank', 'width=720,height=860')
    win.document.write(`<!DOCTYPE html>
<html><head><title>Label — ${order.order_id}</title>
<style>
  body{font-family:Arial,sans-serif;margin:24px;color:#111}
  .header{border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:16px}
  .header h1{font-size:18px;margin:0 0 4px}
  .header p{font-size:13px;color:#555;margin:0}
  .addr-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .addr-block h3{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666;margin:0 0 4px}
  .addr-block p{font-size:14px;margin:2px 0}
  .tracking{background:#f3f4f6;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:14px}
  .tracking strong{display:block;font-size:11px;text-transform:uppercase;color:#555;margin-bottom:2px}
  .label-area{text-align:center}
  @media print{.no-print{display:none!important}}
</style></head>
<body>
<div class="header">
  <h1>Shipping Label</h1>
  <p>Order: ${order.order_id}</p>
</div>
<div class="addr-grid">
  <div class="addr-block">
    <h3>Ship From</h3>
    <p><strong>${shipFrom.name || ''}</strong></p>
    ${fromLines.map(l => `<p>${l}</p>`).join('')}
  </div>
  <div class="addr-block">
    <h3>Ship To</h3>
    <p><strong>${shipTo.name || 'Customer'}</strong></p>
    ${addrLines.map(l => `<p>${l}</p>`).join('')}
  </div>
</div>
${label?.tracking_number ? `<div class="tracking"><strong>Tracking Number</strong>${label.tracking_number}${label.carrier ? ' (' + label.carrier + ')' : ''}</div>` : ''}
<div class="label-area">${labelContent}</div>
<script>window.onload=function(){window.print()}<\/script>
</body></html>`)
    win.document.close()
  }

  const fmtDel = (a, b) => (!a && !b) ? '' : (a === b || !b) ? a : `${a} – ${b}`

  const sfField = (key, lbl, placeholder = '') => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{lbl}</label>
      <input
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
        value={shipFrom[key] || ''}
        placeholder={placeholder}
        onChange={e => setShipFrom(prev => ({ ...prev, [key]: e.target.value }))}
      />
    </div>
  )

  const pkgField = (key, lbl, placeholder, unit) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{lbl}</label>
      <div className="flex items-center gap-1">
        <input
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
          value={pkg[key] || ''}
          placeholder={placeholder}
          onChange={e => setPkg(prev => ({ ...prev, [key]: e.target.value }))}
        />
        {unit && <span className="text-xs text-gray-400 shrink-0">{unit}</span>}
      </div>
    </div>
  )

  const STEPS = [
    { key: 'address', num: 1, label: 'Details' },
    { key: 'rates',   num: 2, label: 'Select Rate' },
    { key: 'label',   num: 3, label: 'Print Label' },
  ]
  const stepIdx = STEPS.findIndex(s => s.key === step)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Buy Shipping</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {order.order_id}
              {step === 'address' && ' · Enter details'}
              {step === 'rates'   && ' · Select a rate'}
              {step === 'label'   && ' · Label ready'}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">✕</button>
        </div>

        {/* Steps */}
        <div className="flex items-center px-6 py-2.5 border-b border-gray-100 bg-gray-50">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <div className={`flex items-center gap-1.5 text-xs font-medium ${step === s.key ? 'text-violet-700' : i < stepIdx ? 'text-green-600' : 'text-gray-400'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${step === s.key ? 'bg-violet-600 text-white' : i < stepIdx ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>{s.num}</span>
                {s.label}
              </div>
              {i < STEPS.length - 1 && <span className="text-gray-300 mx-2">›</span>}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}

          {/* Step 1 — Ship-from + package */}
          {step === 'address' && (
            <div className="space-y-5">
              {loading && <p className="text-sm text-gray-400 py-6 text-center">Loading order info…</p>}
              {!loading && (
                <>
                  {shipInfo?.ship_to && (
                    <div className="bg-violet-50 border border-violet-100 rounded-lg px-4 py-3">
                      <p className="text-xs font-semibold text-violet-700 uppercase tracking-wider mb-2">Shipping To</p>
                      <p className="text-sm font-medium text-gray-900">{shipInfo.ship_to.name}</p>
                      <p className="text-sm text-gray-600">{shipInfo.ship_to.address1}</p>
                      {shipInfo.ship_to.address2 && <p className="text-sm text-gray-600">{shipInfo.ship_to.address2}</p>}
                      <p className="text-sm text-gray-600">{[shipInfo.ship_to.city, shipInfo.ship_to.state, shipInfo.ship_to.zip].filter(Boolean).join(', ')}</p>
                    </div>
                  )}
                  {shipInfo?.items?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Items in Order</p>
                      <div className="space-y-1.5">
                        {shipInfo.items.map((item, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                            <span className="w-6 h-6 bg-gray-100 rounded text-xs flex items-center justify-center font-semibold shrink-0">{item.quantity}</span>
                            <span className="truncate">{item.title || item.sku || item.asin}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Ship From</p>
                    <div className="grid grid-cols-2 gap-3">
                      {sfField('name', 'Name / Company', 'Your business name')}
                      {sfField('phone', 'Phone', '555-123-4567')}
                      <div className="col-span-2">{sfField('address1', 'Address Line 1', '123 Warehouse Blvd')}</div>
                      <div className="col-span-2">{sfField('address2', 'Address Line 2 (optional)', 'Suite 100')}</div>
                      {sfField('city', 'City', 'Los Angeles')}
                      {sfField('state', 'State', 'CA')}
                      {sfField('zip', 'ZIP Code', '90001')}
                      {sfField('country', 'Country', 'US')}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Package Dimensions</p>
                    <div className="grid grid-cols-4 gap-3">
                      {pkgField('length', 'Length', '12', 'in')}
                      {pkgField('width',  'Width',  '9',  'in')}
                      {pkgField('height', 'Height', '4',  'in')}
                      {pkgField('weight', 'Weight', '16', '')}
                    </div>
                    <div className="mt-2 flex items-center gap-4">
                      <span className="text-xs text-gray-500">Weight unit:</span>
                      {['oz', 'lb', 'g', 'kg'].map(u => (
                        <label key={u} className="flex items-center gap-1 text-xs cursor-pointer">
                          <input type="radio" name="wunit" value={u} checked={pkg.weight_unit === u} onChange={() => setPkg(p => ({ ...p, weight_unit: u }))} />
                          {u}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 2 — Rate selection */}
          {step === 'rates' && (
            <div className="space-y-3">
              {working && <p className="text-sm text-gray-400 text-center py-6">Fetching rates…</p>}
              {!working && rates.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">No shipping rates available for this order and package.</p>
              )}
              {!working && rates.map(rate => (
                <button
                  key={rate.service_id}
                  onClick={() => setSelectedRate(rate)}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${selectedRate?.service_id === rate.service_id ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-300 bg-white'}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{rate.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{rate.carrier}</p>
                      {rate.earliest_date && (
                        <p className="text-xs text-green-600 mt-1">Est. delivery: {fmtDel(rate.earliest_date, rate.latest_date)}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="text-xl font-bold text-gray-900">${rate.rate.toFixed(2)}</p>
                      <p className="text-xs text-gray-400">{rate.currency}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Step 3 — Label */}
          {step === 'label' && label && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <p className="text-sm font-semibold text-green-800">Label purchased — your Amazon account has been charged.</p>
                {label.tracking_number && (
                  <p className="text-sm text-green-700 mt-1">
                    Tracking: <span className="font-mono font-medium">{label.tracking_number}</span>
                    {label.carrier && ` (${label.carrier})`}
                  </p>
                )}
              </div>
              {label.label_b64 && (() => {
                const isImg = label.label_type?.includes('png') || label.label_type?.includes('jpeg')
                return isImg
                  ? <img src={`data:${label.label_type};base64,${label.label_b64}`} alt="Shipping Label" className="w-full border border-gray-200 rounded-lg" />
                  : <iframe title="Shipping Label" src={`data:application/pdf;base64,${label.label_b64}`} className="w-full h-80 border border-gray-200 rounded-lg" />
              })()}
              {!label.label_b64 && (
                <div className="border border-dashed border-gray-200 rounded-lg p-6 text-center">
                  <p className="text-sm text-gray-400">Label preview not available. Use the tracking number above to retrieve the label from Amazon Seller Central.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <div>
            {step === 'rates' && (
              <button onClick={() => { setStep('address'); setRates([]); setSelectedRate(null) }} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {step !== 'label' && (
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            )}
            {step === 'address' && !loading && (
              <button
                onClick={getRates}
                disabled={working || !shipFrom.name || !shipFrom.address1}
                className="px-4 py-2 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {working ? 'Getting rates…' : 'Get Rates →'}
              </button>
            )}
            {step === 'rates' && (
              <button
                onClick={purchaseLabel}
                disabled={working || !selectedRate}
                className="px-4 py-2 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {working ? 'Purchasing…' : `Purchase ${selectedRate ? `$${selectedRate.rate.toFixed(2)}` : '—'} →`}
              </button>
            )}
            {step === 'label' && (
              <>
                <button
                  onClick={printLabel}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
                >
                  <PrinterIcon className="w-4 h-4" /> Print Label
                </button>
                <button onClick={onClose} className="px-4 py-2 text-sm font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">Done</button>
              </>
            )}
          </div>
        </div>
      </div>
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
function AlertIcon({ className }) { return <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> }
function CalendarIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> }
function BoxIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" /></svg> }
function DollarIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }
function AmazonBoxIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg> }
function CheckShieldIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg> }
function TruckInIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1" /></svg> }
function TrophyIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg> }

function RefreshIcon({ spinning }) {
  return (
    <svg
      className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}
function ChevronDownIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}
function SalesChartIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  )
}
function OpenOrdersIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  )
}
function PaymentIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  )
}
function PrinterIcon({ className }) {
  return (
    <svg className={className || 'w-5 h-5'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
    </svg>
  )
}
