import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { formatDate, fmtCurrency } from '../utils'

export default function Approvals() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    api.getProducts({ status: 'pending' })
      .then(setProducts)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleApprove = async (id, e) => {
    e.stopPropagation()
    setActionId(id)
    try {
      await api.approveProduct(id)
      setProducts(prev => prev.filter(p => p.id !== id))
    } catch (err) {
      alert(`Approve failed: ${err.message}`)
    } finally { setActionId(null) }
  }

  const handleReject = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Reject this product and send it back to Sourcing?')) return
    setActionId(id)
    try {
      await api.rejectProduct(id)
      setProducts(prev => prev.filter(p => p.id !== id))
    } catch (err) {
      alert(`Reject failed: ${err.message}`)
    } finally { setActionId(null) }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pending Approvals</h1>
        <p className="text-gray-500 text-sm mt-1">
          Products submitted by users — approve to move to Current Inventory, reject to send back to Sourcing
        </p>
      </div>

      {loading && <p className="text-gray-400 text-sm">Loading...</p>}

      {!loading && products.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-gray-400 text-lg font-medium">No pending approvals</p>
          <p className="text-gray-300 text-sm mt-1">Products submitted from the Sourcing page will appear here</p>
        </div>
      )}

      {!loading && products.length > 0 && (
        <div className="space-y-3">
          {products.map(p => {
            const busy = actionId === p.id
            const roi = Number(p.roi)
            const profit = Number(p.profit)
            return (
              <div key={p.id} className="card p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-gray-900 text-base">{p.product_name}</h2>
                    <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
                      {p.asin && (
                        <span className="font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{p.asin}</span>
                      )}
                      {p.va_finder && (
                        <span className="text-gray-500">Sourced by: <span className="font-medium">{p.va_finder}</span></span>
                      )}
                      {p.date_found && (
                        <span className="text-gray-400">Found: {formatDate(p.date_found)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={(e) => handleApprove(p.id, e)}
                      disabled={busy}
                      className="btn-primary text-sm px-4 disabled:opacity-50"
                    >
                      {busy ? '...' : '✓ Approve'}
                    </button>
                    <button
                      onClick={(e) => handleReject(p.id, e)}
                      disabled={busy}
                      className="btn-secondary text-sm px-4 disabled:opacity-50"
                    >
                      ✗ Reject
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100 text-sm">
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Buy Cost</p>
                    <p className="font-medium">{fmtCurrency(p.buy_cost)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Buy Box</p>
                    <p className="font-medium text-green-700">{p.buy_box ? fmtCurrency(p.buy_box) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">ROI</p>
                    <p className={`font-medium ${roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {p.roi ? `${(roi * 100).toFixed(1)}%` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Profit / unit</p>
                    <p className={`font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {p.profit ? fmtCurrency(profit) : '—'}
                    </p>
                  </div>
                  {p.amazon_fee > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Amazon Fee</p>
                      <p className="font-medium">{fmtCurrency(p.amazon_fee)}</p>
                    </div>
                  )}
                  {p.num_sellers > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5"># Sellers</p>
                      <p className="font-medium">{p.num_sellers}</p>
                    </div>
                  )}
                  {p.amazon_url && (
                    <div className="col-span-2">
                      <a
                        href={p.amazon_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 underline"
                      >
                        View on Amazon →
                      </a>
                    </div>
                  )}
                  {p.notes && (
                    <div className="col-span-4">
                      <p className="text-xs text-gray-400 mb-0.5">Notes</p>
                      <p className="text-gray-600">{p.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
