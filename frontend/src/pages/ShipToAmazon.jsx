/**
 * FBA Inbound — Boxem-style create shipment page.
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
  { value: 'BOXEM_PROVIDED',   label: 'Boxem Provided' },
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
// FBA SHIPMENT — 3-step Boxem-style flow
// Step 1: Choose products  Step 2: Prep & Box  Step 3: Confirm FC
// ─────────────────────────────────────────────────────────────────────────────
function FBAShipmentForm() {
  const [step, setStep] = useState(1) // 1 | 2 | 3 | 'done'

  const [addrForm, setAddrForm]       = useState({ name:'', line1:'', line2:'', city:'', state:'FL', zip:'', country:'US' })
  const [editingAddr, setEditingAddr] = useState(false)
  const [addrLoading, setAddrLoading] = useState(true)

  const [inventory, setInventory]     = useState([])
  const [invLoading, setInvLoading]   = useState(true)
  const [search, setSearch]           = useState('')
  const [shipment, setShipment]       = useState([])
  const [shipmentName, setShipmentName] = useState(nowLabel)
  const [labelPrep]                   = useState('SELLER_LABEL')

  const [boxes, setBoxes]             = useState([{ id:1, label:'Default box', length_in:'', width_in:'', height_in:'', weight_lbs:'', items:{} }])
  const [activeBox, setActiveBox]     = useState(1)
  const [boxCount, setBoxCount]       = useState(1)

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
        setAddrForm({ name: addr.name || c?.store_name || '', line1: addr.addressLine1 || '',
          line2: addr.addressLine2 || '', city: addr.city || '',
          state: addr.stateOrProvinceCode || 'FL', zip: addr.postalCode || '', country: addr.countryCode || 'US' })
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

  const shipFromFilled = addrForm.line1 && addrForm.city && addrForm.zip

  async function handleSaveAddress() {
    if (!addrForm.line1 || !addrForm.city || !addrForm.zip) { setError('Please fill in Address, City, and ZIP.'); return }
    const payload = { name: addrForm.name, addressLine1: addrForm.line1,
      ...(addrForm.line2 ? { addressLine2: addrForm.line2 } : {}),
      city: addrForm.city, stateOrProvinceCode: addrForm.state, postalCode: addrForm.zip, countryCode: addrForm.country }
    await api.saveShipFrom(payload).catch(() => {})
    setError(''); setEditingAddr(false)
  }

  const filteredInv = inventory.filter(p => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (p.product_name||'').toLowerCase().includes(q) || (p.asin||'').toLowerCase().includes(q) || (p.seller_sku||'').toLowerCase().includes(q)
  })
  const inShipment = (asin) => shipment.some(s => s.product.asin === asin)
  function addToShipment(product) {
    if (inShipment(product.asin)) return
    setShipment(prev => [...prev, { product, qty: product.quantity || 1, condition: 'NewItem', fees: null }])
    api.fbaFees(product.asin, product.buy_box || product.aria_live_price || 19.99)
      .then(f => setShipment(prev => prev.map(s => s.product.asin === product.asin ? {...s, fees: f} : s)))
      .catch(() => {})
  }
  function removeFromShipment(asin) { setShipment(prev => prev.filter(s => s.product.asin !== asin)) }
  function updateShipmentItem(asin, field, val) { setShipment(prev => prev.map(s => s.product.asin === asin ? {...s, [field]: val} : s)) }
  const totalUnits = shipment.reduce((sum, s) => sum + (s.qty || 1), 0)
  const totalProfit = shipment.reduce((sum, s) => sum + ((s.fees?.net_proceeds || 0) - (s.product.buy_cost || 0)) * (s.qty || 1), 0)

  function updateBox(id, field, val) { setBoxes(prev => prev.map(b => b.id === id ? {...b, [field]: val} : b)) }
  function assignItemToBox(boxId, asin, qty) { setBoxes(prev => prev.map(b => b.id === boxId ? {...b, items:{...b.items,[asin]:qty}} : b)) }
  function createBoxes() {
    const nb = []
    for (let i = 1; i <= boxCount; i++) nb.push({ id:i, label: i===1?'Default box':`Box ${i}`, length_in:'', width_in:'', height_in:'', weight_lbs:'', items:{} })
    setBoxes(nb); setActiveBox(1)
  }

  async function handleGetPlacement() {
    if (!shipFromFilled) { setError('Set your ship-from address first.'); return }
    if (!shipment.length) { setError('Add at least one product.'); return }
    setError(''); setLoading(true)
    const from = { name: addrForm.name, addressLine1: addrForm.line1,
      ...(addrForm.line2 ? {addressLine2: addrForm.line2} : {}),
      city: addrForm.city, stateOrProvinceCode: addrForm.state, postalCode: addrForm.zip, countryCode: addrForm.country }
    const items = shipment.map(s => ({ sku: s.product.seller_sku || s.product.asin, asin: s.product.asin, qty: s.qty, condition: s.condition }))
    try {
      const result = await api.fbaPlan(items, from, labelPrep)
      setPlans(Array.isArray(result) ? result : [result])
      setSelectedPlan(0); setStep(3)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function handleConfirmShipment() {
    const thePlan = plans[selectedPlan]
    if (!thePlan) { setError('Select a shipment option.'); return }
    setError(''); setLoading(true)
    const from = { name: addrForm.name, addressLine1: addrForm.line1,
      ...(addrForm.line2 ? {addressLine2: addrForm.line2} : {}),
      city: addrForm.city, stateOrProvinceCode: addrForm.state, postalCode: addrForm.zip, countryCode: addrForm.country }
    const items = shipment.map(s => ({ sku: s.product.seller_sku || s.product.asin, asin: s.product.asin, qty: s.qty, condition: s.condition }))
    const p0 = shipment[0]
    try {
      const rec = await api.fbaCreateShipment({
        plan: thePlan, shipment_name: shipmentName, from_address: from, items,
        asin: p0.product.asin, seller_sku: p0.product.seller_sku || p0.product.asin,
        title: p0.product.product_name, quantity: totalUnits,
        referral_fee: p0.fees?.referral_fee, fba_fee: p0.fees?.fba_fee,
      })
      setShipmentRecord(rec); setStep('done')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  function resetAll() {
    setStep(1); setShipment([]); setBoxes([{ id:1, label:'Default box', length_in:'', width_in:'', height_in:'', weight_lbs:'', items:{} }])
    setPlans([]); setShipmentRecord(null); setLabelUrl(''); setError(''); setShipmentName(nowLabel())
  }

  const STEPS = [{ n:1, label:'Choose products' }, { n:2, label:'Prep & Boxem®' }, { n:3, label:'Confirm Shipments' }]
  const stepNum = step === 'done' ? 4 : step

  const addrModal = editingAddr && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Ship From Address</h3>
        <div className="space-y-3">
          <div><label className="block text-xs text-gray-500 mb-1">Name / Company</label>
            <input className={inp} value={addrForm.name} onChange={e => setAddrForm(a => ({...a, name: e.target.value}))} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Address Line 1</label>
            <input className={inp} value={addrForm.line1} onChange={e => setAddrForm(a => ({...a, line1: e.target.value}))} autoFocus /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Address Line 2 (optional)</label>
            <input className={inp} value={addrForm.line2} onChange={e => setAddrForm(a => ({...a, line2: e.target.value}))} /></div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="block text-xs text-gray-500 mb-1">City</label>
              <input className={inp} value={addrForm.city} onChange={e => setAddrForm(a => ({...a, city: e.target.value}))} /></div>
            <div><label className="block text-xs text-gray-500 mb-1">State</label>
              <select className={inp} value={addrForm.state} onChange={e => setAddrForm(a => ({...a, state: e.target.value}))}>
                {US_STATES.map(s => <option key={s}>{s}</option>)}</select></div>
            <div><label className="block text-xs text-gray-500 mb-1">ZIP</label>
              <input className={inp} value={addrForm.zip} onChange={e => setAddrForm(a => ({...a, zip: e.target.value}))} /></div>
          </div>
        </div>
        {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={() => { setEditingAddr(false); setError('') }} className="btn-secondary text-sm px-4">Cancel</button>
          <button onClick={handleSaveAddress} className="btn-primary text-sm px-4">Save Address</button>
        </div>
      </div>
    </div>
  )

  const breadcrumb = (
    <div className="flex items-center bg-white border-b border-gray-200 px-6 py-3">
      {STEPS.map((s, i) => {
        const done = stepNum > s.n; const active = stepNum === s.n
        return (
          <div key={s.n} className="flex items-center">
            <button onClick={() => done && setStep(s.n)}
              className={`flex items-center gap-2 text-sm font-medium ${done ? 'cursor-pointer' : 'cursor-default'} ${active ? 'text-gray-900' : done ? 'text-gray-500' : 'text-gray-400'}`}>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${active ? 'bg-red-600 text-white' : done ? 'bg-green-500 text-white' : 'border-2 border-gray-300 text-gray-400'}`}>
                {done ? '✓' : s.n}
              </span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && <span className="mx-4 text-gray-300 text-lg">—</span>}
          </div>
        )
      })}
      <div className="ml-auto flex items-center gap-3">
        <button className="p-2 text-gray-400 hover:text-gray-600">⋮</button>
        <button
          onClick={step === 1 ? () => { if (!shipment.length) { setError('Add at least one product first.'); return }; setStep(2) }
            : step === 2 ? handleGetPlacement
            : step === 3 ? handleConfirmShipment
            : resetAll}
          disabled={loading || (step === 1 && !shipment.length)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gray-700 hover:bg-gray-800 disabled:opacity-40 transition-colors"
        >
          {loading && <SpinIcon className="w-4 h-4 animate-spin" />}
          {step === 'done' ? 'New Shipment' : 'Continue ›'}
        </button>
      </div>
    </div>
  )

  if (step === 'done') {
    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {addrModal}{breadcrumb}
        <div className="p-10 text-center">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-green-600 text-3xl">✓</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900">Shipment Created!</h2>
          <p className="text-gray-500 text-sm mt-2 mb-6">Your shipment has been submitted to Amazon.</p>
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
      </div>
    )
  }

  if (step === 3) {
    const plan = plans[selectedPlan] || {}
    const shipTo = plan.ship_to_address || {}
    const shipToStr = [shipTo.addressLine1, shipTo.city, shipTo.stateOrProvinceCode, shipTo.postalCode].filter(Boolean).join(', ')
    const shipFromStr = [addrForm.name, addrForm.line1, addrForm.city+',', addrForm.state, addrForm.zip].filter(Boolean).join(' ')
    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {addrModal}{breadcrumb}
        {error && <div className="px-6 pt-4"><ErrorBanner msg={error} /></div>}
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-200 min-h-[400px]">
          <div className="p-6 space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-start gap-2 text-xs text-blue-800">
              <span>ℹ</span>
              <span>If you're shipping 5 or more identical boxes, your shipment may qualify for <strong>"optimized placement."</strong></span>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800 mb-1">Select Inbound Placement Option ({plans.length} Total Option{plans.length !== 1 ? 's' : ''})</p>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-gray-500">Ready to Ship:</span>
                <input type="date" className="border border-gray-300 rounded px-2 py-1 text-xs" value={readyDate} onChange={e => setReadyDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-3">
              {plans.map((p, i) => {
                const fc = p.destination_fc || p.fulfillment_center_id || `FC ${i+1}`
                const placement = p.estimated_fees?.placement_fee || 0
                const shipping  = p.estimated_fees?.shipping_fee  || 0
                const labeling  = p.estimated_fees?.labeling_fee  || 0
                const total     = placement + shipping + labeling
                return (
                  <label key={i} className={`block border-2 rounded-xl p-4 cursor-pointer transition-colors ${selectedPlan===i ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <div className="flex items-start gap-3">
                      <input type="radio" name="plan" checked={selectedPlan===i} onChange={() => setSelectedPlan(i)} className="mt-0.5 accent-red-600" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-gray-900 text-sm">1 Shipment</span>
                          {p.expires_at && <span className="text-xs text-amber-600">⚠ Expires: {new Date(p.expires_at).toLocaleDateString()}</span>}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">Ship to: <strong>{fc}</strong></p>
                        <div className="mt-2 space-y-1 text-xs text-gray-600">
                          <div className="flex justify-between"><span>Total prep and labeling fees:</span><span>${labeling.toFixed(2)} USD</span></div>
                          <div className="flex justify-between"><span>Total placement fees:</span><span>${placement.toFixed(2)} USD</span></div>
                          <div className="flex justify-between"><span>Total estimated shipping fees:</span><span>${shipping.toFixed(2)} USD</span></div>
                        </div>
                        <div className="flex justify-between mt-2 pt-2 border-t border-gray-200 text-sm font-semibold">
                          <span>Total fees:</span><span>${total.toFixed(2)} USD</span>
                        </div>
                      </div>
                    </div>
                  </label>
                )
              })}
              {plans.length === 1 && <p className="text-xs text-gray-400 text-center">Amazon assigned this fulfillment center for your shipment.</p>}
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-gray-900 border-b border-gray-100 pb-2">Shipment #1</p>
              <div className="text-xs space-y-1 text-gray-600">
                <div className="flex gap-2"><span className="text-gray-400 w-16 shrink-0">Ship from:</span><span className="font-medium text-gray-800">{shipFromStr}</span></div>
                <div className="flex gap-2"><span className="text-gray-400 w-16 shrink-0">Ship to:</span><span className="font-medium text-gray-800">{shipToStr || (plan.destination_fc ? `FC: ${plan.destination_fc}` : '—')}</span></div>
              </div>
              <div className="flex gap-6 text-xs text-gray-600 pt-2 border-t border-gray-100">
                <span><strong className="text-gray-900">{boxes.length}</strong> Boxes</span>
                <span><strong className="text-gray-900">{totalUnits}</strong> Units</span>
                <span><strong className="text-gray-900">{shipment.length}</strong> SKUs</span>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-gray-900 mb-1">Ready to continue?</p>
              <p className="text-xs text-gray-400 mb-3">Take a moment to review the fee estimates, and check that all is correct.</p>
              {plans[selectedPlan] && (() => {
                const p = plans[selectedPlan]
                const placement = p.estimated_fees?.placement_fee || 0
                const shipping  = p.estimated_fees?.shipping_fee  || 0
                const labeling  = p.estimated_fees?.labeling_fee  || 0
                const total     = placement + shipping + labeling
                return (
                  <div className="space-y-1 text-xs text-gray-600">
                    <div className="flex justify-between"><span>Total prep and labeling fees:</span><span>${labeling.toFixed(2)} USD</span></div>
                    <div className="flex justify-between"><span>Total placement fees:</span><span>${placement.toFixed(2)} USD</span></div>
                    <div className="flex justify-between"><span>Total estimated shipping fees:</span><span>${shipping.toFixed(2)} USD</span></div>
                    <div className="flex justify-between text-sm font-semibold pt-2 border-t border-gray-200 bg-blue-50 -mx-4 px-4 py-2 mt-2 rounded-b-xl">
                      <span className="flex items-center gap-1"><span>ℹ</span> Total fees:</span><span>${total.toFixed(2)} USD</span>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (step === 2) {
    const curBox = boxes.find(b => b.id === activeBox) || boxes[0]
    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {addrModal}{breadcrumb}
        {error && <div className="px-6 pt-4"><ErrorBanner msg={error} /></div>}
        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-gray-700">📦 {totalUnits} Total Units</span>
          <button onClick={() => { shipment.forEach(s => assignItemToBox(activeBox, s.product.asin, s.qty)) }}
            className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700">Bulk Assign</button>
          <button onClick={() => { shipment.forEach(s => assignItemToBox(activeBox, s.product.asin, s.qty)) }}
            className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700">Assign All SKUs</button>
          <div className="ml-auto flex items-center gap-2">
            <select className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700" value={curBox?.label} onChange={() => {}}>
              {boxes.map(b => <option key={b.id}>{b.label}</option>)}
            </select>
            <button onClick={() => setBoxCount(c => Math.max(1, c-1))} className="w-7 h-7 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 font-bold">−</button>
            <span className="text-sm text-gray-700 w-4 text-center">{boxCount}</span>
            <button onClick={() => setBoxCount(c => c+1)} className="w-7 h-7 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 font-bold">+</button>
            <button onClick={createBoxes} className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700">Create boxes</button>
          </div>
        </div>
        <div className="px-6 border-b border-gray-100 flex gap-4">
          {boxes.map(b => (
            <button key={b.id} onClick={() => setActiveBox(b.id)}
              className={`py-2.5 text-sm font-medium border-b-2 transition-colors ${activeBox===b.id ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {b.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100 min-h-[400px]">
          <div className="p-4 space-y-3 overflow-y-auto max-h-[60vh]">
            <input className={`${inp} text-xs`} placeholder="Search by product name, category, condition, SKU, FNSKU, or ASIN" readOnly />
            {shipment.map(s => {
              const assigned = curBox?.items?.[s.product.asin] || 0
              const total = s.qty; const allAssigned = assigned >= total
              return (
                <div key={s.product.asin} className={`border rounded-xl p-4 ${allAssigned ? 'border-green-200 bg-green-50' : 'border-gray-200'}`}>
                  <div className="flex gap-3">
                    {s.product.image_url
                      ? <img src={s.product.image_url} alt="" className="w-14 h-14 object-contain rounded border border-gray-100 bg-gray-50 shrink-0" />
                      : <div className="w-14 h-14 bg-gray-100 rounded shrink-0 flex items-center justify-center text-gray-400 text-xs">{total}</div>
                    }
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900 line-clamp-2">{s.product.product_name || s.product.asin}</p>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded shrink-0 ${allAssigned ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{assigned}/{total}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">ASIN: <span className="font-mono">{s.product.asin}</span></p>
                      {s.product.seller_sku && <p className="text-xs text-gray-400">SKU: <span className="font-mono">{s.product.seller_sku}</span></p>}
                      <p className="text-xs text-gray-500 mt-0.5">Condition: New · 📋 Prep Instructions: FNSKU Labeling</p>
                      <div className="flex items-center gap-2 mt-2">
                        <button onClick={() => assignItemToBox(activeBox, s.product.asin, Math.max(0, assigned-1))}
                          className="w-7 h-7 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 font-bold text-sm">−</button>
                        <span className="text-sm w-6 text-center font-medium">{assigned}</span>
                        <button onClick={() => assignItemToBox(activeBox, s.product.asin, Math.min(total, assigned+1))}
                          className="w-7 h-7 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 font-bold text-sm">+</button>
                        <button onClick={() => assignItemToBox(activeBox, s.product.asin, total)} disabled={allAssigned}
                          className="px-3 py-1 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                          Assign ({total})
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="p-4">
            <div className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-gray-900">{curBox?.label} <span className="text-xs text-gray-400 font-normal">Pack Group 1</span></p>
                <button className="text-gray-400 hover:text-gray-600 text-sm">✏</button>
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-500 mb-4 flex-wrap">
                {[['L','length_in'],['W','width_in'],['H','height_in']].map(([l,f],i) => (
                  <span key={f} className="flex items-center gap-0.5">
                    <input type="number" min="0" placeholder="0" className="w-10 border border-gray-300 rounded px-1 py-0.5 text-xs text-center"
                      value={curBox?.[f]||''} onChange={e => updateBox(activeBox, f, e.target.value)} />
                    <span>{i < 2 ? '×' : ' in'}</span>
                  </span>
                ))}
                <span className="flex items-center gap-0.5 ml-1">
                  <input type="number" min="0" placeholder="0" className="w-12 border border-gray-300 rounded px-1 py-0.5 text-xs text-center"
                    value={curBox?.weight_lbs||''} onChange={e => updateBox(activeBox, 'weight_lbs', e.target.value)} />
                  <span>lbs</span>
                </span>
              </div>
              {Object.keys(curBox?.items||{}).filter(a => (curBox.items[a]||0) > 0).length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-4xl mb-2">📦</div>
                  <p className="text-sm font-semibold text-gray-700">There are no products in the Box</p>
                  <p className="text-xs text-gray-400 mt-1 max-w-48 mx-auto">Enter the item quantity and click <strong>Assign</strong> in the left column — or drag and drop items into the desired box.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(curBox.items).filter(([,q]) => q > 0).map(([asin,qty]) => {
                    const item = shipment.find(s => s.product.asin === asin)
                    return (
                      <div key={asin} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-gray-700 truncate max-w-40">{item?.product.product_name || asin}</span>
                        <span className="font-semibold text-gray-900 ml-2">× {qty}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {addrModal}{breadcrumb}
      {error && <div className="px-6 pt-4"><ErrorBanner msg={error} /></div>}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] min-h-[500px]">
        <div className="border-r border-gray-100">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2">
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input className="flex-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
                placeholder="Search by product name, SKU, FNSKU, ASIN, UPC, ISBN, EAN, or GTIN"
                value={search} onChange={e => setSearch(e.target.value)} autoFocus />
              {search && <button onClick={() => setSearch('')} className="text-gray-400 text-lg">×</button>}
            </div>
          </div>
          {invLoading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading inventory…</div>
          ) : filteredInv.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">{search ? 'No products match your search.' : 'No products found. Run an Amazon sync first.'}</div>
          ) : (
            <div className="divide-y divide-gray-100 overflow-y-auto max-h-[65vh]">
              {filteredInv.map(p => {
                const already = inShipment(p.asin)
                const stockQty = p.quantity || 0
                return (
                  <div key={p.asin} className={`px-4 py-4 flex gap-3 ${already ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                    {p.image_url
                      ? <img src={p.image_url} alt="" className="w-14 h-14 object-contain rounded border border-gray-100 bg-gray-50 shrink-0" />
                      : <div className="w-14 h-14 bg-gray-100 rounded shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 line-clamp-2">{p.product_name || p.asin}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-400">
                        <span>ASIN: <span className="font-mono text-gray-600">{p.asin}</span></span>
                        {p.keepa_category && <span>Category: {p.keepa_category}</span>}
                        {p.keepa_bsr > 0 && <span>Sales Rank: <strong className="text-gray-600">{p.keepa_bsr.toLocaleString()}</strong></span>}
                      </div>
                      {p.seller_sku && <p className="text-xs text-gray-500 mt-1">SKU: <span className="font-mono">{p.seller_sku}</span> · Condition: <strong>New</strong></p>}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <button onClick={() => already ? removeFromShipment(p.asin) : addToShipment(p)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xl font-bold transition-colors ${already ? 'bg-blue-500 hover:bg-blue-600' : 'bg-red-600 hover:bg-red-700'}`}>
                        {already ? '✓' : '+'}
                      </button>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                        {stockQty > 0 ? `${stockQty} In Stock` : '0 In Stock'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">Estimated total profit</span>
            <span className={`text-sm font-bold px-2 py-0.5 rounded ${totalProfit >= 0 ? 'text-green-700 bg-green-50' : 'text-red-600 bg-red-50'}`}>
              ${Math.abs(totalProfit).toFixed(2)}
            </span>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Products within shipment</p>
            {shipment.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-2">📦</div>
                <p className="text-xs font-semibold text-gray-700">No products selected yet</p>
                <p className="text-xs text-gray-400 mt-1">Choose products from the list on the left to start building your shipment.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shipment.map(s => (
                  <div key={s.product.asin} className="flex gap-2 items-center border border-gray-200 rounded-lg p-2">
                    {s.product.image_url
                      ? <img src={s.product.image_url} alt="" className="w-10 h-10 object-contain rounded shrink-0" />
                      : <div className="w-10 h-10 bg-gray-100 rounded shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 line-clamp-1">{s.product.product_name || s.product.asin}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <button onClick={() => updateShipmentItem(s.product.asin,'qty',Math.max(1,s.qty-1))}
                          className="w-5 h-5 border border-gray-300 rounded text-xs font-bold text-gray-600 flex items-center justify-center">−</button>
                        <span className="text-xs w-5 text-center font-medium">{s.qty}</span>
                        <button onClick={() => updateShipmentItem(s.product.asin,'qty',s.qty+1)}
                          className="w-5 h-5 border border-gray-300 rounded text-xs font-bold text-gray-600 flex items-center justify-center">+</button>
                      </div>
                    </div>
                    <button onClick={() => removeFromShipment(s.product.asin)} className="text-gray-300 hover:text-red-500 text-lg shrink-0">×</button>
                  </div>
                ))}
                <p className="text-xs text-gray-400 text-center pt-1">{totalUnits} total unit{totalUnits !== 1 ? 's' : ''}</p>
              </div>
            )}
          </div>
          <div className="border-t border-gray-100 pt-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Ship From</p>
              <button onClick={() => setEditingAddr(true)} className="text-xs text-red-600 hover:text-red-700 font-medium">Edit</button>
            </div>
            {addrLoading
              ? <p className="text-xs text-gray-400">Loading…</p>
              : shipFromFilled
                ? <p className="text-xs text-gray-600">{addrForm.name && <><strong>{addrForm.name}</strong><br/></>}{addrForm.line1}, {addrForm.city} {addrForm.state} {addrForm.zip}</p>
                : <button onClick={() => setEditingAddr(true)} className="text-xs text-amber-600 underline">Set ship-from address</button>
            }
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
