import { useState, useRef, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { api } from '../api'

const HAS_DETECTOR = typeof window !== 'undefined' && 'BarcodeDetector' in window

export default function UpcScanner() {
  const [tab, setTab] = useState('single')

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">UPC Scanner</h1>
        <p className="text-gray-500 text-sm mt-0.5">Look up products by barcode · import a spreadsheet for bulk analysis</p>
      </div>

      <div className="flex border-b border-gray-200">
        {[['single', 'Single Scan'], ['bulk', 'Bulk Import']].map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'single' ? <SingleScan /> : <BulkImport />}
    </div>
  )
}

// ─── Single Scan ──────────────────────────────────────────────────────────────

function SingleScan() {
  const [upc, setUpc] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [cameraOpen, setCameraOpen] = useState(false)

  const lookup = useCallback(async (code) => {
    const c = (code ?? upc).trim()
    if (!c) return
    setLoading(true)
    setError(null)
    setResults(null)
    try {
      const data = await api.keepaUpcLookup(c)
      setResults(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [upc])

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Enter UPC, EAN, or ASIN…"
          value={upc}
          onChange={e => setUpc(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && lookup()}
        />
        <button
          onClick={() => lookup()}
          disabled={!upc.trim() || loading}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Looking up…' : 'Lookup'}
        </button>
        {HAS_DETECTOR && (
          <button
            onClick={() => setCameraOpen(true)}
            className="btn-secondary flex items-center gap-1.5"
          >
            <CameraIcon className="w-4 h-4" /> Scan
          </button>
        )}
      </div>

      {cameraOpen && (
        <CameraScanner
          onDetect={(code) => {
            setCameraOpen(false)
            setUpc(code)
            lookup(code)
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {results?.products?.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-sm">No products found for that code.</div>
      )}

      {results?.products?.map((p, i) => (
        <ProductCard key={i} product={p} />
      ))}

      {results?.tokens_left != null && (
        <p className="text-xs text-gray-400 text-right">Keepa tokens remaining: {results.tokens_left.toLocaleString()}</p>
      )}
    </div>
  )
}

// ─── Camera Scanner ───────────────────────────────────────────────────────────

function CameraScanner({ onDetect, onClose }) {
  const videoRef = useRef(null)
  const rafRef   = useRef(null)
  const streamRef = useRef(null)
  const [status, setStatus] = useState('starting')

  useEffect(() => {
    let active = true
    let detector

    async function start() {
      try {
        detector = new BarcodeDetector({
          formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128', 'code_39'],
        })
      } catch {
        setStatus('unsupported')
        return
      }

      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      } catch {
        setStatus('denied')
        return
      }

      if (!active) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setStatus('scanning')

      async function scan() {
        if (!active) return
        try {
          const codes = await detector.detect(videoRef.current)
          if (codes.length > 0) { onDetect(codes[0].rawValue); return }
        } catch {}
        rafRef.current = requestAnimationFrame(scan)
      }
      scan()
    }

    start()
    return () => {
      active = false
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [onDetect])

  const messages = {
    starting:     'Starting camera…',
    scanning:     'Point at a barcode — it will scan automatically',
    unsupported:  'Barcode detection is not supported in this browser. Use Chrome or Edge.',
    denied:       'Camera access was denied. Please allow camera access and try again.',
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl overflow-hidden shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <p className="font-medium text-sm text-gray-800">Barcode Scanner</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        {status === 'scanning' ? (
          <div className="relative bg-black aspect-video">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-3/4 h-16 border-2 border-blue-400 rounded-lg opacity-80 shadow-[0_0_0_9999px_rgba(0,0,0,0.3)]" />
            </div>
          </div>
        ) : (
          <div className="aspect-video bg-gray-100 flex items-center justify-center">
            <video ref={videoRef} className="hidden" playsInline muted />
          </div>
        )}

        <div className="px-4 py-3 text-center text-xs text-gray-500">{messages[status]}</div>
      </div>
    </div>
  )
}

// ─── Product Card ─────────────────────────────────────────────────────────────

function ProductCard({ product: p }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 text-sm leading-snug">{p.title || '(no title)'}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
              <span className="text-xs text-gray-500">ASIN: <span className="font-mono text-gray-700">{p.asin}</span></span>
              {p.category && <span className="text-xs text-gray-500">{p.category}</span>}
              {p.bsr != null && <span className="text-xs text-gray-500">BSR #{p.bsr.toLocaleString()}</span>}
            </div>
          </div>
          <a
            href={p.amazon_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-600 hover:underline shrink-0 mt-0.5"
          >
            View on Amazon ↗
          </a>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Stat label="Buy Box"   value={p.buy_box     ? `$${p.buy_box}`        : '—'} />
          <Stat label="90d High"  value={p.price_90_high  ? `$${p.price_90_high}` : '—'} color="green" />
          <Stat label="90d Median" value={p.median_price  ? `$${p.median_price}`  : '—'} color="violet" />
          <Stat label="90d Low"   value={p.price_90_low   ? `$${p.price_90_low}`  : '—'} color="red" />
          {p.num_fba_sellers != null ? (
            <Stat label="FBA / FBM" value={`${p.num_fba_sellers} / ${p.num_fbm_sellers}`} />
          ) : (
            <Stat label="Sellers" value="—" />
          )}
        </div>
      </div>

      {p.keepa_chart_url && (
        <div className="px-5 pb-5">
          <p className="text-xs text-gray-400 mb-2">90-Day Price History</p>
          <img
            src={p.keepa_chart_url}
            alt="Keepa price history"
            className="w-full rounded-lg border border-gray-100"
            onError={e => { e.target.style.display = 'none' }}
          />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }) {
  const cls = { green: 'text-green-600', red: 'text-red-500', violet: 'text-violet-600' }
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 ${cls[color] || 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

// ─── Bulk Import ──────────────────────────────────────────────────────────────

function BulkImport() {
  const [headers, setHeaders]     = useState([])
  const [rows, setRows]           = useState([])
  const [upcCol, setUpcCol]       = useState('')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress]   = useState({ done: 0, total: 0 })
  const [results, setResults]     = useState([])
  const [dragOver, setDragOver]   = useState(false)
  const fileRef = useRef(null)
  const abortRef = useRef(false)

  const loadFile = (file) => {
    const ext = file.name.split('.').pop().toLowerCase()

    if (ext === 'csv' || ext === 'txt') {
      const reader = new FileReader()
      reader.onload = (e) => {
        const lines = e.target.result.split(/\r?\n/).filter(l => l.trim())
        if (!lines.length) return
        const hdrs = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
        const data = lines.slice(1).map(line => {
          const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
          return Object.fromEntries(hdrs.map((h, i) => [h, vals[i] ?? '']))
        }).filter(r => Object.values(r).some(Boolean))
        applyData(hdrs, data)
      }
      reader.readAsText(file)
    } else if (['xlsx', 'xls', 'ods'].includes(ext)) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' })
        if (!data.length) return
        const hdrs = Object.keys(data[0])
        applyData(hdrs, data)
      }
      reader.readAsArrayBuffer(file)
    } else {
      alert('Unsupported file type. Please use CSV, XLS, or XLSX.')
    }
  }

  const applyData = (hdrs, data) => {
    setHeaders(hdrs)
    setRows(data)
    setResults([])
    const auto = hdrs.find(h => /upc|ean|barcode|code/i.test(h)) || hdrs[0] || ''
    setUpcCol(auto)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  }

  const reset = () => {
    abortRef.current = true
    setRows([])
    setHeaders([])
    setResults([])
    setProgress({ done: 0, total: 0 })
    setProcessing(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const process = async () => {
    if (!upcCol || !rows.length) return
    const upcs = [...new Set(
      rows.map(r => String(r[upcCol] ?? '').trim()).filter(Boolean)
    )]
    abortRef.current = false
    setProcessing(true)
    setProgress({ done: 0, total: upcs.length })
    setResults([])

    const out = []
    for (let i = 0; i < upcs.length; i++) {
      if (abortRef.current) break
      const code = upcs[i]
      try {
        const data = await api.keepaUpcLookup(code)
        const prods = data.products || []
        if (prods.length) {
          prods.forEach(p => out.push({ upc: code, ...p, _ok: true }))
        } else {
          out.push({ upc: code, title: '', _ok: false, _msg: 'Not found' })
        }
      } catch (e) {
        out.push({ upc: code, title: '', _ok: false, _msg: e.message })
      }
      setProgress({ done: i + 1, total: upcs.length })
      setResults([...out])
      if (i < upcs.length - 1) await new Promise(r => setTimeout(r, 500))
    }
    setProcessing(false)
  }

  const exportCsv = () => {
    const cols = ['upc','asin','title','buy_box','price_90_high','median_price','price_90_low','num_fba_sellers','num_fbm_sellers','bsr','category','amazon_url']
    const header = cols.join(',')
    const csvRows = results.map(r =>
      cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(',')
    )
    const blob = new Blob([[header, ...csvRows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `upc_scan_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  if (!rows.length) {
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-14 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50 hover:bg-white'
        }`}
      >
        <UploadIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-600">Drop your file here or click to browse</p>
        <p className="text-xs text-gray-400 mt-1.5">CSV, XLS, XLSX — one UPC / EAN per row</p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,.ods,.txt"
          className="hidden"
          onChange={e => { const f = e.target.files[0]; if (f) loadFile(f) }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Column picker */}
      {!processing && results.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-sm text-gray-900">{rows.length} rows loaded</p>
              <p className="text-xs text-gray-500 mt-0.5">Select which column contains UPC / EAN codes, then start</p>
            </div>
            <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600 shrink-0">Change file</button>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <select value={upcCol} onChange={e => setUpcCol(e.target.value)} className="input max-w-xs">
              {headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <button onClick={process} disabled={!upcCol} className="btn-primary disabled:opacity-50">
              Process {rows.length} rows
            </button>
          </div>

          {/* Preview table */}
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="text-xs w-full">
              <thead className="bg-gray-50">
                <tr>
                  {headers.slice(0, 6).map(h => (
                    <th key={h} className={`px-3 py-2 text-left font-medium whitespace-nowrap ${h === upcCol ? 'text-blue-600 bg-blue-50' : 'text-gray-500'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 4).map((r, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    {headers.slice(0, 6).map(h => (
                      <td key={h} className={`px-3 py-2 text-gray-700 ${h === upcCol ? 'font-medium text-blue-700 bg-blue-50/40' : ''}`}>{r[h]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {(processing || results.length > 0) && progress.total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">
              {processing ? `Processing… ${progress.done} / ${progress.total}` : `Done — ${progress.done} / ${progress.total} processed`}
            </p>
            <span className="text-sm text-gray-500">{pct}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          {processing && (
            <button onClick={() => { abortRef.current = true; setProcessing(false) }} className="mt-3 text-xs text-red-500 hover:text-red-700">
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Results table */}
      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
            <p className="font-medium text-sm text-gray-900">{results.length} results</p>
            <div className="flex gap-3">
              {!processing && (
                <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600">New import</button>
              )}
              <button onClick={exportCsv} className="btn-secondary text-xs py-1 px-3">Export CSV</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['UPC','ASIN','Title','Buy Box','90d High','90d Med','90d Low','FBA','FBM','BSR',''].map((h, i) => (
                    <th key={i} className="px-3 py-2.5 text-left text-gray-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className={`border-t border-gray-50 hover:bg-gray-50/50 ${!r._ok ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2.5 font-mono text-gray-600 whitespace-nowrap">{r.upc}</td>
                    <td className="px-3 py-2.5 font-mono text-gray-700 whitespace-nowrap">{r.asin || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-700 max-w-[180px] truncate" title={r.title}>
                      {r._ok ? (r.title || '—') : <span className="italic text-gray-400">{r._msg}</span>}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{r.buy_box ? `$${r.buy_box}` : '—'}</td>
                    <td className="px-3 py-2.5 font-medium text-green-600 whitespace-nowrap">{r.price_90_high ? `$${r.price_90_high}` : '—'}</td>
                    <td className="px-3 py-2.5 font-medium text-violet-600 whitespace-nowrap">{r.median_price ? `$${r.median_price}` : '—'}</td>
                    <td className="px-3 py-2.5 font-medium text-red-500 whitespace-nowrap">{r.price_90_low ? `$${r.price_90_low}` : '—'}</td>
                    <td className="px-3 py-2.5 text-gray-700">{r.num_fba_sellers ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-700">{r.num_fbm_sellers ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{r.bsr ? `#${r.bsr.toLocaleString()}` : '—'}</td>
                    <td className="px-3 py-2.5">
                      {r.amazon_url && (
                        <a href={r.amazon_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline whitespace-nowrap">
                          View ↗
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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

function UploadIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  )
}
