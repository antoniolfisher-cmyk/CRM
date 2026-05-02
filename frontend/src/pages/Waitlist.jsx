import { useState } from 'react'
import { Link } from 'react-router-dom'

const GMV_OPTIONS = [
  'Just getting started',
  '$1k – $10k / month',
  '$10k – $50k / month',
  '$50k – $250k / month',
  '$250k+ / month',
]

export default function Waitlist() {
  const [form, setForm]       = useState({ name: '', email: '', company: '', monthly_gmv: '', notes: '' })
  const [status, setStatus]   = useState(null)   // null | 'loading' | 'success' | 'error'
  const [message, setMessage] = useState('')

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.email || !form.name) return
    setStatus('loading')
    try {
      const source = new URLSearchParams(window.location.search).get('utm_source') || 'direct'
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, source }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Something went wrong')
      setStatus('success')
      setMessage(data.message)
    } catch (err) {
      setStatus('error')
      setMessage(err.message)
    }
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-orange-900 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-2xl p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">You're on the list!</h2>
          <p className="text-gray-500 mb-6">{message}</p>
          <p className="text-sm text-gray-400">We'll reach out to <span className="font-medium text-gray-700">{form.email}</span> when your spot is ready.</p>
          <Link to="/login" className="mt-6 inline-block text-sm text-orange-600 hover:underline">Already have an account? Sign in →</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-orange-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-white font-bold text-xl tracking-tight">SellerPulse</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Join the Waitlist</h1>
          <p className="text-slate-300 text-base">The CRM built for Amazon FBA sellers. Manage accounts, track orders, automate follow-ups, and reprice — all in one place.</p>
        </div>

        {/* Social proof */}
        <div className="flex items-center justify-center gap-6 mb-8">
          {[
            { label: 'Active Sellers', value: '500+' },
            { label: 'Avg GMV Managed', value: '$2M+' },
            { label: 'Time Saved / Week', value: '8 hrs' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-orange-400 font-bold text-lg">{s.value}</div>
              <div className="text-slate-400 text-xs">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">First Name *</label>
                <input
                  type="text" required value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="Antonio"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email *</label>
                <input
                  type="email" required value={form.email}
                  onChange={e => set('email', e.target.value)}
                  placeholder="you@example.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Amazon Store / Company</label>
              <input
                type="text" value={form.company}
                onChange={e => set('company', e.target.value)}
                placeholder="My FBA Store LLC"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Monthly Amazon Revenue</label>
              <select
                value={form.monthly_gmv}
                onChange={e => set('monthly_gmv', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
              >
                <option value="">Select range…</option>
                {GMV_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">What's your biggest challenge right now? <span className="text-gray-400 font-normal">(optional)</span></label>
              <textarea
                value={form.notes} rows={2}
                onChange={e => set('notes', e.target.value)}
                placeholder="e.g. Keeping track of restock dates, managing VA tasks..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              />
            </div>

            {status === 'error' && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{message}</p>
            )}

            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
            >
              {status === 'loading' ? 'Submitting…' : 'Request Early Access →'}
            </button>

            <p className="text-center text-xs text-gray-400">
              No spam. No credit card. We'll contact you directly.
            </p>
          </form>
        </div>

        <div className="text-center mt-6 space-x-4">
          <Link to="/login"   className="text-slate-400 hover:text-white text-sm transition-colors">Sign in</Link>
          <span className="text-slate-600">·</span>
          <Link to="/terms"   className="text-slate-400 hover:text-white text-sm transition-colors">Terms</Link>
          <span className="text-slate-600">·</span>
          <Link to="/privacy" className="text-slate-400 hover:text-white text-sm transition-colors">Privacy</Link>
        </div>
      </div>
    </div>
  )
}
