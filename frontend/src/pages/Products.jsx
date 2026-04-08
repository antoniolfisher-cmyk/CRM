import { useState, useEffect, useCallback } from 'react'
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
  const [syncing, setSyncing] = useState(false)
  const [syncingId, setSyncingId] = useState(null)
  const [syncResult, setSyncResult] = useState(null)
  const [keepaSyncingId, setKeepaSyncingId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    const params = {}
    if (search) params.search = search
    if (filterReplenish !== '') params.replenish = filterReplenish
    api.getProducts(params).then(setProducts).finally(() => setLoading(false))
  }, [search, filterReplenish])

  useEffect(() => {
    load()
    api.getAuraStatus().then(r => setAuraConfigured(r.configured)).catch(() => {})
    api.keepaStatus().then(r => setKeepaConfigured(r.configured)).catch(() => {})
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

  const totalSpent = products.reduce((s, p) => s + (p.money_spent || 0), 0)
  const totalProfit = products.reduce((s, p) => s + ((p.profit || 0) * (p.quantity || 0)), 0)
  const replenishCount = products.filter((p) => p.replenish).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-gray-500 text-sm mt-1">{products.length} products tracked</p>
        </div>
        <div className="flex gap-2">
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
          />
        </Modal>
      )}
    </div>
  )
}

// ─── form ─────────────────────────────────────────────────────────────────────

const EMPTY = {
  product_name: '', asin: '', amazon_url: '', purchase_link: '',
  date_found: '', va_finder: '', date_purchased: '', order_number: '',
  quantity: '', buy_cost: '', arrived_at_prep: '', date_sent_to_amazon: '',
  amazon_tracking_number: '', ungated: false, ungating_quantity: '',
  total_bought: '', replenish: false, amazon_fee: '', buy_box: '',
  estimated_sales: '', num_sellers: '', notes: '',
  // calculated — shown read-only
  money_spent: 0, total_cost: 0, profit: 0, profit_margin: 0, roi: 0,
}

function toFormDate(val) {
  if (!val) return ''
  try { return val.slice(0, 10) } catch { return '' }
}

function ProductForm({ initial, onSave, onClose, keepaConfigured }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...initial,
    date_found: toFormDate(initial?.date_found),
    date_purchased: toFormDate(initial?.date_purchased),
    arrived_at_prep: toFormDate(initial?.arrived_at_prep),
    date_sent_to_amazon: toFormDate(initial?.date_sent_to_amazon),
  }))
  const [saving, setSaving] = useState(false)
  const [keepaLoading, setKeepaLoading] = useState(false)
  const [keepaFilled, setKeepaFilled] = useState(null)  // { bsr, category, tokens_left } or null
  const [keepaError, setKeepaError] = useState('')

  // Auto-calculate financials whenever inputs change
  useEffect(() => {
    const calc = calcFinancials(form)
    setForm((f) => ({ ...f, ...calc }))
  }, [form.quantity, form.buy_cost, form.amazon_fee, form.buy_box])

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
          // Only fill product_name if the field is blank
          product_name: f.product_name || data.title || f.product_name,
          buy_box:        data.buy_box        ?? f.buy_box,
          num_sellers:    data.num_sellers     ?? f.num_sellers,
          estimated_sales: data.estimated_sales ?? f.estimated_sales,
        }))
        setKeepaFilled(data)
      } catch (e) {
        setKeepaError(e.message)
      } finally {
        setKeepaLoading(false)
      }
    }, 700)
    return () => { clearTimeout(timer); setKeepaLoading(false) }
  }, [form.asin, keepaConfigured])

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    // Convert date strings to ISO and numbers
    const data = {
      ...form,
      quantity: Number(form.quantity) || 0,
      buy_cost: Number(form.buy_cost) || 0,
      amazon_fee: Number(form.amazon_fee) || 0,
      buy_box: Number(form.buy_box) || 0,
      ungating_quantity: Number(form.ungating_quantity) || 0,
      total_bought: Number(form.total_bought) || 0,
      estimated_sales: Number(form.estimated_sales) || 0,
      num_sellers: Number(form.num_sellers) || 0,
    }
    try { await onSave(data) } finally { setSaving(false) }
  }

  const Section = ({ title, children }) => (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 pb-1 border-b border-gray-100">{title}</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</div>
    </div>
  )

  const Field = ({ label, k, type = 'text', span = 1, readOnly = false, placeholder = '' }) => (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <label className="label">{label}</label>
      <input
        className={`input ${readOnly ? 'bg-gray-50 text-gray-500 cursor-default' : ''}`}
        type={type}
        value={form[k] ?? ''}
        onChange={readOnly ? undefined : set(k)}
        readOnly={readOnly}
        placeholder={placeholder}
        step={type === 'number' ? '0.01' : undefined}
      />
    </div>
  )

  const Check = ({ label, k }) => (
    <div className="flex items-center gap-2 mt-1">
      <input type="checkbox" id={k} checked={!!form[k]} onChange={set(k)} className="rounded" />
      <label htmlFor={k} className="text-sm text-gray-700">{label}</label>
    </div>
  )

  return (
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
            <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
              <span>✓ Keepa data loaded</span>
              {keepaFilled.bsr && <span className="text-gray-500">· BSR #{Number(keepaFilled.bsr).toLocaleString()}</span>}
              {keepaFilled.category && <span className="text-gray-500 truncate max-w-[10rem]">· {keepaFilled.category}</span>}
            </p>
          )}
          {keepaError && (
            <p className="text-xs text-amber-600 mt-1">⚠ {keepaError}</p>
          )}
          {keepaConfigured && !keepaFilled && !keepaLoading && (form.asin || '').length > 0 && (form.asin || '').length < 10 && (
            <p className="text-xs text-gray-400 mt-1">Enter all 10 characters to auto-fill from Keepa</p>
          )}
        </div>
        <Field label="VA Finder" k="va_finder" placeholder="Who found this?" />
        <Field label="Amazon URL" k="amazon_url" span={2} />
        <Field label="Purchase Link" k="purchase_link" span={2} />
      </Section>

      <Section title="Purchase & Timeline">
        <Field label="Date Found" k="date_found" type="date" />
        <Field label="Date Purchased" k="date_purchased" type="date" />
        <Field label="Order Number" k="order_number" />
        <Field label="Arrived at Prep" k="arrived_at_prep" type="date" />
        <Field label="Date Sent to Amazon" k="date_sent_to_amazon" type="date" />
        <Field label="Amazon Tracking #" k="amazon_tracking_number" />
      </Section>

      <Section title="Inventory">
        <Field label="Quantity Ordered" k="quantity" type="number" />
        <Field label="Total Bought (lifetime)" k="total_bought" type="number" />
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
            { label: 'Money Spent', val: fmtCurrency(form.money_spent) },
            { label: 'Total Cost/unit', val: fmtCurrency(form.total_cost) },
            { label: 'Profit/unit', val: fmtCurrency(form.profit), color: Number(form.profit) >= 0 ? 'text-green-600' : 'text-red-600' },
            { label: 'Profit Margin', val: pct(form.profit_margin), color: Number(form.profit_margin) >= 0 ? 'text-green-600' : 'text-red-600' },
            { label: 'R.O.I.', val: pct(form.roi), color: Number(form.roi) >= 0 ? 'text-green-600' : 'text-red-600' },
          ].map(({ label, val, color = 'text-gray-900' }) => (
            <div key={label}>
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`font-semibold text-sm mt-0.5 ${color}`}>{val}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Notes">
        <div className="col-span-2">
          <label className="label">Notes (Discount, Coupon Codes, Gift Cards)</label>
          <textarea className="input" rows={3} value={form.notes || ''} onChange={set('notes')} />
        </div>
      </Section>

      <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : initial ? 'Save Changes' : 'Add Product'}
        </button>
      </div>
    </form>
  )
}

function PlusIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
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
