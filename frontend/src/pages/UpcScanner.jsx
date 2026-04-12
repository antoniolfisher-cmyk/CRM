import { useState, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { api } from '../api'

const HAS_DETECTOR = typeof window !== 'undefined' && 'BarcodeDetector' in window

const MODES = [
  { id: 'asin',   label: 'List of ASINs',              placeholder: 'B08N5WRWNW\nB07XJ8C8F5\nB09G9FPHY6\n…one per line or comma-separated' },
  { id: 'upc',    label: 'List of UPC / EAN / GTIN codes', placeholder: '012345678901\n0123456789012\n…one per line or comma-separated' },
  { id: 'prefix', label: 'Code Prefix Search',          placeholder: 'Enter a UPC/EAN manufacturer prefix (e.g. 01234567)' },
  { id: 'search', label: 'Amazon product search',       placeholder: 'Search keyword (e.g. "wireless earbuds", "protein powder")' },
]

export default function UpcScanner() {
  const [mode, setMode]         = useState('asin')
  const [text, setText]         = useState('')
  const [loading, setLoading]   = useState(false)
  const [progress, setProgress] = useState(null)   // { done, total } for multi-batch
  const [results, setResults]   = useState(null)   // { products, tokens_left, errors }
  const [error, setError]       = useState(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [expandedAsin, setExpandedAsin] = useState(null)
  const fileRef = useRef(null)

  const currentMode = MODES.find(m => m.id === mode)

  // Parse raw text into array of codes
  const parseCodes = (raw) =>
    raw
      .split(/[\n,;\t]+/)
      .map(s => s.trim())
      .filter(Boolean)

  const load = useCallback(async (overrideText) => {
    const raw = (overrideText ?? text).trim()
    if (!raw) return
    setError(null)
    setResults(null)
    setProgress(null)
    setLoading(true)

    try {
      if (mode === 'search') {
        // Amazon keyword search
        const data = await api.keepaAmazonSearch(raw)
        setResults(data)
      } else {
        // ASIN, UPC, or prefix — all go through batch
        const effectiveMode = mode === 'prefix' ? 'upc' : mode
        const codes = parseCodes(raw)
        if (!codes.length) { setError('No valid codes found.'); return }

        // Split into chunks of 500 (backend max) and process
        const CHUNK = 500
        const allProducts = []
        const allErrors   = []
        let tokensLeft    = null

        for (let i = 0; i < codes.length; i += CHUNK) {
          setProgress({ done: i, total: codes.length })
          const chunk = codes.slice(i, i + CHUNK)
          const data  = await api.keepaBatch(effectiveMode, chunk)
          allProducts.push(...(data.products || []))
          allErrors.push(...(data.errors || []))
          if (data.tokens_left != null) tokensLeft = data.tokens_left
          if (allErrors.some(e => e.includes('token limit'))) break
        }

        setProgress({ done: codes.length, total: codes.length })
        setResults({ products: allProducts, tokens_left: tokensLeft, errors: allErrors })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [mode, text])

  const handleFile = (file) => {
    const ext = file.name.split('.').pop().toLowerCase()
    if (['xlsx', 'xls', 'ods'].includes(ext)) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const wb   = XLSX.read(e.target.result, { type: 'array' })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        const codes = data.flat().map(v => String(v).trim()).filter(Boolean)
        setText(codes.join('\n'))
      }
      reader.readAsArrayBuffer(file)
    } else {
      const reader = new FileReader()
      reader.onload = (e) => setText(e.target.result)
      reader.readAsText(file)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const exportCsv = () => {
    const cols = ['asin','upc','title','buy_box','price_90_high','median_price','price_90_low','num_fba_sellers','num_fbm_sellers','bsr','category','amazon_url']
    const header = cols.join(',')
    const rows = (results?.products || []).map(r =>
      cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(',')
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `keepa_scan_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Product Analyzer</h1>
        <p className="text-gray-500 text-sm mt-0.5">Load Amazon products by ASIN, UPC/EAN, or keyword — powered by Keepa</p>
      </div>

      {/* Load card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <p className="font-semibold text-blue-700 text-sm">Load 🇺🇸 Amazon.com Products</p>

        {/* Mode selector */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          {MODES.map(m => (
            <label key={m.id} className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="mode"
                value={m.id}
                checked={mode === m.id}
                onChange={() => { setMode(m.id); setText(''); setResults(null); setError(null) }}
                className="w-4 h-4 text-blue-600 accent-blue-600"
              />
              <span className="text-sm text-gray-700">{m.label}</span>
            </label>
          ))}
        </div>

        {/* Input */}
        {mode === 'search' ? (
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder={currentMode.placeholder}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load()}
            />
            {HAS_DETECTOR && mode !== 'search' && (
              <button onClick={() => setCameraOpen(true)} className="btn-secondary flex items-center gap-1.5">
                <CameraIcon className="w-4 h-4" /> Scan
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              className="input w-full resize-none font-mono text-xs"
              rows={6}
              placeholder={currentMode.placeholder}
              value={text}
              onChange={e => setText(e.target.value)}
            />

            {/* File upload area */}
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className="border border-dashed border-gray-300 rounded-lg px-4 py-3 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
            >
              <p className="text-xs text-gray-500">
                Or upload a text file <span className="text-gray-400">(*.txt, *.csv, *.xlsx, …)</span>
              </p>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.txt,.ods" className="hidden"
                onChange={e => { const f = e.target.files[0]; if (f) { handleFile(f); e.target.value = '' } }} />
            </div>

            {/* Camera scan for UPC/prefix */}
            {HAS_DETECTOR && (mode === 'upc' || mode === 'prefix') && (
              <button onClick={() => setCameraOpen(true)} className="btn-secondary flex items-center gap-1.5 text-xs">
                <CameraIcon className="w-3.5 h-3.5" /> Scan barcode with camera
              </button>
            )}
          </div>
        )}

        {/* Note for search mode */}
        {mode === 'search' && (
          <p className="text-xs text-gray-400">Requires Amazon SP-API to be configured. Returns up to 20 products per search.</p>
        )}

        {/* Load button */}
        <button
          onClick={() => load()}
          disabled={!text.trim() || loading}
          className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <LoadIcon className="w-4 h-4" />
          {loading ? 'Loading…' : 'Load List'}
        </button>

        {/* Code count preview */}
        {text.trim() && mode !== 'search' && (
          <p className="text-xs text-gray-400">
            {parseCodes(text).length} {mode === 'asin' ? 'ASINs' : 'codes'} detected
          </p>
        )}
      </div>

      {/* Progress */}
      {loading && progress && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">Loading products…</p>
            <p className="text-sm text-gray-500">{progress.done} / {progress.total}</p>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Backend errors / warnings */}
      {results?.errors?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm space-y-1">
          {results.errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {/* Results */}
      {results && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <p className="font-semibold text-gray-900">{results.products?.length ?? 0} products found</p>
              {results.tokens_left != null && (
                <p className="text-xs text-gray-400 mt-0.5">Keepa tokens remaining: {results.tokens_left.toLocaleString()}</p>
              )}
            </div>
            <div className="flex gap-3 items-center">
              <button onClick={exportCsv} className="btn-secondary text-xs py-1.5 px-3">Export CSV</button>
              <button onClick={() => { setResults(null); setText('') }} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
            </div>
          </div>

          {results.products?.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">No products found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                  <tr>
                    <th className="px-3 py-3 text-left text-gray-500 font-medium w-8"></th>
                    <th className="px-3 py-3 text-left text-gray-500 font-medium whitespace-nowrap">ASIN</th>
                    <th className="px-3 py-3 text-left text-gray-500 font-medium whitespace-nowrap">UPC / EAN</th>
                    <th className="px-3 py-3 text-left text-gray-500 font-medium min-w-[200px]">Title</th>
                    <th className="px-3 py-3 text-left text-gray-500 font-medium whitespace-nowrap">Buy Box</th>
                    <th className="px-3 py-3 text-left text-gray-500 font-medium whitespace-nowrap">90d High</th>
                    <th className="px-3 py-3 text-left text-gray-500 font-medium whitespace-nowrap">90d Median</th>
                    <th className="px-3 py-3 text-left text-gray-500 font-medium whitespace-nowrap">90d Low</th>
                    <th className="px-3 py-3 text-left text-gray-500 font-medium whitespace-nowrap">FBA</th>
                    <th className="px-3 py-3 text-left text-gray-500 font-medium whitespace-nowrap">FBM</th>
                    <th className="px-3 py-3 text-left text-gray-500 font-medium whitespace-nowrap">BSR</th>
                    <th className="px-3 py-3 text-left text-gray-500 font-medium whitespace-nowrap">Category</th>
                    <th className="px-3 py-3 text-left text-gray-500 font-medium whitespace-nowrap">Amazon</th>
                  </tr>
                </thead>
                <tbody>
                  {results.products.map((p, i) => (
                    <>
                      <tr
                        key={p.asin + i}
                        className="border-t border-gray-50 hover:bg-gray-50/60 cursor-pointer"
                        onClick={() => setExpandedAsin(expandedAsin === p.asin ? null : p.asin)}
                      >
                        <td className="px-3 py-2.5 text-gray-400">
                          <span className="text-xs">{expandedAsin === p.asin ? '▾' : '▸'}</span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-gray-700 whitespace-nowrap">{p.asin || '—'}</td>
                        <td className="px-3 py-2.5 font-mono text-gray-500 whitespace-nowrap">{p.upc || '—'}</td>
                        <td className="px-3 py-2.5 text-gray-700 max-w-[220px]">
                          <p className="truncate" title={p.title}>{p.title || '—'}</p>
                        </td>
                        <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{p.buy_box ? `$${p.buy_box}` : '—'}</td>
                        <td className="px-3 py-2.5 font-medium text-green-600 whitespace-nowrap">{p.price_90_high ? `$${p.price_90_high}` : '—'}</td>
                        <td className="px-3 py-2.5 font-medium text-violet-600 whitespace-nowrap">{p.median_price ? `$${p.median_price}` : '—'}</td>
                        <td className="px-3 py-2.5 font-medium text-red-500 whitespace-nowrap">{p.price_90_low ? `$${p.price_90_low}` : '—'}</td>
                        <td className="px-3 py-2.5 text-gray-700">{p.num_fba_sellers ?? '—'}</td>
                        <td className="px-3 py-2.5 text-gray-700">{p.num_fbm_sellers ?? '—'}</td>
                        <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{p.bsr ? `#${p.bsr.toLocaleString()}` : '—'}</td>
                        <td className="px-3 py-2.5 text-gray-500 max-w-[120px]">
                          <p className="truncate" title={p.category}>{p.category || '—'}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          {p.amazon_url && (
                            <a
                              href={p.amazon_url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-blue-600 hover:underline whitespace-nowrap"
                            >
                              View ↗
                            </a>
                          )}
                        </td>
                      </tr>

                      {/* Expanded chart row */}
                      {expandedAsin === p.asin && p.keepa_chart_url && (
                        <tr key={`chart-${p.asin}`} className="border-t border-blue-50 bg-blue-50/30">
                          <td colSpan={13} className="px-6 py-4">
                            <div className="flex gap-8 items-start">
                              <div className="flex-1">
                                <p className="text-xs font-medium text-gray-600 mb-2">90-Day Price History</p>
                                <img
                                  src={p.keepa_chart_url}
                                  alt="Keepa price history"
                                  className="rounded-lg border border-gray-200 max-w-2xl w-full"
                                  onError={e => { e.target.style.display = 'none' }}
                                />
                              </div>
                              <div className="shrink-0 space-y-3 min-w-[160px]">
                                <Stat label="Buy Box"    value={p.buy_box ? `$${p.buy_box}` : '—'} />
                                <Stat label="90d High"   value={p.price_90_high ? `$${p.price_90_high}` : '—'}  color="green" />
                                <Stat label="90d Median" value={p.median_price ? `$${p.median_price}` : '—'}    color="violet" />
                                <Stat label="90d Low"    value={p.price_90_low ? `$${p.price_90_low}` : '—'}    color="red" />
                                <Stat label="FBA / FBM"  value={p.num_fba_sellers != null ? `${p.num_fba_sellers} / ${p.num_fbm_sellers}` : '—'} />
                                <Stat label="BSR"        value={p.bsr ? `#${p.bsr.toLocaleString()}` : '—'} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Camera overlay */}
      {cameraOpen && (
        <CameraScanner
          onDetect={(code) => {
            setCameraOpen(false)
            setText(prev => prev ? `${prev}\n${code}` : code)
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  )
}

// ─── Inline stat ──────────────────────────────────────────────────────────────

function Stat({ label, value, color }) {
  const cls = { green: 'text-green-600', red: 'text-red-500', violet: 'text-violet-600' }
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 ${cls[color] || 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

// ─── Camera scanner ───────────────────────────────────────────────────────────

function CameraScanner({ onDetect, onClose }) {
  const videoRef  = useRef(null)
  const rafRef    = useRef(null)
  const streamRef = useRef(null)
  const [status, setStatus] = useState('starting')
  const [lastCode, setLastCode] = useState(null)

  const startScan = useCallback(async () => {
    let detector
    try {
      detector = new BarcodeDetector({ formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128', 'code_39'] })
    } catch { setStatus('unsupported'); return }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    } catch { setStatus('denied'); return }

    streamRef.current = stream
    videoRef.current.srcObject = stream
    await videoRef.current.play()
    setStatus('scanning')

    async function scan() {
      try {
        const codes = await detector.detect(videoRef.current)
        if (codes.length > 0) {
          const val = codes[0].rawValue
          setLastCode(val)
          onDetect(val)
          // Keep scanning to allow adding multiple codes
          rafRef.current = requestAnimationFrame(scan)
          return
        }
      } catch {}
      rafRef.current = requestAnimationFrame(scan)
    }
    scan()
  }, [onDetect])

  useState(() => {
    startScan()
    return () => {
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  })

  const close = () => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    onClose()
  }

  const messages = {
    starting:    'Starting camera…',
    scanning:    'Point at a barcode — detected codes are added to the list',
    unsupported: 'Barcode detection requires Chrome or Edge.',
    denied:      'Camera access denied. Allow camera permissions and try again.',
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl overflow-hidden shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <p className="font-medium text-sm">Barcode Scanner</p>
          <button onClick={close} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>

        <div className="relative bg-black aspect-video">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          {status === 'scanning' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-3/4 h-16 border-2 border-blue-400 rounded-lg opacity-90 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
            </div>
          )}
        </div>

        <div className="px-4 py-3 space-y-2">
          <p className="text-xs text-gray-500 text-center">{messages[status]}</p>
          {lastCode && (
            <p className="text-xs text-center font-mono bg-green-50 text-green-700 border border-green-200 rounded px-2 py-1">
              ✓ Added: {lastCode}
            </p>
          )}
          <button onClick={close} className="btn-primary w-full text-sm">
            Done — close scanner
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function CameraIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function LoadIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  )
}
