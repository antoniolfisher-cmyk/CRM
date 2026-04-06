import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import StatusBadge from '../components/StatusBadge'
import Modal from '../components/Modal'
import { formatDate, isOverdue } from '../utils'

const TYPES = ['call', 'email', 'meeting', 'visit', 'other']
const PRIORITIES = ['high', 'medium', 'low']
const STATUSES = ['pending', 'completed', 'cancelled']

export default function FollowUps() {
  const [searchParams] = useSearchParams()
  const [followUps, setFollowUps] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || '')
  const [filterType, setFilterType] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [completing, setCompleting] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    const params = {
      status: filterStatus,
      follow_up_type: filterType,
      priority: filterPriority,
      overdue_only: overdueOnly || undefined,
    }
    api.getFollowUps(params).then(setFollowUps).finally(() => setLoading(false))
  }, [filterStatus, filterType, filterPriority, overdueOnly])

  useEffect(() => {
    load()
    api.getAccounts().then(setAccounts)
  }, [load])

  const handleComplete = async (fu) => {
    setCompleting(fu)
  }

  const handleCompleteSubmit = async (outcome, nextDate) => {
    await api.updateFollowUp(completing.id, {
      status: 'completed',
      outcome,
      next_follow_up_date: nextDate || null,
    })
    setCompleting(null)
    load()

    if (nextDate) {
      await api.createFollowUp({
        account_id: completing.account_id,
        contact_id: completing.contact_id,
        subject: `Follow-up: ${completing.subject}`,
        follow_up_type: completing.follow_up_type,
        priority: completing.priority,
        due_date: nextDate,
        notes: `Continued from: ${completing.subject}`,
      })
      load()
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this follow-up?')) return
    await api.deleteFollowUp(id)
    load()
  }

  const handleSave = async (data) => {
    if (editing) {
      await api.updateFollowUp(editing.id, data)
    } else {
      await api.createFollowUp(data)
    }
    setShowForm(false)
    setEditing(null)
    load()
  }

  const grouped = groupByStatus(followUps)
  const overdue = followUps.filter(fu => fu.status === 'pending' && isOverdue(fu.due_date))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Follow-Ups</h1>
          <p className="text-gray-500 text-sm mt-1">
            {followUps.length} total · {overdue.length > 0 && <span className="text-red-600 font-medium">{overdue.length} overdue</span>}
          </p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true) }}>
          <PlusIcon /> Schedule Follow-Up
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select className="input w-40" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input w-36" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="input w-36" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
          <option value="">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} className="rounded" />
          Overdue only
        </label>
      </div>

      {/* Overdue alert */}
      {overdue.length > 0 && !overdueOnly && !filterStatus && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertIcon className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-800">
            <strong>{overdue.length} overdue follow-up{overdue.length > 1 ? 's' : ''}</strong> need your attention.{' '}
            <button className="underline" onClick={() => setOverdueOnly(true)}>Show overdue only</button>
          </p>
        </div>
      )}

      {/* Follow-ups list */}
      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl animate-pulse" />)}</div>
      ) : followUps.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-gray-400">No follow-ups found</p>
          <button className="btn-primary mt-4" onClick={() => setShowForm(true)}>Schedule your first follow-up</button>
        </div>
      ) : (
        <div className="space-y-2">
          {followUps.map((fu) => (
            <FollowUpCard
              key={fu.id}
              fu={fu}
              onComplete={() => handleComplete(fu)}
              onEdit={() => { setEditing(fu); setShowForm(true) }}
              onDelete={() => handleDelete(fu.id)}
            />
          ))}
        </div>
      )}

      {/* Complete Modal */}
      {completing && (
        <CompleteModal
          fu={completing}
          onSubmit={handleCompleteSubmit}
          onClose={() => setCompleting(null)}
        />
      )}

      {/* Form Modal */}
      {showForm && (
        <Modal title={editing ? 'Edit Follow-Up' : 'Schedule Follow-Up'} onClose={() => { setShowForm(false); setEditing(null) }} size="lg">
          <FollowUpForm
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

function FollowUpCard({ fu, onComplete, onEdit, onDelete }) {
  const overdue = fu.status === 'pending' && isOverdue(fu.due_date)

  return (
    <div className={`card p-4 border-l-4 ${overdue ? 'border-l-red-500' : fu.priority === 'high' ? 'border-l-orange-400' : fu.status === 'completed' ? 'border-l-green-400' : 'border-l-blue-400'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <TypeIcon type={fu.follow_up_type} />
          <div className="min-w-0">
            <p className="font-medium text-gray-900">{fu.subject}</p>
            <p className="text-sm text-gray-500 mt-0.5">
              {fu.account?.name}
              {fu.contact && ` · ${fu.contact.first_name} ${fu.contact.last_name}`}
            </p>
            {fu.notes && <p className="text-xs text-gray-400 mt-1 truncate max-w-lg">{fu.notes}</p>}
            {fu.outcome && (
              <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1 mt-1 inline-block">{fu.outcome}</p>
            )}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-2">
          <div className="flex flex-wrap gap-1.5 justify-end">
            <StatusBadge value={fu.priority} />
            <StatusBadge value={fu.status} />
          </div>
          <p className={`text-xs ${overdue ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
            {overdue ? `Overdue · ` : fu.status === 'completed' ? `Completed · ` : `Due · `}
            {fu.status === 'completed' ? formatDate(fu.completed_date) : formatDate(fu.due_date)}
          </p>
          <div className="flex gap-1">
            {fu.status === 'pending' && (
              <button className="btn-primary py-1 px-3 text-xs" onClick={onComplete}>Complete</button>
            )}
            <button className="btn-secondary py-1 px-3 text-xs" onClick={onEdit}>Edit</button>
            <button className="btn-ghost py-1 px-2 text-xs text-red-500 hover:bg-red-50" onClick={onDelete}>Del</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TypeIcon({ type }) {
  const icons = {
    call: <PhoneIcon />,
    email: <MailIcon />,
    meeting: <UsersIcon />,
    visit: <MapPinIcon />,
    other: <DotsIcon />,
  }
  const colors = {
    call: 'bg-blue-100 text-blue-600',
    email: 'bg-purple-100 text-purple-600',
    meeting: 'bg-green-100 text-green-600',
    visit: 'bg-orange-100 text-orange-600',
    other: 'bg-gray-100 text-gray-600',
  }
  return (
    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${colors[type] || colors.other}`}>
      {icons[type] || icons.other}
    </div>
  )
}

function CompleteModal({ fu, onSubmit, onClose }) {
  const [outcome, setOutcome] = useState('')
  const [nextDate, setNextDate] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try { await onSubmit(outcome, nextDate || null) } finally { setSaving(false) }
  }

  return (
    <Modal title="Complete Follow-Up" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <p className="font-medium">{fu.subject}</p>
          <p className="text-gray-500">{fu.account?.name}</p>
        </div>
        <div>
          <label className="label">Outcome / Notes</label>
          <textarea
            className="input"
            rows={4}
            placeholder="What happened? What was discussed or agreed upon?"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Schedule Next Follow-Up (optional)</label>
          <input
            className="input"
            type="datetime-local"
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">A new follow-up will be automatically created</p>
        </div>
        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Mark Complete'}</button>
        </div>
      </form>
    </Modal>
  )
}

function FollowUpForm({ initial, accounts, onSave, onClose }) {
  const [form, setForm] = useState({
    subject: '',
    follow_up_type: 'call',
    status: 'pending',
    priority: 'medium',
    due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
    account_id: '',
    contact_id: '',
    notes: '',
    ...initial,
    due_date: initial?.due_date ? initial.due_date.slice(0, 16) : new Date(Date.now() + 86400000).toISOString().slice(0, 16),
  })
  const [contacts, setContacts] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (form.account_id) {
      api.getContacts(form.account_id).then(setContacts)
    } else {
      setContacts([])
    }
  }, [form.account_id])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const data = { ...form, account_id: Number(form.account_id), contact_id: form.contact_id ? Number(form.contact_id) : null }
    try { await onSave(data) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Subject *</label>
          <input className="input" required value={form.subject} onChange={set('subject')} placeholder="e.g. Q2 pricing review call" />
        </div>
        <div>
          <label className="label">Account *</label>
          <select className="input" required value={form.account_id} onChange={set('account_id')}>
            <option value="">— Select Account —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Contact</label>
          <select className="input" value={form.contact_id} onChange={set('contact_id')} disabled={!form.account_id}>
            <option value="">— Select Contact —</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={form.follow_up_type} onChange={set('follow_up_type')}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Priority</label>
          <select className="input" value={form.priority} onChange={set('priority')}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Due Date *</label>
          <input className="input" type="datetime-local" required value={form.due_date} onChange={set('due_date')} />
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={form.status} onChange={set('status')}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Notes</label>
          <textarea className="input" rows={3} value={form.notes} onChange={set('notes')} placeholder="What's the context or goal of this follow-up?" />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save Follow-Up'}</button>
      </div>
    </form>
  )
}

function groupByStatus(fus) {
  return fus.reduce((acc, fu) => {
    const key = fu.status
    if (!acc[key]) acc[key] = []
    acc[key].push(fu)
    return acc
  }, {})
}

// Icons
function PlusIcon() { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg> }
function AlertIcon({ className }) { return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> }
function PhoneIcon() { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg> }
function MailIcon() { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg> }
function UsersIcon() { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg> }
function MapPinIcon() { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg> }
function DotsIcon() { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" /></svg> }
