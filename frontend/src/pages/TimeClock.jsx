import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

export default function TimeClock() {
  const [status, setStatus] = useState(null)   // { clocked_in, clock_in, entry_id }
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [msg, setMsg] = useState('')
  const [elapsed, setElapsed] = useState('')
  const [notes, setNotes] = useState('')
  const timerRef = useRef(null)

  const loadStatus = async () => {
    try {
      const s = await api.timeclockStatus()
      setStatus(s)
      return s
    } catch { return null }
  }

  const loadEntries = async () => {
    try {
      const e = await api.timeclockMyEntries()
      setEntries(e)
    } catch {}
  }

  useEffect(() => {
    Promise.all([loadStatus(), loadEntries()]).finally(() => setLoading(false))
  }, [])

  // Live elapsed timer while clocked in
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (status?.clocked_in && status.clock_in) {
      const tick = () => {
        const diff = Date.now() - new Date(status.clock_in + 'Z').getTime()
        const h = Math.floor(diff / 3600000)
        const m = Math.floor((diff % 3600000) / 60000)
        const s = Math.floor((diff % 60000) / 1000)
        setElapsed(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
      }
      tick()
      timerRef.current = setInterval(tick, 1000)
    } else {
      setElapsed('')
    }
    return () => clearInterval(timerRef.current)
  }, [status])

  const handleClockIn = async () => {
    setWorking(true); setMsg('')
    try {
      await api.timeclockIn()
      setMsg('Clocked in successfully.')
      await loadStatus()
      await loadEntries()
    } catch (e) { setMsg(`Error: ${e.message}`) }
    finally { setWorking(false) }
  }

  const handleClockOut = async () => {
    setWorking(true); setMsg('')
    try {
      const res = await api.timeclockOut(notes)
      setMsg(`Clocked out. You worked ${res.hours} hours (${res.duration_minutes} min).`)
      setNotes('')
      await loadStatus()
      await loadEntries()
    } catch (e) { setMsg(`Error: ${e.message}`) }
    finally { setWorking(false) }
  }

  const fmtTime = (iso) => {
    if (!iso) return '—'
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const fmtDate = (iso) => {
    if (!iso) return '—'
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const fmtDuration = (mins) => {
    if (mins == null) return <span className="text-amber-600 text-xs font-medium">In progress</span>
    const h = Math.floor(mins / 60)
    const m = Math.round(mins % 60)
    return `${h}h ${m}m`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400 text-sm">Loading...</div>
    )
  }

  const clockedIn = status?.clocked_in

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Time Clock</h1>
        <p className="text-gray-500 text-sm mt-1">Track your work hours for payroll</p>
      </div>

      {/* ── Clock In/Out Card ── */}
      <div className="card p-6 text-center space-y-4">
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold ${
          clockedIn ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          <span className={`w-2 h-2 rounded-full ${clockedIn ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
          {clockedIn ? 'Currently Clocked In' : 'Not Clocked In'}
        </div>

        {clockedIn && (
          <div className="space-y-1">
            <div className="text-5xl font-mono font-bold text-gray-800 tracking-tight">{elapsed}</div>
            <p className="text-sm text-gray-400">
              Started at {fmtTime(status.clock_in)} · {fmtDate(status.clock_in)}
            </p>
          </div>
        )}

        {!clockedIn && (
          <div className="py-4">
            <p className="text-gray-400 text-sm">Click the button below to start tracking your time.</p>
          </div>
        )}

        {clockedIn && (
          <div>
            <label className="label text-left block mb-1">Notes (optional)</label>
            <input
              className="input text-sm"
              placeholder="What did you work on?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        )}

        <div className="flex justify-center">
          {clockedIn ? (
            <button
              onClick={handleClockOut}
              disabled={working}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-xl text-base transition-colors flex items-center gap-2"
            >
              <StopIcon />
              {working ? 'Clocking Out...' : 'Clock Out'}
            </button>
          ) : (
            <button
              onClick={handleClockIn}
              disabled={working}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-xl text-base transition-colors flex items-center gap-2"
            >
              <PlayIcon />
              {working ? 'Clocking In...' : 'Clock In'}
            </button>
          )}
        </div>

        {msg && (
          <p className={`text-sm font-medium ${msg.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>
            {msg}
          </p>
        )}
      </div>

      {/* ── Recent Entries ── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Entries</h2>
        </div>
        {entries.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 text-sm">No time entries yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Date</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Clock In</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Clock Out</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Duration</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-700 font-medium">{fmtDate(e.clock_in)}</td>
                  <td className="px-5 py-3 text-gray-600">{fmtTime(e.clock_in)}</td>
                  <td className="px-5 py-3 text-gray-600">{e.clock_out ? fmtTime(e.clock_out) : <span className="text-green-600 text-xs font-medium">In progress</span>}</td>
                  <td className="px-5 py-3">{fmtDuration(e.duration_minutes)}</td>
                  <td className="px-5 py-3 text-gray-400 text-xs">{e.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function PlayIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />
    </svg>
  )
}
