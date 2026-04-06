import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import StatusBadge from '../components/StatusBadge'
import Modal from '../components/Modal'
import { formatDate } from '../utils'

const ACCOUNT_TYPES = ['retailer', 'distributor', 'restaurant', 'grocery', 'online', 'other']
const STATUSES = ['prospect', 'active', 'inactive', 'on_hold']
const TERRITORIES = ['Midwest', 'Southeast', 'West', 'Mountain', 'Northeast', 'Southwest']

export default function Accounts() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [selected, setSelected] = useState(null)
  const navigate = useNavigate()

  const load = useCallback(() => {
    setLoading(true)
    api.getAccounts({ search, status: filterStatus, account_type: filterType })
      .then(setAccounts)
      .finally(() => setLoading(false))
  }, [search, filterStatus, filterType])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id) => {
    if (!confirm('Delete this account and all its data?')) return
    await api.deleteAccount(id)
    load()
    if (selected?.id === id) setSelected(null)
  }

  const handleSave = async (data) => {
    if (editing) {
      await api.updateAccount(editing.id, data)
    } else {
      await api.createAccount(data)
    }
    setShowForm(false)
    setEditing(null)
    load()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
          <p className="text-gray-500 text-sm mt-1">{accounts.length} accounts</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true) }}>
          <PlusIcon /> New Account
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          className="input w-64"
          placeholder="Search accounts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input w-40" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select className="input w-44" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Account</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Location</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Territory</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Contact</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Since</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              )}
              {!loading && accounts.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No accounts found</td></tr>
              )}
              {accounts.map((acc) => (
                <tr key={acc.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(acc)}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{acc.name}</p>
                    {acc.email && <p className="text-xs text-gray-400">{acc.email}</p>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge value={acc.account_type} /></td>
                  <td className="px-4 py-3"><StatusBadge value={acc.status} /></td>
                  <td className="px-4 py-3 text-gray-600">{[acc.city, acc.state].filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{acc.territory || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{acc.phone || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(acc.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-ghost py-1 px-2" onClick={() => { setEditing(acc); setShowForm(true) }}>Edit</button>
                      <button className="btn-ghost py-1 px-2 text-red-500 hover:bg-red-50" onClick={() => handleDelete(acc.id)}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Account Detail Panel */}
      {selected && (
        <AccountDetail
          accountId={selected.id}
          onClose={() => setSelected(null)}
          onEdit={() => { setEditing(selected); setShowForm(true) }}
          onDeleted={() => { setSelected(null); load() }}
        />
      )}

      {/* Form Modal */}
      {showForm && (
        <AccountForm
          initial={editing}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function AccountDetail({ accountId, onClose, onEdit, onDeleted }) {
  const [account, setAccount] = useState(null)
  const [followUps, setFollowUps] = useState([])
  const [orders, setOrders] = useState([])
  const [showContactForm, setShowContactForm] = useState(false)
  const [editingContact, setEditingContact] = useState(null)
  const [tab, setTab] = useState('contacts')

  useEffect(() => {
    api.getAccount(accountId).then(setAccount)
    api.getFollowUps({ account_id: accountId }).then(setFollowUps)
    api.getOrders({ account_id: accountId }).then(setOrders)
  }, [accountId])

  const handleDeleteContact = async (cid) => {
    if (!confirm('Delete this contact?')) return
    await api.deleteContact(cid)
    api.getAccount(accountId).then(setAccount)
  }

  const handleSaveContact = async (data) => {
    if (editingContact) {
      await api.updateContact(editingContact.id, data)
    } else {
      await api.createContact({ ...data, account_id: accountId })
    }
    setShowContactForm(false)
    setEditingContact(null)
    api.getAccount(accountId).then(setAccount)
  }

  if (!account) return null

  return (
    <Modal title={account.name} onClose={onClose} size="xl">
      <div className="space-y-4">
        {/* Header info */}
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            <StatusBadge value={account.status} />
            <StatusBadge value={account.account_type} />
            {account.territory && <span className="badge bg-slate-100 text-slate-600">{account.territory}</span>}
          </div>
          <button className="btn-secondary ml-auto" onClick={onEdit}>Edit Account</button>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          {account.phone && <Info label="Phone" value={account.phone} />}
          {account.email && <Info label="Email" value={account.email} />}
          {account.address && <Info label="Address" value={`${account.address}, ${account.city}, ${account.state} ${account.zip_code}`} />}
          {account.payment_terms && <Info label="Payment Terms" value={account.payment_terms} />}
          {account.credit_limit > 0 && <Info label="Credit Limit" value={`$${account.credit_limit.toLocaleString()}`} />}
          {account.website && <Info label="Website" value={account.website} />}
        </div>

        {account.notes && (
          <div className="bg-amber-50 rounded-lg p-3 text-sm text-amber-900">
            <p className="font-medium mb-1">Notes</p>
            <p>{account.notes}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <div className="flex gap-1">
            {[
              { id: 'contacts', label: `Contacts (${account.contacts?.length || 0})` },
              { id: 'followups', label: `Follow-Ups (${followUps.length})` },
              { id: 'orders', label: `Orders (${orders.length})` },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'contacts' && (
          <div className="space-y-2">
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => { setEditingContact(null); setShowContactForm(true) }}>
                <PlusIcon /> Add Contact
              </button>
            </div>
            {(account.contacts || []).map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                <div>
                  <p className="font-medium text-sm">{c.first_name} {c.last_name} {c.is_primary && <span className="badge bg-blue-100 text-blue-700 ml-1">Primary</span>}</p>
                  <p className="text-xs text-gray-500">{[c.title, c.phone, c.email].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex gap-1">
                  <button className="btn-ghost py-1 px-2 text-sm" onClick={() => { setEditingContact(c); setShowContactForm(true) }}>Edit</button>
                  <button className="btn-ghost py-1 px-2 text-sm text-red-500 hover:bg-red-50" onClick={() => handleDeleteContact(c.id)}>Del</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'followups' && (
          <div className="space-y-2">
            {followUps.length === 0 && <p className="text-gray-400 text-sm text-center py-4">No follow-ups yet</p>}
            {followUps.map(fu => (
              <div key={fu.id} className="flex items-start justify-between p-3 border border-gray-200 rounded-lg">
                <div>
                  <p className="font-medium text-sm">{fu.subject}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    <StatusBadge value={fu.follow_up_type} /> · {fu.due_date ? new Date(fu.due_date).toLocaleDateString() : '—'}
                  </p>
                </div>
                <StatusBadge value={fu.status} />
              </div>
            ))}
          </div>
        )}

        {tab === 'orders' && (
          <div className="space-y-2">
            {orders.length === 0 && <p className="text-gray-400 text-sm text-center py-4">No orders yet</p>}
            {orders.map(o => (
              <div key={o.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                <div>
                  <p className="font-medium text-sm">{o.order_number}</p>
                  <p className="text-xs text-gray-500">{o.order_date ? new Date(o.order_date).toLocaleDateString() : '—'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm">${o.total?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  <StatusBadge value={o.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showContactForm && (
        <Modal title={editingContact ? 'Edit Contact' : 'New Contact'} onClose={() => { setShowContactForm(false); setEditingContact(null) }}>
          <ContactForm initial={editingContact} onSave={handleSaveContact} onClose={() => { setShowContactForm(false); setEditingContact(null) }} />
        </Modal>
      )}
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

function AccountForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState({
    name: '', account_type: 'retailer', status: 'prospect', phone: '', email: '',
    website: '', address: '', city: '', state: '', zip_code: '', territory: '',
    payment_terms: '', credit_limit: 0, notes: '',
    ...initial,
  })
  const [saving, setSaving] = useState(false)

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try { await onSave(form) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Account Name *</label>
          <input className="input" required value={form.name} onChange={set('name')} />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={form.account_type} onChange={set('account_type')}>
            {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={form.status} onChange={set('status')}>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={set('phone')} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={form.email} onChange={set('email')} />
        </div>
        <div>
          <label className="label">Website</label>
          <input className="input" value={form.website} onChange={set('website')} />
        </div>
        <div>
          <label className="label">Territory</label>
          <select className="input" value={form.territory} onChange={set('territory')}>
            <option value="">— Select —</option>
            {TERRITORIES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Address</label>
          <input className="input" value={form.address} onChange={set('address')} />
        </div>
        <div>
          <label className="label">City</label>
          <input className="input" value={form.city} onChange={set('city')} />
        </div>
        <div>
          <label className="label">State</label>
          <input className="input" value={form.state} onChange={set('state')} />
        </div>
        <div>
          <label className="label">ZIP</label>
          <input className="input" value={form.zip_code} onChange={set('zip_code')} />
        </div>
        <div>
          <label className="label">Payment Terms</label>
          <select className="input" value={form.payment_terms} onChange={set('payment_terms')}>
            <option value="">— Select —</option>
            {['Net 7', 'Net 15', 'Net 30', 'Net 60', 'COD', 'Prepaid'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Credit Limit ($)</label>
          <input className="input" type="number" min="0" value={form.credit_limit} onChange={set('credit_limit')} />
        </div>
        <div className="col-span-2">
          <label className="label">Notes</label>
          <textarea className="input" rows={3} value={form.notes} onChange={set('notes')} />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save Account'}</button>
      </div>
    </form>
  )
}

function ContactForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState({
    first_name: '', last_name: '', title: '', phone: '', mobile: '', email: '', is_primary: false, notes: '',
    ...initial,
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try { await onSave(form) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">First Name *</label>
          <input className="input" required value={form.first_name} onChange={set('first_name')} />
        </div>
        <div>
          <label className="label">Last Name *</label>
          <input className="input" required value={form.last_name} onChange={set('last_name')} />
        </div>
        <div className="col-span-2">
          <label className="label">Title</label>
          <input className="input" value={form.title} onChange={set('title')} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={set('phone')} />
        </div>
        <div>
          <label className="label">Mobile</label>
          <input className="input" value={form.mobile} onChange={set('mobile')} />
        </div>
        <div className="col-span-2">
          <label className="label">Email</label>
          <input className="input" type="email" value={form.email} onChange={set('email')} />
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <input type="checkbox" id="is_primary" checked={form.is_primary} onChange={set('is_primary')} className="rounded" />
          <label htmlFor="is_primary" className="text-sm text-gray-700">Primary contact</label>
        </div>
        <div className="col-span-2">
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save Contact'}</button>
      </div>
    </form>
  )
}

function PlusIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
}
