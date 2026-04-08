import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import StatusBadge from '../components/StatusBadge'
import Modal from '../components/Modal'
import { formatDate } from '../utils'
import { useAuth } from '../context/AuthContext'

// ─── Wholesale email templates ────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: 'intro',
    label: 'Introduction / First Outreach',
    subject: 'A Wholesale Partnership Built Around Products People Love — Delight Shoppe',
    body: `Dear {{contact_name}},

[H2]A wholesale partnership built around products people love

My name is {{sender_name}}, and I'm reaching out on behalf of Delight Shoppe — an e-commerce retailer dedicated to sourcing thoughtful, high-quality products for customers who care about what they bring into their homes.

We've built a loyal online community around our curated selections, and as we continue to grow, we're actively seeking wholesale partnerships with brands whose values align with ours — quality, authenticity, and a genuine delight in the details.

[CALLOUT]We'd love to explore carrying {{account_name}}'s products within our store. Based on what we know of your line, we believe it's an excellent fit for our customer base and would perform well across our channels.

Here's a little more about what a partnership with Delight Shoppe looks like:

[FEATURE_CARDS]

We'd love to receive your current wholesale catalog, minimum order requirements, and any onboarding information for new retail partners. We're happy to schedule a call at your convenience to learn more about your offerings.

Thank you so much for your time — we genuinely look forward to the possibility of working together.

[CTA]`,
  },
  {
    id: 'catalog',
    label: 'Catalog & Pricing Request',
    subject: 'Requesting Wholesale Catalog — Delight Shoppe × {{account_name}}',
    body: `Dear {{contact_name}},

Thank you for your time — we're genuinely interested in carrying {{account_name}}'s products through Delight Shoppe's e-commerce channels.

To move forward with our internal review process, we'd love to receive the following from {{account_name}}:

→ Current wholesale catalog or line sheet
→ Wholesale pricing and any volume tier structure
→ Minimum order quantities (opening and reorder)
→ Lead times and shipping terms
→ Any exclusivity or territory considerations

A little more about Delight Shoppe as a retail partner:

We operate an active storefront across Amazon and direct e-commerce channels with a growing, loyal customer base. We order on a consistent, predictable cycle, and we actively promote the brands we carry through product pages, email marketing, and social content.

We're not looking for a one-time transaction — we're looking for suppliers we can grow with over time. {{account_name}} feels like a strong fit for what our customers love.

Please feel free to reply directly to this email or send any catalog materials to this address. We'll review and follow up promptly.

Looking forward to learning more.`,
  },
  {
    id: 'followup',
    label: 'Follow-Up — No Response',
    subject: 'Still Interested — Delight Shoppe × {{account_name}}',
    body: `Dear {{contact_name}},

I wanted to follow up on my earlier note about a potential wholesale partnership between Delight Shoppe and {{account_name}}. I understand how busy things get, and I didn't want my message to get buried.

To recap briefly: Delight Shoppe is a curated e-commerce retailer actively looking to source quality products for our customer base. We believe {{account_name}}'s line is a strong fit for what we carry, and we'd love to explore what a partnership could look like.

[CALLOUT]If the timing isn't right at the moment, I completely understand. Just let me know and I'll circle back at a better time — no pressure at all.

But if there's any interest, even just a quick call or a catalog to review, that would mean a lot to us.

Thank you again for your time. Whatever you decide, we wish {{account_name}} continued success.`,
  },
  {
    id: 'welcome',
    label: 'Welcome — New Supplier Partner',
    subject: 'Welcome to the Delight Shoppe Partner Network, {{account_name}}',
    body: `Dear {{contact_name}},

[H2]We're thrilled to have {{account_name}} as a Delight Shoppe supplier partner.

This is the beginning of something we're genuinely excited about, and we want to make sure the partnership starts off on the right foot.

Here's what you can expect from us:

→ Clear, timely purchase orders — no surprises on quantities or timing
→ Prompt payment within agreed terms, every time
→ Active promotion of {{account_name}}'s products across our storefronts and marketing channels
→ A dedicated point of contact — you'll always have a direct line to {{sender_name}}

[CALLOUT]We treat our supplier relationships as long-term partnerships. When your products do well, we reorder consistently and grow the line. We believe the best vendor relationships are built on trust, transparency, and shared growth.

Our first order details will follow in a separate message. In the meantime, please don't hesitate to reach out with any questions, preferred communication preferences, or anything that would make working together easier.

Thank you for choosing to partner with Delight Shoppe — we look forward to building something great with {{account_name}}.`,
  },
  {
    id: 'reorder',
    label: 'Purchase Order / Reorder',
    subject: 'Reorder Request — Delight Shoppe × {{account_name}}',
    body: `Dear {{contact_name}},

I'm reaching out to place our next order with {{account_name}} for Delight Shoppe's upcoming inventory cycle.

[CALLOUT]Please find our reorder quantities below. We'd appreciate a confirmation of availability, estimated ship date, and updated invoice at your earliest convenience.

REORDER DETAILS
• Account: Delight Shoppe
• Ship to: [Your warehouse/prep center address]
• Requested ship date: [Date]
• Payment method: [ACH / Check / Card on file]

ITEMS REQUESTED
• [Product Name / SKU] — Qty: [X]
• [Product Name / SKU] — Qty: [X]
• [Add additional lines as needed]

If any items are out of stock or on backorder, please let us know as soon as possible so we can plan accordingly. We're also open to substitutions or advance notice of upcoming restocks if the timeline is tight.

Thank you for the continued partnership — we look forward to your confirmation.`,
  },
  {
    id: 'terms',
    label: 'Wholesale Terms Inquiry',
    subject: 'Wholesale Terms Inquiry — Delight Shoppe Is Interested in {{account_name}}',
    body: `Dear {{contact_name}},

My name is {{sender_name}} from Delight Shoppe, an e-commerce retailer curating high-quality products for a loyal and growing customer base.

We've been reviewing {{account_name}}'s line and believe there's strong potential for our channels. Before we move forward with a formal buying decision, we'd love to better understand your wholesale structure.

Could you share the following?

→ Wholesale pricing or price list
→ Minimum order requirements (opening and reorder)
→ Payment terms you offer to new retail accounts
→ Typical lead times from order to shipment
→ Whether you offer exclusivity or territory restrictions
→ Any requirements or approval process for new wholesale partners

Delight Shoppe is a serious retail buyer — we order consistently, promote actively, and build long-term relationships with the brands we carry. We'd love {{account_name}} to be one of them.

Thank you for your time. I look forward to your response.`,
  },
  {
    id: 'new_product',
    label: 'New Product Inquiry',
    subject: 'Curious About What\'s New — Delight Shoppe × {{account_name}}',
    body: `Dear {{contact_name}},

I hope things are going well at {{account_name}}. I'm reaching out because we're in the process of expanding Delight Shoppe's product selection for the coming season, and you came to mind immediately.

[CALLOUT]We'd love to know if {{account_name}} has introduced any new products, lines, or collections recently — or anything coming up that you think would be a great fit for our customer base.

Our shoppers tend to respond well to products that are thoughtfully made, solve a real need, and come from brands with a clear identity. If any of {{account_name}}'s recent additions fit that description, we'd love to see them.

A quick email with any new SKUs, lookbooks, or line sheets would be a great starting point — we'll review everything carefully and follow up with feedback and interest levels.

Thank you for always bringing quality to the table. We're excited to see what's new with {{account_name}}.`,
  },
]

function fillTemplate(text, vars) {
  return text
    .replace(/\{\{account_name\}\}/g, vars.account_name || 'your company')
    .replace(/\{\{contact_name\}\}/g, vars.contact_name || 'there')
    .replace(/\{\{sender_name\}\}/g, vars.sender_name || 'The Delight Shoppe Team')
    .replace(/\{\{company_name\}\}/g, 'Delight Shoppe')
}

function EmailComposer({ account, onClose }) {
  const { user } = useAuth()
  const primaryContact = account.contacts?.find(c => c.is_primary) || account.contacts?.[0]
  const defaultTo = account.email || primaryContact?.email || ''
  const contactName = primaryContact ? primaryContact.first_name : ''

  const vars = {
    account_name: account.name,
    contact_name: contactName || 'there',
    sender_name: user?.username || 'The Delight Shoppe Team',
  }

  const [templateId, setTemplateId] = useState(TEMPLATES[0].id)
  const [to, setTo] = useState(defaultTo)
  const [subject, setSubject] = useState(() => fillTemplate(TEMPLATES[0].subject, vars))
  const [body, setBody] = useState(() => fillTemplate(TEMPLATES[0].body, vars))
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState('')

  const applyTemplate = (id) => {
    const tpl = TEMPLATES.find(t => t.id === id)
    if (tpl) {
      setSubject(fillTemplate(tpl.subject, vars))
      setBody(fillTemplate(tpl.body, vars))
    } else {
      setSubject('')
      setBody('')
    }
    setTemplateId(id)
    setMsg('')
  }

  const handleSend = async () => {
    if (!to) { setMsg('Enter a recipient email address.'); return }
    setSending(true); setMsg('')
    try {
      await api.sendAccountEmail(account.id, {
        to, subject, body,
        template_id: templateId,
        sender_name: user?.username || 'Delight Shoppe',
      })
      setMsg('✓ Email sent successfully!')
    } catch (e) {
      setMsg(`✗ ${e.message}`)
    } finally { setSending(false) }
  }

  return (
    <Modal title={`Email — ${account.name}`} onClose={onClose} size="xl">
      <div className="space-y-4">
        {/* Template picker */}
        <div>
          <label className="label">Template</label>
          <select
            className="input"
            value={templateId}
            onChange={e => applyTemplate(e.target.value)}
          >
            {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            <option value="blank">— Start from scratch —</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">Selecting a template will replace the subject and body below. You can edit freely after.</p>
        </div>

        <div className="border-t border-gray-100 pt-4 space-y-3">
          {/* To */}
          <div>
            <label className="label">To *</label>
            <input
              className="input"
              type="email"
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="recipient@example.com"
            />
            {!defaultTo && (
              <p className="text-xs text-amber-600 mt-1">No email on file for this account — enter one above or add it to the account record.</p>
            )}
          </div>

          {/* Subject */}
          <div>
            <label className="label">Subject *</label>
            <input className="input" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>

          {/* Body */}
          <div>
            <label className="label">Message</label>
            <textarea
              className="input font-mono text-sm"
              rows={14}
              value={body}
              onChange={e => setBody(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">
              Variables auto-filled: account name, contact name, your username.
            </p>
          </div>
        </div>

        {msg && (
          <p className={`text-sm font-medium ${msg.startsWith('✓') ? 'text-green-700' : 'text-red-600'}`}>{msg}</p>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleSend}
            disabled={sending}
          >
            <MailIcon />
            {sending ? 'Sending...' : 'Send Email'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

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
  const [emailAccount, setEmailAccount] = useState(null)
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
                      <button className="btn-ghost py-1 px-2 flex items-center gap-1 text-blue-600 hover:bg-blue-50"
                        title="Send wholesale email"
                        onClick={() => setEmailAccount(acc)}>
                        <MailIcon className="w-3.5 h-3.5" />
                      </button>
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

      {/* Email Composer */}
      {emailAccount && (
        <EmailComposer account={emailAccount} onClose={() => setEmailAccount(null)} />
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
  const [showEmail, setShowEmail] = useState(false)

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
          <div className="ml-auto flex gap-2">
            <button className="btn-secondary flex items-center gap-1.5" onClick={() => setShowEmail(true)}>
              <MailIcon className="w-4 h-4" /> Email
            </button>
            <button className="btn-secondary" onClick={onEdit}>Edit Account</button>
          </div>
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

      {showEmail && (
        <EmailComposer account={account} onClose={() => setShowEmail(false)} />
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

function MailIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
    </svg>
  )
}
