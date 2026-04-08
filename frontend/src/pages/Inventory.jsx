import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { formatDate, fmtCurrency } from '../utils'

// Pipeline stage for a product
function getStage(p) {
  if (p.date_sent_to_amazon) return 'amazon'
  if (p.arrived_at_prep) return 'prep'
  if (p.date_purchased) return 'ordered'
  return 'sourced'
}

const STAGES = [
  { key: 'sourced',  label: 'Sourced',            color: 'bg-gray-100 text-gray-700',   dot: 'bg-gray-400' },
  { key: 'ordered',  label: 'Ordered / In Transit', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
  { key: 'prep',     label: 'At Prep Center',       color: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500' },
  { key: 'amazon',   label: 'Sent to Amazon (FBA)', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
]

function num(v, dec = 0) {
  if (v == null || v === '') return '—'
  return Number(v).toFixed(dec)
}

export default function Inventory() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [replenishOnly, setReplenishOnly] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    const params = {}
    if (search) params.search = search
    api.getProducts(params).then(setProducts).finally(() => setLoading(false))
  }, [search])

  useEffect(() => { load() }, [load])

  // Apply client-side filters
  const filtered = products.filter(p => {
    if (stageFilter !== 'all' && getStage(p) !== stageFilter) return false
    if (replenishOnly && !p.replenish) return false
    return true
  })

  // KPIs across all products (not filtered)
  const totalUnits = products.reduce((s, p) => s + (Number(p.quantity) || 0), 0)
  const totalSpent = products.reduce((s, p) => s + (Number(p.money_spent) || 0), 0)
  const stageCounts = Object.fromEntries(STAGES.map(s => [s.key, products.filter(p => getStage(p) === s.key).length]))
  const replenishCount = products.filter(p => p.replenish).length
  const atAmazon = products.filter(p => getStage(p) === 'amazon').reduce((s, p) => s + (Number(p.quantity) || 0), 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
        <p className="text-gray-500 text-sm mt-1">Pipeline view of all purchased inventory</p>
      </div>

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
          <p className="text-xs text-gray-500 uppercase tracking-wide">Needs Replenish</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{replenishCount}</p>
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
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={replenishOnly}
            onChange={e => setReplenishOnly(e.target.checked)}
            className="rounded"
          />
          Replenish only
        </label>
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
                <th className="text-left px-4 py-3 font-medium text-gray-600">Purchased</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">At Prep</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Sent to FBA</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Replenish</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ungated</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ROI</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Profit/unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr><td colSpan={12} className="px-4 py-10 text-center text-gray-400">Loading...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={12} className="px-4 py-10 text-center text-gray-400">No inventory found.</td></tr>
              )}
              {!loading && filtered.map(p => {
                const stage = STAGES.find(s => s.key === getStage(p))
                const roiVal = Number(p.roi) || 0
                const profitVal = Number(p.profit) || 0
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="min-w-0 max-w-[14rem]">
                        <p className="font-medium text-gray-900 truncate">{p.product_name}</p>
                        {p.asin && <p className="text-xs text-gray-400">{p.asin}</p>}
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
                    <td className="px-4 py-3 text-gray-500">{formatDate(p.date_purchased) || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(p.arrived_at_prep) || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(p.date_sent_to_amazon) || '—'}</td>
                    <td className="px-4 py-3">
                      {p.replenish
                        ? <span className="badge bg-blue-100 text-blue-700">Yes</span>
                        : <span className="text-gray-300 text-xs">No</span>}
                    </td>
                    <td className="px-4 py-3">
                      {p.ungated
                        ? <span className="badge bg-green-100 text-green-700">Yes</span>
                        : <span className="badge bg-gray-100 text-gray-500">No</span>}
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
