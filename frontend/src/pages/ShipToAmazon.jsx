/**
 * FBA Inbound — create shipment page.
 * Two modes: Create FBA Shipment | Create FBM Listing
 */
import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]
const CONDITIONS = [
  { value: 'NewItem',          label: 'New' },
  { value: 'UsedLikeNew',      label: 'Used – Like New' },
  { value: 'UsedVeryGood',     label: 'Used – Very Good' },
  { value: 'UsedGood',         label: 'Used – Good' },
  { value: 'UsedAcceptable',   label: 'Used – Acceptable' },
]
const SHIP_METHODS = [
  { value: 'spd',             label: 'SPD (Small Parcel Delivery)' },
  { value: 'partnered_ups',   label: 'Amazon Partnered Carrier (UPS)' },
  { value: 'non_partnered',   label: 'Non-Partnered Carrier' },
  { value: 'ltl',             label: 'LTL (Less Than Truckload)' },
]
const LABEL_PREPS = [
  { value: 'SELLER_LABEL',       label: 'Seller Labels (I will label)' },
  { value: 'AMAZON_LABEL_ONLY',  label: 'Amazon Labels (fee applies)' },
  { value: 'NO_LABEL',           label: 'No Label Required' },
]
const BOX_CONTENTS = [
  { value: 'INDIVIDUAL_ITEMS', label: 'Individual Items' },
  { value: 'CASE_PACKED',      label: 'Case Packed' },
]

const PRICE_MATCH_BASIS = [
  { value: 'buy_box',     label: 'Buy Box' },
  { value: 'lowest_fba',  label: 'Lowest FBA' },
  { value: 'lowest_fbm',  label: 'Lowest FBM' },
]
const PRICE_DIRECTION = [
  { value: 'increase', label: 'Increase' },
  { value: 'decrease', label: 'Decrease' },
  { value: 'match',    label: 'Match' },
]

function nowLabel() {
  return new Date().toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
}
const fmt$ = (v) => (v != null && v !== '') ? `$${Number(v).toFixed(2)}` : '—'

// ─────────────────────────────────────────────────────────────────────────────
export default function ShipToAmazon() {
  const [mode, setMode] = useState('fba') // 'fba' | 'listings' | 'fbm'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">FBA Inbound</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Send inventory to Amazon FBA or create Merchant Fulfilled listings.
          </p>
        </div>
      </div>

      {/* Mode tabs */}
      <div className="flex border-b border-gray-200">
        {[
          { key: 'fba',      label: 'Create FBA Shipment' },
          { key: 'listings', label: 'Create FBA Listings' },
          { key: 'fbm',      label: 'Create FBM Listing' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              mode === key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'fba'      && <FBAShipmentForm />}
      {mode === 'listings' && <FBAListingsForm />}
      {mode === 'fbm'      && <FBMListingForm />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FBA SHIPMENT
// ─────────────────────────────────────────────────────────────────────────────
function FBAShipmentForm() {
  // 'pick' → 'placement' → 'done'
  const [stage, setStage] = useState('pick')

  const [addrForm, setAddrForm]       = useState({ name:'', line1:'', line2:'', city:'', state:'FL', zip:'', country:'US' })
  const [editingAddr, setEditingAddr] = useState(false)
  const [addrLoading, setAddrLoading] = useState(true)
  const [addrError, setAddrError]     = useState('')

  const [inventory, setInventory]     = useState([])
  const [invLoading, setInvLoading]   = useState(true)
  const [search, setSearch]           = useState('')
  const [shipment, setShipment]       = useState([])
  const [shipmentName, setShipmentName] = useState(nowLabel)
  const [labelPrep, setLabelPrep]     = useState('SELLER_LABEL')
  const [shipMethod, setShipMethod]   = useState('spd')

  const [plans, setPlans]             = useState([])
  const [selectedPlan, setSelectedPlan] = useState(0)
  const [shipmentRecord, setShipmentRecord] = useState(null)
  const [labelUrl, setLabelUrl]       = useState('')
  const [readyDate, setReadyDate]     = useState(() => new Date().toISOString().slice(0,10))

  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')

  useEffect(() => {
    setAddrLoading(true)
    Promise.all([
      api.getAmazonCredentials().catch(() => null),
      api.getShipFrom().catch(() => null),
    ]).then(([c, sf]) => {
      const addr = sf || c?.ship_from
      if (addr) {
        setAddrForm({
          name:    addr.name || c?.store_name || '',
          line1:   addr.addressLine1 || addr.addressLine2 || '',
          line2:   addr.addressLine1 ? (addr.addressLine2 || '') : '',
          city:    addr.city || '',
          state:   addr.stateOrProvinceCode || 'FL',
          zip:     addr.postalCode || '',
          country: addr.countryCode || 'US',
        })
      } else if (c?.store_name) {
        setAddrForm(a => ({ ...a, name: c.store_name }))
        setEditingAddr(true)
      }
    }).finally(() => setAddrLoading(false))

    setInvLoading(true)
    api.getProducts({ limit: 500 })
      .then(d => setInventory(Array.isArray(d) ? d : (d?.items || [])))
      .catch(() => {})
      .finally(() => setInvLoading(false))
  }, [])

  const shipFromFilled = (addrForm.line1 || addrForm.line2) && addrForm.city && addrForm.zip

  async function handleSaveAddress() {
    const addr1 = addrForm.line1.trim() || addrForm.line2.trim()
    if (!addr1 || !addrForm.city.trim() || !addrForm.zip.trim()) {
      setAddrError('Please fill in Address, City, and ZIP.'); return
    }
    const payload = {
      name: addrForm.name,
      addressLine1: addr1,
      ...(addrForm.line2.trim() && addr1 !== addrForm.line2.trim() ? { addressLine2: addrForm.line2 } : {}),
      city: addrForm.city, stateOrProvinceCode: addrForm.state,
      postalCode: addrForm.zip, countryCode: addrForm.country,
    }
    try {
      await api.saveShipFrom(payload)
      setAddrError(''); setEditingAddr(false)
    } catch (e) { setAddrError(e.message || 'Failed to save address.') }
  }

  const filteredInv = inventory.filter(p => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (p.product_name||'').toLowerCase().includes(q) ||
           (p.asin||'').toLowerCase().includes(q) ||
           (p.seller_sku||'').toLowerCase().includes(q)
  })

  const inShipment = asin => shipment.some(s => s.product.asin === asin)

  function addToShipment(product) {
    if (inShipment(product.asin)) return
    setShipment(prev => [...prev, { product, qty: 1, condition: 'NewItem', fees: null }])
    api.fbaFees(product.asin, product.buy_box || product.aria_live_price || 19.99)
      .then(f => setShipment(prev => prev.map(s => s.product.asin === product.asin ? {...s, fees: f} : s)))
      .catch(() => {})
  }
  function removeFromShipment(asin) { setShipment(prev => prev.filter(s => s.product.asin !== asin)) }
  function updateQty(asin, val) { setShipment(prev => prev.map(s => s.product.asin === asin ? {...s, qty: Math.max(1, val)} : s)) }

  const totalUnits  = shipment.reduce((sum, s) => sum + (s.qty || 1), 0)
  const totalProfit = shipment.reduce((sum, s) => sum + ((s.fees?.net_proceeds || 0) - (s.product.buy_cost || 0)) * (s.qty || 1), 0)

  // Build address in the format fba_shipping.py expects
  function buildFrom() {
    return {
      name:        addrForm.name,
      address1:    addrForm.line1 || addrForm.line2,
      ...(addrForm.line2 && addrForm.line1 ? { address2: addrForm.line2 } : {}),
      city:        addrForm.city,
      state:       addrForm.state,
      postal_code: addrForm.zip,
      country:     addrForm.country,
    }
  }

  async function handleCreateShipment() {
    if (!shipFromFilled) { setError('Set your ship-from address first.'); return }
    if (!shipment.length) { setError('Add at least one product to your shipment.'); return }
    setError(''); setLoading(true)
    const items = shipment.map(s => ({ sku: s.product.seller_sku || s.product.asin, asin: s.product.asin, qty: s.qty, condition: s.condition }))
    try {
      const result = await api.fbaPlan(items, buildFrom(), labelPrep)
      setPlans(Array.isArray(result) ? result : [result])
      setSelectedPlan(0); setStage('placement')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function handleConfirmShipment() {
    const thePlan = plans[selectedPlan]
    if (!thePlan) { setError('Select a placement option.'); return }
    setError(''); setLoading(true)
    const from = buildFrom()
    const items = shipment.map(s => ({ sku: s.product.seller_sku || s.product.asin, asin: s.product.asin, qty: s.qty, condition: s.condition }))
    const p0 = shipment[0]
    try {
      const rec = await api.fbaCreateShipment({
        plan: thePlan, shipment_name: shipmentName, from_address: from, items,
        asin: p0.product.asin, seller_sku: p0.product.seller_sku || p0.product.asin,
        title: p0.product.product_name, quantity: totalUnits,
        referral_fee: p0.fees?.referral_fee, fba_fee: p0.fees?.fba_fee,
      })
      setShipmentRecord(rec); setStage('done')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  function resetAll() {
    setStage('pick'); setShipment([]); setPlans([]); setShipmentRecord(null)
    setLabelUrl(''); setError(''); setShipmentName(nowLabel())
  }

  const addrDisplay = shipFromFilled
    ? `${addrForm.name ? addrForm.name + ' · ' : ''}${addrForm.line1 || addrForm.line2}, ${addrForm.city} ${addrForm.state} ${addrForm.zip}`
    : null

  const addrModal = editingAddr && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Ship From Address</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name / Company</label>
            <input className={inp} value={addrForm.name} onChange={e => setAddrForm(a => ({...a, name: e.target.value}))} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Address Line 1</label>
            <input className={inp} value={addrForm.line1} onChange={e => setAddrForm(a => ({...a, line1: e.target.value}))} autoFocus />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Address Line 2 (optional)</label>
            <input className={inp} value={addrForm.line2} onChange={e => setAddrForm(a => ({...a, line2: e.target.value}))} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">City</label>
              <input className={inp} value={addrForm.city} onChange={e => setAddrForm(a => ({...a, city: e.target.value}))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">State</label>
              <select className={inp} value={addrForm.state} onChange={e => setAddrForm(a => ({...a, state: e.target.value}))}>
                {US_STATES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">ZIP</label>
              <input className={inp} value={addrForm.zip} onChange={e => setAddrForm(a => ({...a, zip: e.target.value}))} />
            </div>
          </div>
        </div>
        {addrError && <p className="text-red-600 text-xs mt-3">{addrError}</p>}
        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={() => { setEditingAddr(false); setAddrError('') }} className="btn-secondary text-sm px-4">Cancel</button>
          <button onClick={handleSaveAddress} className="btn-primary text-sm px-4">Save Address</button>
        </div>
      </div>
    </div>
  )

  // ── DONE ─────────────────────────────────────────────────────────────────
  if (stage === 'done') {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        {addrModal}
        <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-green-600 text-3xl">✓</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900">Shipment Created!</h2>
        <p className="text-gray-500 text-sm mt-2 mb-6">Your shipment has been submitted to Amazon FBA.</p>
        <div className="inline-block bg-gray-50 rounded-xl p-5 text-left space-y-2 text-sm mb-6 min-w-64">
          <InfoRow label="Amazon Shipment ID" value={shipmentRecord?.amazon_shipment_id} mono />
          <InfoRow label="Destination FC"     value={plans[selectedPlan]?.destination_fc} />
          <InfoRow label="Total Units"        value={totalUnits} />
        </div>
        <div className="flex gap-3 justify-center">
          {shipmentRecord && !labelUrl && (
            <button onClick={async () => { try { const r = await api.fbaGetLabels(shipmentRecord.id); setLabelUrl(r.label_url) } catch(_){} }}
              className="btn-secondary text-sm">Download Labels (PDF)</button>
          )}
          {labelUrl && <a href={labelUrl} target="_blank" rel="noreferrer" className="btn-secondary text-sm">Open Labels PDF</a>}
          <button onClick={resetAll} className="btn-primary text-sm">Create Another Shipment</button>
        </div>
      </div>
    )
  }

  // ── PLACEMENT OPTIONS ─────────────────────────────────────────────────────
  if (stage === 'placement') {
    const plan = plans[selectedPlan] || {}
    const shipTo    = plan.ship_to_address || {}
    const shipToStr = [shipTo.address1, shipTo.city, shipTo.state, shipTo.postal_code].filter(Boolean).join(', ')
    return (
      <div className="space-y-4">
        {addrModal}
        <button onClick={() => setStage('pick')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          ← Back to shipment
        </button>
        {error && <ErrorBanner msg={error} />}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 items-start">
          {/* Placement options */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="text-base font-semibold text-gray-900">Select Fulfillment Center</p>
              <p className="text-xs text-gray-400 mt-0.5">Amazon will route your shipment to the assigned fulfillment center based on your inventory.</p>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500">Ready to ship:</label>
                <input type="date" className="border border-gray-300 rounded px-2 py-1 text-xs" value={readyDate} onChange={e => setReadyDate(e.target.value)} />
              </div>
              {plans.map((p, i) => {
                const fc       = p.destination_fc || p.fulfillment_center_id || `FC ${i+1}`
                const labeling = p.estimated_fees?.labeling_fee  || 0
                const placement= p.estimated_fees?.placement_fee || 0
                const shipping = p.estimated_fees?.shipping_fee  || 0
                const total    = labeling + placement + shipping
                return (
                  <label key={i} className={`flex items-start gap-3 border-2 rounded-xl p-4 cursor-pointer transition-colors ${selectedPlan===i ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <input type="radio" name="plan" checked={selectedPlan===i} onChange={() => setSelectedPlan(i)} className="mt-0.5 accent-blue-600" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-900 text-sm">Shipment {i+1} — {fc}</span>
                        {p.expires_at && <span className="text-xs text-amber-600">Expires {new Date(p.expires_at).toLocaleDateString()}</span>}
                      </div>
                      {shipToStr && <p className="text-xs text-gray-500 mt-0.5">Ship to: {shipToStr}</p>}
                      <div className="mt-2 space-y-1 text-xs text-gray-600">
                        <div className="flex justify-between"><span>Prep &amp; labeling fees:</span><span>${labeling.toFixed(2)}</span></div>
                        <div className="flex justify-between"><span>Placement fees:</span><span>${placement.toFixed(2)}</span></div>
                        <div className="flex justify-between"><span>Estimated shipping:</span><span>${shipping.toFixed(2)}</span></div>
                      </div>
                      <div className="flex justify-between mt-2 pt-2 border-t border-gray-200 text-sm font-semibold">
                        <span>Total fees:</span><span>${total.toFixed(2)} USD</span>
                      </div>
                    </div>
                  </label>
                )
              })}
              {plans.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No placement options returned by Amazon.</p>}
            </div>
          </div>

          {/* Summary + confirm */}
          <div className="space-y-3">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-semibold text-gray-900 mb-3 pb-2 border-b border-gray-100">Shipment Summary</p>
              <div className="space-y-1.5 text-xs text-gray-600">
                <div className="flex gap-2"><span className="text-gray-400 w-20 shrink-0">Ship from:</span><span className="font-medium text-gray-800">{addrDisplay || '—'}</span></div>
                <div className="flex gap-2"><span className="text-gray-400 w-20 shrink-0">Ship to:</span><span className="font-medium text-gray-800">{shipToStr || (plan.destination_fc || '—')}</span></div>
              </div>
              <div className="flex gap-6 text-xs text-gray-600 pt-3 mt-3 border-t border-gray-100">
                <span><strong className="text-gray-900">{totalUnits}</strong> Units</span>
                <span><strong className="text-gray-900">{shipment.length}</strong> SKUs</span>
              </div>
              <div className="mt-3 space-y-1 text-xs text-gray-500">
                {shipment.map(s => (
                  <div key={s.product.asin} className="flex justify-between">
                    <span className="truncate max-w-44">{s.product.product_name || s.product.asin}</span>
                    <span className="font-semibold text-gray-700 ml-2">× {s.qty}</span>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={handleConfirmShipment}
              disabled={loading || !plans.length}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {loading && <SpinIcon className="w-4 h-4 animate-spin" />}
              Confirm &amp; Create Shipment
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── PICK PRODUCTS (main view) ─────────────────────────────────────────────
  return (
    <div className="space-y-0">
      {addrModal}
      {error && <div className="mb-3"><ErrorBanner msg={error} /></div>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] min-h-[520px] bg-white rounded-xl border border-gray-200 overflow-hidden">

        {/* Left: product picker */}
        <div className="border-r border-gray-100 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2">
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                className="flex-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
                placeholder="Search by product name, SKU, ASIN…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
              {search && <button onClick={() => setSearch('')} className="text-gray-400 text-lg">×</button>}
            </div>
          </div>

          {invLoading ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading inventory…</div>
          ) : filteredInv.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              {search ? 'No products match your search.' : 'No products found. Run an Amazon sync first.'}
            </div>
          ) : (
            <div className="divide-y divide-gray-100 overflow-y-auto flex-1">
              {filteredInv.map(p => {
                const already = inShipment(p.asin)
                return (
                  <div key={p.asin} className={`px-4 py-3 flex gap-3 transition-colors ${already ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                    {p.image_url
                      ? <img src={p.image_url} alt="" className="w-12 h-12 object-contain rounded border border-gray-100 bg-gray-50 shrink-0" />
                      : <div className="w-12 h-12 bg-gray-100 rounded shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 line-clamp-2 leading-snug">{p.product_name || p.asin}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-400">
                        <span className="font-mono text-gray-500">{p.asin}</span>
                        {p.seller_sku && <span>SKU: {p.seller_sku}</span>}
                        {p.keepa_category && <span>{p.keepa_category}</span>}
                        {p.keepa_bsr > 0 && <span>BSR #{p.keepa_bsr.toLocaleString()}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <button
                        onClick={() => already ? removeFromShipment(p.asin) : addToShipment(p)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-lg font-bold transition-colors ${already ? 'bg-blue-500 hover:bg-blue-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                      >
                        {already ? '✓' : '+'}
                      </button>
                      <span className="text-xs text-gray-400">{(p.quantity || 0)} in stock</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: shipment config */}
        <div className="flex flex-col">
          {/* Ship from */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Ship From</p>
              <button onClick={() => setEditingAddr(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                {shipFromFilled ? 'Edit' : 'Set address'}
              </button>
            </div>
            {addrLoading
              ? <p className="text-xs text-gray-400">Loading…</p>
              : addrDisplay
                ? <p className="text-xs text-gray-700 leading-relaxed">{addrDisplay}</p>
                : <p className="text-xs text-amber-600">⚠ Address required before creating shipment</p>
            }
          </div>

          {/* Shipment options */}
          <div className="px-4 py-3 border-b border-gray-100 space-y-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Shipment Name</label>
              <input className={inp} value={shipmentName} onChange={e => setShipmentName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Label Prep</label>
                <select className={inp} value={labelPrep} onChange={e => setLabelPrep(e.target.value)}>
                  {LABEL_PREPS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Ship Method</label>
                <select className={inp} value={shipMethod} onChange={e => setShipMethod(e.target.value)}>
                  {SHIP_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Cart */}
          <div className="flex-1 px-4 py-3 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Products in Shipment</p>
              {shipment.length > 0 && (
                <span className="text-xs text-gray-400">{totalUnits} unit{totalUnits !== 1 ? 's' : ''}</span>
              )}
            </div>
            {shipment.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-xs text-gray-400">Click <strong>+</strong> on a product to add it to your shipment.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shipment.map(s => (
                  <div key={s.product.asin} className="flex gap-2 items-start border border-gray-200 rounded-lg p-2">
                    {s.product.image_url
                      ? <img src={s.product.image_url} alt="" className="w-9 h-9 object-contain rounded shrink-0 mt-0.5" />
                      : <div className="w-9 h-9 bg-gray-100 rounded shrink-0 mt-0.5" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 line-clamp-2 leading-snug">{s.product.product_name || s.product.asin}</p>
                      <div className="flex items-center gap-1 mt-1.5">
                        <button onClick={() => updateQty(s.product.asin, s.qty - 1)}
                          className="w-5 h-5 border border-gray-300 rounded text-xs font-bold text-gray-600 flex items-center justify-center hover:bg-gray-50">−</button>
                        <span className="text-xs w-6 text-center font-semibold">{s.qty}</span>
                        <button onClick={() => updateQty(s.product.asin, s.qty + 1)}
                          className="w-5 h-5 border border-gray-300 rounded text-xs font-bold text-gray-600 flex items-center justify-center hover:bg-gray-50">+</button>
                        {s.fees?.net_proceeds != null && (
                          <span className="text-xs text-gray-400 ml-1">{fmt$(s.fees.net_proceeds)} net</span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => removeFromShipment(s.product.asin)} className="text-gray-300 hover:text-red-500 text-lg shrink-0 leading-none mt-0.5">×</button>
                  </div>
                ))}
                {totalProfit !== 0 && (
                  <div className="flex items-center justify-between pt-1 text-xs">
                    <span className="text-gray-500">Est. total profit:</span>
                    <span className={`font-semibold ${totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {totalProfit >= 0 ? '' : '-'}${Math.abs(totalProfit).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action */}
          <div className="px-4 py-3 border-t border-gray-100">
            <button
              onClick={handleCreateShipment}
              disabled={loading || !shipment.length}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {loading && <SpinIcon className="w-4 h-4 animate-spin" />}
              {loading ? 'Getting placement options…' : 'Create Shipment →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
// ─────────────────────────────────────────────────────────────────────────────
// FBM LISTING — Create a Merchant Fulfilled listing on Amazon
// ─────────────────────────────────────────────────────────────────────────────
function FBMListingForm() {
  const [asinInput, setAsinInput] = useState('')
  const [product, setProduct]     = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [success, setSuccess]     = useState('')

  // Listing fields
  const [sku, setSku]               = useState('')
  const [price, setPrice]           = useState('')
  const [qty, setQty]               = useState(1)
  const [condition, setCondition]   = useState('NewItem')
  const [handlingDays, setHandling] = useState('2')

  async function handleLookup() {
    const asin = asinInput.trim().toUpperCase()
    if (!asin) return
    setError(''); setLoading(true); setProduct(null)
    try {
      const p = await api.fbaLookup(asin)
      setProduct(p)
      setSku(`${asin}-FBM-${Date.now().toString().slice(-6)}`)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function handleCreate() {
    if (!product || !price || !sku) return
    setError(''); setLoading(true); setSuccess('')
    try {
      // Use Listings Items API to create FBM listing
      await api.fbaCreateFbmListing?.({
        asin: product.asin,
        sku, price: parseFloat(price), quantity: qty, condition,
        handling_days: parseInt(handlingDays),
      })
      setSuccess(`FBM listing created for ${product.asin} with SKU ${sku}`)
      setProduct(null); setAsinInput(''); setSku(''); setPrice('')
    } catch (e) { setError(e.message || 'Listing creation not yet configured — connect Amazon account first.') }
    finally { setLoading(false) }
  }

  return (
    <div className="max-w-2xl">
      {error   && <div className="mb-4"><ErrorBanner msg={error} /></div>}
      {success && <div className="mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">{success}</div>}

      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Create FBM Listing</h2>
          <p className="text-gray-500 text-xs mt-0.5">Create a Merchant Fulfilled listing — you ship directly to the customer.</p>
        </div>

        <Section title="Find Product">
          <div className="w-full space-y-3">
            <div className="flex gap-2">
              <input className={`${inp} flex-1`} placeholder="Enter ASIN"
                value={asinInput}
                onChange={e => setAsinInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleLookup()} />
              <button onClick={handleLookup} disabled={loading}
                className="btn-primary text-sm flex items-center gap-2 shrink-0">
                {loading && <SpinIcon className="w-3.5 h-3.5 animate-spin" />}
                Look Up
              </button>
            </div>
            {product && (
              <div className="flex gap-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
                {product.image_url && (
                  <img src={product.image_url} alt="" className="w-14 h-14 object-contain rounded border border-gray-100 bg-white shrink-0" />
                )}
                <div>
                  <p className="text-sm font-medium text-gray-900 line-clamp-2">{product.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{product.brand} · {product.asin}</p>
                </div>
              </div>
            )}
          </div>
        </Section>

        {product && (
          <>
            <Section title="Listing Details">
              <FormRow label="Seller SKU">
                <input className={inp} value={sku} onChange={e => setSku(e.target.value)} />
              </FormRow>
              <FormRow label="List Price ($)">
                <input type="number" min="0" step="0.01" className={inp} value={price} onChange={e => setPrice(e.target.value)} />
              </FormRow>
              <FormRow label="Quantity">
                <input type="number" min="1" className={inp} value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)} />
              </FormRow>
              <FormRow label="Condition">
                <select className={inp} value={condition} onChange={e => setCondition(e.target.value)}>
                  {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </FormRow>
              <FormRow label="Handling Days">
                <select className={inp} value={handlingDays} onChange={e => setHandling(e.target.value)}>
                  {['1','2','3','5','7','14'].map(d => <option key={d} value={d}>{d} day{d !== '1' ? 's' : ''}</option>)}
                </select>
              </FormRow>
            </Section>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button onClick={handleCreate} disabled={loading || !price || !sku}
                className="btn-primary flex items-center gap-2">
                {loading && <SpinIcon className="w-4 h-4 animate-spin" />}
                Create FBM Listing →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="border-t border-gray-100 first:border-t-0">
      <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</p>
      </div>
      <div className="px-6 py-4 space-y-4">{children}</div>
    </div>
  )
}

function SectionHeader({ title }) {
  return (
    <div className="-mx-6 px-6 py-2 bg-gray-50 border-y border-gray-100 mb-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</p>
    </div>
  )
}

function FormRow({ label, children }) {
  return (
    <div className="flex items-start gap-4">
      {label && (
        <label className="text-sm text-gray-600 font-medium w-36 shrink-0 pt-2">{label}</label>
      )}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function Toggle({ value, onChange, label }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none ${
          value ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          value ? 'translate-x-4' : 'translate-x-0'
        }`} />
      </button>
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}

function InfoRow({ label, value, mono, valueClass }) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-0.5">
      <dt className="text-gray-500 text-sm shrink-0">{label}</dt>
      <dd className={`text-sm text-right break-all ${mono ? 'font-mono text-gray-700' : 'text-gray-900'} ${valueClass || ''}`}>
        {value ?? '—'}
      </dd>
    </div>
  )
}

function ErrorBanner({ msg }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{msg}</div>
  )
}

function SpinIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function DownloadIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FBA LISTINGS — search inventory, set price/condition, submit to Amazon
// ─────────────────────────────────────────────────────────────────────────────
function FBAListingsForm() {
  const [step, setStep]         = useState(1) // 1=select, 2=review
  const [inventory, setInventory] = useState([])
  const [loadingInv, setLoadingInv] = useState(true)
  const [search, setSearch]     = useState('')
  const [selected, setSelected] = useState([]) // [{product, sku, price, condition}]
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults]   = useState(null)
  const [error, setError]       = useState('')

  useEffect(() => {
    api.getProducts({ limit: 500, status: 'approved' })
      .then(data => setInventory(Array.isArray(data) ? data : (data?.items || [])))
      .catch(e => setError(e.message))
      .finally(() => setLoadingInv(false))
  }, [])

  const filtered = inventory.filter(p => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (p.product_name || '').toLowerCase().includes(q) ||
           (p.asin  || '').toLowerCase().includes(q) ||
           (p.va_finder || '').toLowerCase().includes(q)
  })

  const isSelected = (asin) => selected.some(s => s.product.asin === asin)

  function toggleSelect(product) {
    if (isSelected(product.asin)) {
      setSelected(prev => prev.filter(s => s.product.asin !== product.asin))
    } else {
      setSelected(prev => [...prev, {
        product,
        sku:       product.seller_sku || `${product.asin}-FBA`,
        price:     product.aria_live_price || product.aria_suggested_price || '',
        condition: 'NewItem',
      }])
    }
  }

  function updateSelected(asin, field, val) {
    setSelected(prev => prev.map(s => s.product.asin === asin ? { ...s, [field]: val } : s))
  }

  async function handleSubmit() {
    const invalid = selected.filter(s => !s.price || !s.sku)
    if (invalid.length) { setError('All listings need a price and SKU.'); return }
    setError(''); setSubmitting(true)
    try {
      const res = await api.createFbaListings(
        selected.map(s => ({
          asin:      s.product.asin,
          sku:       s.sku,
          price:     parseFloat(s.price),
          condition: s.condition,
        }))
      )
      setResults(res.results)
    } catch (e) { setError(e.message) }
    finally { setSubmitting(false) }
  }

  // ── Results view ─────────────────────────────────────────────────────────
  if (results) {
    const ok  = results.filter(r => r.success)
    const bad = results.filter(r => !r.success)
    return (
      <div className="max-w-2xl space-y-4">
        <div className="card p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Submission Complete</h2>
          <p className="text-sm text-gray-500 mb-4">
            {ok.length} listing{ok.length !== 1 ? 's' : ''} submitted successfully
            {bad.length > 0 && `, ${bad.length} failed`}.
          </p>
          <div className="space-y-2">
            {results.map(r => (
              <div key={r.sku} className={`flex items-start gap-3 px-3 py-2 rounded-lg text-sm ${
                r.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
              }`}>
                <span className={`mt-0.5 font-bold ${r.success ? 'text-green-600' : 'text-red-500'}`}>
                  {r.success ? '✓' : '✗'}
                </span>
                <div>
                  <span className="font-mono text-xs text-gray-600">{r.asin}</span>
                  <span className="mx-2 text-gray-300">·</span>
                  <span className="text-gray-700">{r.sku}</span>
                  {r.success && r.status && (
                    <span className="ml-2 text-xs text-green-600">{r.status}</span>
                  )}
                  {!r.success && (
                    <p className="text-xs text-red-600 mt-0.5">{r.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => { setResults(null); setSelected([]); setStep(1) }}
            className="btn-secondary text-sm mt-4">
            Submit More Listings
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner msg={error} />}

      {/* Step header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {[
            { n: 1, label: 'Create FBA Listings' },
            { n: 2, label: 'Review FBA Listings' },
          ].map(({ n, label }, i) => (
            <div key={n} className="flex items-center gap-2">
              <button
                onClick={() => n < step ? setStep(n) : undefined}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  step === n ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === n ? 'bg-white text-blue-600' : 'bg-gray-300 text-gray-500'
                }`}>{n}</span>
                {label}
              </button>
              {i === 0 && <span className="text-gray-300">→</span>}
            </div>
          ))}
        </div>

        {step === 1 && (
          <button
            onClick={() => { if (!selected.length) { setError('Select at least one product.'); return } setError(''); setStep(2) }}
            className="btn-primary text-sm"
          >
            Review ({selected.length}) →
          </button>
        )}
        {step === 2 && (
          <button onClick={handleSubmit} disabled={submitting}
            className="btn-primary text-sm flex items-center gap-2">
            {submitting && <SpinIcon className="w-4 h-4 animate-spin" />}
            Submit FBA Listings
          </button>
        )}
      </div>

      {/* ── STEP 1: Select products ── */}
      {step === 1 && (
        <div className="card overflow-hidden">
          {/* Search bar */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              className="flex-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none bg-transparent"
              placeholder="Search by typing a search query above."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            )}
          </div>

          {/* Stats bar */}
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-3 text-xs text-gray-500">
            <span className="font-semibold text-gray-700">{inventory.length}</span> products in inventory
            {selected.length > 0 && (
              <span className="ml-auto text-blue-600 font-medium">{selected.length} selected</span>
            )}
          </div>

          {/* Product list */}
          {loadingInv ? (
            <div className="px-4 py-10 text-center text-gray-400 text-sm">Loading inventory…</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-gray-400 text-sm">
              {search ? 'No products match your search.' : 'No products found.'}
            </div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
              {filtered.map(p => {
                const sel = isSelected(p.asin)
                return (
                  <div
                    key={p.asin}
                    onClick={() => toggleSelect(p)}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                      sel ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input type="checkbox" readOnly checked={sel}
                      className="rounded border-gray-300 text-blue-600 shrink-0" />
                    {p.image_url ? (
                      <img src={p.image_url} alt="" className="w-10 h-10 object-contain rounded border border-gray-100 bg-gray-50 shrink-0" />
                    ) : (
                      <div className="w-10 h-10 bg-gray-100 rounded shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.product_name || p.asin}</p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{p.asin}
                        {p.seller_sku && <span className="ml-2 text-gray-400">· SKU: {p.seller_sku}</span>}
                      </p>
                    </div>
                    {p.aria_live_price && (
                      <span className="text-sm font-semibold text-gray-700 shrink-0">${Number(p.aria_live_price).toFixed(2)}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── STEP 2: Review & edit listings ── */}
      {step === 2 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-800">{selected.length} listing{selected.length !== 1 ? 's' : ''} ready to submit</p>
            <p className="text-xs text-gray-400 mt-0.5">Review SKU, price, and condition before submitting to Amazon.</p>
          </div>
          <div className="divide-y divide-gray-100">
            {selected.map(s => (
              <div key={s.product.asin} className="px-4 py-4 flex gap-3 items-start">
                {s.product.image_url ? (
                  <img src={s.product.image_url} alt="" className="w-12 h-12 object-contain rounded border border-gray-100 bg-gray-50 shrink-0" />
                ) : (
                  <div className="w-12 h-12 bg-gray-100 rounded shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 line-clamp-1">{s.product.product_name || s.product.asin}</p>
                  <p className="text-xs text-gray-400 font-mono">{s.product.asin}</p>
                  <div className="mt-2 flex gap-3 flex-wrap">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Seller SKU</label>
                      <input
                        className="border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 focus:outline-none focus:border-blue-500 w-44"
                        value={s.sku}
                        onChange={e => updateSelected(s.product.asin, 'sku', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">List Price ($)</label>
                      <input
                        type="number" min="0" step="0.01"
                        className="border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 focus:outline-none focus:border-blue-500 w-24"
                        value={s.price}
                        onChange={e => updateSelected(s.product.asin, 'price', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Condition</label>
                      <select
                        className="border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                        value={s.condition}
                        onChange={e => updateSelected(s.product.asin, 'condition', e.target.value)}
                      >
                        {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
                <button onClick={() => setSelected(prev => prev.filter(x => x.product.asin !== s.product.asin))}
                  className="text-gray-300 hover:text-red-500 text-xl shrink-0">×</button>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center gap-3">
            <button onClick={() => setStep(1)} className="btn-secondary text-sm">← Back</button>
          </div>
        </div>
      )}
    </div>
  )
}

const inp   = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
const inpSm = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500'
