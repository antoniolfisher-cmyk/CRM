import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

const STATUS_META = {
  pending:        { label: 'Pending',        color: 'bg-gray-100 text-gray-600' },
  in_progress:    { label: 'In Progress',    color: 'bg-blue-100 text-blue-700' },
  approved:       { label: 'Approved',       color: 'bg-green-100 text-green-700' },
  rejected_final: { label: 'Final Rejected', color: 'bg-red-100 text-red-700' },
}

const STEP_STATUS = {
  submitted: { label: 'Submitted', color: 'text-blue-600' },
  rejected:  { label: 'Rejected',  color: 'text-red-500' },
  approved:  { label: 'Approved',  color: 'text-green-600' },
  draft:     { label: 'Draft',     color: 'text-violet-600' },
}

export default function Ungate() {
  const [tab, setTab] = useState('requests')
  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ungate Requests</h1>
        <p className="text-gray-500 text-sm mt-0.5">Track Amazon ungating applications · AI drafts responses automatically on rejection</p>
      </div>
      <div className="flex border-b border-gray-200">
        {[['requests','Active Requests'],['templates','Templates (10)']].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'requests' ? <RequestsTab /> : <TemplatesTab />}
    </div>
  )
}

// ─── Requests Tab ─────────────────────────────────────────────────────────────

function RequestsTab() {
  const [requests, setRequests]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState(null)
  const [showNew, setShowNew]     = useState(false)

  const load = useCallback(async () => {
    try { const d = await api.getUngateRequests(); setRequests(d) }
    catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const pending     = requests.filter(r => r.status === 'pending')
  const in_progress = requests.filter(r => r.status === 'in_progress')
  const approved    = requests.filter(r => r.status === 'approved')
  const final_rej   = requests.filter(r => r.status === 'rejected_final')

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Loading…</div>

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Left: list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">{requests.length} total requests</p>
          <button onClick={() => setShowNew(true)} className="btn-primary text-sm py-1.5 px-3">+ New Request</button>
        </div>

        {requests.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 py-14 text-center">
            <LockIcon className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No ungate requests yet</p>
            <p className="text-xs text-gray-400 mt-1">Add a gated product to start the ungating process</p>
          </div>
        )}

        {[['in_progress','In Progress'], ['pending','Pending'], ['approved','Approved'], ['rejected_final','Final Rejected']].map(([status, label]) => {
          const group = requests.filter(r => r.status === status)
          if (!group.length) return null
          return (
            <div key={status}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{label}</p>
              <div className="space-y-2">
                {group.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className={`w-full text-left bg-white rounded-xl border p-4 hover:border-blue-300 transition-colors ${selected?.id === r.id ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-gray-900 truncate">{r.product_name}</p>
                        <p className="text-xs font-mono text-gray-500 mt-0.5">{r.asin}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_META[r.status]?.color || ''}`}>
                        {STATUS_META[r.status]?.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-gray-400">Template {r.current_template_num}/10</span>
                      {r.category && <span className="text-xs text-gray-400">{r.category}</span>}
                    </div>
                    <div className="mt-2 flex gap-1">
                      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                        <div key={n} className={`h-1.5 flex-1 rounded-full ${n < r.current_template_num ? 'bg-blue-400' : n === r.current_template_num ? 'bg-blue-600' : 'bg-gray-100'}`} />
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Right: detail */}
      <div>
        {selected ? (
          <RequestDetail
            request={selected}
            onUpdate={(updated) => {
              setRequests(prev => prev.map(r => r.id === updated.id ? updated : r))
              setSelected(updated)
            }}
            onDelete={() => {
              setRequests(prev => prev.filter(r => r.id !== selected.id))
              setSelected(null)
            }}
          />
        ) : (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 h-64 flex items-center justify-center">
            <p className="text-sm text-gray-400">Select a request to view details</p>
          </div>
        )}
      </div>

      {showNew && (
        <NewRequestModal
          onClose={() => setShowNew(false)}
          onCreate={(r) => { setRequests(prev => [r, ...prev]); setSelected(r); setShowNew(false) }}
        />
      )}
    </div>
  )
}

// ─── Request Detail ───────────────────────────────────────────────────────────

function RequestDetail({ request: r, onUpdate, onDelete }) {
  const [history, setHistory]   = useState([])
  const [busy, setBusy]         = useState(false)
  const [rejModal, setRejModal] = useState(false)
  const [rendered, setRendered] = useState(null)
  const [copied, setCopied]     = useState(false)
  const [submitModal, setSubmitModal] = useState(false)
  const [applyLink, setApplyLink] = useState(null)
  const [invoiceFilename, setInvoiceFilename] = useState(r.invoice_filename || null)
  const [invoiceUploading, setInvoiceUploading] = useState(false)

  // Fetch apply link from requirements when loaded
  useEffect(() => {
    const loadLink = async () => {
      try {
        const d = await api.getUngateRequirements(r.asin)
        if (d.apply_links?.[0]) setApplyLink(d.apply_links[0].resource)
      } catch {}
    }
    loadLink()
  }, [r.asin])

  useEffect(() => {
    try { setHistory(JSON.parse(r.history || '[]')) } catch { setHistory([]) }
  }, [r.history])

  // Load current template rendered with product variables
  useEffect(() => {
    const load = async () => {
      try {
        let reqs = {}
        try { reqs = JSON.parse(r.requirements || '{}') } catch {}
        const d = await api.renderTemplate(r.current_template_num, {
          product_name:  r.product_name,
          asin:          r.asin,
          quantity:      reqs.quantity || '150',
        })
        setRendered(d)
      } catch {}
    }
    load()
  }, [r.current_template_num, r.asin, r.product_name, r.requirements])

  const markSubmitted = async (openLink = false) => {
    setBusy(true)
    try {
      // Copy template to clipboard before opening SC so it's ready to paste
      const bodyText = latestDraft?.ai_response || rendered?.body || ''
      if (bodyText && openLink) {
        try { await navigator.clipboard.writeText(bodyText) } catch {}
      }
      const updated = await api.submitUngateRequest(r.id, {})
      onUpdate(updated)
      if (openLink && applyLink) window.open(applyLink, '_blank')
    } catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  const sendEmail = async (toEmail, includeInvoice = false) => {
    const body   = latestDraft?.ai_response || rendered?.body || ''
    const subject = latestDraft?.subject || rendered?.subject || `Ungate Request — ${r.product_name} (${r.asin})`
    setBusy(true)
    try {
      await api.sendUngateEmail(r.id, { to_email: toEmail, subject, body, include_invoice: includeInvoice })
      const updated = await api.getUngateRequest(r.id)
      onUpdate(updated)
      setSubmitModal(false)
    } catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  const handleInvoiceUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setInvoiceUploading(true)
    try {
      const result = await api.uploadUngateInvoice(r.id, file)
      setInvoiceFilename(result.filename)
      onUpdate({ ...r, invoice_filename: result.filename })
    } catch (err) { alert(`Invoice upload failed: ${err.message}`) }
    finally { setInvoiceUploading(false); e.target.value = '' }
  }

  const handleInvoiceRemove = async () => {
    if (!confirm('Remove attached invoice?')) return
    try {
      await api.deleteUngateInvoice(r.id)
      setInvoiceFilename(null)
      onUpdate({ ...r, invoice_filename: null })
    } catch (err) { alert(`Failed to remove invoice: ${err.message}`) }
  }

  const markApproved = async () => {
    if (!confirm('Mark this request as approved? The product will be marked as ungated.')) return
    setBusy(true)
    try {
      const updated = await api.approveUngateRequest(r.id)
      onUpdate(updated)
    } catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  const del = async () => {
    if (!confirm('Delete this request?')) return
    await api.deleteUngateRequest(r.id)
    onDelete()
  }

  const copy = () => {
    if (!rendered) return
    navigator.clipboard.writeText(rendered.body)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Get the latest draft AI response if available
  const latestDraft = [...history].reverse().find(h => h.status === 'draft')

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-gray-900">{r.product_name}</p>
            <p className="text-xs font-mono text-gray-500 mt-0.5">
              ASIN: <a href={`https://www.amazon.com/dp/${r.asin}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{r.asin} ↗</a>
              {r.category && <span className="ml-3 text-gray-400">{r.category}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_META[r.status]?.color || ''}`}>
              {STATUS_META[r.status]?.label}
            </span>
            <button onClick={del} className="text-gray-300 hover:text-red-400 text-xs">✕</button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex gap-1 mt-3">
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <div key={n} className={`h-2 flex-1 rounded-full ${n < r.current_template_num ? 'bg-blue-400' : n === r.current_template_num ? 'bg-blue-600' : 'bg-gray-100'}`} title={`Template ${n}`} />
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">Template {r.current_template_num} of 10</p>
      </div>

      {/* Requirements */}
      <RequirementsBlock asin={r.asin} cachedReqs={r.requirements} />

      {/* Timeline */}
      {history.length > 0 && (
        <div className="px-5 py-4 border-t border-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Submission History</p>
          <div className="space-y-3">
            {history.map((step, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${STEP_STATUS[step.status]?.color?.replace('text-', 'bg-') || 'bg-gray-300'}`} />
                  {i < history.length - 1 && <div className="w-0.5 bg-gray-100 flex-1 mt-1" />}
                </div>
                <div className="flex-1 pb-3">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xs font-medium ${STEP_STATUS[step.status]?.color || 'text-gray-500'}`}>
                      Template {step.template_num} — {STEP_STATUS[step.status]?.label}
                    </span>
                    <span className="text-xs text-gray-400">
                      {step.submitted_at ? new Date(step.submitted_at).toLocaleDateString() : step.generated_at ? new Date(step.generated_at).toLocaleDateString() : ''}
                    </span>
                  </div>
                  {step.rejection_reason && (
                    <p className="text-xs text-red-600 mt-1 bg-red-50 rounded px-2 py-1">{step.rejection_reason}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current template / AI draft */}
      {r.status !== 'approved' && r.status !== 'rejected_final' && (
        <div className="px-5 py-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {latestDraft ? 'AI-Generated Response (Next)' : `Template ${r.current_template_num}`}
            </p>
            {rendered && (
              <button onClick={copy} className="text-xs text-blue-600 hover:text-blue-800">
                {copied ? '✓ Copied' : 'Copy to clipboard'}
              </button>
            )}
          </div>
          {rendered?.subject && (
            <p className="text-xs bg-gray-50 rounded px-3 py-1.5 mb-2 text-gray-700">
              <span className="text-gray-400">Subject: </span>{latestDraft?.subject || rendered.subject}
            </p>
          )}
          <textarea
            readOnly
            className="w-full text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 resize-none font-mono text-gray-700 leading-relaxed"
            rows={10}
            value={latestDraft?.ai_response || rendered?.body || ''}
          />
        </div>
      )}

      {/* Invoice attachment */}
      {r.status !== 'approved' && r.status !== 'rejected_final' && (
        <div className="px-5 py-3 border-t border-gray-50 bg-gray-50/40">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Invoice</span>
            {invoiceFilename ? (
              <>
                <span className="text-xs text-green-700 font-medium flex items-center gap-1">
                  📎 {invoiceFilename}
                </span>
                <label className={`text-xs text-blue-600 hover:text-blue-800 cursor-pointer ${invoiceUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  {invoiceUploading ? 'Uploading…' : '↑ Replace'}
                  <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.gif" onChange={handleInvoiceUpload} />
                </label>
                <button onClick={handleInvoiceRemove} className="text-xs text-red-500 hover:text-red-700">Remove</button>
              </>
            ) : (
              <label className={`text-xs text-blue-600 hover:text-blue-800 cursor-pointer flex items-center gap-1 ${invoiceUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {invoiceUploading ? 'Uploading…' : '+ Attach Invoice'}
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.gif" onChange={handleInvoiceUpload} />
              </label>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      {r.status !== 'approved' && r.status !== 'rejected_final' && (
        <div className="px-5 py-4 border-t border-gray-100 space-y-2">
          {(r.status === 'pending' || history.length === 0 || history[history.length-1]?.status === 'draft') ? (
            <div className="flex flex-wrap gap-2">
              {applyLink && (
                <button
                  onClick={() => { markSubmitted(true) }}
                  disabled={busy}
                  className="btn-primary text-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  <span>🔓</span> Submit via Seller Central ↗
                </button>
              )}
              <button
                onClick={() => setSubmitModal(true)}
                disabled={busy}
                className="btn-secondary text-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                ✉ Send via Email
              </button>
              {!applyLink && (
                <button onClick={() => markSubmitted(false)} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
                  Mark as Submitted
                </button>
              )}
            </div>
          ) : history.length > 0 && history[history.length - 1]?.status === 'submitted' ? (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setRejModal(true)} disabled={busy} className="bg-red-50 text-red-600 border border-red-200 rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-100 transition-colors">
                Record Amazon Rejection
              </button>
              <button onClick={markApproved} disabled={busy} className="bg-green-50 text-green-700 border border-green-200 rounded-lg px-4 py-2 text-sm font-medium hover:bg-green-100 transition-colors">
                Mark Approved ✓
              </button>
            </div>
          ) : null}
          <p className="text-xs text-gray-400">
            Template copied to clipboard automatically when submitting via Seller Central.
          </p>
        </div>
      )}

      {r.status === 'approved' && (
        <div className="px-5 py-4 border-t border-green-50 bg-green-50/50 text-center">
          <p className="text-sm font-medium text-green-700">✓ Ungating Approved!</p>
          <p className="text-xs text-green-600 mt-0.5">Product has been marked as ungated in Sourcing</p>
        </div>
      )}

      {rejModal && (
        <RejectionModal
          onClose={() => setRejModal(false)}
          onSubmit={async (reason) => {
            setBusy(true)
            setRejModal(false)
            try {
              const updated = await api.recordRejection(r.id, { rejection_reason: reason })
              onUpdate({ ...r, ...updated, history: updated.history })
            } catch (e) { alert(e.message) }
            finally { setBusy(false) }
          }}
        />
      )}

      {submitModal && (
        <SubmitEmailModal
          onClose={() => setSubmitModal(false)}
          onSend={sendEmail}
          busy={busy}
          invoiceFilename={invoiceFilename}
        />
      )}
    </div>
  )
}

function RequirementsBlock({ asin, cachedReqs }) {
  const [reqs, setReqs]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  let cached = {}
  try { cached = JSON.parse(cachedReqs || '{}') } catch {}
  const hasCache = Object.keys(cached).length > 0

  const fetch = async () => {
    setLoading(true)
    try {
      const d = await api.getUngateRequirements(asin)
      setReqs(d)
      setExpanded(true)
    } catch (e) { alert(e.message) }
    finally { setLoading(false) }
  }

  const data = reqs?.requirements || cached

  return (
    <div className="px-5 py-3 border-t border-gray-50 bg-amber-50/30">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Amazon Requirements</p>
        <button onClick={hasCache && !expanded ? () => setExpanded(!expanded) : fetch}
          disabled={loading}
          className="text-xs text-amber-600 hover:text-amber-800 disabled:opacity-50">
          {loading ? 'Fetching…' : expanded || hasCache ? (expanded ? 'Hide' : 'Show') : 'Fetch from Amazon'}
        </button>
      </div>
      {(expanded || hasCache) && (reqs || hasCache) && (
        <div className="mt-2 space-y-2">
          {/* Gating status banner */}
          {reqs && (
            <div className={`rounded-lg px-3 py-2 text-xs font-medium ${reqs.is_gated ? 'bg-red-50 border border-red-200 text-red-700' : reqs.check_ran ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-gray-50 border border-gray-200 text-gray-600'}`}>
              {reqs.is_gated
                ? '🔒 GATED — approval required'
                : reqs.check_ran
                ? '✓ Appears ungated for your account'
                : `⚠ ${reqs.sp_error || 'Could not verify'}`}
              {reqs.reasons?.map((r, i) => <p key={i} className="font-normal mt-0.5">{r}</p>)}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
          {data.quantity && (
            <div className="bg-white rounded-lg border border-amber-100 px-3 py-2">
              <p className="text-xs text-amber-600">Min. Invoice Qty</p>
              <p className="text-sm font-bold text-gray-800">{data.quantity} units</p>
            </div>
          )}
          {data.invoice_age_days && (
            <div className="bg-white rounded-lg border border-amber-100 px-3 py-2">
              <p className="text-xs text-amber-600">Invoice Age</p>
              <p className="text-sm font-bold text-gray-800">Within {data.invoice_age_days} days</p>
            </div>
          )}
          {data.needs_brand_auth && (
            <div className="bg-white rounded-lg border border-amber-100 px-3 py-2 col-span-2">
              <p className="text-xs text-amber-700 font-medium">⚠ Brand authorization letter required</p>
            </div>
          )}
          {data.notes && (
            <div className="bg-white rounded-lg border border-amber-100 px-3 py-2 col-span-2">
              <p className="text-xs text-gray-600">{data.notes}</p>
            </div>
          )}
          {reqs?.apply_links?.length > 0 && (
            <div className="col-span-2">
              <a href={reqs.apply_links[0].resource} target="_blank" rel="noreferrer"
                className="text-xs text-blue-600 hover:underline">
                {reqs.apply_links[0].title || 'Apply in Seller Central'} ↗
              </a>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function NewRequestModal({ onClose, onCreate }) {
  const [asin, setAsin]       = useState('')
  const [name, setName]       = useState('')
  const [category, setCategory] = useState('')
  const [notes, setNotes]     = useState('')
  const [reqData, setReqData] = useState(null)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving]   = useState(false)

  const fetchReqs = async () => {
    if (!asin.trim()) return
    setFetching(true)
    try {
      const d = await api.getUngateRequirements(asin.trim().toUpperCase())
      setReqData(d)
      // Auto-fill product name and category from Amazon catalog data
      if (d.product_details?.name)     setName(d.product_details.name)
      if (d.product_details?.category) setCategory(d.product_details.category)
    } catch (e) { alert(e.message) }
    finally { setFetching(false) }
  }

  const save = async () => {
    if (!asin.trim() || !name.trim()) return
    setSaving(true)
    try {
      const r = await api.createUngateRequest({
        asin: asin.trim().toUpperCase(),
        product_name: name.trim(),
        category: category.trim(),
        notes,
        requirements: reqData?.requirements || {},
      })
      onCreate(r)
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <p className="font-semibold text-gray-900">New Ungate Request</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="label">ASIN</label>
              <input className="input" placeholder="B08N5WRWNW" value={asin}
                onChange={e => setAsin(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchReqs()} />
            </div>
            <div className="self-end">
              <button onClick={fetchReqs} disabled={!asin.trim() || fetching}
                className="btn-secondary disabled:opacity-50 whitespace-nowrap">
                {fetching ? 'Fetching…' : 'Fetch Requirements'}
              </button>
            </div>
          </div>

          {reqData && (
            <div className={`border rounded-lg p-3 text-xs space-y-1.5 ${reqData.is_gated ? 'bg-red-50 border-red-200' : reqData.check_ran ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
              <p className={`font-semibold ${reqData.is_gated ? 'text-red-700' : reqData.check_ran ? 'text-green-700' : 'text-gray-600'}`}>
                {reqData.is_gated
                  ? '🔒 Product is GATED — approval required'
                  : reqData.check_ran
                  ? '✓ Product appears ungated for your account'
                  : `⚠ Could not verify — ${reqData.sp_error || 'SP-API unavailable'}`}
              </p>
              {reqData.reasons?.map((r, i) => (
                <p key={i} className="text-red-600">{r}</p>
              ))}
              {reqData.requirements?.quantity && (
                <p className="text-gray-700">Min invoice qty: <strong>{reqData.requirements.quantity} units</strong>
                  {reqData.requirements.invoice_age_days ? ` · within ${reqData.requirements.invoice_age_days} days` : ''}
                </p>
              )}
              {reqData.requirements?.needs_brand_auth && <p className="text-amber-700 font-medium">⚠ Brand authorization letter required</p>}
              {reqData.requirements?.notes && <p className="text-gray-600">{reqData.requirements.notes}</p>}
              {reqData.product_details?.name && (
                <p className="text-gray-500">Auto-filled: <span className="font-medium text-gray-700">{reqData.product_details.name}</span>
                  {reqData.product_details?.category ? ` · ${reqData.product_details.category}` : ''}
                </p>
              )}
              {reqData.apply_links?.[0] && (
                <a href={reqData.apply_links[0].resource} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 mt-1 text-blue-600 hover:text-blue-800 font-medium">
                  {reqData.apply_links[0].title || 'Apply in Seller Central'} ↗
                </a>
              )}
            </div>
          )}

          <div>
            <label className="label">Product Name</label>
            <input className="input" placeholder="Product name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Category (optional)</label>
            <input className="input" placeholder="e.g. Grocery, Health, Topicals" value={category} onChange={e => setCategory(e.target.value)} />
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <textarea className="input resize-none" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={!asin.trim() || !name.trim() || saving} className="btn-primary disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Request'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RejectionModal({ onClose, onSubmit }) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <p className="font-semibold text-gray-900">Record Amazon Rejection</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-600">Paste Amazon's rejection reason. AI will automatically generate a tailored response using the next template.</p>
          <textarea
            className="input w-full resize-none"
            rows={6}
            placeholder="Paste Amazon's rejection message here…"
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => onSubmit(reason)}
            disabled={!reason.trim()}
            className="btn-primary disabled:opacity-50"
          >
            Generate AI Response →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading]     = useState(true)
  const [editing, setEditing]     = useState(null)

  const load = useCallback(async () => {
    try { const d = await api.getUngateTemplates(); setTemplates(d) }
    catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Loading templates…</div>

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        These 10 templates are used in sequence when Amazon rejects an application. AI automatically customizes each one based on the rejection reason.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map(t => (
          <div key={t.id} className={`bg-white rounded-xl border p-4 ${t.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">{t.number}</span>
                <div>
                  <p className="font-medium text-sm text-gray-900">{t.name}</p>
                  <span className="text-xs text-gray-400 capitalize">{t.category}</span>
                </div>
              </div>
              <button onClick={() => setEditing(t)} className="text-xs text-blue-600 hover:text-blue-800 shrink-0">Edit</button>
            </div>
            {t.description && <p className="text-xs text-gray-500 mt-2">{t.description}</p>}
            <p className="text-xs text-gray-400 mt-2 line-clamp-2 font-mono">{t.body?.slice(0, 120)}…</p>
          </div>
        ))}
      </div>

      {editing && (
        <TemplateEditModal
          template={editing}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            const updated = await api.updateUngateTemplate(editing.id, data)
            setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function TemplateEditModal({ template: t, onClose, onSave }) {
  const [name, setName]         = useState(t.name)
  const [description, setDesc]  = useState(t.description || '')
  const [subject, setSubject]   = useState(t.subject || '')
  const [body, setBody]         = useState(t.body)
  const [category, setCategory] = useState(t.category || 'general')
  const [isActive, setIsActive] = useState(t.is_active)
  const [saving, setSaving]     = useState(false)
  const [generating, setGen]    = useState(false)

  const save = async () => {
    setSaving(true)
    try { await onSave({ name, description, subject, body, category, is_active: isActive }) }
    catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const generateAI = async () => {
    setGen(true)
    try {
      const d = await api.aiGenerateTemplate({
        scenario: `${name} — template #${t.number}`,
        category,
        template_num: t.number,
        context: description,
      })
      if (d.body)    setBody(d.body)
      if (d.subject) setSubject(d.subject)
    } catch (e) { alert(e.message) }
    finally { setGen(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white">
          <p className="font-semibold text-gray-900">Template {t.number}: {t.name}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Template Name</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
                {['general','resubmission','escalation','brand_auth'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={description} onChange={e => setDesc(e.target.value)} placeholder="When to use this template" />
          </div>
          <div>
            <label className="label">Email Subject</label>
            <input className="input font-mono text-xs" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Email Body</label>
              <button onClick={generateAI} disabled={generating} className="text-xs text-violet-600 hover:text-violet-800 disabled:opacity-50">
                {generating ? 'Generating…' : '✦ Regenerate with AI'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-1.5">
              Variables: {'{SELLER_NAME}'} {'{SELLER_ID}'} {'{PRODUCT_NAME}'} {'{ASIN}'} {'{QUANTITY}'} {'{SUPPLIER_NAME}'}
            </p>
            <textarea
              className="input w-full resize-y font-mono text-xs"
              rows={14}
              value={body}
              onChange={e => setBody(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4 accent-blue-600" />
            <span className="text-sm text-gray-700">Active (included in ungating workflow)</span>
          </label>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Submit Email Modal ───────────────────────────────────────────────────────

function SubmitEmailModal({ onClose, onSend, busy, invoiceFilename }) {
  const [toEmail, setToEmail] = useState('seller-performance@amazon.com')
  const [includeInvoice, setIncludeInvoice] = useState(true)
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <p className="font-semibold text-gray-900">Send Application via Email</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-600">
            The template will be sent via your configured SMTP email to Amazon's seller performance team.
          </p>
          <div>
            <label className="label">Send to</label>
            <input
              className="input"
              value={toEmail}
              onChange={e => setToEmail(e.target.value)}
              placeholder="seller-performance@amazon.com"
            />
            <p className="text-xs text-gray-400 mt-1">Common Amazon emails: seller-performance@amazon.com · brand-registry@amazon.com</p>
          </div>
          {invoiceFilename && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeInvoice}
                onChange={e => setIncludeInvoice(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span className="text-sm text-gray-700">
                Attach invoice: <span className="font-medium text-gray-800">{invoiceFilename}</span>
              </span>
            </label>
          )}
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => onSend(toEmail, invoiceFilename ? includeInvoice : false)}
            disabled={!toEmail.trim() || busy}
            className="btn-primary disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy ? 'Sending…' : invoiceFilename && includeInvoice ? '✉ Send Email + Invoice' : '✉ Send Email'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function LockIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  )
}
