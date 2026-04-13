import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { fmtCurrency } from '../utils'

/**
 * Aura-style Buy Box indicator.
 * Green box = we're winning the Buy Box (buy_box_winner === true from SP-API)
 * Red box   = we're not winning (buy_box_winner === false)
 * Gray text = no Buy Box data yet
 */
function BuyBoxBadge({ buyBox, buyBoxWinner }) {
  if (!buyBox) return <span className="text-gray-300 text-xs">—</span>

  if (buyBoxWinner === true) {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded border-2 border-green-500 bg-green-50 text-green-800 font-semibold text-sm">
        {fmtCurrency(buyBox)}
      </span>
    )
  }
  if (buyBoxWinner === false) {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded border-2 border-red-500 bg-red-50 text-red-700 font-semibold text-sm">
        {fmtCurrency(buyBox)}
      </span>
    )
  }

  // buy_box_winner is null/undefined — unknown state, show neutral
  return <span className="font-medium text-gray-600">{fmtCurrency(buyBox)}</span>
}

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
function toDateInput(iso) {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function SyncIcon({ spinning }) {
  return (
    <svg className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

// ── Product Drawer ─────────────────────────────────────────────────────────────

function ProductDrawer({ product, strategies, keepaConfigured, onClose, onSave, onDelete, onKeepaSync }) {
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!product) return
    setForm({
      product_name:           product.product_name || '',
      asin:                   product.asin || '',
      amazon_url:             product.amazon_url || '',
      purchase_link:          product.purchase_link || '',
      quantity:               product.quantity ?? '',
      buy_cost:               product.buy_cost ?? '',
      money_spent:            product.money_spent ?? '',
      order_number:           product.order_number || '',
      va_finder:              product.va_finder || '',
      notes:                  product.notes || '',
      date_purchased:         toDateInput(product.date_purchased),
      arrived_at_prep:        toDateInput(product.arrived_at_prep),
      date_sent_to_amazon:    toDateInput(product.date_sent_to_amazon),
      amazon_tracking_number: product.amazon_tracking_number || '',
      ungated:                product.ungated || false,
      aria_strategy_id:       product.aria_strategy_id ?? '',
    })
  }, [product])

  if (!product) return null

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        ...form,
        quantity:    form.quantity    !== '' ? Number(form.quantity)    : null,
        buy_cost:    form.buy_cost    !== '' ? Number(form.buy_cost)    : null,
        money_spent: form.money_spent !== '' ? Number(form.money_spent) : null,
        date_purchased:      form.date_purchased      || null,
        arrived_at_prep:     form.arrived_at_prep     || null,
        date_sent_to_amazon: form.date_sent_to_amazon || null,
        aria_strategy_id:    form.aria_strategy_id !== '' ? Number(form.aria_strategy_id) : null,
      }
      const updated = await api.updateProduct(product.id, payload)
      onSave(updated)
    } catch (e) {
      alert(`Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${product.product_name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await api.deleteProduct(product.id)
      onDelete(product.id)
    } catch (e) {
      alert(`Delete failed: ${e.message}`)
      setDeleting(false)
    }
  }

  const handleKeepaSync = async () => {
    setSyncing(true)
    try {
      const updated = await api.keepaRefreshOne(product.id)
      onSave(updated)
    } catch (e) {
      alert(`Keepa sync failed: ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const stage = STAGE_META[getStage(product)]
  const synced = fmtSynced(product.keepa_last_synced)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-gray-900 leading-tight">{product.product_name}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {product.asin && (
                <span className="font-mono text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded select-all">
                  {product.asin}
                </span>
              )}
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${stage.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${stage.dot}`} />
                {stage.label}
              </span>
              {product.amazon_url && (
                <a href={product.amazon_url} target="_blank" rel="noreferrer"
                  className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                  View on Amazon ↗
                </a>
              )}
              {!product.amazon_url && product.asin && (
                <a href={`https://www.amazon.com/dp/${product.asin}`} target="_blank" rel="noreferrer"
                  className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                  View on Amazon ↗
                </a>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 shrink-0 mt-0.5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Live market data bar */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-6 py-3 bg-blue-50 border-b border-blue-100 text-sm">
          <span className="text-gray-500">BSR: <strong className="text-gray-800">{product.keepa_bsr ? `#${fmtBsr(product.keepa_bsr)}` : '—'}</strong></span>
          <span className="text-gray-500">Buy Box: <BuyBoxBadge buyBox={product.buy_box} buyBoxWinner={product.buy_box_winner} /></span>
          <span className="text-gray-500">Sellers: <strong className="text-gray-800">{product.num_sellers || '—'}</strong></span>
          <span className="text-gray-500">ROI: <strong className={Number(product.roi) >= 0 ? 'text-green-600' : 'text-red-600'}>{product.roi ? `${(Number(product.roi) * 100).toFixed(1)}%` : '—'}</strong></span>
          <span className="text-gray-500">Profit/unit: <strong className={Number(product.profit) >= 0 ? 'text-green-600' : 'text-red-600'}>{product.profit ? fmtCurrency(product.profit) : '—'}</strong></span>
          {product.aria_suggested_price && (
            <span className="text-gray-500">Aria price: <strong className="text-purple-700">{fmtCurrency(product.aria_suggested_price)}</strong></span>
          )}
          {keepaConfigured && (
            <button onClick={handleKeepaSync} disabled={syncing}
              className="ml-auto flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50">
              <SyncIcon spinning={syncing} />
              {syncing ? 'Syncing…' : synced ? `Synced ${synced}` : 'Sync Keepa'}
            </button>
          )}
        </div>

        {/* Scrollable form */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Core info */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Product Info</h3>
            <div className="space-y-3">
              <div>
                <label className="label">Product Name</label>
                <input className="input" value={form.product_name} onChange={set('product_name')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">ASIN</label>
                  <input className="input font-mono" value={form.asin} onChange={set('asin')} placeholder="B0XXXXXXXX" />
                </div>
                <div>
                  <label className="label">VA / Finder</label>
                  <input className="input" value={form.va_finder} onChange={set('va_finder')} placeholder="Who sourced it" />
                </div>
              </div>
              <div>
                <label className="label">Amazon URL</label>
                <input className="input" value={form.amazon_url} onChange={set('amazon_url')} placeholder="https://amazon.com/dp/..." />
              </div>
              <div>
                <label className="label">Purchase / Supplier Link</label>
                <input className="input" value={form.purchase_link} onChange={set('purchase_link')} placeholder="https://..." />
              </div>
            </div>
          </section>

          {/* Purchase details */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Purchase Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Quantity</label>
                <input className="input" type="number" min="0" value={form.quantity} onChange={set('quantity')} />
              </div>
              <div>
                <label className="label">Buy Cost / unit</label>
                <input className="input" type="number" step="0.01" min="0" value={form.buy_cost} onChange={set('buy_cost')} />
              </div>
              <div>
                <label className="label">Total Invested</label>
                <input className="input" type="number" step="0.01" min="0" value={form.money_spent} onChange={set('money_spent')} />
              </div>
              <div>
                <label className="label">Order Number</label>
                <input className="input" value={form.order_number} onChange={set('order_number')} />
              </div>
              <div>
                <label className="label">Date Purchased</label>
                <input className="input" type="date" value={form.date_purchased} onChange={set('date_purchased')} />
              </div>
            </div>
          </section>

          {/* Pipeline dates */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Pipeline Dates</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Arrived at Prep</label>
                <input className="input" type="date" value={form.arrived_at_prep} onChange={set('arrived_at_prep')} />
              </div>
              <div>
                <label className="label">Sent to Amazon</label>
                <input className="input" type="date" value={form.date_sent_to_amazon} onChange={set('date_sent_to_amazon')} />
              </div>
              <div className="col-span-2">
                <label className="label">Amazon Tracking Number</label>
                <input className="input" value={form.amazon_tracking_number} onChange={set('amazon_tracking_number')} />
              </div>
            </div>
          </section>

          {/* Repricer */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Aria Repricer</h3>
            <div>
              <label className="label">Strategy</label>
              <select className="input" value={form.aria_strategy_id} onChange={set('aria_strategy_id')}>
                <option value="">— None —</option>
                {strategies.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            {product.aria_suggested_price && (
              <div className="mt-3 p-3 bg-purple-50 rounded-lg text-sm">
                <p className="font-medium text-purple-800">Last Aria suggestion: {fmtCurrency(product.aria_suggested_price)}</p>
                {product.aria_reasoning && (
                  <p className="text-purple-600 mt-1 text-xs leading-relaxed">{product.aria_reasoning}</p>
                )}
                {product.aria_suggested_at && (
                  <p className="text-purple-400 text-xs mt-1">{fmtAgo(product.aria_suggested_at)}</p>
                )}
              </div>
            )}
          </section>

          {/* Gating & notes */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Other</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.ungated} onChange={set('ungated')} className="rounded w-4 h-4 accent-blue-600" />
                <span className="text-sm text-gray-700">Ungated on Amazon</span>
              </label>
              <div>
                <label className="label">Notes</label>
                <textarea className="input" rows={3} value={form.notes} onChange={set('notes')} placeholder="Internal notes…" />
              </div>
            </div>
          </section>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-3">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors"
          >
            {deleting ? 'Deleting…' : 'Delete product'}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Status cards ───────────────────────────────────────────────────────────────

function AmazonSyncCard({ status, onSync, syncing, onPurge, purging, isAdmin, onFbmUpload, fbmUploading, fbmUploadResult }) {
  if (!status) return null
  if (!status.configured) {
    return (
      <div className="card p-4 border-l-4 border-amber-400 bg-amber-50">
        <p className="font-semibold text-amber-900 text-sm">Amazon account not connected</p>
        <p className="text-xs text-amber-700 mt-0.5">
          Go to <strong>Settings → Connect Amazon</strong> and authorize your Amazon Seller Central account to enable live sync.
        </p>
      </div>
    )
  }
  const ago = fmtAgo(status.last_sync_at)
  const hasError = Boolean(status.error)
  const hasFbmError = Boolean(status.fbm_error)
  const hasSyncData = status.last_sync_at && (status.fba_synced != null || status.fbm_synced != null)
  return (
    <div className={`card overflow-hidden ${hasError ? 'border-l-4 border-red-400' : hasFbmError ? 'border-l-4 border-amber-400' : ''}`}>
      <div className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${hasError ? 'bg-red-500' : hasFbmError ? 'bg-amber-500' : 'bg-green-500'}`} />
            <span className="text-sm font-medium text-gray-800">Amazon Sync</span>
            <span className="text-xs text-gray-400">— auto-refreshes every hour</span>
          </div>
          {ago && !hasError && (
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>Last sync: <span className="font-medium text-gray-700">{ago}</span></span>
              {hasSyncData && (
                <span className="text-blue-600 font-medium">
                  FBA: {status.fba_synced ?? '—'} &nbsp;|&nbsp; FBM: {status.fbm_synced ?? '—'}
                </span>
              )}
              {status.updated > 0 && <span className="text-green-600">↑ {status.updated} updated</span>}
              {status.created > 0 && <span className="text-blue-600">+ {status.created} new</span>}
            </div>
          )}
          {hasError && <span className="text-xs text-red-600 font-medium">Last error: {status.error}</span>}
          {hasFbmError && !hasError && (
            <span className="text-xs text-amber-700 font-medium" title={status.fbm_error}>
              FBM auto-sync: {status.fbm_error?.split('.')[0]}
            </span>
          )}
          {status.running && <span className="text-xs text-blue-600 animate-pulse">Syncing…</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <>
              <label
                className={`btn-secondary text-sm text-purple-700 hover:bg-purple-50 border-purple-200 cursor-pointer flex items-center gap-1.5 ${fbmUploading ? 'opacity-50 pointer-events-none' : ''}`}
                title="Upload Active Listings Report from Seller Central to import FBM inventory"
              >
                {fbmUploading ? 'Importing FBM…' : '↑ Import FBM'}
                <input type="file" className="hidden" accept=".txt,.tsv,.csv,.tab" onChange={onFbmUpload} disabled={fbmUploading} />
              </label>
              {fbmUploadResult && (
                <span className={`text-xs font-medium ${fbmUploadResult.errors?.length ? 'text-amber-700' : 'text-green-700'}`}>
                  FBM: +{fbmUploadResult.created} new, {fbmUploadResult.updated} updated
                </span>
              )}
              <button
                onClick={onPurge}
                disabled={purging || syncing || status.running}
                className="btn-secondary text-sm text-red-600 hover:bg-red-50 border-red-200"
                title="Delete all auto-synced products and re-import from your Amazon account"
              >
                {purging ? 'Clearing…' : 'Clear & Re-import'}
              </button>
            </>
          )}
          <button onClick={onSync} disabled={syncing || status.running} className="btn-secondary text-sm flex items-center gap-1.5">
            <SyncIcon spinning={syncing || status.running} />
            {syncing || status.running ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>
      {isAdmin && (
        <div className="px-4 py-2 border-t border-gray-100 bg-purple-50/40 text-xs text-gray-500">
          <span className="font-medium text-purple-800">FBM not auto-syncing?</span> In Seller Central go to <strong>Reports → Inventory Reports → Active Listings Report</strong>, download the file, then click <strong>↑ Import FBM</strong> above.
        </div>
      )}
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

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Inventory() {
  const { isAdmin } = useAuth()
  const [products, setProducts] = useState([])
  const [strategies, setStrategies] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('all')
  const [keepaStatus, setKeepaStatus] = useState(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState(null)
  const [amazonSyncStatus, setAmazonSyncStatus] = useState(null)
  const [amazonSyncing, setAmazonSyncing] = useState(false)
  const [amazonPurging, setAmazonPurging] = useState(false)
  const [fbmUploading, setFbmUploading]   = useState(false)
  const [fbmUploadResult, setFbmUploadResult] = useState(null)
  const [strategyMap, setStrategyMap] = useState({})
  const [selectedProduct, setSelectedProduct] = useState(null)

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

  const [channelFilter, setChannelFilter] = useState(null) // null | 'FBA' | 'FBM'

  const channelFiltered = channelFilter
    ? products.filter(p => (p.fulfillment_channel || 'FBA') === channelFilter)
    : products

  const tabCounts = Object.fromEntries(TABS.map(t => [t.key, applyTab(channelFiltered, t.key).length]))

  const searchedProducts = search
    ? channelFiltered.filter(p =>
        p.product_name?.toLowerCase().includes(search.toLowerCase()) ||
        p.asin?.toLowerCase().includes(search.toLowerCase())
      )
    : channelFiltered
  const tableRows = applyTab(searchedProducts, activeTab)

  const activeProducts = products.filter(p => Number(p.quantity) > 0)
  const totalUnits = activeProducts.reduce((s, p) => s + (Number(p.quantity) || 0), 0)
  const totalSpent = products.reduce((s, p) => s + (Number(p.money_spent) || 0), 0)
  const oosCount   = products.filter(p => !Number(p.quantity)).length
  const fbaCount   = products.filter(p => (p.fulfillment_channel || 'FBA') === 'FBA' && Number(p.quantity) > 0).length
  const fbmCount   = products.filter(p => p.fulfillment_channel === 'FBM' && Number(p.quantity) > 0).length

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

  const handleAmazonPurge = async () => {
    if (!window.confirm(
      'This will delete all auto-imported Amazon products and re-import from your connected Amazon account.\n\n' +
      'Products you added manually will NOT be affected.\n\nContinue?'
    )) return
    setAmazonPurging(true)
    try {
      const result = await api.purgeAndResyncAmazon()
      load()
      loadAmazonSyncStatus()
      const reimported = result.sync_triggered
        ? `${(result.sync_result?.created || 0) + (result.sync_result?.updated || 0)} re-imported from your Amazon account.`
        : 'Connect your Amazon account then hit Sync Now to re-import.'
      alert(`Cleared ${result.purged} products (${result.purged_system} auto-created, ${result.purged_fba} FBA imports). ${reimported}`)
    } catch (e) {
      alert(`Failed: ${e.message}`)
    } finally {
      setAmazonPurging(false)
    }
  }

  const handleFbmUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFbmUploading(true)
    setFbmUploadResult(null)
    try {
      const result = await api.uploadFbmListings(file)
      setFbmUploadResult(result)
      load()
      if (result.errors?.length) alert(`FBM import completed with errors:\n${result.errors.join('\n')}`)
    } catch (err) {
      alert(`FBM import failed: ${err.message}`)
    } finally {
      setFbmUploading(false)
      e.target.value = ''
    }
  }

  const handleStrategyChange = async (productId, value, e) => {
    e.stopPropagation()
    const strategyId = value === '' ? null : Number(value)
    setStrategyMap(prev => ({ ...prev, [productId]: value }))
    try {
      await api.setProductStrategy(productId, strategyId)
    } catch (err) {
      alert(`Failed to update strategy: ${err.message}`)
      setStrategyMap(prev => ({ ...prev, [productId]: products.find(p => p.id === productId)?.aria_strategy_id ?? '' }))
    }
  }

  // Drawer callbacks
  const handleDrawerSave = (updated) => {
    setProducts(prev => prev.map(p => p.id === updated.id ? updated : p))
    setSelectedProduct(updated)
  }
  const handleDrawerDelete = (id) => {
    setProducts(prev => prev.filter(p => p.id !== id))
    setSelectedProduct(null)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Current Inventory</h1>
        <p className="text-gray-500 text-sm mt-1">All approved products — auto-synced from Amazon FBA hourly</p>
      </div>

      <AmazonSyncCard status={amazonSyncStatus} onSync={handleAmazonSync} syncing={amazonSyncing} onPurge={handleAmazonPurge} purging={amazonPurging} isAdmin={isAdmin} onFbmUpload={handleFbmUpload} fbmUploading={fbmUploading} fbmUploadResult={fbmUploadResult} />
      <KeepaStatusCard status={keepaStatus} onBulkSync={handleBulkSync} bulkLoading={bulkLoading} bulkResult={bulkResult} isAdmin={isAdmin} />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
        {/* FBA tile */}
        <div
          onClick={() => setChannelFilter(c => c === 'FBA' ? null : 'FBA')}
          className={`card p-4 cursor-pointer transition-all ${channelFilter === 'FBA' ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-gray-50'}`}
        >
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-gray-500 uppercase tracking-wide">FBA</p>
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Amazon</span>
          </div>
          <p className="text-2xl font-bold text-blue-700 mt-1">{fbaCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">active SKUs</p>
          {channelFilter === 'FBA' && <p className="text-xs text-blue-500 mt-1">Filtered ✕ click to clear</p>}
        </div>
        {/* FBM tile */}
        <div
          onClick={() => setChannelFilter(c => c === 'FBM' ? null : 'FBM')}
          className={`card p-4 cursor-pointer transition-all ${channelFilter === 'FBM' ? 'ring-2 ring-purple-500 bg-purple-50' : 'hover:bg-gray-50'}`}
        >
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-gray-500 uppercase tracking-wide">FBM</p>
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Merchant</span>
          </div>
          <p className="text-2xl font-bold text-purple-700 mt-1">{fbmCount}</p>
          {fbmCount === 0
            ? <p className="text-xs text-gray-400 mt-0.5">run Sync Now to populate</p>
            : <p className="text-xs text-gray-400 mt-0.5">active SKUs</p>
          }
          {channelFilter === 'FBM' && <p className="text-xs text-purple-500 mt-1">Filtered ✕ click to clear</p>}
        </div>
      </div>

      {/* Tab bar + table */}
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
                activeTab === tab.key ? 'bg-blue-100 text-blue-700'
                  : tab.key === 'oos' && oosCount > 0 ? 'bg-red-100 text-red-600'
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
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-64">Product</th>
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
                <th className="text-left px-4 py-3 font-medium text-gray-600 bg-purple-50/60">Aria</th>
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
                const stage     = STAGE_META[getStage(p)]
                const roiVal    = Number(p.roi) || 0
                const profitVal = Number(p.profit) || 0
                const synced    = fmtSynced(p.keepa_last_synced)
                const isOos     = !Number(p.quantity)
                const curStrategy = strategyMap[p.id] ?? ''
                const isSelected = selectedProduct?.id === p.id

                return (
                  <tr
                    key={p.id}
                    onClick={() => setSelectedProduct(p)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50' : isOos ? 'opacity-60 hover:bg-gray-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    {/* Product name + ASIN — truncated in table, full in drawer */}
                    <td className="px-4 py-3">
                      <div className="min-w-0 max-w-[15rem]">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-gray-900 truncate">{p.product_name}</p>
                          {p.fulfillment_channel === 'FBM' && (
                            <span className="shrink-0 text-xs font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">FBM</span>
                          )}
                        </div>
                        {p.asin && <p className="text-xs text-blue-500 font-mono">{p.asin}</p>}
                        {p.keepa_category && (
                          <p className="text-xs text-gray-400 truncate">{p.keepa_category}</p>
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
                      {p.keepa_bsr ? <span className="font-mono text-xs text-gray-700">#{fmtBsr(p.keepa_bsr)}</span> : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 bg-blue-50/30">
                      <BuyBoxBadge buyBox={p.buy_box} buyBoxWinner={p.buy_box_winner} />
                    </td>
                    <td className="px-4 py-3 bg-blue-50/30">
                      {p.num_sellers > 0 ? <span className="text-gray-700">{p.num_sellers}</span> : <span className="text-gray-300 text-xs">—</span>}
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

                    {/* Aria strategy — stop propagation so click doesn't open drawer */}
                    <td className="px-4 py-3 bg-purple-50/30" onClick={e => e.stopPropagation()}>
                      <select
                        value={curStrategy}
                        onChange={e => handleStrategyChange(p.id, e.target.value, e)}
                        className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-400 max-w-[130px]"
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

                    {/* Keepa sync — stop propagation */}
                    <td className="px-4 py-3 bg-blue-50/30" onClick={e => e.stopPropagation()}>
                      {p.asin && keepaStatus?.configured ? (
                        <div className="flex flex-col items-start gap-0.5">
                          <button
                            onClick={async (e) => {
                              e.stopPropagation()
                              const updated = await api.keepaRefreshOne(p.id).catch(err => { alert(`Keepa sync failed: ${err.message}`); return null })
                              if (updated) {
                                setProducts(prev => prev.map(x => x.id === updated.id ? updated : x))
                                if (selectedProduct?.id === updated.id) setSelectedProduct(updated)
                              }
                            }}
                            title={synced ? `Last synced ${synced}` : 'Sync with Keepa'}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                          >
                            <SyncIcon spinning={false} />
                            Sync
                          </button>
                          {synced && <span className="text-xs text-gray-400">{synced}</span>}
                        </div>
                      ) : (
                        <span className="text-gray-300 text-xs">{p.asin ? '—' : 'No ASIN'}</span>
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
              <span className="font-semibold text-gray-800">{tableRows.reduce((s, p) => s + (Number(p.quantity) || 0), 0).toLocaleString()}</span> units
            </span>
            <span className="text-gray-500">
              <span className="font-semibold text-gray-800">{fmtCurrency(tableRows.reduce((s, p) => s + (Number(p.money_spent) || 0), 0))}</span> invested
            </span>
            <span className="text-gray-500">
              <span className="font-semibold text-green-600">{fmtCurrency(tableRows.reduce((s, p) => s + ((Number(p.profit) || 0) * (Number(p.quantity) || 0)), 0))}</span> est. profit
            </span>
            <span className="text-gray-400 ml-auto">{tableRows.length} products</span>
          </div>
        )}
      </div>

      {/* Product drawer */}
      {selectedProduct && (
        <ProductDrawer
          product={selectedProduct}
          strategies={strategies}
          keepaConfigured={keepaStatus?.configured}
          onClose={() => setSelectedProduct(null)}
          onSave={handleDrawerSave}
          onDelete={handleDrawerDelete}
          onKeepaSync={() => {}}
        />
      )}
    </div>
  )
}
