import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const { loginWithToken } = useAuth()
  const navigate = useNavigate()

  const [step, setStep]       = useState(1)   // 1=account  2=plan
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const [form, setForm] = useState({
    name: '',
    storeName: '',
    email: '',
    password: '',
    confirm: '',
    plan: 'starter',
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const validateStep1 = () => {
    if (!form.name.trim())          { setError('Please enter your name'); return false }
    if (!form.storeName.trim())     { setError('Please enter your store or business name'); return false }
    if (!form.email.trim())         { setError('Please enter your email'); return false }
    if (form.password.length < 8)   { setError('Password must be at least 8 characters'); return false }
    if (form.password !== form.confirm) { setError('Passwords do not match'); return false }
    return true
  }

  const handleContinue = (e) => {
    e.preventDefault()
    setError('')
    if (!validateStep1()) return
    setStep(2)
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    // Auto-generate username from name, slug from email prefix
    const username = slugify(form.name) || slugify(form.email.split('@')[0])
    const slug     = slugify(form.email.split('@')[0]) + '-' + Math.random().toString(36).slice(2, 6)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: form.storeName || form.name,
          slug,
          username,
          email: form.email,
          password: form.password,
          plan: form.plan,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Registration failed')
      loginWithToken(data.access_token, {
        username,
        role: 'admin',
        tenant_name: form.storeName || form.name,
        plan: form.plan,
      })
      if (form.plan !== 'starter' && data.billing_url) {
        window.location.href = data.billing_url
      } else {
        navigate('/onboarding/amazon')
      }
    } catch (err) {
      setError(err.message)
      setStep(1)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center shadow-lg">
            <RocketIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-xl leading-tight">SellerPulse</p>
            <p className="text-slate-400 text-sm">Amazon Seller CRM</p>
          </div>
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className={`w-2 h-2 rounded-full ${step >= 1 ? 'bg-orange-500' : 'bg-slate-600'}`} />
          <div className={`w-8 h-px ${step >= 2 ? 'bg-orange-500' : 'bg-slate-600'}`} />
          <div className={`w-2 h-2 rounded-full ${step >= 2 ? 'bg-orange-500' : 'bg-slate-600'}`} />
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {/* Step 1 — Account details */}
          {step === 1 && (
            <form onSubmit={handleContinue} className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Create your account</h2>
                <p className="text-gray-500 text-sm mt-1">Get started with SellerPulse free</p>
              </div>

              <div>
                <label className="label">Full Name</label>
                <input
                  className="input"
                  placeholder="John Smith"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="label">Amazon Store / Business Name</label>
                <input
                  className="input"
                  placeholder="e.g. Delight Shoppe"
                  value={form.storeName}
                  onChange={(e) => set('storeName', e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label">Email Address</label>
                <input
                  className="input"
                  type="email"
                  placeholder="john@yourbusiness.com"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label">Password</label>
                <input
                  className="input"
                  type="password"
                  placeholder="At least 8 characters"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  required
                  minLength={8}
                />
              </div>

              <div>
                <label className="label">Confirm Password</label>
                <input
                  className="input"
                  type="password"
                  placeholder="Re-enter your password"
                  value={form.confirm}
                  onChange={(e) => set('confirm', e.target.value)}
                  required
                />
                {form.confirm && form.password !== form.confirm && (
                  <p className="text-red-500 text-xs mt-1">Passwords don't match</p>
                )}
                {form.confirm && form.password === form.confirm && form.confirm.length > 0 && (
                  <p className="text-green-600 text-xs mt-1">✓ Passwords match</p>
                )}
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold transition-colors mt-2"
              >
                Continue
              </button>
            </form>
          )}

          {/* Step 2 — Plan */}
          {step === 2 && (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Choose your plan</h2>
                <p className="text-gray-500 text-sm mt-1">Start free, upgrade anytime</p>
              </div>

              <div className="space-y-3">
                {[
                  {
                    key: 'starter', name: 'Starter', price: 'Free',
                    features: ['1 user', '100 ASINs', 'CRM & orders'],
                    color: 'border-gray-300',
                  },
                  {
                    key: 'pro', name: 'Pro', price: '$49/mo',
                    features: ['5 users', 'Unlimited ASINs', 'Full Amazon SP-API', 'AI Repricer', 'Ungate workflow'],
                    color: 'border-orange-400',
                    badge: 'Most Popular',
                  },
                  {
                    key: 'enterprise', name: 'Enterprise', price: '$199/mo',
                    features: ['Unlimited users', 'Everything in Pro', 'White-label', 'Priority support'],
                    color: 'border-purple-400',
                  },
                ].map(plan => (
                  <button
                    key={plan.key}
                    type="button"
                    onClick={() => set('plan', plan.key)}
                    className={`w-full text-left border-2 rounded-xl p-4 transition-all ${
                      form.plan === plan.key ? plan.color + ' bg-orange-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
                          ${form.plan === plan.key ? 'border-orange-500 bg-orange-500' : 'border-gray-300'}`}>
                          {form.plan === plan.key && <div className="w-2 h-2 bg-white rounded-full" />}
                        </div>
                        <span className="font-semibold text-gray-900 text-sm">{plan.name}</span>
                        {plan.badge && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                            {plan.badge}
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-gray-700">{plan.price}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 ml-6">
                      {plan.features.map(f => (
                        <span key={f} className="text-xs text-gray-500">✓ {f}</span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => { setStep(1); setError('') }}
                  className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Creating…' : 'Get Started'}
                </button>
              </div>
            </form>
          )}

          <p className="text-center text-sm text-gray-500 mt-5">
            Already have an account?{' '}
            <Link to="/login" className="text-orange-600 font-medium hover:underline">Sign in</Link>
          </p>
        </div>

        <p className="text-center text-slate-500 text-xs mt-5">
          No credit card required · Cancel anytime
        </p>
      </div>
    </div>
  )
}

function RocketIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  )
}
