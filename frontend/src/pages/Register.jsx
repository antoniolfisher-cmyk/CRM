import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const { loginWithToken } = useAuth()
  const navigate = useNavigate()

  const [step, setStep]       = useState(1)   // 1=company  2=credentials  3=plan
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const [form, setForm] = useState({
    company_name: '',
    slug: '',
    username: '',
    email: '',
    password: '',
    confirm: '',
    plan: 'starter',
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const submit = async (e) => {
    e.preventDefault()
    if (form.password !== form.confirm) { setError('Passwords do not match'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: form.company_name,
          slug: form.slug || slugify(form.company_name),
          username: form.username,
          email: form.email,
          password: form.password,
          plan: form.plan,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Registration failed')
      loginWithToken(data.access_token, {
        username: form.username,
        role: 'admin',
        tenant_name: form.company_name,
        plan: form.plan,
      })
      // If Pro/Enterprise plan and Stripe is configured, go to checkout
      if (form.plan !== 'starter' && data.billing_url) {
        window.location.href = data.billing_url
      } else {
        navigate('/onboarding/amazon')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
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

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {['Workspace', 'Your Account', 'Plan'].map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold
                ${step > i + 1 ? 'bg-green-500 text-white' : step === i + 1 ? 'bg-orange-500 text-white' : 'bg-slate-700 text-slate-400'}`}>
                {step > i + 1 ? '✓' : i + 1}
              </div>
              <span className={`text-xs ${step === i + 1 ? 'text-white' : 'text-slate-500'}`}>{label}</span>
              {i < 2 && <div className="w-8 h-px bg-slate-700 mx-1" />}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={step < 3 ? (e) => { e.preventDefault(); setStep(s => s + 1) } : submit}>
            {/* Step 1: Company */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Create your workspace</h2>
                  <p className="text-gray-500 text-sm mt-1">Your team's home in SellerPulse</p>
                </div>
                <div>
                  <label className="label">Company / Store Name</label>
                  <input
                    className="input"
                    placeholder="Acme Wholesale"
                    value={form.company_name}
                    onChange={(e) => {
                      set('company_name', e.target.value)
                      if (!form.slug || form.slug === slugify(form.company_name)) {
                        set('slug', slugify(e.target.value))
                      }
                    }}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label">Workspace URL</label>
                  <div className="flex items-center gap-0 border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-orange-500 focus-within:border-orange-500">
                    <span className="px-3 py-2 bg-gray-50 text-gray-400 text-sm border-r border-gray-300 shrink-0">
                      sellersuite.com/
                    </span>
                    <input
                      className="flex-1 px-3 py-2 text-sm outline-none"
                      placeholder="acme-wholesale"
                      value={form.slug}
                      onChange={(e) => set('slug', slugify(e.target.value))}
                      required
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Lowercase letters, numbers, and hyphens only</p>
                </div>
              </div>
            )}

            {/* Step 2: Credentials */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Create your account</h2>
                  <p className="text-gray-500 text-sm mt-1">You'll be the admin of this workspace</p>
                </div>
                <div>
                  <label className="label">Username</label>
                  <input className="input" placeholder="johndoe" value={form.username}
                    onChange={(e) => set('username', e.target.value)} required autoFocus />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input className="input" type="email" placeholder="john@acme.com" value={form.email}
                    onChange={(e) => set('email', e.target.value)} required />
                </div>
                <div>
                  <label className="label">Password</label>
                  <input className="input" type="password" value={form.password}
                    onChange={(e) => set('password', e.target.value)} required minLength={8} />
                </div>
                <div>
                  <label className="label">Confirm Password</label>
                  <input className="input" type="password" value={form.confirm}
                    onChange={(e) => set('confirm', e.target.value)} required />
                </div>
              </div>
            )}

            {/* Step 3: Plan */}
            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Choose your plan</h2>
                  <p className="text-gray-500 text-sm mt-1">Start free, upgrade anytime</p>
                </div>
                <div className="space-y-3">
                  {[
                    {
                      key: 'starter', name: 'Starter', price: 'Free',
                      features: ['1 user', '100 ASINs', 'CRM & orders'],
                      color: 'border-gray-200',
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
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center
                            ${form.plan === plan.key ? 'border-orange-500 bg-orange-500' : 'border-gray-300'}`}>
                            {form.plan === plan.key && <div className="w-2 h-2 bg-white rounded-full" />}
                          </div>
                          <span className="font-semibold text-gray-900">{plan.name}</span>
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
              </div>
            )}

            <div className="flex items-center gap-3 mt-6">
              {step > 1 && (
                <button type="button" onClick={() => setStep(s => s - 1)}
                  className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  Back
                </button>
              )}
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {loading ? 'Creating…' : step < 3 ? 'Continue' : 'Create Workspace'}
              </button>
            </div>
          </form>

          <p className="text-center text-sm text-gray-500 mt-4">
            Already have an account?{' '}
            <Link to="/login" className="text-orange-600 font-medium hover:underline">Sign in</Link>
          </p>
        </div>
        <p className="text-center text-slate-500 text-xs mt-6">
          No credit card required to start · Cancel anytime
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
