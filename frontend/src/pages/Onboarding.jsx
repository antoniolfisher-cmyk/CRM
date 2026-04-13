import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

export default function Onboarding() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [searchParams] = useSearchParams()
  const needsConfirm = searchParams.get('confirm') === 'true'
  const urlSellerId  = searchParams.get('seller_id') || ''
  const urlStoreName = searchParams.get('store_name') || ''
  const error        = searchParams.get('error')

  const [oauthUrl, setOauthUrl]     = useState('')
  const [status, setStatus]         = useState(null)
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState('')
  const [tab, setTab]               = useState('oauth')
  const [confirmed, setConfirmed]   = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [manual, setManual]         = useState({
    lwa_client_id: '', lwa_client_secret: '', sp_refresh_token: '',
    seller_id: '', marketplace_id: 'ATVPDKIKX0DER', is_sandbox: false,
  })

  const [syncing, setSyncing]       = useState(false)
  const [syncDone, setSyncDone]     = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const pollRef = useRef(null)

  const [setupStoreName, setSetupStoreName] = useState('')
  const [savingStore, setSavingStore] = useState(false)
  const [finTest, setFinTest]         = useState(null)
  const [finTesting, setFinTesting]   = useState(false)
  const [showTokenInput, setShowTokenInput] = useState(false)
  const [manualToken, setManualToken] = useState('')
  const [savingToken, setSavingToken] = useState(false)

  useEffect(() => {
    // Only admins can initiate Amazon OAuth; non-admins get 403, no URL needed
    if (isAdmin) {
      api.getAmazonOAuthUrl().then(r => setOauthUrl(r.url)).catch(() => {})
    }
    api.getAmazonCredentials().then(setStatus).catch(() => {})
  }, [isAdmin])

  function startPolling() {
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.getOnboardingSyncStatus()
        setSyncResult(s)
        if (!s.running && s.last_sync_at) {
          clearInterval(pollRef.current)
          setSyncing(false)
          setSyncDone(true)
          api.getAmazonCredentials().then(setStatus).catch(() => {})
        }
      } catch { /* keep polling */ }
    }, 2000)
    setTimeout(() => {
      clearInterval(pollRef.current)
      setSyncing(false)
      setSyncDone(true)
      api.getAmazonCredentials().then(setStatus).catch(() => {})
    }, 600_000)  // 10 minute UI timeout — backend sync continues regardless
  }

  // After confirming it's their account — start data pull
  const handleConfirm = async () => {
    setConfirmed(true)
    setSyncing(true)
    await api.triggerInitialSync().catch(() => {})
    startPolling()
  }

  // Wrong account — wipe credentials and start over
  const handleWrongAccount = async () => {
    setDisconnecting(true)
    try {
      await api.disconnectAmazon().catch(() => {})
    } finally {
      setDisconnecting(false)
      navigate('/onboarding/amazon')
    }
  }

  // Disconnect from the "already connected" screen
  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect your Amazon account? Your product records will not be deleted. You can reconnect at any time.')) return
    setDisconnecting(true)
    try {
      await api.disconnectAmazon()
      setStatus(prev => ({ ...prev, connected: false, seller_id: null }))
    } catch (e) {
      alert('Failed to disconnect: ' + e.message)
    } finally {
      setDisconnecting(false)
    }
  }

  const saveManual = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveError('')
    try {
      await api.saveAmazonCredentials(manual)
      await api.triggerInitialSync().catch(() => {})
      setSyncing(true)
      setConfirmed(true)
      startPolling()
      setStatus({ connected: true, seller_id: manual.seller_id })
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── STEP: Confirm this is the right Amazon account ──────────────────────────
  if (needsConfirm && !confirmed) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            {/* Warning icon */}
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <ShieldIcon className="w-8 h-8 text-amber-600" />
            </div>

            <h1 className="text-xl font-bold text-gray-900 text-center mb-1">
              Confirm Your Amazon Account
            </h1>
            <p className="text-gray-500 text-sm text-center mb-6">
              Before we pull any data, verify this is the correct Amazon seller account.
              We will <strong>only</strong> pull data from this account.
            </p>

            <div className="bg-slate-50 border-2 border-slate-200 rounded-xl p-5 mb-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Amazon account that just authorized:
              </p>
              {urlStoreName && (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-500">Store Name</span>
                  <span className="text-sm font-bold text-gray-900">{urlStoreName}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Seller ID</span>
                <span className="font-mono text-sm font-bold text-gray-900 bg-gray-200 px-3 py-1 rounded-lg">
                  {urlSellerId || 'Not returned by Amazon'}
                </span>
              </div>
            </div>

            <p className="text-sm text-gray-600 text-center mb-5">
              Does this match <strong>your</strong> Seller Central account?<br />
              <span className="text-xs text-gray-400">
                (Check your Seller ID in Seller Central → Account Info)
              </span>
            </p>

            <div className="space-y-3">
              <button
                onClick={handleConfirm}
                className="w-full py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold text-sm transition-colors"
              >
                ✓ Yes, this is my account — connect it
              </button>
              <button
                onClick={handleWrongAccount}
                disabled={disconnecting}
                className="w-full py-3 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50"
              >
                ✕ No, wrong account — start over
              </button>
            </div>

            <p className="text-xs text-gray-400 text-center mt-4">
              Clicking "No" will remove the stored credentials immediately.
              Sign out of Amazon in your browser and try again with the correct account.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── STEP: Syncing / Done ────────────────────────────────────────────────────
  if (confirmed || (status && status.connected && !needsConfirm)) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg ${
              syncing ? 'bg-orange-500' : 'bg-green-500'
            }`}>
              {syncing
                ? <SpinnerIcon className="w-10 h-10 text-white animate-spin" />
                : <CheckIcon className="w-10 h-10 text-white" />
              }
            </div>

            <h1 className="text-2xl font-bold text-gray-900 mb-1">
              {syncing ? 'Importing your data…' : 'All set!'}
            </h1>

            {/* Confirmed account */}
            {(urlSellerId || status?.seller_id || urlStoreName || status?.store_name) && (
              <div className="mt-4 mb-5 bg-green-50 border border-green-200 rounded-xl p-4 text-left">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">
                  ✓ Verified Amazon Account
                </p>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Store Name</span>
                  <span className="font-semibold text-gray-900">
                    {urlStoreName || status?.store_name || urlSellerId || status?.seller_id || '—'}
                  </span>
                </div>
              </div>
            )}

            {syncing && (
              <p className="text-gray-500 text-sm mb-4">
                Pulling your FBA inventory.<br />
                <span className="text-xs text-gray-400">This can take a few minutes for large catalogs — you can navigate away and it will keep running.</span>
              </p>
            )}

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
                {syncResult.error && <p className="text-red-500 text-xs mt-1">{syncResult.error}</p>}
              </div>
            )}

            {!syncing && !urlStoreName && !status?.store_name && (
              <div className="mt-4 mb-2 text-left space-y-2">
                <p className="text-sm font-medium text-gray-700">What's your Amazon store name?</p>
                <p className="text-xs text-gray-400">This appears in your sidebar and outgoing emails.</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="e.g. Delight Shoppe"
                    value={setupStoreName}
                    onChange={e => setSetupStoreName(e.target.value)}
                  />
                  <button
                    onClick={async () => {
                      if (!setupStoreName.trim()) return
                      setSavingStore(true)
                      try {
                        await fetch('/api/tenant/settings', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
                          body: JSON.stringify({ store_name: setupStoreName.trim() }),
                        })
                      } catch {}
                      setSavingStore(false)
                    }}
                    disabled={savingStore}
                    className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                  >
                    {savingStore ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}

            {!syncing && (
              <div className="space-y-3">
                <button
                  onClick={() => navigate('/')}
                  className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-semibold transition-colors"
                >
                  Go to Dashboard →
                </button>
                {isAdmin && oauthUrl && (
                  <div className="space-y-2">
                    <a
                      href={oauthUrl}
                      className="w-full py-2.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl border border-blue-200 transition-colors text-center block font-medium"
                    >
                      ↻ Refresh API Permissions (re-authorize)
                    </a>
                    {status?.connected_at && (
                      <p className="text-center text-xs text-gray-400">
                        Token last saved: {new Date(status.connected_at).toLocaleString()}
                      </p>
                    )}

                    {/* Finances API test */}
                    <button
                      onClick={async () => {
                        setFinTesting(true); setFinTest(null)
                        try {
                          const r = await fetch('/api/amazon/test-finances', {
                            headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` }
                          })
                          setFinTest(await r.json())
                        } catch (e) { setFinTest({ error: e.message }) }
                        setFinTesting(false)
                      }}
                      disabled={finTesting}
                      className="w-full py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-xl border border-gray-200 transition-colors disabled:opacity-50"
                    >
                      {finTesting ? 'Testing…' : '🔍 Test Finances API connection'}
                    </button>
                    {finTest && (
                      <div className={`rounded-lg p-3 text-xs font-mono break-all ${finTest.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                        <p className="font-semibold mb-1">{finTest.success ? '✓ Finances API working' : '✗ Finances API failed'}</p>
                        {finTest.connected_at && <p>Token saved: {new Date(finTest.connected_at).toLocaleString()}</p>}
                        {finTest.token_preview && <p>Token: {finTest.token_preview}</p>}
                        {finTest.lwa_error && <p>LWA error: {finTest.lwa_error}</p>}
                        {finTest.finances_status && <p>HTTP {finTest.finances_status}</p>}
                        {finTest.finances_body && !finTest.success && <p>{JSON.stringify(finTest.finances_body)}</p>}
                        {finTest.error && <p>{finTest.error}</p>}
                      </div>
                    )}

                    {/* Manual refresh token paste (last resort) */}
                    {!showTokenInput ? (
                      <button
                        onClick={() => setShowTokenInput(true)}
                        className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        Paste refresh token manually →
                      </button>
                    ) : (
                      <div className="border border-gray-200 rounded-xl p-3 space-y-2">
                        <p className="text-xs font-medium text-gray-700">Paste new SP-API Refresh Token</p>
                        <p className="text-xs text-gray-400">From Amazon Developer Central → your app → "Generate Refresh Token" after adding the Finances role.</p>
                        <input
                          type="text"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                          placeholder="Atzr|IwEB…"
                          value={manualToken}
                          onChange={e => setManualToken(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <button
                            disabled={savingToken || !manualToken.trim()}
                            onClick={async () => {
                              setSavingToken(true)
                              try {
                                await api.saveAmazonCredentials({ sp_refresh_token: manualToken.trim() })
                                const updated = await api.getAmazonCredentials()
                                setStatus(updated)
                                setManualToken('')
                                setShowTokenInput(false)
                                setFinTest(null)
                                alert('Refresh token saved. Click "Test Finances API connection" to verify.')
                              } catch (e) { alert(e.message) }
                              setSavingToken(false)
                            }}
                            className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg font-semibold disabled:opacity-50"
                          >
                            {savingToken ? 'Saving…' : 'Save token'}
                          </button>
                          <button onClick={() => { setShowTokenInput(false); setManualToken('') }} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {isAdmin && (
                  <button
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="w-full py-2.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-xl border border-red-200 transition-colors disabled:opacity-50"
                  >
                    {disconnecting ? 'Disconnecting…' : 'Disconnect Amazon account'}
                  </button>
                )}
              </div>
            )}
            {syncing && (
              <button onClick={() => navigate('/')} className="mt-4 text-sm text-gray-400 hover:text-gray-600">
                Continue to dashboard while syncing →
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── STEP: Connect screen ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
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
            Link your Amazon seller account to pull live inventory, orders, and sales data.
          </p>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              <p><strong>Connection failed:</strong> {error.replace(/_/g, ' ')}</p>
              {searchParams.get('detail') && (
                <p className="mt-1 text-xs font-mono break-all opacity-80">{searchParams.get('detail')}</p>
              )}
              <p className="mt-1 text-xs opacity-70">Check Railway logs for the full error.</p>
            </div>
          )}

          <div className="flex border border-gray-200 rounded-lg p-1 mb-5">
            <button onClick={() => setTab('oauth')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'oauth' ? 'bg-orange-500 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
              Connect with Amazon
            </button>
            <button onClick={() => setTab('manual')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'manual' ? 'bg-orange-500 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
              Manual Entry
            </button>
          </div>

          {tab === 'oauth' && (
            <div className="space-y-4">
              {/* Security warning */}
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
                <p className="text-sm font-bold text-amber-800 mb-2">⚠ Before you click — important:</p>
                <p className="text-sm text-amber-700">
                  Make sure you are signed into <strong>your own</strong> Amazon Seller Central
                  account in this browser before clicking below. We will connect whichever account
                  Amazon shows as currently logged in.
                </p>
                <p className="text-sm text-amber-700 mt-2">
                  Not sure? <strong>Open a new tab, go to sellercentral.amazon.com, sign out,
                  then sign back in as yourself</strong> — then come back and click Connect.
                </p>
              </div>

              <div className="bg-slate-50 rounded-xl p-4 space-y-1.5">
                <p className="text-xs font-semibold text-gray-500 mb-2">What happens next:</p>
                {[
                  'You\'re taken to Amazon Seller Central',
                  'Sign in to YOUR seller account if not already',
                  'Click "Authorize" to approve the connection',
                  'You\'ll see the Seller ID that was connected',
                  'Confirm it\'s yours before we pull any data',
                ].map((s, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-orange-500 font-bold text-xs mt-0.5">{i + 1}.</span>
                    <p className="text-sm text-gray-600">{s}</p>
                  </div>
                ))}
              </div>

              {!isAdmin ? (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                  <strong>Admin access required.</strong> Only workspace admins can connect an Amazon account. Ask your workspace admin to complete this step.
                </div>
              ) : !oauthUrl ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
                  <strong>OAuth not configured.</strong> Use Manual Entry below, or ask your platform admin to set <code>AMAZON_SP_APP_ID</code> in Railway Variables.
                </div>
              ) : (
                <a href={oauthUrl}
                  className="flex items-center justify-center gap-3 w-full py-4 bg-[#FF9900] hover:bg-[#e88b00] text-white rounded-xl font-bold text-base transition-colors shadow-md">
                  <AmazonIcon className="w-6 h-6" />
                  Sign in to Amazon &amp; Connect
                </a>
              )}
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
                  <input className="input text-sm" placeholder={f.ph} value={manual[f.key]}
                    onChange={e => setManual(m => ({ ...m, [f.key]: e.target.value }))}
                    type={f.key.includes('secret') || f.key.includes('token') ? 'password' : 'text'}
                    required={f.key !== 'marketplace_id'} />
                </div>
              ))}
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={manual.is_sandbox}
                  onChange={e => setManual(m => ({ ...m, is_sandbox: e.target.checked }))} className="rounded" />
                Use Sandbox environment
              </label>
              {saveError && <p className="text-red-600 text-sm">{saveError}</p>}
              <button type="submit" disabled={saving}
                className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50 transition-colors">
                {saving ? 'Saving & starting sync…' : 'Save & Pull My Data'}
              </button>
            </form>
          )}

          <div className="mt-5 pt-4 border-t border-gray-100">
            <button onClick={() => navigate('/')}
              className="w-full text-sm text-gray-400 hover:text-gray-600 transition-colors">
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
function ShieldIcon({ className }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
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
