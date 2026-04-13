import { useState, useEffect } from 'react'
import { api } from '../api'
import Modal from '../components/Modal'

const STRATEGY_CATALOG = {
  ai: [
    {
      value: 'aria',
      label: 'Aria',
      badge: 'AI',
      badgeColor: 'bg-violet-100 text-violet-800',
      icon: '✦',
      desc: 'Aria AI analyzes your competition, sales velocity, and cost structure to find the optimal price — balancing Buy Box wins with healthy profit margins automatically.',
      recommended: true,
    },
  ],
  rule: [
    {
      value: 'buy_box',
      label: 'Buy Box Targeting',
      badge: 'Rule',
      badgeColor: 'bg-green-100 text-green-700',
      icon: '🏆',
      desc: 'Target and compete directly with the current Buy Box winner. Un-suppress Buy Boxes, increase prices when out of stock, and raise prices when possible.',
      recommended: true,
      target: 'buy_box_winner',
    },
    {
      value: 'featured_merchants',
      label: 'Featured Merchants',
      badge: 'Rule',
      badgeColor: 'bg-blue-100 text-blue-700',
      icon: '⭐',
      desc: 'Target the lowest offer from sellers eligible for the Buy Box. Raise prices when you are the lowest featured merchant to increase profits.',
      target: 'featured_merchants',
    },
    {
      value: 'lowest_price',
      label: 'Lowest Price',
      badge: 'Rule',
      badgeColor: 'bg-amber-100 text-amber-800',
      icon: '↓',
      desc: 'Target the lowest overall offer on the listing. Raise prices when you are the lowest featured merchant in the Buy Box to increase profits.',
      target: 'lowest_price',
    },
    {
      value: 'custom',
      label: 'Custom',
      badge: 'Custom',
      badgeColor: 'bg-gray-100 text-gray-700',
      icon: '⚙',
      desc: 'Create a custom strategy — decide who to target, how to update your price, and what to do when you are winning the Buy Box.',
    },
  ],
}

const ALL_STRATEGIES = [...STRATEGY_CATALOG.ai, ...STRATEGY_CATALOG.rule]

const COMPETE_ACTIONS = [
  { value: 'beat_pct', label: 'Beat by %' },
  { value: 'beat_amt', label: 'Beat by $' },
  { value: 'match',    label: 'Match price' },
]

const WINNING_ACTIONS = [
  { value: 'raise_pct',    label: 'Raise toward max by %' },
  { value: 'raise_amt',    label: 'Raise toward max by $' },
  { value: 'raise_to_max', label: 'Raise to max immediately' },
  { value: 'maintain',     label: 'Maintain current price' },
]

const TARGETS = [
  { value: 'buy_box_winner',     label: 'Buy Box winner' },
  { value: 'featured_merchants', label: 'Lowest featured merchant' },
  { value: 'lowest_price',       label: 'Lowest overall price' },
]

function strategyMeta(type) {
  return ALL_STRATEGIES.find(s => s.value === type) || { label: type, badgeColor: 'bg-gray-100 text-gray-600', icon: '?' }
}

function StrategyPicker({ onPick }) {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">AI Strategies</p>
        </div>
        {STRATEGY_CATALOG.ai.map(s => (
          <button
            key={s.value}
            type="button"
            onClick={() => onPick(s.value)}
            className="w-full text-left card p-4 hover:border-violet-300 hover:bg-violet-50 transition-colors border border-transparent group"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl mt-0.5">{s.icon}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900 group-hover:text-violet-800">{s.label}</span>
                  {s.recommended && <span className="badge bg-violet-100 text-violet-700 text-xs">Recommended</span>}
                  <span className={`badge text-xs ${s.badgeColor}`}>{s.badge}</span>
                </div>
                <p className="text-sm text-gray-500 mt-1 leading-snug">{s.desc}</p>
              </div>
              <span className="text-gray-300 group-hover:text-violet-400 text-lg mt-1">›</span>
            </div>
          </button>
        ))}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Rule-based Strategies</p>
        <div className="space-y-2">
          {STRATEGY_CATALOG.rule.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => onPick(s.value)}
              className="w-full text-left card p-4 hover:border-blue-300 hover:bg-blue-50 transition-colors border border-transparent group"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl mt-0.5">{s.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 group-hover:text-blue-800">{s.label}</span>
                    {s.recommended && <span className="badge bg-green-100 text-green-700 text-xs">Recommended</span>}
                    <span className={`badge text-xs ${s.badgeColor}`}>{s.badge}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1 leading-snug">{s.desc}</p>
                </div>
                <span className="text-gray-300 group-hover:text-blue-400 text-lg mt-1">›</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function StrategyForm({ initial, strategyType, onSave, onClose }) {
  const type = strategyType || initial?.strategy_type || 'buy_box'
  const meta = strategyMeta(type)
  const isAI = type === 'aria'
  const isCustom = type === 'custom'
  const defaultTarget = ALL_STRATEGIES.find(s => s.value === type)?.target || 'buy_box_winner'

  const [form, setForm] = useState({
    name: initial?.name || '',
    description: initial?.description || '',
    target: initial?.target ?? defaultTarget,
    compete_action: initial?.compete_action || 'beat_pct',
    compete_value: initial?.compete_value != null
      ? (initial.compete_action === 'beat_pct' ? (initial.compete_value * 100).toFixed(2) : initial.compete_value.toFixed(2))
      : '1.00',
    winning_action: initial?.winning_action || 'raise_pct',
    winning_value: initial?.winning_value != null
      ? (initial.winning_action === 'raise_pct' ? (initial.winning_value * 100).toFixed(2) : initial.winning_value.toFixed(2))
      : '1.00',
    min_price: initial?.min_price ?? '',
    max_price: initial?.max_price ?? '',
    profit_floor: initial?.profit_floor ?? '',
    min_roi: initial?.min_roi ?? '',
    is_active: initial?.is_active ?? true,
    is_default: initial?.is_default ?? false,
    notes: initial?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) =>
    setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const nn = (v) => (v === '' || v == null) ? null : Number(v)

  const submit = async (e) => {
    e.preventDefault(); setError('')
    if (!form.name.trim()) { setError('Strategy name is required'); return }
    setSaving(true)
    const cv = nn(form.compete_value)
    const wv = nn(form.winning_value)
    const data = {
      name: form.name.trim(),
      description: form.description || null,
      strategy_type: type,
      target: isAI ? null : (isCustom ? form.target : defaultTarget),
      compete_action: isAI ? null : form.compete_action,
      compete_value: isAI ? null : (form.compete_action === 'beat_pct' ? (cv != null ? cv / 100 : null) : cv),
      winning_action: isAI ? null : form.winning_action,
      winning_value: isAI ? null : (form.winning_action === 'raise_pct' ? (wv != null ? wv / 100 : null) : wv),
      min_price: nn(form.min_price),
      max_price: nn(form.max_price),
      profit_floor: nn(form.profit_floor),
      min_roi: nn(form.min_roi),
      is_active: form.is_active,
      is_default: form.is_default,
      notes: form.notes || null,
    }
    try { await onSave(data) }
    catch (err) { setError(err.message); setSaving(false) }
  }

  const SectionHead = ({ children }) => (
    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100 pb-1 mb-3">{children}</h3>
  )

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

      <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
        <span className="text-lg">{meta.icon}</span>
        <span className={`badge ${meta.badgeColor}`}>{meta.label}</span>
        <span className="text-sm text-gray-500">{meta.desc}</span>
      </div>

      <div>
        <label className="label">Strategy Name *</label>
        <input className="input" required value={form.name} onChange={set('name')} placeholder={`e.g. My ${meta.label}`} />
      </div>
      <div>
        <label className="label">Description <span className="text-gray-400 font-normal">(optional)</span></label>
        <input className="input" value={form.description} onChange={set('description')} placeholder="Short note about this strategy" />
      </div>

      {!isAI && (
        <>
          {isCustom && (
            <div>
              <SectionHead>Who to target</SectionHead>
              <select className="input" value={form.target} onChange={set('target')}>
                {TARGETS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <SectionHead>How to compete</SectionHead>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Action</label>
                <select className="input" value={form.compete_action} onChange={set('compete_action')}>
                  {COMPETE_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              {form.compete_action !== 'match' && (
                <div>
                  <label className="label">{form.compete_action === 'beat_pct' ? 'Amount (%)' : 'Amount ($)'}</label>
                  <input
                    className="input" type="number"
                    step="0.01" min="0"
                    value={form.compete_value} onChange={set('compete_value')}
                    placeholder={form.compete_action === 'beat_pct' ? 'e.g. 1.00' : 'e.g. 0.10'}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    {form.compete_action === 'beat_pct'
                      ? "Percentage below the target competitor's price"
                      : "Dollar amount below the target competitor's price"}
                  </p>
                </div>
              )}
            </div>
          </div>
          <div>
            <SectionHead>When winning the Buy Box</SectionHead>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Action</label>
                <select className="input" value={form.winning_action} onChange={set('winning_action')}>
                  {WINNING_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              {(form.winning_action === 'raise_pct' || form.winning_action === 'raise_amt') && (
                <div>
                  <label className="label">{form.winning_action === 'raise_pct' ? 'Raise by (%)' : 'Raise by ($)'}</label>
                  <input
                    className="input" type="number" step="0.01" min="0"
                    value={form.winning_value} onChange={set('winning_value')}
                    placeholder={form.winning_action === 'raise_pct' ? 'e.g. 1.00' : 'e.g. 0.25'}
                  />
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-2">Applies when you are already the lowest price — prevents racing to the bottom</p>
          </div>
        </>
      )}

      {isAI ? (
        <div className="space-y-4">
          <SectionHead>Minimum price protection</SectionHead>

          {/* ROI floor */}
          <div className="rounded-lg border border-gray-200 p-4 space-y-3">
            <div>
              <label className="label">Minimum ROI (%)</label>
              <div className="flex items-center gap-2">
                <input
                  className="input w-32"
                  type="number" step="0.1" min="0" max="100"
                  value={form.min_roi}
                  onChange={set('min_roi')}
                  placeholder="e.g. 5"
                />
                <span className="text-sm text-gray-500">% return on cost</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Aria sets the minimum price so that <strong>(price − cost − fees) / cost ≥ ROI%</strong>.
                Includes all marketplace fees. Leave blank to use a 5% markup above break-even.
              </p>
            </div>

            {/* Profit floor */}
            <div>
              <label className="label">Profit floor ($) <span className="text-gray-400 font-normal">optional override</span></label>
              <div className="flex items-center gap-2">
                <input
                  className="input w-32"
                  type="number" step="0.01" min="0"
                  value={form.profit_floor}
                  onChange={set('profit_floor')}
                  placeholder="e.g. 3.00"
                />
                <span className="text-sm text-gray-500">minimum $ profit per unit</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Hard floor on profit in dollars — useful for low-priced items. Overrides the ROI floor if higher.
              </p>
            </div>

            {/* Fixed min override */}
            <div>
              <label className="label">Fixed minimum price ($) <span className="text-gray-400 font-normal">optional hard floor</span></label>
              <input
                className="input w-40"
                type="number" step="0.01" min="0"
                value={form.min_price}
                onChange={set('min_price')}
                placeholder="e.g. 29.99"
              />
              <p className="text-xs text-gray-400 mt-1">Overrides ROI and profit floor if set. Aria will never go below this.</p>
            </div>
          </div>

          <SectionHead>Maximum price</SectionHead>
          <div className="rounded-lg border border-gray-200 p-4 space-y-2">
            <p className="text-sm text-gray-600">
              By default, Aria evaluates each listing's competitive landscape and determines the optimal maximum price automatically.
            </p>
            <div>
              <label className="label">Fixed maximum price ($) <span className="text-gray-400 font-normal">optional override</span></label>
              <input
                className="input w-40"
                type="number" step="0.01" min="0"
                value={form.max_price}
                onChange={set('max_price')}
                placeholder="Auto (Buy Box × 1.15)"
              />
            </div>
          </div>
        </div>
      ) : (
        <div>
          <SectionHead>Price limits</SectionHead>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Min Price ($)</label>
              <input className="input" type="number" step="0.01" min="0" value={form.min_price} onChange={set('min_price')} placeholder="No floor" />
            </div>
            <div>
              <label className="label">Max Price ($)</label>
              <input className="input" type="number" step="0.01" min="0" value={form.max_price} onChange={set('max_price')} placeholder="No ceiling" />
            </div>
            <div>
              <label className="label">Profit Floor ($)</label>
              <input className="input" type="number" step="0.01" min="0" value={form.profit_floor} onChange={set('profit_floor')} placeholder="No minimum" />
            </div>
          </div>
          <div className="mt-3">
            <label className="label">Min ROI (%)</label>
            <div className="flex items-center gap-2">
              <input className="input w-32" type="number" step="0.1" min="0" max="100" value={form.min_roi} onChange={set('min_roi')} placeholder="e.g. 5" />
              <span className="text-xs text-gray-400">% return on cost — sets min price dynamically per product</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">Profit floor = minimum profit per unit required before any reprice action is taken</p>
        </div>
      )}

      <div>
        <label className="label">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
        <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="When or why to use this strategy" />
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" checked={form.is_active} onChange={set('is_active')} className="rounded" /> Active
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" checked={form.is_default} onChange={set('is_default')} className="rounded" /> Set as default strategy
        </label>
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : initial ? 'Save Changes' : 'Create Strategy'}
        </button>
      </div>
    </form>
  )
}

function PlusIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
}

function AriaActivityLog({ logs, loading, onRefresh }) {
  if (loading) return <p className="text-gray-400 text-sm text-center py-4">Loading activity...</p>
  if (!logs.length) return (
    <div className="text-center py-6 text-gray-400 text-sm">
      No price changes yet. Run Aria to see activity here.
    </div>
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
            <th className="pb-2 font-medium">Product</th>
            <th className="pb-2 font-medium text-right">Old Price</th>
            <th className="pb-2 font-medium text-right">New Price</th>
            <th className="pb-2 font-medium text-right">Buy Box</th>
            <th className="pb-2 font-medium">Reasoning</th>
            <th className="pb-2 font-medium text-center">Status</th>
            <th className="pb-2 font-medium text-right">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {logs.map(l => {
            const delta = l.old_price != null ? l.new_price - l.old_price : null
            const ts = l.created_at ? new Date(l.created_at) : null
            const timeStr = ts ? ts.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
            return (
              <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                <td className="py-2 pr-3">
                  <div className="font-medium text-gray-900 truncate max-w-[180px]" title={l.product_name}>{l.product_name || '—'}</div>
                  {l.asin && <div className="text-xs text-gray-400">{l.asin}</div>}
                </td>
                <td className="py-2 text-right text-gray-500 tabular-nums">
                  {l.old_price != null ? `$${l.old_price.toFixed(2)}` : '—'}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums">
                  <span className={delta == null ? '' : delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-700'}>
                    ${l.new_price.toFixed(2)}
                    {delta != null && delta !== 0 && (
                      <span className="text-xs ml-1">{delta > 0 ? '+' : ''}{delta.toFixed(2)}</span>
                    )}
                  </span>
                </td>
                <td className="py-2 text-right text-gray-500 tabular-nums">
                  {l.buy_box != null ? `$${l.buy_box.toFixed(2)}` : '—'}
                </td>
                <td className="py-2 px-3 text-gray-500 text-xs max-w-[220px]">
                  <span title={l.reasoning} className="line-clamp-2">{l.reasoning || '—'}</span>
                </td>
                <td className="py-2 text-center">
                  {l.pushed
                    ? <span className="badge bg-green-100 text-green-700 text-xs">Pushed</span>
                    : <span className="badge bg-gray-100 text-gray-400 text-xs">Not pushed</span>
                  }
                </td>
                <td className="py-2 text-right text-gray-400 text-xs whitespace-nowrap">{timeStr}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Repricer() {
  const [strategies, setStrategies] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [picking, setPicking] = useState(false)
  const [pickedType, setPickedType] = useState(null)
  const [error, setError] = useState('')
  const [ariaStatus, setAriaStatus] = useState({ configured: false, eligible: 0, need_buy_box: 0, need_cost: 0, no_sku: 0 })
  const [ariaRunning, setAriaRunning] = useState(false)
  const [ariaResult, setAriaResult] = useState(null)
  const [logs, setLogs] = useState([])
  const [logsLoading, setLogsLoading] = useState(false)

  const loadLogs = async () => {
    setLogsLoading(true)
    try { setLogs(await api.ariaLogs(null, 100)) }
    catch { /* silently ignore */ }
    finally { setLogsLoading(false) }
  }

  const load = async () => {
    setLoading(true)
    try { setStrategies(await api.getRepricerStrategies()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    loadLogs()
    api.ariaStatus().then(r => setAriaStatus(r)).catch(() => {})
  }, [])

  const handleAriaRunAll = async () => {
    setAriaRunning(true); setAriaResult(null)
    try {
      const result = await api.ariaRunAll()
      setAriaResult(result)
      loadLogs()
      api.ariaStatus().then(r => setAriaStatus(r)).catch(() => {})
    }
    catch (e) { setError(e.message) }
    finally { setAriaRunning(false) }
  }

  const handleDelete = async (s) => {
    if (!confirm(`Delete strategy "${s.name}"?`)) return
    try { await api.deleteRepricerStrategy(s.id); load() }
    catch (e) { setError(e.message) }
  }

  const handleToggleActive = async (s) => {
    try { await api.updateRepricerStrategy(s.id, { is_active: !s.is_active }); load() }
    catch (e) { setError(e.message) }
  }

  const handleSave = async (data) => {
    if (editing) { await api.updateRepricerStrategy(editing.id, data) }
    else { await api.createRepricerStrategy(data) }
    setShowForm(false); setEditing(null); setPickedType(null); load()
  }

  const openNew = () => { setEditing(null); setPicking(true) }
  const openEdit = (s) => { setEditing(s); setPickedType(s.strategy_type); setPicking(false); setShowForm(true) }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Repricer</h1>
          <p className="text-gray-500 text-sm mt-1">Define rules that control how your inventory is priced on Amazon</p>
        </div>
        <button className="btn-primary flex items-center gap-1.5" onClick={openNew}>
          <PlusIcon /> New Strategy
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex justify-between">
          {error}<button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Aria status card */}
      <div className={`card p-4 border-l-4 ${ariaStatus.configured ? 'border-violet-500' : 'border-gray-300'}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">✦</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">Aria AI Repricer</span>
                <span className={`badge ${ariaStatus.configured ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'}`}>
                  {ariaStatus.configured ? 'Ready' : 'Not Configured'}
                </span>
              </div>
              {ariaStatus.configured ? (
                <p className="text-xs text-gray-500 mt-0.5">
                  {ariaStatus.eligible > 0
                    ? <>{ariaStatus.eligible} product{ariaStatus.eligible !== 1 ? 's' : ''} eligible to reprice
                       {ariaStatus.no_sku > 0 && <> · <span className="text-amber-600">{ariaStatus.no_sku} missing seller SKU (won't push to Amazon)</span></>}
                       {ariaStatus.need_cost > 0 && <> · <span className="text-amber-600">{ariaStatus.need_cost} need a Buy Cost set</span></>}
                       {ariaStatus.need_buy_box > 0 && <> · <span className="text-amber-600">{ariaStatus.need_buy_box} need Keepa sync for Buy Box price</span></>}
                    </>
                    : ariaStatus.need_buy_box > 0
                      ? <span className="text-amber-600">
                          {ariaStatus.need_buy_box} product{ariaStatus.need_buy_box !== 1 ? 's have' : ' has'} a Buy Cost but no Buy Box price yet —
                          open each product and click <strong>Sync Keepa</strong> to fetch the current market price.
                        </span>
                      : ariaStatus.need_cost > 0
                        ? <span className="text-amber-600">No eligible products — {ariaStatus.need_cost} product{ariaStatus.need_cost !== 1 ? 's' : ''} need a Buy Cost entered before Aria can reprice them.</span>
                        : 'No products with both Buy Box price and Buy Cost set. Add a Buy Cost to your products and Sync Keepa to fetch the Buy Box price.'
                  }
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-0.5">Add ANTHROPIC_API_KEY to your environment variables to enable Aria.</p>
              )}
            </div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            {ariaResult && (
              <div className="text-xs text-gray-500">
                <span>
                  Last run: {ariaResult.repriced} repriced
                  {' · '}{ariaResult.pushed ?? 0} pushed to Amazon
                  {ariaResult.no_sku > 0 && <> · <span className="text-amber-600">{ariaResult.no_sku} missing SKU</span></>}
                  {ariaResult.skipped > 0 && <> · {ariaResult.skipped} skipped</>}
                  {ariaResult.errors > 0 && <> · <span className="text-red-500">{ariaResult.errors} error{ariaResult.errors !== 1 ? 's' : ''}</span></>}
                </span>
                {ariaResult.error_details?.length > 0 && (
                  <ul className="mt-1 text-red-500 space-y-0.5">
                    {ariaResult.error_details.map((d, i) => <li key={i}>⚠ {d}</li>)}
                  </ul>
                )}
              </div>
            )}
            <button
              className="btn-primary flex items-center gap-2"
              onClick={handleAriaRunAll}
              disabled={!ariaStatus.configured || ariaRunning}
            >
              {ariaRunning ? '⏳ Running...' : '✦ Run Aria on All Products'}
            </button>
          </div>
        </div>
      </div>

      {loading && <p className="text-gray-400 text-sm py-6 text-center">Loading...</p>}

      {!loading && strategies.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-gray-400 mb-3">No repricing strategies yet</p>
          <button className="btn-primary" onClick={openNew}>Create your first strategy</button>
        </div>
      )}

      <div className="space-y-3">
        {strategies.map(s => {
          const meta = strategyMeta(s.strategy_type)
          return (
            <div key={s.id} className={`card p-4 border-l-4 transition-opacity ${s.is_active ? 'border-blue-500' : 'border-gray-200 opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="text-xl mt-0.5 shrink-0">{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{s.name}</span>
                      {s.is_default && <span className="badge bg-blue-100 text-blue-700">Default</span>}
                      <span className={`badge ${meta.badgeColor}`}>{meta.label}</span>
                      <span className={`badge ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {s.description && <p className="text-sm text-gray-500 mt-0.5">{s.description}</p>}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
                      {s.compete_action && s.strategy_type !== 'aria' && (
                        <span>
                          {COMPETE_ACTIONS.find(a => a.value === s.compete_action)?.label}
                          {s.compete_value != null && s.compete_action === 'beat_pct' && `: ${(s.compete_value * 100).toFixed(2)}%`}
                          {s.compete_value != null && s.compete_action === 'beat_amt' && `: $${s.compete_value.toFixed(2)}`}
                        </span>
                      )}
                      {s.winning_action && s.strategy_type !== 'aria' && (
                        <span>When winning: {WINNING_ACTIONS.find(a => a.value === s.winning_action)?.label}
                          {s.winning_value != null && s.winning_action === 'raise_pct' && ` ${(s.winning_value * 100).toFixed(2)}%`}
                          {s.winning_value != null && s.winning_action === 'raise_amt' && ` $${s.winning_value.toFixed(2)}`}
                        </span>
                      )}
                      {s.min_roi != null && <span>Min ROI {s.min_roi}%</span>}
                      {s.min_price != null && <span>Min ${s.min_price.toFixed(2)}</span>}
                      {s.max_price != null && <span>Max ${s.max_price.toFixed(2)}</span>}
                      {s.profit_floor != null && <span>Profit floor ${s.profit_floor.toFixed(2)}</span>}
                    </div>
                    {s.notes && <p className="text-xs text-gray-400 mt-1 italic">{s.notes}</p>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    className={`btn-ghost py-1 px-2 text-xs ${s.is_active ? 'text-amber-600 hover:bg-amber-50' : 'text-green-600 hover:bg-green-50'}`}
                    onClick={() => handleToggleActive(s)}
                  >
                    {s.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn-ghost py-1 px-2 text-xs" onClick={() => openEdit(s)}>Edit</button>
                  <button className="btn-ghost py-1 px-2 text-xs text-red-500 hover:bg-red-50" onClick={() => handleDelete(s)}>Delete</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Aria Activity Log */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-gray-900">Aria Price Change History</h2>
            <p className="text-xs text-gray-400 mt-0.5">Every price Aria has set — including whether it was pushed live to Amazon</p>
          </div>
          <button className="btn-ghost py-1 px-2 text-xs" onClick={loadLogs} disabled={logsLoading}>
            {logsLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <AriaActivityLog logs={logs} loading={logsLoading} onRefresh={loadLogs} />
      </div>

      {picking && (
        <Modal title="Select a strategy type" onClose={() => setPicking(false)} size="lg">
          <StrategyPicker onPick={(type) => { setPickedType(type); setPicking(false); setShowForm(true) }} />
        </Modal>
      )}

      {showForm && (
        <Modal
          title={editing ? `Edit: ${editing.name}` : `New ${strategyMeta(pickedType).label} Strategy`}
          onClose={() => { setShowForm(false); setEditing(null); setPickedType(null) }}
          size="lg"
        >
          <StrategyForm
            initial={editing}
            strategyType={pickedType}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditing(null); setPickedType(null) }}
          />
        </Modal>
      )}
    </div>
  )
}
