import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { api } from '../api'
import Modal from '../components/Modal'
import { formatDate, fmtCurrency } from '../utils'

// ─── helpers ──────────────────────────────────────────────────────────────────

function pct(val) {
  if (!val && val !== 0) return '—'
  return `${(Number(val) * 100).toFixed(1)}%`
}
function num(val, dec = 2) {
  if (!val && val !== 0) return '—'
  return Number(val).toFixed(dec)
}

function calcFinancials(f) {
  const qty = Number(f.quantity) || 0
  const buyCost = Number(f.buy_cost) || 0
  const amazonFee = Number(f.amazon_fee) || 0
  const buyBox = Number(f.buy_box) || 0

  const moneySpent = qty * buyCost
  const totalCost = buyCost + amazonFee          // per unit
  const profit = buyBox - totalCost              // per unit
  const profitMargin = buyBox > 0 ? profit / buyBox : 0
  const roi = buyCost > 0 ? profit / buyCost : 0

  return {
    money_spent: Math.round(moneySpent * 100) / 100,
    total_cost: Math.round(totalCost * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    profit_margin: Math.round(profitMargin * 10000) / 10000,
    roi: Math.round(roi * 10000) / 10000,
  }
}

// ─── column definitions ───────────────────────────────────────────────────────

const COLS = [
  { key: 'product_name', label: 'Product Name', width: 'w-48', render: (v, r) => (
    <div className="min-w-0">
      <p className="font-medium text-gray-900 truncate">{v}</p>
      {r.asin && <p className="text-xs text-gray-400">{r.asin}</p>}
    </div>
  )},
  { key: 'date_found',        label: 'Date Found',          width: 'w-28', render: (v) => formatDate(v) },
  { key: 'date_purchased',    label: 'Date Purchased',       width: 'w-28', render: (v) => formatDate(v) },
  { key: 'va_finder',         label: 'VA Finder',            width: 'w-28' },
  { key: 'order_number',      label: 'Order #',              width: 'w-32' },
  { key: 'arrived_at_prep',   label: 'Arrived at Prep',      width: 'w-28', render: (v) => formatDate(v) },
  { key: 'date_sent_to_amazon', label: 'Sent to Amazon',     width: 'w-28', render: (v) => formatDate(v) },
  { key: 'amazon_tracking_number', label: 'Tracking #',      width: 'w-36' },
  { key: 'ungated',           label: 'Ungated',              width: 'w-20', render: (v) => (
    <span className={`badge ${v ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{v ? 'Yes' : 'No'}</span>
  )},
  { key: 'ungating_quantity', label: 'Ungating Qty',         width: 'w-24', render: (v) => num(v, 0) },
  { key: 'total_bought',      label: 'Total Bought',         width: 'w-24', render: (v) => num(v, 0) },
  { key: 'replenish',         label: 'Replenish',            width: 'w-20', render: (v) => (
    <span className={`badge ${v ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{v ? 'Yes' : 'No'}</span>
  )},
  { key: 'quantity',          label: 'Quantity',             width: 'w-20', render: (v) => num(v, 0) },
  { key: 'buy_cost',          label: 'Buy Cost',             width: 'w-24', render: (v) => fmtCurrency(v) },
  { key: 'money_spent',       label: 'Money Spent',          width: 'w-28', render: (v) => fmtCurrency(v) },
  { key: 'amazon_fee',        label: 'Amazon Fee',           width: 'w-24', render: (v) => fmtCurrency(v) },
  { key: 'total_cost',        label: 'Total Cost',           width: 'w-24', render: (v) => fmtCurrency(v) },
  { key: 'buy_box',           label: 'Buy Box',              width: 'w-24', render: (v) => fmtCurrency(v) },
  { key: 'keepa_bsr',        label: 'BSR',                  width: 'w-24', render: (v) => v ? `#${Number(v).toLocaleString()}` : '—' },
  { key: 'keepa_category',   label: 'Category',             width: 'w-36', render: (v) => <span className="text-xs text-gray-500 truncate block max-w-[9rem]">{v || '—'}</span> },
  { key: 'aria_suggested_price', label: '✦ Aria Price',     width: 'w-28', render: (v, r) => v ? (
    <div>
      <span className={`font-semibold text-sm ${v > (r.buy_box || 0) ? 'text-amber-600' : 'text-violet-700'}`}>{fmtCurrency(v)}</span>
      {r.buy_box > 0 && <span className="text-xs text-gray-400 block">{v < r.buy_box ? `↓${fmtCurrency(r.buy_box - v)}` : v > r.buy_box ? `↑${fmtCurrency(v - r.buy_box)}` : '= buy box'}</span>}
    </div>
  ) : <span className="text-xs text-gray-300">—</span> },
  { key: 'profit',            label: 'Profit',               width: 'w-24', render: (v) => (
    <span className={Number(v) >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>{fmtCurrency(v)}</span>
  )},
  { key: 'profit_margin',     label: 'Profit Margin',        width: 'w-28', render: (v) => (
    <span className={Number(v) >= 0 ? 'text-green-600' : 'text-red-600'}>{pct(v)}</span>
  )},
  { key: 'roi',               label: 'R.O.I.',               width: 'w-24', render: (v) => (
    <span className={Number(v) >= 0 ? 'text-green-600' : 'text-red-600'}>{pct(v)}</span>
  )},
  { key: 'estimated_sales',   label: 'Est. Sales',           width: 'w-24', render: (v) => num(v, 0) },
  { key: 'num_sellers',       label: '# Sellers',            width: 'w-20', render: (v) => num(v, 0) },
  { key: 'notes',             label: 'Notes',                width: 'w-48', render: (v) => (
    <span className="text-xs text-gray-500 truncate block max-w-xs">{v || '—'}</span>
  )},
]

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Products() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterReplenish, setFilterReplenish] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [auraConfigured, setAuraConfigured] = useState(false)
  const [keepaConfigured, setKeepaConfigured] = useState(false)
  const [amazonConfigured, setAmazonConfigured] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncingId, setSyncingId] = useState(null)
  const [syncResult, setSyncResult] = useState(null)
  const [keepaSyncingId, setKeepaSyncingId] = useState(null)
  const [ungatingId, setUngatingId] = useState(null)
  const [submittingId, setSubmittingId] = useState(null)
  const [ariaConfigured, setAriaConfigured] = useState(false)
  const [ariaRunningId, setAriaRunningId] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    const params = { status: 'sourcing' }
    if (search) params.search = search
    if (filterReplenish !== '') params.replenish = filterReplenish
    api.getProducts(params).then(setProducts).finally(() => setLoading(false))
  }, [search, filterReplenish])

  useEffect(() => {
    load()
    api.getAuraStatus().then(r => setAuraConfigured(r.configured)).catch(() => {})
    api.keepaStatus().then(r => setKeepaConfigured(r.configured)).catch(() => {})
    api.amazonStatus().then(r => setAmazonConfigured(r.configured)).catch(() => {})
    api.ariaStatus().then(r => setAriaConfigured(r.configured)).catch(() => {})
  }, [load])

  const handleDelete = async (id) => {
    if (!confirm('Delete this product?')) return
    await api.deleteProduct(id)
    load()
  }

  const handleSave = async (data) => {
    if (editing) {
      await api.updateProduct(editing.id, data)
    } else {
      await api.createProduct(data)
    }
    setShowForm(false)
    setEditing(null)
    load()
  }

  const handleSyncAll = async () => {
    setSyncing(true); setSyncResult(null)
    try {
      const result = await api.syncAllToAura()
      setSyncResult(result)
    } catch (e) {
      setSyncResult({ error: e.message })
    } finally { setSyncing(false) }
  }

  const handleSyncOne = async (productId, e) => {
    e.stopPropagation()
    setSyncingId(productId); setSyncResult(null)
    try {
      const result = await api.syncOneToAura(productId)
      setSyncResult(result)
    } catch (e) {
      setSyncResult({ error: e.message })
    } finally { setSyncingId(null) }
  }

  const handleKeepaSyncOne = async (productId, e) => {
    e.stopPropagation()
    setKeepaSyncingId(productId)
    try {
      const updated = await api.keepaRefreshOne(productId)
      setProducts(prev => prev.map(p => p.id === productId ? updated : p))
    } catch (err) {
      alert(`Keepa sync failed: ${err.message}`)
    } finally { setKeepaSyncingId(null) }
  }

  const handleCheckUngated = async (productId, e) => {
    e.stopPropagation()
    setUngatingId(productId)
    try {
      const result = await api.checkAmazonUngated(productId)
      setProducts(prev => prev.map(p => {
        if (p.id !== productId) return p
        if (!result.ungated) {
          const reasons = (result.restrictions || []).flatMap(r => r.reasons || [])
          const msg = reasons.map(r => r.message).filter(Boolean).join('\n')
          const approvalLink = reasons.flatMap(r => r.links || []).find(l => l.resource)
          let info = `⚠ Gated — approval required`
          if (p.ungating_quantity) info += `\nUnits needed to ungate: ${p.ungating_quantity}`
          if (msg) info += `\n\n${msg}`
          if (approvalLink) info += `\n\nApproval: ${approvalLink.resource}`
          alert(info)
        }
        return { ...p, ungated: result.ungated }
      }))
    } catch (err) {
      alert(`Ungated check failed: ${err.message}`)
    } finally { setUngatingId(null) }
  }

  const handleSubmitForApproval = async (productId, e) => {
    e.stopPropagation()
    if (!confirm('Send this product to admin for approval?')) return
    setSubmittingId(productId)
    try {
      await api.submitProduct(productId)
      setProducts(prev => prev.filter(p => p.id !== productId))
    } catch (err) {
      alert(`Submit failed: ${err.message}`)
    } finally { setSubmittingId(null) }
  }

  const handleAriaRunOne = async (productId, e) => {
    e.stopPropagation()
    setAriaRunningId(productId)
    try {
      const updated = await api.ariaRunOne(productId)
      setProducts(prev => prev.map(p => p.id === productId ? updated : p))
    } catch (err) {
      alert(`Aria repricing failed: ${err.message}`)
    } finally { setAriaRunningId(null) }
  }

  const handleImportAmazon = async () => {
    if (!confirm('Import FBA inventory from Amazon? New ASINs will be added as products. Existing ASINs will have their quantity updated.')) return
    setImporting(true); setImportResult(null)
    try {
      const r = await api.importAmazonInventory()
      setImportResult(r)
      load()
    } catch (e) {
      setImportResult({ error: e.message })
    } finally { setImporting(false) }
  }

  const totalSpent = products.reduce((s, p) => s + (p.money_spent || 0), 0)
  const totalProfit = products.reduce((s, p) => s + ((p.profit || 0) * (p.quantity || 0)), 0)
  const replenishCount = products.filter((p) => p.replenish).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sourcing</h1>
          <p className="text-gray-500 text-sm mt-1">{products.length} products tracked</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {amazonConfigured && (
            <button
              className="btn-secondary flex items-center gap-2"
              onClick={handleImportAmazon}
              disabled={importing}
              title="Pull your FBA inventory from Amazon Seller Central"
            >
              <AmazonIcon />
              {importing ? 'Importing...' : 'Import from Amazon'}
            </button>
          )}
          {auraConfigured && (
            <button className="btn-secondary flex items-center gap-2" onClick={handleSyncAll} disabled={syncing}>
              <AuraIcon />
              {syncing ? 'Syncing...' : 'Sync All to Aura'}
            </button>
          )}
          <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true) }}>
            <PlusIcon /> Add Product
          </button>
        </div>
      </div>

      {/* Import result banner */}
      {importResult && (
        <div className={`rounded-lg p-4 text-sm ${importResult.error ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          {importResult.error ? (
            <p className="text-red-700">Import failed: {importResult.error}</p>
          ) : (
            <p className="text-green-800 font-medium">
              Import complete — {importResult.created} new products added · {importResult.updated} quantities updated · {importResult.skipped} skipped
              {importResult.total > 0 && <span className="font-normal text-green-700"> ({importResult.total} total FBA items found)</span>}
            </p>
          )}
          <button className="text-xs underline mt-1 opacity-60" onClick={() => setImportResult(null)}>dismiss</button>
        </div>
      )}

      {/* Aura not configured banner */}
      {!auraConfigured && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
          <AuraIcon className="text-amber-600 shrink-0" />
          <span>Add <code className="bg-amber-100 px-1 rounded">AURA_API_KEY</code> to your Railway environment variables to enable Aura sync.</span>
        </div>
      )}

      {/* Sync result */}
      {syncResult && (
        <div className={`rounded-lg p-4 text-sm ${syncResult.error ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          {syncResult.error ? (
            <p className="text-red-700">✗ {syncResult.error}</p>
          ) : (
            <div className="space-y-1">
              <p className="font-medium text-green-800">
                ✓ Synced {syncResult.synced?.length || 0} · Skipped {syncResult.skipped?.length || 0} · Errors {syncResult.errors?.length || 0}
              </p>
              {syncResult.skipped?.length > 0 && (
                <p className="text-amber-700 text-xs">{syncResult.skipped.map(s => `${s.product}: ${s.reason}`).join(' · ')}</p>
              )}
              {syncResult.errors?.length > 0 && (
                <p className="text-red-700 text-xs">{syncResult.errors.map(e => `${e.product}: ${e.error}`).join(' · ')}</p>
              )}
            </div>
          )}
          <button className="text-xs underline mt-1 opacity-60" onClick={() => setSyncResult(null)}>dismiss</button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Invested</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{fmtCurrency(totalSpent)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Profit (est.)</p>
          <p className={`text-2xl font-bold mt-1 ${totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtCurrency(totalProfit)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Needs Replenish</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{replenishCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          className="input w-64"
          placeholder="Search by name, ASIN, order #..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input w-40" value={filterReplenish} onChange={(e) => setFilterReplenish(e.target.value)}>
          <option value="">All Products</option>
          <option value="true">Replenish Only</option>
          <option value="false">No Replenish</option>
        </select>
      </div>

      {/* Scrollable table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm whitespace-nowrap">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} className={`text-left px-3 py-3 font-medium text-gray-600 ${c.width}`}>
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-3 sticky right-0 bg-gray-50" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr><td colSpan={COLS.length + 1} className="px-4 py-10 text-center text-gray-400">Loading...</td></tr>
              )}
              {!loading && products.length === 0 && (
                <tr>
                  <td colSpan={COLS.length + 1} className="px-4 py-10 text-center">
                    <p className="text-gray-400 mb-3">No products yet</p>
                    <button className="btn-primary" onClick={() => setShowForm(true)}>Add your first product</button>
                  </td>
                </tr>
              )}
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50 group">
                  {COLS.map((c) => (
                    <td key={c.key} className={`px-3 py-2.5 ${c.width} align-middle`}>
                      {c.render ? c.render(p[c.key], p) : (p[c.key] ?? '—')}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 sticky right-0 bg-white group-hover:bg-gray-50">
                    <div className="flex gap-1 items-center">
                      {keepaConfigured && p.asin && (
                        <button
                          className="btn-ghost py-1 px-2 text-xs text-blue-600 hover:bg-blue-50 flex items-center gap-1"
                          onClick={(e) => handleKeepaSyncOne(p.id, e)}
                          disabled={keepaSyncingId === p.id}
                          title="Refresh from Keepa"
                        >
                          <KeepaIcon spinning={keepaSyncingId === p.id} />
                        </button>
                      )}
                      {amazonConfigured && p.asin && (
                        <button
                          className={`btn-ghost py-1 px-2 text-xs flex items-center gap-1 ${ungatingId === p.id ? 'opacity-50' : p.ungated ? 'text-green-600 hover:bg-green-50' : 'text-amber-600 hover:bg-amber-50'}`}
                          onClick={(e) => handleCheckUngated(p.id, e)}
                          disabled={ungatingId === p.id}
                          title="Check gating status in Amazon Seller Central"
                        >
                          {ungatingId === p.id ? '⏳' : p.ungated ? '✓ Ungated' : '? Gate'}
                        </button>
                      )}
                      {ariaConfigured && p.buy_box > 0 && (
                        <button
                          className="btn-ghost py-1 px-2 text-xs text-violet-600 hover:bg-violet-50 flex items-center gap-1"
                          onClick={(e) => handleAriaRunOne(p.id, e)}
                          disabled={ariaRunningId === p.id}
                          title={p.aria_suggested_price ? `Aria: ${fmtCurrency(p.aria_suggested_price)} — click to refresh` : 'Run Aria AI Repricer'}
                        >
                          {ariaRunningId === p.id ? '⏳' : '✦'}
                        </button>
                      )}
                      {auraConfigured && p.asin && (
                        <button
                          className="btn-ghost py-1 px-2 text-xs text-purple-600 hover:bg-purple-50"
                          onClick={(e) => handleSyncOne(p.id, e)}
                          disabled={syncingId === p.id}
                          title="Sync to Aura Repricer"
                        >
                          {syncingId === p.id ? '...' : <AuraIcon />}
                        </button>
                      )}
                      <button
                        className="btn-ghost py-1 px-2 text-xs text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                        onClick={(e) => handleSubmitForApproval(p.id, e)}
                        disabled={submittingId === p.id}
                        title="Send to admin for approval"
                      >
                        {submittingId === p.id ? '...' : '→ Send to Admin'}
                      </button>
                      <button className="btn-ghost py-1 px-2 text-xs" onClick={() => { setEditing(p); setShowForm(true) }}>Edit</button>
                      <button className="btn-ghost py-1 px-2 text-xs text-red-500 hover:bg-red-50" onClick={() => handleDelete(p.id)}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <Modal
          title={editing ? `Edit: ${editing.product_name}` : 'Add Product'}
          onClose={() => { setShowForm(false); setEditing(null) }}
          size="xl"
        >
          <ProductForm
            initial={editing}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditing(null) }}
            keepaConfigured={keepaConfigured}
            amazonConfigured={amazonConfigured}
          />
        </Modal>
      )}
    </div>
  )
}

// ─── form helpers (defined outside ProductForm so their refs stay stable) ────

const FormCtx = createContext({})

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 pb-1 border-b border-gray-100">{title}</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</div>
    </div>
  )
}

function Field({ label, k, type = 'text', span = 1, readOnly = false, placeholder = '', isLink = false }) {
  const { form, set } = useContext(FormCtx)
  return (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <label className="label">{label}</label>
      <div className={isLink ? 'flex gap-1.5' : ''}>
        <input
          className={`input ${readOnly ? 'bg-gray-50 text-gray-500 cursor-default' : ''}`}
          type={type}
          value={form[k] ?? ''}
          onChange={readOnly ? undefined : set(k)}
          readOnly={readOnly}
          placeholder={placeholder}
          step={type === 'number' ? '0.01' : undefined}
        />
        {isLink && form[k] && (
          <a
            href={form[k]}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
          >
            Open ↗
          </a>
        )}
      </div>
    </div>
  )
}

function Check({ label, k }) {
  const { form, set } = useContext(FormCtx)
  return (
    <div className="flex items-center gap-2 mt-1">
      <input type="checkbox" id={k} checked={!!form[k]} onChange={set(k)} className="rounded" />
      <label htmlFor={k} className="text-sm text-gray-700">{label}</label>
    </div>
  )
}

// ─── form ─────────────────────────────────────────────────────────────────────

const EMPTY = {
  product_name: '', asin: '', amazon_url: '', purchase_link: '',
  date_found: '', va_finder: '', date_purchased: '',
  quantity: '', buy_cost: '', ungated: false, ungating_quantity: '',
  replenish: false, amazon_fee: '', buy_box: '',
  estimated_sales: '', num_sellers: '', notes: '',
  // calculated — shown read-only
  money_spent: 0, total_cost: 0, profit: 0, profit_margin: 0, roi: 0,
}

function toFormDate(val) {
  if (!val) return ''
  try { return val.slice(0, 10) } catch { return '' }
}

function ProductForm({ initial, onSave, onClose, keepaConfigured, amazonConfigured }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...initial,
    date_found: toFormDate(initial?.date_found),
    date_purchased: toFormDate(initial?.date_purchased),
  }))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [keepaLoading, setKeepaLoading] = useState(false)
  const [keepaFilled, setKeepaFilled] = useState(null)  // full Keepa response or null
  const [keepaError, setKeepaError] = useState('')
  const [ungatingStatus, setUngatingStatus] = useState(null)  // null | 'loading' | true | false
  const [ungatingRestrictions, setUngatingRestrictions] = useState([])

  // Derived financials — computed inline, no effect needed (avoids scroll-reset bug)
  const _calc = calcFinancials(form)

  // Auto-fetch Keepa data when a valid ASIN is entered
  useEffect(() => {
    const asin = (form.asin || '').trim().toUpperCase()
    if (!keepaConfigured || asin.length !== 10) {
      setKeepaFilled(null)
      setKeepaError('')
      return
    }
    setKeepaLoading(true)
    setKeepaFilled(null)
    setKeepaError('')
    const timer = setTimeout(async () => {
      try {
        const data = await api.keepaLookup(asin)
        setForm(f => ({
          ...f,
          product_name:    f.product_name || data.title || f.product_name,
          amazon_url:      f.amazon_url || data.amazon_url || f.amazon_url,
          buy_box:         data.buy_box          ?? f.buy_box,
          amazon_fee:      data.amazon_fee        ?? f.amazon_fee,
          num_sellers:     data.num_sellers        ?? f.num_sellers,
          estimated_sales: data.estimated_sales    ?? f.estimated_sales,
        }))
        setKeepaFilled(data)
        // Auto-check ungating as soon as ASIN is confirmed
        if (amazonConfigured) {
          setUngatingStatus('loading')
          setUngatingRestrictions([])
          try {
            const r = initial?.id
              ? await api.checkAmazonUngated(initial.id)
              : await api.checkAmazonUngatedAsin(asin)
            setUngatingStatus(r.ungated)
            setUngatingRestrictions(r.restrictions || [])
            setForm(f => ({ ...f, ungated: r.ungated }))
          } catch {
            setUngatingStatus(null)
          }
        } else {
          setUngatingStatus(null)
          setUngatingRestrictions([])
        }
      } catch (e) {
        // Only surface errors the seller can act on (ASIN not found).
        // Keepa being temporarily unavailable is silent — they can fill in manually.
        const msg = e.message || ''
        if (msg.includes('not found') || msg.includes('404')) {
          setKeepaError('ASIN not found in Keepa')
        }
        // otherwise silently fail
      } finally {
        setKeepaLoading(false)
      }
    }, 700)
    return () => { clearTimeout(timer); setKeepaLoading(false) }
  }, [form.asin, keepaConfigured, amazonConfigured, initial?.id])

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveError('')
    const nd = (v) => (v === '' || v == null) ? null : v  // empty string → null for optional dates
    const data = {
      ...form,
      ..._calc,  // include freshly computed derived values
      quantity: Number(form.quantity) || 0,
      buy_cost: Number(form.buy_cost) || 0,
      amazon_fee: Number(form.amazon_fee) || 0,
      buy_box: Number(form.buy_box) || 0,
      ungating_quantity: Number(form.ungating_quantity) || 0,
      estimated_sales: Number(form.estimated_sales) || 0,
      num_sellers: Number(form.num_sellers) || 0,
      date_found: nd(form.date_found),
      date_purchased: nd(form.date_purchased),
    }
    try {
      await onSave(data)
    } catch (err) {
      setSaveError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Max Buy Cost — computed before render to avoid IIFE in JSX
  const _buyBox = Number(form.buy_box)
  const _fee = Number(form.amazon_fee)
  const _net = _buyBox - _fee
  const showMaxBuy = _buyBox > 0 && _fee > 0 && _net > 0

  return (
    <FormCtx.Provider value={{ form, set }}>
    <form onSubmit={submit} className="space-y-6">

      <Section title="Product Info">
        <Field label="Product Name *" k="product_name" span={2} />
        {/* ASIN field with Keepa live-lookup */}
        <div>
          <label className="label">ASIN</label>
          <div className="relative">
            <input
              className="input pr-8"
              type="text"
              value={form.asin ?? ''}
              onChange={set('asin')}
              placeholder="B0XXXXXXXXX"
              maxLength={10}
            />
            {keepaLoading && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2">
                <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </span>
            )}
          </div>
          {keepaFilled && (
            <div className="mt-1 space-y-1">
              <p className="text-xs text-green-700 flex flex-wrap items-center gap-x-2">
                <span className="font-medium">✓ Keepa data loaded</span>
                {keepaFilled.bsr && <span className="text-gray-500">BSR #{Number(keepaFilled.bsr).toLocaleString()}</span>}
                {keepaFilled.category && <span className="text-gray-500 truncate max-w-[12rem]">{keepaFilled.category}</span>}
              </p>
              {keepaFilled.fba_fulfillment_fee != null && (
                <p className="text-xs text-gray-500">
                  FBA fee: <span className="font-medium text-gray-700">${keepaFilled.fba_fulfillment_fee.toFixed(2)}</span>
                  {' '}+ Referral (15%): <span className="font-medium text-gray-700">${keepaFilled.referral_fee?.toFixed(2)}</span>
                  {' '}= <span className="font-semibold text-gray-800">${keepaFilled.amazon_fee?.toFixed(2)}</span> total
                </p>
              )}
              {amazonConfigured && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="text-xs border border-gray-200 rounded px-2 py-0.5 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    disabled={ungatingStatus === 'loading'}
                    onClick={async () => {
                      const asin = (form.asin || '').trim().toUpperCase()
                      if (!asin || asin.length !== 10) {
                        alert('Enter a valid 10-character ASIN first')
                        return
                      }
                      setUngatingStatus('loading')
                      setUngatingRestrictions([])
                      try {
                        const r = initial?.id
                          ? await api.checkAmazonUngated(initial.id)
                          : await api.checkAmazonUngatedAsin(asin)
                        setUngatingStatus(r.ungated)
                        setUngatingRestrictions(r.restrictions || [])
                        setForm(f => ({ ...f, ungated: r.ungated }))
                      } catch (e) {
                        setUngatingStatus(null)
                        alert(`Ungated check failed: ${e.message}`)
                      }
                    }}
                  >
                    {ungatingStatus === 'loading' ? '⏳ Checking...' : '🔍 Check Ungating (Seller Central)'}
                  </button>
                  {ungatingStatus === true && <span className="text-xs text-green-700 font-medium">✓ Approved to sell</span>}
                  {ungatingStatus === false && (
                    <div className="text-xs text-amber-700 space-y-0.5">
                      <div className="font-medium">⚠ Gated — approval required</div>
                      {Number(form.ungating_quantity) > 0 && (
                        <div className="text-gray-600">Units needed to ungate: <strong>{form.ungating_quantity}</strong></div>
                      )}
                      {ungatingRestrictions.flatMap(r => r.reasons || []).map((reason, i) => (
                        <div key={i} className="text-gray-500">
                          {reason.message}
                          {reason.links?.[0] && (
                            <a href={reason.links[0].resource} target="_blank" rel="noreferrer" className="ml-1 text-blue-600 underline">
                              {reason.links[0].title || 'Request Approval'} →
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {keepaError && (
            <p className="text-xs text-amber-600 mt-1">⚠ {keepaError}</p>
          )}
          {keepaConfigured && !keepaFilled && !keepaLoading && (form.asin || '').length > 0 && (form.asin || '').length < 10 && (
            <p className="text-xs text-gray-400 mt-1">Enter all 10 characters to auto-fill from Keepa</p>
          )}
        </div>
        <Field label="VA Finder" k="va_finder" placeholder="Who found this?" />
        <Field label="Amazon URL" k="amazon_url" span={2} isLink />
        <Field label="Purchase Link" k="purchase_link" span={2} isLink />
      </Section>

      {keepaFilled && (
        <MarketAnalysis data={keepaFilled} asin={(form.asin || '').trim().toUpperCase()} />
      )}

      <Section title="Purchase & Timeline">
        <Field label="Date Found" k="date_found" type="date" />
        <Field label="Date Purchased" k="date_purchased" type="date" />
        <Field label="Quantity" k="quantity" type="number" />
        <Field label="Ungating Quantity" k="ungating_quantity" type="number" />
        <div className="flex gap-6 col-span-2 mt-1">
          <Check label="Ungated" k="ungated" />
          <Check label="Replenish" k="replenish" />
        </div>
      </Section>

      <Section title="Financials">
        <Field label="Buy Cost (per unit)" k="buy_cost" type="number" placeholder="0.00" />
        <Field label="Amazon Fee (per unit)" k="amazon_fee" type="number" placeholder="0.00" />
        <Field label="Buy Box Price" k="buy_box" type="number" placeholder="0.00" />
        <Field label="Estimated Sales / mo" k="estimated_sales" type="number" />
        <Field label="# of Sellers" k="num_sellers" type="number" />
        <div /> {/* spacer */}
        {/* Calculated read-only */}
        <div className="col-span-2 grid grid-cols-4 gap-3 bg-gray-50 rounded-lg p-3">
          {[
            { label: 'Money Spent', val: fmtCurrency(_calc.money_spent) },
            { label: 'Total Cost/unit', val: fmtCurrency(_calc.total_cost) },
            { label: 'Profit/unit', val: fmtCurrency(_calc.profit), color: _calc.profit >= 0 ? 'text-green-600' : 'text-red-600' },
            { label: 'Profit Margin', val: pct(_calc.profit_margin), color: _calc.profit_margin >= 0 ? 'text-green-600' : 'text-red-600' },
            { label: 'R.O.I.', val: pct(_calc.roi), color: _calc.roi >= 0 ? 'text-green-600' : 'text-red-600' },
          ].map(({ label, val, color = 'text-gray-900' }) => (
            <div key={label}>
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`font-semibold text-sm mt-0.5 ${color}`}>{val}</p>
            </div>
          ))}
        </div>

        {/* Max Buy Cost */}
        {showMaxBuy && (
          <div className="col-span-2 bg-blue-50 border border-blue-100 rounded-lg p-3">
            <p className="text-xs font-semibold text-blue-800 mb-2">Max Buy Cost (to hit target ROI)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-blue-600">Break-even</p>
                <p className="font-bold text-sm text-blue-900">{fmtCurrency(_net)}</p>
              </div>
              <div>
                <p className="text-xs text-blue-600">@ 20% ROI</p>
                <p className="font-bold text-sm text-blue-900">{fmtCurrency(_net / 1.20)}</p>
              </div>
              <div>
                <p className="text-xs text-blue-600">@ 30% ROI</p>
                <p className="font-bold text-sm text-blue-900">{fmtCurrency(_net / 1.30)}</p>
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section title="Notes">
        <div className="col-span-2">
          <label className="label">Notes (Discount, Coupon Codes, Gift Cards)</label>
          <textarea className="input" rows={3} value={form.notes || ''} onChange={set('notes')} />
        </div>
      </Section>

      {saveError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{saveError}</p>
      )}

      <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : initial ? 'Save Changes' : 'Add Product'}
        </button>
      </div>
    </form>
    </FormCtx.Provider>
  )
}

// ─── market analysis (shown after Keepa load) ────────────────────────────────

function MarketAnalysis({ data, asin }) {
  const hasPrices = data.fba_high != null || data.fbm_high != null
  const fmtP = (v) => v != null ? fmtCurrency(v) : '—'
  // Keepa public chart image — shows price history + sales rank, same as Amazon page embed
  const keepaChartUrl = asin
    ? `https://graph.keepa.com/pricehistory.png?asin=${asin}&domain=1&salesrank=1&bb=1&new=1&fbafba=1&range=90`
    : null

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 pb-1 border-b border-gray-100">
        Market Analysis
      </h3>
      <div className="space-y-4">
        {/* Seller counts */}
        <div className="flex gap-8 flex-wrap items-end">
          {data.offers_available ? (
            <>
              <div>
                <p className="text-xs text-gray-500">FBA Sellers</p>
                <p className="text-2xl font-bold text-blue-700 mt-0.5">{data.num_fba_sellers ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">FBM Sellers</p>
                <p className="text-2xl font-bold text-gray-700 mt-0.5">{data.num_fbm_sellers ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Offers</p>
                <p className="text-2xl font-bold text-gray-500 mt-0.5">{(data.num_fba_sellers ?? 0) + (data.num_fbm_sellers ?? 0)}</p>
              </div>
            </>
          ) : (
            <div>
              <p className="text-xs text-gray-500">Total New Sellers</p>
              <p className="text-2xl font-bold text-gray-700 mt-0.5">{data.num_sellers ?? '—'}</p>
              <p className="text-xs text-gray-400 mt-1">FBA/FBM breakdown requires Keepa offer data (check plan)</p>
            </div>
          )}
          {(data.price_90_high != null || data.median_price != null || data.price_90_low != null) && (
            <div className="flex gap-6 border-l border-gray-200 pl-6">
              {data.price_90_high != null && (
                <div>
                  <p className="text-xs text-gray-500">90d High</p>
                  <p className="text-2xl font-bold text-green-600 mt-0.5">{fmtCurrency(data.price_90_high)}</p>
                </div>
              )}
              {data.median_price != null && (
                <div>
                  <p className="text-xs text-gray-500">90d Median</p>
                  <p className="text-2xl font-bold text-violet-700 mt-0.5">{fmtCurrency(data.median_price)}</p>
                </div>
              )}
              {data.price_90_low != null && (
                <div>
                  <p className="text-xs text-gray-500">90d Low</p>
                  <p className="text-2xl font-bold text-red-500 mt-0.5">{fmtCurrency(data.price_90_low)}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Price table */}
        {hasPrices && (
          <table className="text-xs w-full border border-gray-100 rounded overflow-hidden">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left text-gray-400 font-medium w-20"></th>
                <th className="px-3 py-2 text-center text-blue-700 font-semibold">FBA</th>
                <th className="px-3 py-2 text-center text-gray-600 font-semibold">FBM</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Highest', fba: data.fba_high,   fbm: data.fbm_high },
                { label: 'Lowest',  fba: data.fba_low,    fbm: data.fbm_low },
                { label: 'Median',  fba: data.fba_median, fbm: data.fbm_median, bold: true },
              ].map(row => (
                <tr key={row.label} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-500 font-medium">{row.label}</td>
                  <td className={`px-3 py-2 text-center ${row.bold ? 'font-bold text-blue-700' : 'font-semibold text-gray-800'}`}>{fmtP(row.fba)}</td>
                  <td className={`px-3 py-2 text-center ${row.bold ? 'font-bold text-violet-700' : 'font-semibold text-gray-800'}`}>{fmtP(row.fbm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Keepa price history chart — same visual as embedded on Amazon product pages */}
        {keepaChartUrl && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-gray-500">Price History &amp; Sales Rank (90 days)</p>
              <a
                href={`https://www.keepa.com/#!product/1-${asin}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                Open in Keepa →
              </a>
            </div>
            <div className="rounded-lg overflow-hidden border border-gray-100 bg-white">
              <img
                src={keepaChartUrl}
                alt="Keepa price history chart"
                className="w-full"
                loading="lazy"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PlusIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
}

function AmazonIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13.958 10.09c0 1.232.029 2.256-.591 3.351-.502.891-1.301 1.438-2.186 1.438-1.214 0-1.922-.924-1.922-2.292 0-2.692 2.415-3.182 4.699-3.182v.685zm3.186 7.706a.661.661 0 01-.77.074c-1.081-.898-1.276-1.313-1.87-2.169-1.785 1.82-3.048 2.365-5.363 2.365-2.737 0-4.869-1.69-4.869-5.073 0-2.642 1.43-4.44 3.464-5.32 1.765-.779 4.226-.917 6.107-1.131v-.421c0-.779.06-1.7-.396-2.373-.397-.6-1.157-.849-1.826-.849-1.239 0-2.345.636-2.617 1.955-.056.295-.271.585-.57.601l-3.203-.345c-.268-.06-.566-.276-.488-.686C5.581 2.508 8.725 1.5 11.547 1.5c1.44 0 3.318.383 4.453 1.472 1.44 1.344 1.301 3.137 1.301 5.089v4.608c0 1.385.577 1.994 1.117 2.742.192.268.232.59-.01.789-.606.505-1.683 1.44-2.275 1.966l.011-.37zm3.059 2.437c-2.898 2.043-7.107 3.127-10.728 3.127-5.073 0-9.64-1.877-13.092-4.998-.271-.245-.029-.579.299-.388 3.73 2.169 8.342 3.471 13.104 3.471 3.213 0 6.748-.666 10.001-2.053.49-.211.902.321.416.841z"/>
    </svg>
  )
}

function KeepaIcon({ spinning = false }) {
  return (
    <svg className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function AuraIcon({ className = '' }) {
  return (
    <svg className={`w-4 h-4 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  )
}
