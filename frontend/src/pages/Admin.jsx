import { useState, useEffect } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import { formatDate } from '../utils'

function InboundEmailSetup({ status }) {
  const webhookUrl = status.inbound_webhook_url || '/api/webhooks/inbound-email'
  const configured = status.inbound_configured

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold text-gray-900">Inbound Email (Reply Capture)</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Route replies from suppliers back into the CRM — matched to the right account automatically.
          </p>
        </div>
        <span className={`badge ${configured ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
          {configured ? 'Configured' : 'Not Set Up'}
        </span>
      </div>

      {configured ? (
        <div className="text-sm text-gray-600 bg-green-50 rounded-lg p-3">
          Replies to <span className="font-mono font-medium">{status.inbound_email}</span> will flow into each account's Email tab and notify the assigned user.
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3 text-sm">
          <p className="font-medium text-amber-900">3 steps to capture reply emails:</p>
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
                This is the address your wholesale contacts will reply to.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold shrink-0">3.</span>
              <span>
                In <strong>Railway Variables</strong>, set:<br />
                <code className="inline-block mt-1 bg-amber-100 px-2 py-0.5 rounded text-xs">CRM_INBOUND_EMAIL = crm@inbound.delightshoppe.org</code><br />
                <span className="text-xs text-amber-600 mt-1 block">This becomes the Reply-To on every outbound email.</span>
              </span>
            </li>
          </ol>
          <p className="text-xs text-amber-600">
            Once configured, every reply from a supplier lands in the account's Email tab and triggers a notification to the assigned user.
          </p>
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
  const { user: currentUser } = useAuth()
  const [activeTab, setActiveTab] = useState('users')
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
        <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
        <p className="text-gray-500 text-sm mt-1">Users, repricing strategies, and notification settings</p>
      </div>

      {/* ── Tab bar ── */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {[
            { key: 'users',    label: 'Users & Notifications' },
            { key: 'repricer', label: 'Repricer' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'repricer' && <RepricerTab />}

      {activeTab === 'users' && <>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">User Management</h2>
          <p className="text-gray-500 text-sm mt-0.5">Manage users, roles, and email notifications</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true) }}>
          <PlusIcon /> Add User
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex justify-between">
          {error}<button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* ── Notification Settings ── */}
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

      {/* ── Inbound Email Setup ── */}
      {notifStatus && <InboundEmailSetup status={notifStatus} />}

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

      </>}
    </div>
  )
}

// ─── Repricer Tab ─────────────────────────────────────────────────────────────

// Mirrors Aura's strategy type catalogue
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

// ── Strategy picker (shown first when creating a new strategy) ────────────────
function StrategyPicker({ onPick }) {
  return (
    <div className="space-y-6">
      {/* AI */}
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

      {/* Rule-based */}
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

function RepricerTab() {
  const [strategies, setStrategies] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [picking, setPicking] = useState(false)  // show type picker before form
  const [pickedType, setPickedType] = useState(null)
  const [error, setError] = useState('')
  const [ariaConfigured, setAriaConfigured] = useState(false)
  const [ariaRunning, setAriaRunning] = useState(false)
  const [ariaResult, setAriaResult] = useState(null)

  const load = async () => {
    setLoading(true)
    try { setStrategies(await api.getRepricerStrategies()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    api.ariaStatus().then(r => setAriaConfigured(r.configured)).catch(() => {})
  }, [])

  const handleAriaRunAll = async () => {
    setAriaRunning(true); setAriaResult(null)
    try {
      const r = await api.ariaRunAll()
      setAriaResult(r)
    } catch (e) { setError(e.message) }
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
          <h2 className="text-lg font-semibold text-gray-900">Repricing Strategies</h2>
          <p className="text-sm text-gray-500 mt-0.5">Define rules that control how your inventory is priced on Amazon</p>
        </div>
        <button className="btn-primary" onClick={openNew}>
          <PlusIcon /> New Strategy
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex justify-between">
          {error}<button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* ── Aria status card ── */}
      <div className={`card p-4 border-l-4 ${ariaConfigured ? 'border-violet-500' : 'border-gray-300'}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">✦</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">Aria AI Repricer</span>
                <span className={`badge ${ariaConfigured ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'}`}>
                  {ariaConfigured ? 'Ready' : 'Not Configured'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {ariaConfigured
                  ? 'Aria will analyze market data and suggest optimal prices for all products with a buy box price.'
                  : 'Add ANTHROPIC_API_KEY to your environment variables to enable Aria.'}
              </p>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            {ariaResult && (
              <span className="text-xs text-gray-500">
                Last run: {ariaResult.repriced} repriced · {ariaResult.skipped ?? 0} skipped · {ariaResult.errors} errors
              </span>
            )}
            <button
              className="btn-primary flex items-center gap-2"
              onClick={handleAriaRunAll}
              disabled={!ariaConfigured || ariaRunning}
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

                    {/* Parameters summary */}
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

      {/* Type picker modal */}
      {picking && (
        <Modal title="Select a strategy type" onClose={() => setPicking(false)} size="lg">
          <StrategyPicker onPick={(type) => { setPickedType(type); setPicking(false); setShowForm(true) }} />
        </Modal>
      )}

      {/* Config form modal */}
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

function StrategyForm({ initial, strategyType, onSave, onClose }) {
  const type = strategyType || initial?.strategy_type || 'buy_box'
  const meta = strategyMeta(type)
  const isAI = type === 'aria'
  const isCustom = type === 'custom'

  // Default target based on strategy type
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

      {/* Strategy type badge */}
      <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
        <span className="text-lg">{meta.icon}</span>
        <span className={`badge ${meta.badgeColor}`}>{meta.label}</span>
        <span className="text-sm text-gray-500">{meta.desc}</span>
      </div>

      {/* Name + description */}
      <div>
        <label className="label">Strategy Name *</label>
        <input className="input" required value={form.name} onChange={set('name')} placeholder={`e.g. My ${meta.label}`} />
      </div>
      <div>
        <label className="label">Description <span className="text-gray-400 font-normal">(optional)</span></label>
        <input className="input" value={form.description} onChange={set('description')} placeholder="Short note about this strategy" />
      </div>

      {/* Rule-based configuration */}
      {!isAI && (
        <>
          {/* Target (custom only — others are fixed) */}
          {isCustom && (
            <div>
              <SectionHead>Who to target</SectionHead>
              <select className="input" value={form.target} onChange={set('target')}>
                {TARGETS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          )}

          {/* Competition settings */}
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
                  <label className="label">
                    {form.compete_action === 'beat_pct' ? 'Amount (%)' : 'Amount ($)'}
                  </label>
                  <input
                    className="input"
                    type="number"
                    step={form.compete_action === 'beat_pct' ? '0.01' : '0.01'}
                    min="0"
                    value={form.compete_value}
                    onChange={set('compete_value')}
                    placeholder={form.compete_action === 'beat_pct' ? 'e.g. 1.00' : 'e.g. 0.10'}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    {form.compete_action === 'beat_pct'
                      ? 'Percentage below the target competitor\'s price'
                      : 'Dollar amount below the target competitor\'s price'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Winning action */}
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
                  <label className="label">
                    {form.winning_action === 'raise_pct' ? 'Raise by (%)' : 'Raise by ($)'}
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.winning_value}
                    onChange={set('winning_value')}
                    placeholder={form.winning_action === 'raise_pct' ? 'e.g. 1.00' : 'e.g. 0.25'}
                  />
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-2">Applies when you are already the lowest price — prevents racing to the bottom</p>
          </div>
        </>
      )}

      {/* Price limits — all strategy types */}
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
        <p className="text-xs text-gray-400 mt-2">
          Profit floor = minimum profit per unit required before any reprice action is taken
        </p>
      </div>

      {/* Notes + flags */}
      <div>
        <label className="label">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
        <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="When or why to use this strategy" />
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" checked={form.is_active} onChange={set('is_active')} className="rounded" />
          Active
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" checked={form.is_default} onChange={set('is_default')} className="rounded" />
          Set as default strategy
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


function UserForm({ initial, onSave, onClose, isSelf }) {
  const [form, setForm] = useState({
    username: initial?.username || '', password: '', role: initial?.role || 'user',
    is_active: initial?.is_active ?? true, email: initial?.email || '', notify_email: initial?.notify_email ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError('')
    if (!initial && !form.password) { setError('Password is required for new users'); return }
    setSaving(true)
    const payload = { ...form }
    if (!payload.password) delete payload.password
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
