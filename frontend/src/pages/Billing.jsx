import { useState, useEffect } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

const PLAN_COLORS = {
  starter:    { bg: 'bg-gray-100',   text: 'text-gray-600',   border: 'border-gray-300'   },
  pro:        { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-400' },
  enterprise: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-400' },
}

export default function Billing() {
  const { user } = useAuth()
  const [tenant, setTenant]     = useState(null)
  const [loading, setLoading]   = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)

  useEffect(() => {
    api.getTenantMe().then(setTenant).finally(() => setLoading(false))
  }, [])

  const goToPortal = async () => {
    setPortalLoading(true)
    try {
      const { url } = await api.getBillingPortal()
      window.location.href = url
    } catch (e) {
      alert(e.message)
    } finally {
      setPortalLoading(false)
    }
  }

  const goToCheckout = async (plan) => {
    try {
      const { url } = await api.createBillingCheckout(plan)
      window.location.href = url
    } catch (e) {
      alert(e.message)
    }
  }

  if (loading) return <div className="p-6 text-gray-400">Loading…</div>

  const colors = PLAN_COLORS[tenant?.plan] || PLAN_COLORS.starter

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing & Plan</h1>
        <p className="text-gray-500 text-sm mt-1">Manage your subscription and workspace</p>
      </div>

      {/* Current plan card */}
      <div className={`card p-6 border-2 ${colors.border}`}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Current Plan</p>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-gray-900 capitalize">{tenant?.plan || 'Starter'}</h2>
              {tenant?.stripe_status && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  tenant.stripe_status === 'active'   ? 'bg-green-100 text-green-700' :
                  tenant.stripe_status === 'trialing' ? 'bg-blue-100 text-blue-700' :
                  tenant.stripe_status === 'past_due' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {tenant.stripe_status}
                </span>
              )}
            </div>
            {tenant?.trial_ends_at && (
              <p className="text-sm text-gray-500 mt-1">
                Trial ends {new Date(tenant.trial_ends_at).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className={`px-4 py-2 rounded-xl text-sm font-bold ${colors.bg} ${colors.text}`}>
            {tenant?.plan === 'starter' ? 'Free' :
             tenant?.plan === 'pro'     ? '$49/mo' : '$199/mo'}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4 pt-4 border-t border-gray-100">
          <div>
            <p className="text-xs text-gray-400">Workspace</p>
            <p className="text-sm font-semibold text-gray-800">{tenant?.name}</p>
            <p className="text-xs text-gray-400">{tenant?.slug}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Users</p>
            <p className="text-sm font-semibold text-gray-800">
              {tenant?.users_count}{' '}
              <span className="text-gray-400 font-normal">
                / {tenant?.plan === 'starter' ? '1' : tenant?.plan === 'pro' ? '5' : '∞'}
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Amazon</p>
            <p className={`text-sm font-semibold ${tenant?.amazon_connected ? 'text-green-600' : 'text-gray-400'}`}>
              {tenant?.amazon_connected ? '✓ Connected' : 'Not connected'}
            </p>
          </div>
        </div>

        {tenant?.stripe_customer_id && tenant?.billing_enabled && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <button
              onClick={goToPortal}
              disabled={portalLoading}
              className="text-sm font-medium text-orange-600 hover:text-orange-700 disabled:opacity-50"
            >
              {portalLoading ? 'Loading…' : 'Manage subscription, invoices & payment method →'}
            </button>
          </div>
        )}
      </div>

      {/* Plan comparison */}
      {tenant?.billing_enabled && (
        <div>
          <h2 className="text-base font-semibold text-gray-700 mb-3">
            {tenant?.plan === 'starter' ? 'Upgrade your plan' : 'Change plan'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(tenant?.plans || {}).map(([key, plan]) => {
              const isCurrent = tenant?.plan === key
              const c = PLAN_COLORS[key] || PLAN_COLORS.starter
              return (
                <div key={key} className={`card p-5 border-2 ${isCurrent ? c.border : 'border-transparent'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-gray-900">{plan.name}</h3>
                    <span className="text-sm font-bold text-gray-600">{plan.price_label}</span>
                  </div>
                  <ul className="space-y-1.5 mb-4">
                    {plan.features.map(f => (
                      <li key={f} className="text-xs text-gray-600 flex items-start gap-1.5">
                        <span className="text-green-500 mt-0.5">✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <div className={`w-full py-2 text-center text-xs font-semibold rounded-lg ${c.bg} ${c.text}`}>
                      Current Plan
                    </div>
                  ) : plan.stripe_price_id ? (
                    <button
                      onClick={() => tenant?.stripe_customer_id ? goToPortal() : goToCheckout(key)}
                      className="w-full py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      {key === 'starter' ? 'Downgrade' : 'Upgrade'} to {plan.name}
                    </button>
                  ) : (
                    <div className="w-full py-2 text-center text-xs text-gray-400 bg-gray-50 rounded-lg">
                      Contact us
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!tenant?.billing_enabled && (
        <div className="card p-5 bg-blue-50 border border-blue-200">
          <p className="text-sm text-blue-700">
            <strong>Self-hosted mode:</strong> Billing is disabled. All features are available.
            To enable billing, set <code className="bg-blue-100 px-1 rounded">STRIPE_SECRET_KEY</code> in your environment.
          </p>
        </div>
      )}
    </div>
  )
}
