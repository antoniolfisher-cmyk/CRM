import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Profile() {
  const { user, token, loginWithToken, isAdmin } = useAuth()

  // Account info form
  const [username, setUsername]       = useState(user?.username || '')
  const [email, setEmail]             = useState(user?.email || '')
  const [notifyEmail, setNotifyEmail] = useState(user?.notify_email !== false)
  const [infoMsg, setInfoMsg]         = useState(null)
  const [infoErr, setInfoErr]         = useState(null)
  const [infoLoading, setInfoLoading] = useState(false)

  // Workspace / store name form (admin only)
  const [storeName, setStoreName]       = useState(user?.tenant_name || '')
  const [storeMsg, setStoreMsg]         = useState(null)
  const [storeErr, setStoreErr]         = useState(null)
  const [storeLoading, setStoreLoading] = useState(false)

  // Password form
  const [currentPwd, setCurrentPwd]   = useState('')
  const [newPwd, setNewPwd]           = useState('')
  const [confirmPwd, setConfirmPwd]   = useState('')
  const [pwdMsg, setPwdMsg]           = useState(null)
  const [pwdErr, setPwdErr]           = useState(null)
  const [pwdLoading, setPwdLoading]   = useState(false)

  const usernameChanged = username.trim() && username.trim() !== user?.username

  const handleStoreSave = async (e) => {
    e.preventDefault()
    setStoreMsg(null)
    setStoreErr(null)
    setStoreLoading(true)
    try {
      const res = await fetch('/api/tenant/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ store_name: storeName.trim() }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Update failed')
      setStoreMsg('Store name saved. It will appear in the sidebar and email templates.')
    } catch (err) {
      setStoreErr(err.message)
    } finally {
      setStoreLoading(false)
    }
  }

  const handleInfoSave = async (e) => {
    e.preventDefault()
    setInfoMsg(null)
    setInfoErr(null)
    setInfoLoading(true)
    try {
      const body = {
        email:        email.trim() || null,
        notify_email: notifyEmail,
      }
      if (username.trim() && username.trim() !== user?.username) {
        body.username = username.trim()
      }
      const res = await fetch('/api/auth/profile', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Update failed')
      if (d.new_token) {
        loginWithToken(d.new_token, {
          ...user,
          username:     d.username,
          email:        email.trim() || null,
          notify_email: notifyEmail,
        })
      }
      setInfoMsg(
        d.new_token
          ? 'Username changed and profile saved. Remember to update CRM_USERNAME and SUPERADMIN_USERNAME in Railway Variables if applicable.'
          : 'Profile saved.'
      )
    } catch (err) {
      setInfoErr(err.message)
    } finally {
      setInfoLoading(false)
    }
  }

  const handlePwdSave = async (e) => {
    e.preventDefault()
    setPwdMsg(null)
    setPwdErr(null)
    if (newPwd !== confirmPwd) { setPwdErr('Passwords do not match'); return }
    if (newPwd.length < 8)    { setPwdErr('Password must be at least 8 characters'); return }
    setPwdLoading(true)
    try {
      const res = await fetch('/api/auth/profile', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ current_password: currentPwd, new_password: newPwd }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Update failed')
      setPwdMsg('Password changed successfully.')
      setCurrentPwd('')
      setNewPwd('')
      setConfirmPwd('')
    } catch (err) {
      setPwdErr(err.message)
    } finally {
      setPwdLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
        <p className="text-sm text-gray-500 mt-1">Update your username, email, and password.</p>
      </div>

      {/* Current info badges */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium capitalize">
          {user?.role}
        </span>
        {user?.is_superadmin && (
          <span className="px-2.5 py-1 rounded-full bg-orange-100 text-orange-700 font-medium">
            Platform Admin
          </span>
        )}
        <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium capitalize">
          {user?.plan || 'starter'} plan
        </span>
      </div>

      {/* Account info */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900 text-lg">Account Info</h2>
        <form onSubmit={handleInfoSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="input w-full"
              required
              minLength={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input w-full"
              placeholder="your@email.com"
            />
          </div>
          <label className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={notifyEmail}
              onChange={e => setNotifyEmail(e.target.checked)}
              className="rounded border-gray-300 text-blue-600"
            />
            Receive email notifications
          </label>

          {/* Superadmin username-change warning */}
          {usernameChanged && user?.is_superadmin && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 space-y-2">
              <p className="font-semibold">You are the platform superadmin</p>
              <p>After saving, go to Railway Variables and update these two variables so the system still recognises your account as superadmin after the next deploy:</p>
              <code className="block bg-amber-100 px-2.5 py-1 rounded font-mono text-xs">
                CRM_USERNAME = {username.trim()}
              </code>
              <code className="block bg-amber-100 px-2.5 py-1 rounded font-mono text-xs">
                SUPERADMIN_USERNAME = {username.trim()}
              </code>
            </div>
          )}

          {infoMsg && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              {infoMsg}
            </p>
          )}
          {infoErr && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {infoErr}
            </p>
          )}

          <button type="submit" disabled={infoLoading} className="btn-primary">
            {infoLoading ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </div>

      {/* Workspace name — admin only */}
      {isAdmin && (
        <div className="card p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-900 text-lg">Workspace / Store Name</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              This name appears in the sidebar and in outgoing ungate email templates as <code className="bg-gray-100 px-1 rounded text-xs">{'{SELLER_NAME}'}</code>.
            </p>
          </div>
          <form onSubmit={handleStoreSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Store / Business Name</label>
              <input
                type="text"
                value={storeName}
                onChange={e => setStoreName(e.target.value)}
                className="input w-full"
                placeholder="e.g. Delight Shoppe"
                required
              />
              <p className="text-xs text-gray-400 mt-1">
                Current: <span className="font-medium">{user?.tenant_name || '—'}</span>
              </p>
            </div>

            {storeMsg && (
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                {storeMsg}
              </p>
            )}
            {storeErr && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {storeErr}
              </p>
            )}

            <button type="submit" disabled={storeLoading} className="btn-primary">
              {storeLoading ? 'Saving…' : 'Save Store Name'}
            </button>
          </form>
        </div>
      )}

      {/* Change password */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900 text-lg">Change Password</h2>
        <form onSubmit={handlePwdSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <input
              type="password"
              value={currentPwd}
              onChange={e => setCurrentPwd(e.target.value)}
              className="input w-full"
              required
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password"
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              className="input w-full"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPwd}
              onChange={e => setConfirmPwd(e.target.value)}
              className="input w-full"
              required
              autoComplete="new-password"
            />
          </div>

          {pwdMsg && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              {pwdMsg}
            </p>
          )}
          {pwdErr && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {pwdErr}
            </p>
          )}

          <button type="submit" disabled={pwdLoading} className="btn-primary">
            {pwdLoading ? 'Changing…' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
