const COLORS = {
  // Account status
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-gray-100 text-gray-600',
  prospect: 'bg-blue-100 text-blue-800',
  on_hold: 'bg-yellow-100 text-yellow-800',

  // Follow-up status
  pending: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-500',
  overdue: 'bg-red-100 text-red-800',

  // Priority
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-600',

  // Order status
  quote: 'bg-purple-100 text-purple-800',
  confirmed: 'bg-blue-100 text-blue-800',
  shipped: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-green-100 text-green-800',

  // Account type
  retailer: 'bg-slate-100 text-slate-700',
  distributor: 'bg-blue-100 text-blue-700',
  restaurant: 'bg-orange-100 text-orange-700',
  grocery: 'bg-green-100 text-green-700',
  online: 'bg-purple-100 text-purple-700',
  other: 'bg-gray-100 text-gray-600',
}

export default function StatusBadge({ value, label }) {
  const display = label || value?.replace('_', ' ')
  const color = COLORS[value] || 'bg-gray-100 text-gray-600'
  return (
    <span className={`badge ${color}`}>
      {display}
    </span>
  )
}
