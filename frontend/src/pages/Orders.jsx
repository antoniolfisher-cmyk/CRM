import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import StatusBadge from '../components/StatusBadge'
import Modal from '../components/Modal'
import { formatDate, fmtCurrency } from '../utils'

const ORDER_STATUSES = ['quote', 'pending', 'confirmed', 'shipped', 'delivered', 'cancelled']

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    api.getOrders({ status: filterStatus }).then(setOrders).finally(() => setLoading(false))
  }, [filterStatus])

  useEffect(() => {
    load()
    api.getAccounts().then(setAccounts)
  }, [load])

  const handleDelete = async (id) => {
    if (!confirm('Delete this order?')) return
    await api.deleteOrder(id)
    load()
    if (viewing?.id === id) setViewing(null)
  }

  const handleSave = async (data) => {
    if (editing) {
      await api.updateOrder(editing.id, data)
    } else {
      await api.createOrder(data)
    }
    setShowForm(false)
    setEditing(null)
    load()
  }

  const handleStatusChange = async (order, status) => {
    await api.updateOrder(order.id, { status })
    load()
  }

  const totalValue = orders.reduce((sum, o) => sum + (o.total || 0), 0)
  const openValue = orders.filter(o => ['pending', 'confirmed', 'quote'].includes(o.status)).reduce((sum, o) => sum + (o.total || 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
          <p className="text-gray-500 text-sm mt-1">{orders.length} orders · {fmtCurrency(totalValue)} total</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true) }}>
          <PlusIcon /> New Order
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Open Pipeline', value: fmtCurrency(openValue), sub: `${orders.filter(o => ['quote','pending','confirmed'].includes(o.status)).length} orders` },
          { label: 'In Transit', value: orders.filter(o => o.status === 'shipped').length, sub: 'orders shipped' },
          { label: 'Delivered (all)', value: orders.filter(o => o.status === 'delivered').length, sub: 'orders complete' },
        ].map(s => (
          <div key={s.label} className="card p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{s.label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-3 flex-wrap">
        {['', ...ORDER_STATUSES].map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${filterStatus === s ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Orders table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Order #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Account</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Items</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Total</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>}
              {!loading && orders.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No orders found</td></tr>}
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setViewing(order)}>
                  <td className="px-4 py-3 font-medium text-blue-600">{order.order_number}</td>
                  <td className="px-4 py-3">{order.account?.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(order.order_date)}</td>
                  <td className="px-4 py-3 text-gray-500">{order.items?.length || 0} items</td>
                  <td className="px-4 py-3 font-semibold">{fmtCurrency(order.total)}</td>
                  <td className="px-4 py-3"><StatusBadge value={order.status} /></td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button className="btn-ghost py-1 px-2 text-xs" onClick={() => { setEditing(order); setShowForm(true) }}>Edit</button>
                      <button className="btn-ghost py-1 px-2 text-xs text-red-500 hover:bg-red-50" onClick={() => handleDelete(order.id)}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Detail Modal */}
      {viewing && (
        <OrderDetail
          order={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setShowForm(true); setViewing(null) }}
          onStatusChange={(s) => handleStatusChange(viewing, s)}
        />
      )}

      {/* Order Form Modal */}
      {showForm && (
        <Modal title={editing ? `Edit ${editing.order_number}` : 'New Order'} onClose={() => { setShowForm(false); setEditing(null) }} size="xl">
          <OrderForm
            initial={editing}
            accounts={accounts}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditing(null) }}
          />
        </Modal>
      )}
    </div>
  )
}

function OrderDetail({ order, onClose, onEdit, onStatusChange }) {
  const nextStatus = {
    quote: 'pending', pending: 'confirmed', confirmed: 'shipped', shipped: 'delivered',
  }
  const next = nextStatus[order.status]

  return (
    <Modal title={order.order_number} onClose={onClose} size="lg">
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2 flex-wrap">
            <StatusBadge value={order.status} />
            {order.account && <span className="badge bg-slate-100 text-slate-700">{order.account.name}</span>}
          </div>
          <div className="flex gap-2">
            {next && (
              <button className="btn-primary py-1.5 text-sm" onClick={() => { onStatusChange(next); onClose() }}>
                Mark as {next}
              </button>
            )}
            <button className="btn-secondary py-1.5 text-sm" onClick={onEdit}>Edit</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm">
          <Info label="Order Date" value={formatDate(order.order_date)} />
          <Info label="Ship Date" value={order.ship_date ? formatDate(order.ship_date) : 'TBD'} />
          <Info label="Account" value={order.account?.name || '—'} />
        </div>

        {/* Items table */}
        <div>
          <h3 className="font-medium text-gray-800 mb-2">Line Items</h3>
          <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 text-gray-600 font-medium">Product</th>
                <th className="text-left px-3 py-2 text-gray-600 font-medium">SKU</th>
                <th className="text-right px-3 py-2 text-gray-600 font-medium">Qty</th>
                <th className="text-right px-3 py-2 text-gray-600 font-medium">Unit Price</th>
                <th className="text-right px-3 py-2 text-gray-600 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(order.items || []).map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">{item.product_name}</td>
                  <td className="px-3 py-2 text-gray-500">{item.sku || '—'}</td>
                  <td className="px-3 py-2 text-right">{item.quantity} {item.unit}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(item.unit_price)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right text-gray-600">Subtotal</td>
                <td className="px-3 py-2 text-right">{fmtCurrency(order.subtotal)}</td>
              </tr>
              {order.discount > 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-right text-gray-600">Discount</td>
                  <td className="px-3 py-2 text-right text-green-600">-{fmtCurrency(order.discount)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right font-semibold">Total</td>
                <td className="px-3 py-2 text-right font-bold text-lg">{fmtCurrency(order.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {order.notes && (
          <div className="bg-amber-50 rounded-lg p-3 text-sm text-amber-900">
            <p className="font-medium mb-1">Notes</p>
            <p>{order.notes}</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-gray-800 mt-0.5">{value}</p>
    </div>
  )
}

const EMPTY_ITEM = { product_name: '', sku: '', quantity: 1, unit: 'case', unit_price: 0, total: 0 }

function OrderForm({ initial, accounts, onSave, onClose }) {
  const [form, setForm] = useState({
    account_id: initial?.account_id ?? '',
    order_number: initial?.order_number ?? '',
    status: initial?.status ?? 'pending',
    order_date: initial?.order_date ? initial.order_date.slice(0, 16) : new Date().toISOString().slice(0, 16),
    ship_date: initial?.ship_date ? initial.ship_date.slice(0, 16) : '',
    discount: initial?.discount ?? 0,
    notes: initial?.notes ?? '',
  })
  const [items, setItems] = useState(initial?.items?.length ? initial.items : [{ ...EMPTY_ITEM }])
  const [saving, setSaving] = useState(false)

  const setField = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const setItem = (idx, k, v) => {
    setItems(items => {
      const next = [...items]
      next[idx] = { ...next[idx], [k]: v }
      if (k === 'quantity' || k === 'unit_price') {
        const qty = k === 'quantity' ? Number(v) : Number(next[idx].quantity)
        const price = k === 'unit_price' ? Number(v) : Number(next[idx].unit_price)
        next[idx].total = Math.round(qty * price * 100) / 100
      }
      return next
    })
  }

  const addItem = () => setItems(i => [...i, { ...EMPTY_ITEM }])
  const removeItem = (idx) => setItems(i => i.filter((_, j) => j !== idx))

  const subtotal = items.reduce((s, i) => s + (Number(i.total) || 0), 0)
  const total = subtotal - Number(form.discount || 0)

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const data = {
      ...form,
      account_id: Number(form.account_id),
      discount: Number(form.discount || 0),
      subtotal,
      total,
      items: items.map(i => ({
        ...i,
        quantity: Number(i.quantity),
        unit_price: Number(i.unit_price),
        total: Number(i.total),
      })),
    }
    try { await onSave(data) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className="label">Account *</label>
          <select className="input" required value={form.account_id} onChange={setField('account_id')}>
            <option value="">— Select Account —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={form.status} onChange={setField('status')}>
            {ORDER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Order Date</label>
          <input className="input" type="datetime-local" value={form.order_date} onChange={setField('order_date')} />
        </div>
        <div>
          <label className="label">Ship Date</label>
          <input className="input" type="datetime-local" value={form.ship_date} onChange={setField('ship_date')} />
        </div>
        <div>
          <label className="label">Order # (auto if blank)</label>
          <input className="input" value={form.order_number} onChange={setField('order_number')} placeholder="e.g. ORD-2024-0001" />
        </div>
      </div>

      {/* Line Items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium text-gray-800">Line Items</h3>
          <button type="button" className="btn-secondary py-1 px-3 text-sm" onClick={addItem}>+ Add Item</button>
        </div>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Product</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600 w-24">SKU</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600 w-20">Qty</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600 w-20">Unit</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">Unit Price</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">Total</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item, idx) => (
                <tr key={idx}>
                  <td className="px-2 py-1.5">
                    <input className="input py-1" value={item.product_name} onChange={(e) => setItem(idx, 'product_name', e.target.value)} placeholder="Product name" required />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className="input py-1" value={item.sku} onChange={(e) => setItem(idx, 'sku', e.target.value)} placeholder="SKU" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className="input py-1 text-right" type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => setItem(idx, 'quantity', e.target.value)} required />
                  </td>
                  <td className="px-2 py-1.5">
                    <select className="input py-1" value={item.unit} onChange={(e) => setItem(idx, 'unit', e.target.value)}>
                      {['case', 'pallet', 'each', 'lb', 'kg', 'box', 'bag'].map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input className="input py-1 text-right" type="number" min="0" step="0.01" value={item.unit_price} onChange={(e) => setItem(idx, 'unit_price', e.target.value)} required />
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium">{fmtCurrency(item.total)}</td>
                  <td className="px-2 py-1.5">
                    {items.length > 1 && (
                      <button type="button" className="text-red-400 hover:text-red-600" onClick={() => removeItem(idx)}>×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td colSpan={5} className="px-3 py-2 text-right text-gray-600 text-sm">Subtotal</td>
                <td className="px-3 py-2 text-right font-medium">{fmtCurrency(subtotal)}</td>
                <td />
              </tr>
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right text-gray-600 text-sm">Discount ($)</td>
                <td className="px-2 py-1.5">
                  <input className="input py-1 text-right" type="number" min="0" step="0.01" value={form.discount} onChange={setField('discount')} />
                </td>
                <td className="px-3 py-2 text-right text-green-600 font-medium">{form.discount > 0 ? `-${fmtCurrency(form.discount)}` : '—'}</td>
                <td />
              </tr>
              <tr>
                <td colSpan={5} className="px-3 py-2 text-right font-semibold text-gray-800">Total</td>
                <td className="px-3 py-2 text-right font-bold text-lg">{fmtCurrency(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea className="input" rows={2} value={form.notes} onChange={setField('notes')} placeholder="Delivery instructions, special requirements..." />
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save Order'}</button>
      </div>
    </form>
  )
}

function PlusIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
}
