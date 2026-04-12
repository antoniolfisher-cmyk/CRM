import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'

export default function Onboarding() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const justConnected = searchParams.get('connected') === 'true'
  const error         = searchParams.get('error')

  const [oauthUrl, setOauthUrl]   = useState('')
  const [status, setStatus]       = useState(null)
  const [saving, setSaving]       = useState(false)
  const [saveError, setSaveError] = useState('')
  const [tab, setTab]             = useState('oauth')
  const [manual, setManual]       = useState({
    lwa_client_id: '', lwa_client_secret: '', sp_refresh_token: '',
    seller_id: '', marketplace_id: 'ATVPDKIKX0DER', is_sandbox: false,
  })

  const [syncing, setSyncing]       = useState(false)
  const [syncDone, setSyncDone]     = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    api.getAmazonOAuthUrl().then(r => setOauthUrl(r.url)).catch(() => {})
    api.getAmazonCredentials().then(setStatus).catch(() => {})
  }, [justConnected])

  useEffect(() => {
    if (justConnected) {
      setSyncing(true)
      startPolling()
    }
    return () => clearInterval(pollRef.current)
  }, [justConnected]) // eslint-disable-line

  function startPolling() {
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.getOnboardingSyncStatus()
        setSyncResult(s)
        if (!s.running && s.last_sync_at) {
          clearInterval(pollRef.current)
          setSyncing(false)
          setSyncDone(true)
          // Refresh credentials to get store_name + seller_id
          api.getAmazonCredentials().then(setStatus).catch(() => {})
        }
      } catch {
        // keep polling
      }
    }, 2000)
    setTimeout(() => {
      clearInterval(pollRef.current)
      setSyncing(false)
      setSyncDone(true)
      api.getAmazonCredentials().then(setStatus).catch(() => {})
    }, 180_000)
  }

  const saveManual = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveError('')
    try {
      await api.saveAmazonCredentials(manual)
      await api.triggerInitialSync().catch(() => {})
      setSyncing(true)
      startPolling()
      setStatus({ connected: true, seller_id: manual.seller_id })
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Connected screen ────────────────────────────────────────────────────────
  if (justConnected || (status && status.connected)) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">

            {/* Status icon */}
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg ${
              syncing ? 'bg-orange-500' : 'bg-green-500'
            }`}>
              {syncing
                ? <SpinnerIcon className="w-10 h-10 text-white animate-spin" />
                : <CheckIcon className="w-10 h-10 text-white" />
              }
            </div>

            <h1 className="text-2xl font-bold text-gray-900 mb-1">
              {syncing ? 'Importing your data…' : 'Amazon Connected!'}
            </h1>

            {/* Confirmed Amazon account details */}
            {status?.seller_id && (
              <div className="mt-4 mb-5 bg-green-50 border border-green-200 rounded-xl p-4 text-left">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">
                  ✓ Confirmed Amazon Account
                </p>
                {status.store_name && (
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-500">Store Name</span>
                    <span className="font-semibold text-gray-900">{status.store_name}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Seller ID</span>
                  <span className="font-mono text-xs font-semibold text-gray-800 bg-gray-100 px-2 py-0.5 rounded">
                    {status.seller_id}
                  </span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-gray-500">Marketplace</span>
                  <span className="font-semibold text-gray-900">
                    {status.marketplace_id === 'ATVPDKIKX0DER' ? '🇺🇸 Amazon.com (US)' : status.marketplace_id}
                  </span>
                </div>
              </div>
            )}

            {syncing && (
              <p className="text-gray-500 text-sm mb-4">
                Pulling your FBA inventory and Keepa data. This takes about 30–60 seconds.
              </p>
            )}

            {/* Sync progress */}
            {syncResult && (
              <div className="bg-slate-50 rounded-xl p-4 text-left mb-5 space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Initial Data Pull</p>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">FBA products imported</span>
                  <span className="font-semibold text-gray-900">{syncResult.created ?? '—'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Products updated</span>
                  <span className="font-semibold text-gray-900">{syncResult.updated ?? '—'}</span>
                </div>
                {syncResult.error && (
                  <p className="text-red-500 text-xs mt-1">{syncResult.error}</p>
                )}
                {syncResult.running && (
                  <div className="flex items-center gap-2 text-orange-600 text-xs mt-1">
                    <SpinnerIcon className="w-3 h-3 animate-spin" />
                    Still syncing…
                  </div>
                )}
              </div>
            )}

            {!syncing && (
              <button
                onClick={() => navigate('/')}
                className="w-full px-8 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-semibold transition-colors"
              >
                Go to Dashboard →
              </button>
            )}

            {syncing && (
              <button
                onClick={() => navigate('/')}
                className="mt-4 text-sm text-gray-400 hover:text-gray-600"
              >
                Continue to dashboard while syncing →
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Connect screen ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center shadow-lg">
            <RocketIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-xl leading-tight">SellerPulse</p>
            <p className="text-slate-400 text-sm">Connect your Amazon account</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-1">Connect Amazon Seller Central</h2>
          <p className="text-gray-500 text-sm mb-5">
            Link your Amazon seller account. You'll be taken to Amazon to sign in and approve the connection — then we'll pull all your live data automatically.
          </p>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              Connection failed: <strong>{error.replace(/_/g, ' ')}</strong>. Please try again.
            </div>
          )}

          {/* What gets pulled */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            {[
              { label: 'FBA Inventory', desc: 'All your live stock' },
              { label: 'Keepa Data',    desc: 'BSR, buy box, fees' },
              { label: 'Live Orders',   desc: 'Sales & open orders' },
            ].map(item => (
              <div key={item.label} className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xs font-semibold text-gray-700">{item.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Tab selector */}
          <div className="flex border border-gray-200 rounded-lg p-1 mb-5">
            <button
              onClick={() => setTab('oauth')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'oauth' ? 'bg-orange-500 text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Connect with Amazon
            </button>
            <button
              onClick={() => setTab('manual')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'manual' ? 'bg-orange-500 text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Manual Entry
            </button>
          </div>

          {tab === 'oauth' && (
            <div className="space-y-4">
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-2">
                <p className="text-sm font-semibold text-orange-800">What happens when you click below:</p>
                <div className="space-y-1.5">
                  {[
                    '1. You\'ll be redirected to Amazon Seller Central',
                    '2. Sign in to YOUR Amazon seller account',
                    '3. Click "Authorize" to approve the connection',
                    '4. You\'ll be sent back here automatically',
                    '5. We\'ll pull all your inventory & sales data',
                  ].map(s => (
                    <p key={s} className="text-sm text-orange-700">{s}</p>
                  ))}
                </div>
              </div>

              {!oauthUrl ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
                  <strong>OAuth not configured.</strong> The <code>AMAZON_SP_APP_ID</code> env var is not set.
                  Use Manual Entry below.
                </div>
              ) : (
                <a
                  href={oauthUrl}
                  className="flex items-center justify-center gap-3 w-full py-4 bg-[#FF9900] hover:bg-[#e88b00] text-white rounded-xl font-bold text-base transition-colors shadow-md"
                >
                  <AmazonIcon className="w-6 h-6" />
                  Sign in to Amazon &amp; Connect
                </a>
              )}

              <p className="text-center text-xs text-gray-400">
                You will be asked to sign in to Amazon Seller Central to confirm this is your account
              </p>
            </div>
          )}

          {tab === 'manual' && (
            <form onSubmit={saveManual} className="space-y-3">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 mb-2">
                Find these in <strong>Seller Central → Apps & Services → Develop Apps → your app</strong>
              </div>
              {[
                { key: 'lwa_client_id',     label: 'LWA Client ID',        ph: 'amzn1.application-oa2-client.xxx' },
                { key: 'lwa_client_secret', label: 'LWA Client Secret',    ph: '••••••••••••' },
                { key: 'sp_refresh_token',  label: 'SP-API Refresh Token', ph: 'Atzr|...' },
                { key: 'seller_id',         label: 'Seller ID',            ph: 'A1XXXXXXXXXXXXX' },
                { key: 'marketplace_id',    label: 'Marketplace ID',       ph: 'ATVPDKIKX0DER' },
              ].map(f => (
                <div key={f.key}>
                  <label className="label text-xs">{f.label}</label>
                  <input
                    className="input text-sm"
                    placeholder={f.ph}
                    value={manual[f.key]}
                    onChange={e => setManual(m => ({ ...m, [f.key]: e.target.value }))}
                    type={f.key.includes('secret') || f.key.includes('token') ? 'password' : 'text'}
                    required={f.key !== 'marketplace_id'}
                  />
                </div>
              ))}
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={manual.is_sandbox}
                  onChange={e => setManual(m => ({ ...m, is_sandbox: e.target.checked }))}
                  className="rounded"
                />
                Use Sandbox environment
              </label>
              {saveError && <p className="text-red-600 text-sm">{saveError}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving & starting sync…' : 'Save & Pull My Data'}
              </button>
            </form>
          )}

          <div className="mt-5 pt-4 border-t border-gray-100">
            <button
              onClick={() => navigate('/')}
              className="w-full text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Skip for now — connect later in Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CheckIcon({ className }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
}
function SpinnerIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}
function RocketIcon({ className }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
}
function AmazonIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M13.958 10.09c0 1.232.029 2.256-.591 3.351-.502.891-1.301 1.438-2.186 1.438-1.214 0-1.922-.924-1.922-2.292 0-2.692 2.415-3.182 4.699-3.182v.685zm3.186 7.705c-.209.189-.512.201-.745.074-1.047-.872-1.234-1.276-1.814-2.106-1.734 1.768-2.962 2.297-5.209 2.297-2.66 0-4.731-1.641-4.731-4.925 0-2.565 1.391-4.309 3.37-5.164 1.715-.754 4.11-.891 5.942-1.097v-.41c0-.753.06-1.642-.384-2.294-.385-.578-1.124-.816-1.776-.816-1.208 0-2.282.622-2.545 1.908-.054.284-.265.563-.548.576l-3.064-.333c-.259-.056-.548-.27-.474-.671C5.89 1.808 9.19 1 12.091 1c1.491 0 3.439.397 4.616 1.526 1.49 1.392 1.347 3.252 1.347 5.27v4.77c0 1.434.594 2.064 1.155 2.839.196.277.238.612-.01.819l-2.055 1.571zM3.586 19.237c3.537 2.619 8.228 4.13 12.403 4.13 3.054 0 6.538-.9 9.175-2.613.388-.253.745.275.418.613C22.908 23.752 19.088 25 15.703 25c-4.717 0-9.948-1.748-13.514-4.641-.374-.303.042-.718.397-.472l.001.001z"/>
    </svg>
  )
}
