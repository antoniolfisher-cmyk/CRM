import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import StatusBadge from '../components/StatusBadge'
import { formatDate, isOverdue } from '../utils'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getDashboard().then(setStats).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSkeleton />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Wholesale distribution follow-up overview</p>
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
          wide
        />
        <KpiCard
          label="Pipeline Value"
          value={`$${stats.total_order_value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub="active orders"
          color="green"
          icon={<DollarIcon />}
          wide
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Follow-Ups */}
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Upcoming Follow-Ups</h2>
            <Link to="/follow-ups" className="text-blue-600 text-sm hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-gray-50">
            {stats.upcoming_follow_ups.length === 0 && (
              <p className="px-5 py-8 text-center text-gray-400 text-sm">No upcoming follow-ups</p>
            )}
            {stats.upcoming_follow_ups.map((fu) => (
              <FollowUpRow key={fu.id} fu={fu} />
            ))}
          </div>
        </div>

        {/* Recently Completed */}
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Recently Completed</h2>
            <Link to="/follow-ups?status=completed" className="text-blue-600 text-sm hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-gray-50">
            {stats.recent_follow_ups.length === 0 && (
              <p className="px-5 py-8 text-center text-gray-400 text-sm">No completed follow-ups</p>
            )}
            {stats.recent_follow_ups.map((fu) => (
              <FollowUpRow key={fu.id} fu={fu} completed />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
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

function FollowUpRow({ fu, completed }) {
  const overdue = !completed && isOverdue(fu.due_date) && fu.status === 'pending'
  return (
    <div className="px-5 py-3 hover:bg-gray-50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{fu.subject}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {fu.account?.name}
            {fu.contact && ` · ${fu.contact.first_name} ${fu.contact.last_name}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <StatusBadge value={fu.follow_up_type} />
          <p className={`text-xs mt-1 ${overdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
            {completed ? `Done ${formatDate(fu.completed_date)}` : overdue ? `Overdue · ${formatDate(fu.due_date)}` : formatDate(fu.due_date)}
          </p>
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
      <div className="grid grid-cols-2 gap-6">
        <div className="h-64 bg-gray-200 rounded-xl" />
        <div className="h-64 bg-gray-200 rounded-xl" />
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
