import { format, isAfter, isBefore, parseISO, startOfDay } from 'date-fns'

export function formatDate(dateStr, fmt = 'MMM d, yyyy') {
  if (!dateStr) return '—'
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr
    return format(d, fmt)
  } catch {
    return '—'
  }
}

export function formatDateTime(dateStr) {
  return formatDate(dateStr, 'MMM d, yyyy h:mm a')
}

export function isOverdue(dateStr) {
  if (!dateStr) return false
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr
    return isBefore(d, startOfDay(new Date()))
  } catch {
    return false
  }
}

export function toLocalInputDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr
    return format(d, "yyyy-MM-dd'T'HH:mm")
  } catch {
    return ''
  }
}

export function fmtCurrency(val) {
  return `$${Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
