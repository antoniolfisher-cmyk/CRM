import { useState, useEffect } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import { formatDate } from '../utils'

function InboundEmailSetup({ status, isSuperAdmin }) {
  const webhookUrl = status.inbound_webhook_url || '/api/webhooks/inbound-email'
  const configured = status.inbound_configured

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold text-gray-900">Inbound Email (Reply Capture)</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Supplier replies are routed back into each account's Email tab automatically.
          </p>
        </div>
        <span className={`badge ${configured ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
          {configured ? 'Active' : 'Not Set Up'}
        </span>
      </div>

      {configured ? (
        <div className="text-sm text-gray-600 bg-green-50 rounded-lg p-3 space-y-1">
          <p>Your unique reply address:</p>
          <code className="block font-mono font-medium text-green-800 bg-green-100 px-2 py-1 rounded text-xs break-all">
            {status.inbound_email}
          </code>
          <p className="text-xs text-green-700 mt-1">
            Every outbound email uses this as Reply-To. Replies land in the account's Email tab and notify you. Each seller on the platform gets their own unique address — replies never cross between accounts.
          </p>
        </div>
      ) : isSuperAdmin ? (
        /* Platform admin sees the full setup instructions */
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3 text-sm">
          <p className="font-medium text-amber-900">3 steps to enable reply capture for all sellers:</p>
          <ol className="space-y-3 text-amber-800">
            <li className="flex gap-2">
              <span className="font-bold shrink-0">1.</span>
              <span>
                In <strong>SendGrid dashboard</strong> → Settings → Inbound Parse → Add Host & URL.
                Set the webhook URL to:<br />
                <code className="block mt-1 bg-amber-100 px-2 py-1 rounded text-xs break-all">{webhookUrl}</code>
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold shrink-0">2.</span>
              <span>
                Add an <strong>MX record</strong> on your domain (e.g. <code>inbound.delightshoppe.org</code>) pointing to <code>mx.sendgrid.net</code> (priority 10).
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold shrink-0">3.</span>
              <span>
                In <strong>Railway Variables</strong>, set:<br />
                <code className="inline-block mt-1 bg-amber-100 px-2 py-0.5 rounded text-xs">CRM_INBOUND_EMAIL = crm@inbound.delightshoppe.org</code><br />
                <span className="text-xs text-amber-600 mt-1 block">
                  Each seller automatically gets their own subaddress (e.g. crm+t2@inbound.delightshoppe.org).
                  Replies are isolated per seller — no cross-tenant leakage.
                </span>
              </span>
            </li>
          </ol>
        </div>
      ) : (
        /* Non-platform sellers see a simple message */
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
          Reply capture is managed by the platform. Once your platform admin enables it, supplier replies will automatically appear in each account's Email tab. No configuration needed on your end.
        </div>
      )}
    </div>
  )
}


function TimeClockReport() {
  const [entries, setEntries] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({ user: '', date_from: '', date_to: '' })
  const [exporting, setExporting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.timeclockReport(filters)
      setEntries(data)
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => {
    api.getUsers().then(u => setUsers(u)).catch(() => {})
    load()
  }, [])

  const fmtDateTime = (iso) => {
    if (!iso) return '—'
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const fmtDuration = (mins) => {
    if (mins == null) return <span className="text-amber-600 text-xs">In progress</span>
    const h = Math.floor(mins / 60)
    const m = Math.round(mins % 60)
    return `${h}h ${m}m`
  }

  const totalHours = entries
    .filter(e => e.duration_minutes != null)
    .reduce((sum, e) => sum + e.duration_minutes, 0) / 60

  const handleExport = async () => {
    setExporting(true)
    try {
      const qs = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v)
      ).toString()
      const token = localStorage.getItem('crm_token')
      const res = await fetch(`/api/timeclock/report/export${qs ? '?' + qs : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `timeclock_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { alert(e.message) }
    finally { setExporting(false) }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-gray-900">Time Clock Report</h2>
          <p className="text-xs text-gray-400 mt-0.5">Employee hours for payroll</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          <DownloadIcon />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Filters */}
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-3 items-end bg-gray-50">
        <div>
          <label className="label text-xs">Employee</label>
          <select
            className="input text-sm py-1.5"
            value={filters.user}
            onChange={e => setFilters(f => ({ ...f, user: e.target.value }))}
          >
            <option value="">All employees</option>
            {users.filter(u => u.role !== 'admin').map(u => (
              <option key={u.id} value={u.username}>{u.username}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-xs">From</label>
          <input type="date" className="input text-sm py-1.5" value={filters.date_from}
            onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))} />
        </div>
        <div>
          <label className="label text-xs">To</label>
          <input type="date" className="input text-sm py-1.5" value={filters.date_to}
            onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))} />
        </div>
        <button className="btn-primary text-sm py-1.5" onClick={load}>Apply</button>
        <button className="btn-secondary text-sm py-1.5" onClick={() => {
          setFilters({ user: '', date_from: '', date_to: '' })
          setTimeout(load, 0)
        }}>Clear</button>
      </div>

      {/* Summary */}
      {entries.length > 0 && (
        <div className="px-5 py-2.5 bg-blue-50 border-b border-blue-100 flex gap-6 text-sm">
          <span><span className="font-semibold text-blue-800">{entries.length}</span> <span className="text-blue-600">entries</span></span>
          <span><span className="font-semibold text-blue-800">{totalHours.toFixed(2)}</span> <span className="text-blue-600">total hours</span></span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Clock In</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Clock Out</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Duration</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            )}
            {!loading && entries.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No entries found.</td></tr>
            )}
            {!loading && entries.map(e => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-semibold text-xs">
                      {e.username[0].toUpperCase()}
                    </div>
                    <span className="font-medium">{e.username}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{fmtDateTime(e.clock_in)}</td>
                <td className="px-4 py-3 text-gray-600">{e.clock_out ? fmtDateTime(e.clock_out) : <span className="text-green-600 text-xs font-medium">In progress</span>}</td>
                <td className="px-4 py-3 font-medium">{fmtDuration(e.duration_minutes)}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{e.notes || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  )
}

export default function Admin() {
  const { user: currentUser, isSuperAdmin } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [notifStatus, setNotifStatus] = useState(null)
  const [sendingTest, setSendingTest] = useState(false)
  const [sendingNow, setSendingNow] = useState(false)
  const [notifMsg, setNotifMsg] = useState('')
  const [myEmail, setMyEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)

  const load = () => {
    setLoading(true)
    api.getUsers().then(setUsers).finally(() => setLoading(false))
  }

  const loadStatus = () => api.getNotificationStatus().then(s => {
    setNotifStatus(s)
    if (s.admin_email) setMyEmail(s.admin_email)
  }).catch(() => {})

  useEffect(() => {
    load()
    loadStatus()
  }, [])

  const handleSaveMyEmail = async () => {
    setSavingEmail(true); setNotifMsg('')
    try {
      await api.saveMyEmail(myEmail)
      await loadStatus()
      setNotifMsg('✓ Email address saved.')
    } catch (e) { setNotifMsg(`✗ ${e.message}`) }
    finally { setSavingEmail(false) }
  }

  const handleDelete = async (u) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return
    try { await api.deleteUser(u.id); load() } catch (e) { setError(e.message) }
  }

  const handleToggleActive = async (u) => {
    try { await api.updateUser(u.id, { is_active: !u.is_active }); load() } catch (e) { setError(e.message) }
  }

  const handleToggleNotify = async (u) => {
    try { await api.updateUser(u.id, { notify_email: !u.notify_email }); load() } catch (e) { setError(e.message) }
  }

  const handleSave = async (data) => {
    try {
      if (editing) { await api.updateUser(editing.id, data) }
      else { await api.createUser(data) }
      setShowForm(false); setEditing(null); setError(''); load()
    } catch (e) { throw e }
  }

  const handleSendTest = async () => {
    setSendingTest(true); setNotifMsg('')
    try {
      await api.sendTestEmail()
      setNotifMsg('✓ Test email sent! Check your inbox.')
    } catch (e) { setNotifMsg(`✗ ${e.message}`) }
    finally { setSendingTest(false) }
  }

  const handleSendNow = async () => {
    setSendingNow(true); setNotifMsg('')
    try {
      await api.sendDigestNow()
      setNotifMsg('✓ Digest sent to all users with notifications enabled.')
    } catch (e) { setNotifMsg(`✗ ${e.message}`) }
    finally { setSendingNow(false) }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <p className="text-gray-500 text-sm mt-1">Manage users, roles, and notification settings</p>
      </div>

      <div className="flex items-center justify-between">
        <div />
        <button className="btn-primary flex items-center gap-1.5" onClick={() => { setEditing(null); setShowForm(true) }}>
          <PlusIcon /> Add User
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex justify-between">
          {error}<button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* ── Notification Settings ── */}
      {isSuperAdmin ? (
        /* Platform admin: shows full SMTP config status + digest controls */
        <div className="card p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Email Notifications</h2>
              <p className="text-sm text-gray-500 mt-0.5">Daily follow-up digests sent each morning to users with notifications enabled</p>
            </div>
            {notifStatus && (
              <span className={`badge ${notifStatus.smtp_configured ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {notifStatus.smtp_configured ? 'Connected' : 'Not Set Up'}
              </span>
            )}
          </div>

          {notifStatus && !notifStatus.smtp_configured && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Add <code className="font-mono text-xs bg-amber-100 px-1 rounded">SENDGRID_API_KEY</code> and{' '}
              <code className="font-mono text-xs bg-amber-100 px-1 rounded">SMTP_FROM</code> in Railway Variables to enable email sending.
            </div>
          )}

          {notifStatus && notifStatus.smtp_configured && (
            <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 flex flex-wrap gap-x-4 gap-y-1">
              <span><span className="font-medium">Sending from:</span> {notifStatus.smtp_user}</span>
              <span><span className="font-medium">Daily digest at:</span> {notifStatus.notify_hour_utc}:00 UTC</span>
              <span><span className="font-medium">Auto follow-up after:</span> {notifStatus.followup_days ?? 4} days of no reply</span>
            </div>
          )}

          {notifMsg && (
            <p className={`text-sm font-medium ${notifMsg.startsWith('✓') ? 'text-green-700' : 'text-red-600'}`}>
              {notifMsg}
            </p>
          )}

          <div className="flex gap-3">
            <button className="btn-secondary" onClick={handleSendTest} disabled={sendingTest || !notifStatus?.smtp_configured}>
              {sendingTest ? 'Sending...' : 'Send Test Email to Me'}
            </button>
            <button className="btn-primary" onClick={handleSendNow} disabled={sendingNow || !notifStatus?.smtp_configured}>
              {sendingNow ? 'Sending...' : 'Send Digest Now'}
            </button>
          </div>
        </div>
      ) : (
        /* Regular sellers: show their personal notification status only */
        <div className="card p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Email Notifications</h2>
              <p className="text-sm text-gray-500 mt-0.5">Daily follow-up digests and supplier reply alerts</p>
            </div>
            {notifStatus && (
              <span className={`badge ${notifStatus.smtp_configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {notifStatus.smtp_configured ? 'Active' : 'Pending Setup'}
              </span>
            )}
          </div>

          {notifStatus && notifStatus.admin_email && (
            <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 space-y-1">
              <p><span className="font-medium">Notifications sent to:</span> {notifStatus.admin_email}</p>
              {notifStatus.tenant_inbound && (
                <p><span className="font-medium">Supplier reply-to:</span>{' '}
                  <code className="font-mono text-xs bg-gray-100 px-1 rounded break-all">{notifStatus.tenant_inbound}</code>
                </p>
              )}
            </div>
          )}

          {notifStatus && !notifStatus.admin_email && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Add your email address in{' '}
              <a href="/profile" className="font-medium underline">My Profile</a>{' '}
              to receive daily digests and reply alerts.
            </div>
          )}

          {notifMsg && (
            <p className={`text-sm font-medium ${notifMsg.startsWith('✓') ? 'text-green-700' : 'text-red-600'}`}>
              {notifMsg}
            </p>
          )}

          <div className="flex gap-3">
            <button className="btn-secondary" onClick={handleSendTest} disabled={sendingTest || !notifStatus?.smtp_configured}>
              {sendingTest ? 'Sending...' : 'Send Test Email to Me'}
            </button>
          </div>
        </div>
      )}

      {/* ── Inbound Email Setup ── */}
      {notifStatus && <InboundEmailSetup status={notifStatus} isSuperAdmin={isSuperAdmin} />}

      {/* ── Time Clock Report ── */}
      <TimeClockReport />

      {/* ── Role legend ── */}
      <div className="card p-4 flex gap-6 text-sm">
        <div><span className="badge bg-blue-100 text-blue-800 mr-2">admin</span>Full access including user management</div>
        <div><span className="badge bg-gray-100 text-gray-700 mr-2">user</span>Can view and enter data, no admin access</div>
      </div>

      {/* ── Users table ── */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Username</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Notify</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>}
            {!loading && users.map((u) => {
              const isSelf = u.username === currentUser?.username
              return (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-semibold text-sm">
                        {u.username[0].toUpperCase()}
                      </div>
                      <span className="font-medium">{u.username}</span>
                      {isSelf && <span className="badge bg-blue-50 text-blue-600">you</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{u.email || <span className="italic text-gray-300">no email</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${u.role === 'admin' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>{u.role}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => !isSelf && handleToggleActive(u)}
                      disabled={isSelf}
                      className={`badge cursor-pointer transition-opacity ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} ${isSelf ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'}`}
                    >
                      {u.is_active ? 'Active' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleNotify(u)}
                      className={`badge cursor-pointer hover:opacity-80 transition-opacity ${u.notify_email && u.email ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-400'}`}
                      title={!u.email ? 'Add an email address to enable notifications' : u.notify_email ? 'Click to disable' : 'Click to enable'}
                    >
                      {u.notify_email && u.email ? '🔔 On' : '🔕 Off'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button className="btn-ghost py-1 px-2 text-xs" onClick={() => { setEditing(u); setShowForm(true) }}>Edit</button>
                      {!isSelf && (
                        <button className="btn-ghost py-1 px-2 text-xs text-red-500 hover:bg-red-50" onClick={() => handleDelete(u)}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal title={editing ? `Edit "${editing.username}"` : 'Add New User'} onClose={() => { setShowForm(false); setEditing(null) }}>
          <UserForm initial={editing} onSave={handleSave} onClose={() => { setShowForm(false); setEditing(null) }} isSelf={editing?.username === currentUser?.username} />
        </Modal>
      )}

    </div>
  )
}

// ─── User Form ────────────────────────────────────────────────────────────────

// All pages a non-admin user can be granted access to
const ALL_PAGES = [
  { key: 'dashboard',   label: 'Dashboard',         sub: [
    { key: 'amazon_sales',     label: 'Amazon Sales',         desc: 'Revenue & order counts' },
    { key: 'amazon_orders',    label: 'Amazon Open Orders',   desc: 'Live FBA and FBM tiles' },
    { key: 'amazon_inventory', label: 'Amazon FBA Inventory', desc: 'Live inventory levels' },
    { key: 'repricer',         label: 'Repricer Performance', desc: 'Price updates & Buy Box %' },
  ]},
  { key: 'accounts',    label: 'Accounts' },
  { key: 'follow_ups',  label: 'Follow-Ups' },
  { key: 'orders',      label: 'Orders' },
  { key: 'wholesale',   label: 'Wholesale' },
  { key: 'sourcing',    label: 'Sourcing' },
  { key: 'inventory',   label: 'Current Inventory' },
  { key: 'timeclock',   label: 'Time Clock' },
  { key: 'upc_scanner', label: 'UPC Scanner' },
  { key: 'ungate',      label: 'Ungate Requests' },
  { key: 'support',     label: 'Support' },
]
const ALL_PAGE_KEYS      = ALL_PAGES.map(p => p.key)
const ALL_SECTION_KEYS   = ALL_PAGES.flatMap(p => p.sub?.map(s => s.key) || [])

function parseList(str, allKeys) {
  if (!str) return allKeys   // null = all
  return str.split(',').map(s => s.trim()).filter(Boolean)
}

function UserForm({ initial, onSave, onClose, isSelf }) {
  const [form, setForm] = useState({
    username: initial?.username || '', password: '', role: initial?.role || 'user',
    is_active: initial?.is_active ?? true, email: initial?.email || '', notify_email: initial?.notify_email ?? true,
  })
  const [pages, setPages]       = useState(() => parseList(initial?.page_permissions ?? null, ALL_PAGE_KEYS))
  const [sections, setSections] = useState(() => parseList(initial?.dashboard_sections ?? null, ALL_SECTION_KEYS))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const togglePage = (key) =>
    setPages(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  const toggleSection = (key) =>
    setSections(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  const submit = async (e) => {
    e.preventDefault(); setError('')
    if (!initial && !form.password) { setError('Password is required for new users'); return }
    setSaving(true)
    const payload = { ...form }
    if (!payload.password) delete payload.password
    if (form.role === 'user') {
      payload.page_permissions   = pages.length === ALL_PAGE_KEYS.length       ? null : pages.join(',')
      payload.dashboard_sections = sections.length === ALL_SECTION_KEYS.length ? null : sections.join(',')
    } else {
      payload.page_permissions   = null
      payload.dashboard_sections = null
    }
    try { await onSave(payload) } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}
      <div>
        <label className="label">Username *</label>
        <input className="input" required value={form.username} onChange={set('username')} autoComplete="off" />
      </div>
      <div>
        <label className="label">{initial ? 'New Password' : 'Password *'}</label>
        <input className="input" type="password" placeholder={initial ? 'Leave blank to keep current' : ''} value={form.password} onChange={set('password')} autoComplete="new-password" />
      </div>
      <div>
        <label className="label">Email Address</label>
        <input className="input" type="email" placeholder="employee@example.com" value={form.email} onChange={set('email')} />
        <p className="text-xs text-gray-400 mt-1">Required to receive follow-up notifications</p>
      </div>
      <div>
        <label className="label">Role</label>
        <select className="input" value={form.role} onChange={set('role')} disabled={isSelf}>
          <option value="user">user — data entry, no admin access</option>
          <option value="admin">admin — full access including user management</option>
        </select>
      </div>

      {/* Page & section access — only for non-admin users */}
      {form.role === 'user' && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
            <div>
              <p className="text-sm font-semibold text-gray-800">Page Access</p>
              <p className="text-xs text-gray-400 mt-0.5">Choose which pages this user can see and navigate to</p>
            </div>
            <button
              type="button"
              className="text-xs text-blue-600 hover:underline shrink-0"
              onClick={() => { setPages(ALL_PAGE_KEYS); setSections(ALL_SECTION_KEYS) }}
            >
              Select all
            </button>
          </div>
          <div className="p-4 space-y-1">
            {ALL_PAGES.map(page => (
              <div key={page.key}>
                <label className="flex items-center gap-2.5 cursor-pointer py-1 group">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={pages.includes(page.key)}
                    onChange={() => togglePage(page.key)}
                  />
                  <span className="text-sm font-medium text-gray-800 group-hover:text-blue-600">{page.label}</span>
                </label>
                {/* Dashboard sub-sections */}
                {page.sub && pages.includes(page.key) && (
                  <div className="ml-6 mt-1 mb-2 space-y-1 border-l-2 border-gray-100 pl-3">
                    {page.sub.map(s => (
                      <label key={s.key} className="flex items-start gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          className="rounded mt-0.5"
                          checked={sections.includes(s.key)}
                          onChange={() => toggleSection(s.key)}
                        />
                        <span>
                          <span className="text-sm text-gray-700 group-hover:text-blue-600">{s.label}</span>
                          <span className="block text-xs text-gray-400">{s.desc}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {initial && (
          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_active" checked={form.is_active} onChange={set('is_active')} disabled={isSelf} className="rounded" />
            <label htmlFor="is_active" className="text-sm text-gray-700">Account active</label>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input type="checkbox" id="notify_email" checked={form.notify_email} onChange={set('notify_email')} className="rounded" />
          <label htmlFor="notify_email" className="text-sm text-gray-700">Send daily follow-up email notifications</label>
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : initial ? 'Save Changes' : 'Create User'}</button>
      </div>
    </form>
  )
}

function PlusIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
}
