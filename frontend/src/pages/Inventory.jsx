import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { fmtCurrency } from '../utils'

function getStage(p) {
  if (p.date_sent_to_amazon) return 'amazon'
  if (p.arrived_at_prep) return 'prep'
  if (p.date_purchased) return 'ordered'
  return 'instock'
}

const STAGE_META = {
  instock: { label: 'In Stock',             color: 'bg-gray-100 text-gray-700',   dot: 'bg-gray-400' },
  ordered: { label: 'Ordered / In Transit', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
  prep:    { label: 'At Prep Center',       color: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500' },
  amazon:  { label: 'Sent to Amazon (FBA)', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
}

const TABS = [
  { key: 'all',     label: 'All Active' },
  { key: 'instock', label: 'In Stock' },
  { key: 'ordered', label: 'In Transit' },
  { key: 'prep',    label: 'At Prep' },
  { key: 'amazon',  label: 'At Amazon' },
  { key: 'oos',     label: 'Out of Stock' },
]

function applyTab(products, tab) {
  if (tab === 'oos') return products.filter(p => !Number(p.quantity))
  const active = products.filter(p => Number(p.quantity) > 0)
  if (tab === 'all') return active
  return active.filter(p => getStage(p) === tab)
}

function num(v, dec = 0) {
  if (v == null || v === '') return '—'
  return Number(v).toFixed(dec)
}
function fmtBsr(bsr) {
  if (!bsr) return '—'
  return Number(bsr).toLocaleString()
}
function fmtSynced(iso) {
  if (!iso) return null
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
  const diffMin = Math.floor((Date.now() - d) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}
function fmtAgo(iso) { return fmtSynced(iso) }

function SyncIcon({ spinning }) {
  return (
    <svg className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function AmazonSyncCard({ status, onSync, syncing }) {
  if (!status) return null
  if (!status.configured) {
    return (
      <div className="card p-4 border-l-4 border-amber-400 bg-amber-50">
        <p className="font-semibold text-amber-900 text-sm">Amazon SP-API not connected</p>
        <p className="text-xs text-amber-700 mt-0.5">
          Add <code className="bg-amber-100 px-1 rounded">AMAZON_LWA_CLIENT_ID</code>,{' '}
          <code className="bg-amber-100 px-1 rounded">AMAZON_LWA_CLIENT_SECRET</code>,{' '}
          <code className="bg-amber-100 px-1 rounded">AMAZON_SP_REFRESH_TOKEN</code>, and{' '}
          <code className="bg-amber-100 px-1 rounded">AMAZON_SELLER_ID</code> in Railway Variables to enable hourly sync.
        </p>
      </div>
    )
  }
  const ago = fmtAgo(status.last_sync_at)
  const hasError = Boolean(status.error)
  return (
    <div className={`card p-4 flex flex-wrap items-center justify-between gap-3 ${hasError ? 'border-l-4 border-red-400' : ''}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${hasError ? 'bg-red-500' : 'bg-green-500'}`} />
          <span className="text-sm font-medium text-gray-800">Amazon FBA Sync</span>
          <span className="text-xs text-gray-400">— auto-refreshes every hour</span>
        </div>
        {ago && !hasError && (
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>Last sync: <span className="font-medium text-gray-700">{ago}</span></span>
            {status.updated > 0 && <span className="text-green-600">↑ {status.updated} updated</span>}
            {status.created > 0 && <span className="text-blue-600">+ {status.created} new</span>}
          </div>
        )}
        {hasError && <span className="text-xs text-red-600 font-medium">Last error: {status.error}</span>}
        {status.running && <span className="text-xs text-blue-600 animate-pulse">Syncing…</span>}
      </div>
      <button onClick={onSync} disabled={syncing || status.running} className="btn-secondary text-sm flex items-center gap-1.5">
        <SyncIcon spinning={syncing || status.running} />
        {syncing || status.running ? 'Syncing…' : 'Sync Now'}
      </button>
    </div>
  )
}

function KeepaStatusCard({ status, onBulkSync, bulkLoading, bulkResult, isAdmin }) {
  if (!status) return null
  if (!status.configured) {
    return (
      <div className="card p-4 border-l-4 border-amber-400 bg-amber-50">
        <p className="font-semibold text-amber-900 text-sm">Keepa not connected</p>
        <p className="text-xs text-amber-700 mt-0.5">
          Add <code className="bg-amber-100 px-1 rounded">KEEPA_API_KEY</code> in Railway Variables to enable live BSR, Buy Box, and seller data.
        </p>
      </div>
    )
  }
  return (
    <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        <span className="text-sm font-medium text-gray-800">Keepa connected</span>
        <span className="text-xs text-gray-400">— live BSR, Buy Box &amp; seller count per ASIN</span>
      </div>
      {isAdmin && (
        <div className="flex items-center gap-3">
          {bulkResult && (
            <span className={`text-sm font-medium ${bulkResult.errors?.length ? 'text-red-600' : 'text-green-600'}`}>
              {bulkResult.errors?.length ? `⚠ ${bulkResult.errors[0]}` : `✓ ${bulkResult.refreshed} ASINs synced`}
            </span>
          )}
          <button onClick={onBulkSync} disabled={bulkLoading} className="btn-secondary text-sm flex items-center gap-1.5">
            <SyncIcon spinning={bulkLoading} />
            {bulkLoading ? 'Syncing all...' : 'Sync All ASINs'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function Inventory() {
  const { isAdmin } = useAuth()
  const [products, setProducts] = useState([])
  const [strategies, setStrategies] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('all')
  const [keepaStatus, setKeepaStatus] = useState(null)
  const [syncingIds, setSyncingIds] = useState(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState(null)
  const [amazonSyncStatus, setAmazonSyncStatus] = useState(null)
  const [amazonSyncing, setAmazonSyncing] = useState(false)
  const [strategyMap, setStrategyMap] = useState({})

  const load = useCallback(() => {
    setLoading(true)
    const params = { status: 'approved' }
    if (search) params.search = search
    api.getProducts(params).then(prods => {
      setProducts(prods)
      const m = {}
      prods.forEach(p => { m[p.id] = p.aria_strategy_id ?? '' })
      setStrategyMap(m)
    }).finally(() => setLoading(false))
  }, [search])

  const loadAmazonSyncStatus = useCallback(() => {
    api.amazonInventorySyncStatus().then(setAmazonSyncStatus).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { api.keepaStatus().then(setKeepaStatus).catch(() => {}) }, [])
  useEffect(() => { api.getRepricerStrategies().then(setStrategies).catch(() => {}) }, [])
  useEffect(() => {
    loadAmazonSyncStatus()
    const id = setInterval(loadAmazonSyncStatus, 60000)
    return () => clearInterval(id)
  }, [loadAmazonSyncStatus])

  // Tab counts
  const tabCounts = Object.fromEntries(TABS.map(t => [t.key, applyTab(products, t.key).length]))

  // Table rows = active tab filtered by search
  const searchedProducts = search
    ? products.filter(p =>
        p.product_name?.toLowerCase().includes(search.toLowerCase()) ||
        p.asin?.toLowerCase().includes(search.toLowerCase())
      )
    : products
  const tableRows = applyTab(searchedProducts, activeTab)

  // Overall KPIs (all products)
  const activeProducts = products.filter(p => Number(p.quantity) > 0)
  const totalUnits  = activeProducts.reduce((s, p) => s + (Number(p.quantity) || 0), 0)
  const totalSpent  = products.reduce((s, p) => s + (Number(p.money_spent) || 0), 0)
  const ariaCount   = products.filter(p => p.aria_strategy_id).length
  const oosCount    = products.filter(p => !Number(p.quantity)).length

  const handleSyncOne = async (productId) => {
    setSyncingIds(prev => new Set(prev).add(productId))
    try {
      const updated = await api.keepaRefreshOne(productId)
      setProducts(prev => prev.map(p => p.id === productId ? updated : p))
    } catch (e) {
      alert(`Keepa sync failed: ${e.message}`)
    } finally {
      setSyncingIds(prev => { const s = new Set(prev); s.delete(productId); return s })
    }
  }

  const handleBulkSync = async () => {
    setBulkLoading(true)
    setBulkResult(null)
    try {
      const result = await api.keepaBulkRefresh()
      setBulkResult(result)
      if (result.errors?.length) alert(`Sync completed with errors:\n${result.errors.join('\n')}`)
      load()
    } catch (e) {
      setBulkResult({ errors: [e.message], refreshed: 0, skipped: 0 })
      alert(`Sync failed: ${e.message}`)
    } finally {
      setBulkLoading(false)
    }
  }

  const handleAmazonSync = async () => {
    setAmazonSyncing(true)
    try {
      const result = await api.amazonInventorySyncNow()
      setAmazonSyncStatus(s => ({ ...s, ...result, last_sync_at: new Date().toISOString() }))
      load()
    } catch (e) {
      alert(`Amazon sync failed: ${e.message}`)
    } finally {
      setAmazonSyncing(false)
      loadAmazonSyncStatus()
    }
  }

  const handleStrategyChange = async (productId, value) => {
    const strategyId = value === '' ? null : Number(value)
    setStrategyMap(prev => ({ ...prev, [productId]: value }))
    try {
      await api.setProductStrategy(productId, strategyId)
    } catch (e) {
      alert(`Failed to update strategy: ${e.message}`)
      setStrategyMap(prev => ({ ...prev, [productId]: products.find(p => p.id === productId)?.aria_strategy_id ?? '' }))
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Current Inventory</h1>
        <p className="text-gray-500 text-sm mt-1">All approved products — auto-synced from Amazon FBA hourly</p>
      </div>

      {/* Sync status cards */}
      <AmazonSyncCard status={amazonSyncStatus} onSync={handleAmazonSync} syncing={amazonSyncing} />
      <KeepaStatusCard status={keepaStatus} onBulkSync={handleBulkSync} bulkLoading={bulkLoading} bulkResult={bulkResult} isAdmin={isAdmin} />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Active SKUs</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{activeProducts.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Units</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totalUnits.toLocaleString()}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Invested</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{fmtCurrency(totalSpent)}</p>
        </div>
        <div className="card p-4 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => setActiveTab('oos')}>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Out of Stock</p>
          <p className={`text-2xl font-bold mt-1 ${oosCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>{oosCount}</p>
        </div>
      </div>

      {/* Tab bar + search */}
      <div className="card overflow-hidden">
        {/* Tabs */}
        <div className="flex items-center gap-0 border-b border-gray-200 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600 bg-blue-50/40'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              } ${tab.key === 'oos' && oosCount > 0 && activeTab !== 'oos' ? 'text-red-500 hover:text-red-700' : ''}`}
            >
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                activeTab === tab.key
                  ? 'bg-blue-100 text-blue-700'
                  : tab.key === 'oos' && oosCount > 0
                  ? 'bg-red-100 text-red-600'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {tabCounts[tab.key]}
              </span>
            </button>
          ))}
          <div className="ml-auto px-4 flex-shrink-0">
            <input
              className="input w-52 text-sm py-1.5"
              placeholder="Search name or ASIN…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-56">Product</th>
                {activeTab === 'all' && (
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Stage</th>
                )}
                <th className="text-left px-4 py-3 font-medium text-gray-600">Qty</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Buy Cost</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Invested</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 bg-blue-50/60">BSR</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 bg-blue-50/60">Buy Box</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 bg-blue-50/60"># Sellers</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ROI</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Profit/unit</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 bg-purple-50/60">Aria Strategy</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ungated</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 bg-blue-50/60">Keepa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr><td colSpan={14} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              )}
              {!loading && tableRows.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-4 py-12 text-center text-gray-400">
                    {activeTab === 'oos' ? 'No out-of-stock products.' : 'No products in this category.'}
                  </td>
                </tr>
              )}
              {!loading && tableRows.map(p => {
                const stage = STAGE_META[getStage(p)]
                const roiVal    = Number(p.roi) || 0
                const profitVal = Number(p.profit) || 0
                const isSyncing = syncingIds.has(p.id)
                const hasAsin   = Boolean(p.asin)
                const synced    = fmtSynced(p.keepa_last_synced)
                const curStrategy = strategyMap[p.id] ?? ''
                const isOos = !Number(p.quantity)

                return (
                  <tr key={p.id} className={`hover:bg-gray-50 ${isOos ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="min-w-0 max-w-[14rem]">
                        <p className="font-medium text-gray-900 truncate">{p.product_name}</p>
                        {p.asin && <p className="text-xs text-blue-500 font-mono">{p.asin}</p>}
                        {p.keepa_category && (
                          <p className="text-xs text-gray-400 truncate max-w-[13rem]">{p.keepa_category}</p>
                        )}
                      </div>
                    </td>
                    {activeTab === 'all' && (
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${stage.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${stage.dot}`} />
                          {stage.label}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <span className={`font-semibold ${isOos ? 'text-red-500' : 'text-gray-800'}`}>
                        {isOos ? '0' : num(p.quantity)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{fmtCurrency(p.buy_cost)}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{fmtCurrency(p.money_spent)}</td>

                    <td className="px-4 py-3 bg-blue-50/30">
                      {p.keepa_bsr
                        ? <span className="font-mono text-xs text-gray-700">#{fmtBsr(p.keepa_bsr)}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 bg-blue-50/30">
                      {p.buy_box
                        ? <span className="font-medium text-green-700">{fmtCurrency(p.buy_box)}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 bg-blue-50/30">
                      {p.num_sellers > 0
                        ? <span className="text-gray-700">{p.num_sellers}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>

                    <td className="px-4 py-3">
                      <span className={`font-medium ${roiVal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {p.roi != null && p.roi !== 0 ? `${(roiVal * 100).toFixed(1)}%` : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${profitVal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {p.profit != null && p.profit !== 0 ? fmtCurrency(profitVal) : '—'}
                      </span>
                    </td>

                    <td className="px-4 py-3 bg-purple-50/30">
                      <select
                        value={curStrategy}
                        onChange={e => handleStrategyChange(p.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-400 max-w-[140px]"
                      >
                        <option value="">— None —</option>
                        {strategies.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </td>

                    <td className="px-4 py-3">
                      {p.ungated
                        ? <span className="badge bg-green-100 text-green-700">Yes</span>
                        : <span className="badge bg-gray-100 text-gray-500">No</span>}
                    </td>

                    <td className="px-4 py-3 bg-blue-50/30">
                      {hasAsin && keepaStatus?.configured ? (
                        <div className="flex flex-col items-start gap-0.5">
                          <button
                            onClick={() => handleSyncOne(p.id)}
                            disabled={isSyncing}
                            title={synced ? `Last synced ${synced}` : 'Sync with Keepa'}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                          >
                            <SyncIcon spinning={isSyncing} />
                            {isSyncing ? 'Syncing...' : 'Sync'}
                          </button>
                          {synced && <span className="text-xs text-gray-400">{synced}</span>}
                        </div>
                      ) : (
                        <span className="text-gray-300 text-xs">{hasAsin ? '—' : 'No ASIN'}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        {!loading && tableRows.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 flex flex-wrap gap-6 text-sm">
            <span className="text-gray-500">
              <span className="font-semibold text-gray-800">
                {tableRows.reduce((s, p) => s + (Number(p.quantity) || 0), 0).toLocaleString()}
              </span> units
            </span>
            <span className="text-gray-500">
              <span className="font-semibold text-gray-800">
                {fmtCurrency(tableRows.reduce((s, p) => s + (Number(p.money_spent) || 0), 0))}
              </span> invested
            </span>
            <span className="text-gray-500">
              <span className="font-semibold text-green-600">
                {fmtCurrency(tableRows.reduce((s, p) => s + ((Number(p.profit) || 0) * (Number(p.quantity) || 0)), 0))}
              </span> est. profit
            </span>
            <span className="text-gray-400 ml-auto">{tableRows.length} products</span>
          </div>
        )}
      </div>
    </div>
  )
}
