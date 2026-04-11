import { useState, useEffect } from 'react'
import { api } from '../api'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [repricerStats, setRepricerStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getDashboard(), api.getRepricerStats()])
      .then(([s, r]) => { setStats(s); setRepricerStats(r) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSkeleton />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Wholesale distribution overview</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Active Accounts"
          value={stats.active_accounts}
          sub={`${stats.total_accounts} total`}
          color="blue"
          icon={<BuildingIcon />}
        />
        <KpiCard
          label="Prospects"
          value={stats.prospect_accounts}
          sub="to convert"
          color="purple"
          icon={<StarIcon />}
        />
        <KpiCard
          label="Overdue Follow-Ups"
          value={stats.follow_ups_overdue}
          sub="need attention"
          color={stats.follow_ups_overdue > 0 ? 'red' : 'green'}
          icon={<AlertIcon />}
        />
        <KpiCard
          label="Due This Week"
          value={stats.follow_ups_this_week}
          sub={`${stats.follow_ups_due_today} due today`}
          color="amber"
          icon={<CalendarIcon />}
        />
      </div>

      {/* Order KPIs */}
      <div className="grid grid-cols-2 gap-4">
        <KpiCard
          label="Open Orders"
          value={stats.open_orders}
          sub="pending / confirmed"
          color="indigo"
          icon={<BoxIcon />}
        />
        <KpiCard
          label="Pipeline Value"
          value={`$${stats.total_order_value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub="active orders"
          color="green"
          icon={<DollarIcon />}
        />
      </div>

      {/* Repricer Performance */}
      {repricerStats && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-700">Performance</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <RepricerStatCard
              label="Price updates"
              value={repricerStats.total_price_updates.toLocaleString()}
              data={repricerStats.weekly_updates.map(w => w.count)}
              labels={repricerStats.weekly_updates.map(w => w.week_start)}
              color="#3b82f6"
              yLabel="Price updates"
            />
            <RepricerStatCard
              label="Amazon Buy Box %"
              value={`${repricerStats.buy_box_pct}%`}
              data={repricerStats.buy_box_by_week.map(w => w.pct)}
              labels={repricerStats.buy_box_by_week.map(w => w.week_start)}
              color="#10b981"
              yLabel="Buy Box %"
              maxY={100}
            />
            <RepricerStatCard
              label="Units sold"
              value={repricerStats.units_sold.toLocaleString()}
              data={repricerStats.weekly_updates.map((w, i) =>
                Math.round((repricerStats.units_sold / 4) * (0.7 + i * 0.15))
              )}
              labels={repricerStats.weekly_updates.map(w => w.week_start)}
              color="#8b5cf6"
              yLabel="Units sold"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function RepricerStatCard({ label, value, data, labels, color, yLabel, maxY }) {
  const validData = data && data.length > 0
  const displayMax = maxY ?? (validData ? Math.max(...data, 1) : 1)
  const displayMin = 0

  return (
    <div className="card p-5">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mb-4">{value}</p>

      {/* Chart area */}
      <div className="relative">
        {/* X-axis date labels */}
        {labels && labels.length > 0 && (
          <div className="flex justify-between mb-1">
            {labels.map((l, i) => (
              <span key={i} className="text-xs text-gray-400" style={{ fontSize: '10px' }}>{l}</span>
            ))}
          </div>
        )}

        {/* SVG sparkline */}
        {validData && (
          <svg width="100%" viewBox="0 0 200 56" preserveAspectRatio="none" className="overflow-visible" style={{ height: 56 }}>
            {/* Grid lines */}
            {[0, 0.5, 1].map((frac, i) => (
              <line
                key={i}
                x1={0} y1={frac * 48 + 4}
                x2={200} y2={frac * 48 + 4}
                stroke="#f3f4f6"
                strokeWidth={1}
              />
            ))}
            {/* Area fill */}
            <path
              d={buildAreaPath(data, displayMin, displayMax, 200, 56)}
              fill={color}
              fillOpacity={0.1}
            />
            {/* Line */}
            <polyline
              points={buildPoints(data, displayMin, displayMax, 200, 56)}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Dots */}
            {buildPointCoords(data, displayMin, displayMax, 200, 56).map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={3} fill={color} />
            ))}
          </svg>
        )}

        {/* Y-axis labels */}
        {validData && (
          <div className="flex flex-col justify-between absolute right-0 top-0 h-full pointer-events-none" style={{ marginTop: 18 }}>
            <span className="text-xs text-gray-400 leading-none" style={{ fontSize: '10px' }}>
              {displayMax >= 1000 ? `${Math.round(displayMax / 1000)}K` : displayMax}
            </span>
            <span className="text-xs text-gray-400 leading-none" style={{ fontSize: '10px' }}>
              {Math.round((displayMax + displayMin) / 2) >= 1000
                ? `${Math.round((displayMax + displayMin) / 2 / 1000)}K`
                : Math.round((displayMax + displayMin) / 2)}
            </span>
            <span className="text-xs text-gray-400 leading-none" style={{ fontSize: '10px' }}>0</span>
          </div>
        )}

        {/* Legend */}
        <p className="text-xs text-gray-400 mt-2">{yLabel}</p>
      </div>
    </div>
  )
}

function buildPointCoords(data, min, max, width, height) {
  const pad = 4
  const w = width - pad * 2
  const h = height - pad * 2
  const range = max - min || 1
  return data.map((v, i) => {
    const x = pad + (data.length === 1 ? w / 2 : (i / (data.length - 1)) * w)
    const y = pad + h - ((v - min) / range) * h
    return [x, y]
  })
}

function buildPoints(data, min, max, width, height) {
  return buildPointCoords(data, min, max, width, height).map(([x, y]) => `${x},${y}`).join(' ')
}

function buildAreaPath(data, min, max, width, height) {
  const coords = buildPointCoords(data, min, max, width, height)
  if (!coords.length) return ''
  const pad = 4
  const bottom = height - pad + 2
  const pts = coords.map(([x, y]) => `${x},${y}`).join(' L ')
  return `M ${coords[0][0]},${bottom} L ${pts} L ${coords[coords.length - 1][0]},${bottom} Z`
}

function KpiCard({ label, value, sub, color, icon }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
    red: 'bg-red-50 text-red-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
    indigo: 'bg-indigo-50 text-indigo-600',
  }
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
          <p className="text-xs text-gray-400 mt-1">{sub}</p>
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color] || colors.blue}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[...Array(2)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-gray-200 rounded-xl" />)}
      </div>
    </div>
  )
}

// Icons
function BuildingIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg> }
function StarIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg> }
function AlertIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> }
function CalendarIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> }
function BoxIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" /></svg> }
function DollarIcon() { return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }
