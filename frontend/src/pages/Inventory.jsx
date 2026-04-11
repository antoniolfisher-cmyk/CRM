import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { fmtCurrency } from '../utils'

// Pipeline stage for a product
function getStage(p) {
  if (p.date_sent_to_amazon) return 'amazon'
  if (p.arrived_at_prep) return 'prep'
  if (p.date_purchased) return 'ordered'
  return 'instock'
}

const STAGES = [
  { key: 'instock',  label: 'In Stock',              color: 'bg-gray-100 text-gray-700',   dot: 'bg-gray-400' },
  { key: 'ordered',  label: 'Ordered / In Transit',  color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
  { key: 'prep',     label: 'At Prep Center',         color: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500' },
  { key: 'amazon',   label: 'Sent to Amazon (FBA)',   color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
]

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
  const now = new Date()
  const diffMin = Math.floor((now - d) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

function SyncIcon({ spinning }) {
  return (
    <svg
      className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function KeepaStatusCard({ status, onBulkSync, bulkLoading, bulkResult, isAdmin }) {
  if (!status) return null

  if (!status.configured) {
    return (
      <div className="card p-4 border-l-4 border-amber-400 bg-amber-50">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-amber-900 text-sm">Keepa not connected</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Add <code className="bg-amber-100 px-1 rounded">KEEPA_API_KEY</code> in Railway Variables to enable live BSR, Buy Box, and seller data.
              Get a free key at <span className="font-medium">keepa.com/api</span> (~400 tokens/day for $20/mo).
            </p>
          </div>
        </div>
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
              {bulkResult.errors?.length
                ? `⚠ ${bulkResult.errors[0]}`
                : `✓ ${bulkResult.refreshed} ASINs synced`}
            </span>
          )}
          <button
            onClick={onBulkSync}
            disabled={bulkLoading}
            className="btn-secondary text-sm flex items-center gap-1.5"
          >
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
  const [stageFilter, setStageFilter] = useState('all')
  const [keepaStatus, setKeepaStatus] = useState(null)
  const [syncingIds, setSyncingIds] = useState(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState(null)
  // aria_strategy_id per product (local optimistic state)
  const [strategyMap, setStrategyMap] = useState({})

  const load = useCallback(() => {
    setLoading(true)
    const params = { status: 'approved' }
    if (search) params.search = search
    api.getProducts(params).then(prods => {
      setProducts(prods)
      // seed strategyMap from server data
      const m = {}
      prods.forEach(p => { m[p.id] = p.aria_strategy_id ?? '' })
      setStrategyMap(m)
    }).finally(() => setLoading(false))
  }, [search])

  useEffect(() => { load() }, [load])
  useEffect(() => { api.keepaStatus().then(setKeepaStatus).catch(() => {}) }, [])
  useEffect(() => { api.getRepricerStrategies().then(setStrategies).catch(() => {}) }, [])

  // Apply client-side filters
  const filtered = products.filter(p => {
    if (stageFilter !== 'all' && getStage(p) !== stageFilter) return false
    return true
  })

  // KPIs
  const totalUnits = products.reduce((s, p) => s + (Number(p.quantity) || 0), 0)
  const totalSpent = products.reduce((s, p) => s + (Number(p.money_spent) || 0), 0)
  const stageCounts = Object.fromEntries(STAGES.map(s => [s.key, products.filter(p => getStage(p) === s.key).length]))
  const ariaCount = products.filter(p => p.aria_strategy_id).length

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
      if (result.errors?.length) {
        alert(`Sync completed with errors:\n${result.errors.join('\n')}`)
      }
      load()
    } catch (e) {
      setBulkResult({ errors: [e.message], refreshed: 0, skipped: 0 })
      alert(`Sync failed: ${e.message}`)
    } finally {
      setBulkLoading(false)
    }
  }

  const handleStrategyChange = async (productId, value) => {
    const strategyId = value === '' ? null : Number(value)
    // optimistic update
    setStrategyMap(prev => ({ ...prev, [productId]: value }))
    try {
      await api.setProductStrategy(productId, strategyId)
    } catch (e) {
      alert(`Failed to update strategy: ${e.message}`)
      // revert
      setStrategyMap(prev => ({ ...prev, [productId]: products.find(p => p.id === productId)?.aria_strategy_id ?? '' }))
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Current Inventory</h1>
        <p className="text-gray-500 text-sm mt-1">Pipeline view of all approved inventory</p>
      </div>

      {/* ── Keepa status ── */}
      <KeepaStatusCard
        status={keepaStatus}
        onBulkSync={handleBulkSync}
        bulkLoading={bulkLoading}
        bulkResult={bulkResult}
        isAdmin={isAdmin}
      />

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Products</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{products.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Units</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totalUnits.toLocaleString()}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Invested</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{fmtCurrency(totalSpent)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Aria Managed</p>
          <p className="text-2xl font-bold text-purple-600 mt-1">{ariaCount}</p>
        </div>
      </div>

      {/* ── Pipeline summary ── */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Inventory Pipeline</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {STAGES.map(s => (
            <button
              key={s.key}
              onClick={() => setStageFilter(stageFilter === s.key ? 'all' : s.key)}
              className={`rounded-lg p-3 text-left transition-all border-2 ${
                stageFilter === s.key ? 'border-blue-500 shadow-sm' : 'border-transparent'
              } ${s.color}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                <span className="text-xs font-medium">{s.label}</span>
              </div>
              <p className="text-2xl font-bold">{stageCounts[s.key]}</p>
              <p className="text-xs opacity-70 mt-0.5">
                {products
                  .filter(p => getStage(p) === s.key)
                  .reduce((sum, p) => sum + (Number(p.quantity) || 0), 0)
                  .toLocaleString()} units
              </p>
            </button>
          ))}
        </div>
        {stageFilter !== 'all' && (
          <button className="text-xs text-blue-600 underline mt-3" onClick={() => setStageFilter('all')}>
            Clear filter — show all stages
          </button>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          className="input w-64"
          placeholder="Search by name or ASIN..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="text-sm text-gray-400 ml-auto">{filtered.length} items</span>
      </div>

      {/* ── Table ── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-56">Product</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Stage</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Qty</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Buy Cost</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Invested</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 bg-blue-50">BSR</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 bg-blue-50">Buy Box</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 bg-blue-50"># Sellers</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ROI</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Profit/unit</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 bg-purple-50">Aria Strategy</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ungated</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 bg-blue-50">Keepa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-gray-400">Loading...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-gray-400">No inventory found.</td></tr>
              )}
              {!loading && filtered.map(p => {
                const stage = STAGES.find(s => s.key === getStage(p))
                const roiVal = Number(p.roi) || 0
                const profitVal = Number(p.profit) || 0
                const isSyncing = syncingIds.has(p.id)
                const hasAsin = Boolean(p.asin)
                const synced = fmtSynced(p.keepa_last_synced)
                const currentStrategy = strategyMap[p.id] ?? ''
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="min-w-0 max-w-[14rem]">
                        <p className="font-medium text-gray-900 truncate">{p.product_name}</p>
                        {p.asin && <p className="text-xs text-blue-500 font-mono">{p.asin}</p>}
                        {p.keepa_category && (
                          <p className="text-xs text-gray-400 truncate max-w-[13rem]">{p.keepa_category}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${stage.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${stage.dot}`} />
                        {stage.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{num(p.quantity)}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtCurrency(p.buy_cost)}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{fmtCurrency(p.money_spent)}</td>

                    {/* ── Keepa columns ── */}
                    <td className="px-4 py-3 bg-blue-50/40">
                      {p.keepa_bsr
                        ? <span className="font-mono text-xs text-gray-700">#{fmtBsr(p.keepa_bsr)}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 bg-blue-50/40">
                      {p.buy_box
                        ? <span className="font-medium text-green-700">{fmtCurrency(p.buy_box)}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 bg-blue-50/40">
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

                    {/* ── Aria Strategy dropdown ── */}
                    <td className="px-4 py-3 bg-purple-50/40">
                      <select
                        value={currentStrategy}
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

                    {/* ── Sync button ── */}
                    <td className="px-4 py-3 bg-blue-50/40">
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
                          {synced && (
                            <span className="text-xs text-gray-400">{synced}</span>
                          )}
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

        {/* Footer summary */}
        {!loading && filtered.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 flex flex-wrap gap-6 text-sm">
            <span className="text-gray-500">
              <span className="font-semibold text-gray-800">
                {filtered.reduce((s, p) => s + (Number(p.quantity) || 0), 0).toLocaleString()}
              </span> total units
            </span>
            <span className="text-gray-500">
              <span className="font-semibold text-gray-800">
                {fmtCurrency(filtered.reduce((s, p) => s + (Number(p.money_spent) || 0), 0))}
              </span> invested
            </span>
            <span className="text-gray-500">
              <span className="font-semibold text-green-600">
                {fmtCurrency(filtered.reduce((s, p) => s + ((Number(p.profit) || 0) * (Number(p.quantity) || 0)), 0))}
              </span> est. profit
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
