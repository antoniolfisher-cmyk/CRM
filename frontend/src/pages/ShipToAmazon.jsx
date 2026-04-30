/**
 * FBA Inbound — Ship to Amazon wizard.
 * Steps: Find Product → Shipment Details → FC Assignment → Shipping Rate → Labels
 */
import { useState } from 'react'
import { api } from '../api'

const STEPS = ['Find Product', 'Shipment Details', 'FC Assignment', 'Shipping Rate', 'Labels']

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]
const CONDITIONS = ['NewItem','UsedLikeNew','UsedVeryGood','UsedGood','UsedAcceptable']

const fmt$ = (v) => (v != null && v !== '') ? `$${Number(v).toFixed(2)}` : '—'

export default function ShipToAmazon() {
  const [step, setStep]           = useState(0)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  // Step 0
  const [asinInput, setAsinInput] = useState('')
  const [product, setProduct]     = useState(null)
  const [price, setPrice]         = useState('')
  const [fees, setFees]           = useState(null)
  const [feesError, setFeesError] = useState('')

  // Step 1
  const [qty, setQty]             = useState(1)
  const [condition, setCondition] = useState('NewItem')
  const [labelPrep, setLabelPrep] = useState('SELLER_LABEL')
  const [shipFrom, setShipFrom]   = useState({
    name: '', line1: '', line2: '', city: '', state: 'TX', zip: '', country: 'US',
  })
  const [packages, setPackages]   = useState([
    { length_in: '', width_in: '', height_in: '', weight_lbs: '' },
  ])

  // Step 2
  const [plan, setPlan]                   = useState(null)
  const [shipmentRecord, setShipmentRecord] = useState(null)

  // Step 3
  const [rate, setRate]           = useState(null)

  // Step 4
  const [labelUrl, setLabelUrl]   = useState('')

  const setErr = (msg) => { setError(msg); setLoading(false) }

  // ── Step 0: ASIN lookup ──────────────────────────────────────────────────────
  async function handleLookup() {
    const asin = asinInput.trim().toUpperCase()
    if (!asin) return
    setError(''); setLoading(true); setProduct(null); setFees(null); setFeesError('')
    try {
      const p = await api.fbaLookup(asin)
      setProduct(p)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function handleEstimateFees() {
    if (!product || !price) return
    setFeesError(''); setLoading(true)
    try {
      const f = await api.fbaFees(product.asin, parseFloat(price))
      setFees(f)
    } catch (e) {
      setFeesError('Fee estimate unavailable for this ASIN — you can still create the shipment.')
    }
    finally { setLoading(false) }
  }

  // ── Step 1 → 2: create plan + shipment ──────────────────────────────────────
  async function handleCreateShipment() {
    setError(''); setLoading(true)
    const items = [{ sku: product.asin, asin: product.asin, qty, condition }]
    const from = {
      name: shipFrom.name,
      addressLine1: shipFrom.line1,
      ...(shipFrom.line2 ? { addressLine2: shipFrom.line2 } : {}),
      city: shipFrom.city,
      stateOrProvinceCode: shipFrom.state,
      postalCode: shipFrom.zip,
      countryCode: shipFrom.country,
    }
    try {
      const plans = await api.fbaPlan(items, from, labelPrep)
      if (!plans?.length) { setErr('No shipment plan returned — check ASIN and address'); return }
      const thePlan = plans[0]
      setPlan(thePlan)
      const rec = await api.fbaCreateShipment({
        plan:          thePlan,
        shipment_name: `FBA-${product.asin}-${Date.now()}`,
        from_address:  from,
        items,
        asin:          product.asin,
        seller_sku:    product.asin,
        title:         product.title,
        quantity:      qty,
        referral_fee:  fees?.referral_fee,
        fba_fee:       fees?.fba_fee,
      })
      setShipmentRecord(rec)
      setStep(2)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  // ── Step 2 → 3: set transport ────────────────────────────────────────────────
  async function handleSetTransport() {
    setError(''); setLoading(true)
    const pkgs = packages.map(p => ({
      length_in:  parseFloat(p.length_in),
      width_in:   parseFloat(p.width_in),
      height_in:  parseFloat(p.height_in),
      weight_lbs: parseFloat(p.weight_lbs),
    }))
    try {
      const r = await api.fbaSetTransport(shipmentRecord.id, pkgs, true)
      setRate(r)
      setStep(3)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  // ── Step 3: confirm / void ───────────────────────────────────────────────────
  async function handleConfirm() {
    setError(''); setLoading(true)
    try {
      await api.fbaConfirmTransport(shipmentRecord.id)
      setStep(4)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function handleVoid() {
    if (!window.confirm('Void this shipping rate? This cannot be undone.')) return
    setError(''); setLoading(true)
    try {
      await api.fbaVoidTransport(shipmentRecord.id)
      setRate(null); setStep(2)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  // ── Step 4: labels ───────────────────────────────────────────────────────────
  async function handleGetLabels() {
    setError(''); setLoading(true)
    try {
      const res = await api.fbaGetLabels(shipmentRecord.id)
      setLabelUrl(res.label_url)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  // ── package helpers ──────────────────────────────────────────────────────────
  function updatePkg(i, field, val) {
    setPackages(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p))
  }
  const addPkg    = () => setPackages(prev => [...prev, { length_in: '', width_in: '', height_in: '', weight_lbs: '' }])
  const removePkg = (i) => setPackages(prev => prev.filter((_, idx) => idx !== i))

  function resetAll() {
    setStep(0); setProduct(null); setFees(null); setFeesError(''); setAsinInput(''); setPrice('')
    setPlan(null); setShipmentRecord(null); setRate(null); setLabelUrl(''); setError('')
    setPackages([{ length_in: '', width_in: '', height_in: '', weight_lbs: '' }])
  }

  const pkgFields = [
    ['L (in)', 'length_in'], ['W (in)', 'width_in'], ['H (in)', 'height_in'], ['Wt (lbs)', 'weight_lbs'],
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">FBA Inbound</h1>
        <p className="text-gray-500 text-sm mt-1">
          Create inbound shipments with FC routing, UPS partnered rates, and box labels — right from your dashboard.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center">
        {STEPS.map((label, i) => (
          <div key={i} className="flex items-center flex-1 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2
                ${i < step  ? 'bg-blue-600 border-blue-600 text-white' :
                  i === step ? 'border-blue-500 text-blue-600 bg-blue-50' :
                               'border-gray-300 text-gray-400 bg-white'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`text-xs font-medium hidden sm:block whitespace-nowrap
                ${i === step ? 'text-blue-600' : i < step ? 'text-gray-700' : 'text-gray-400'}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 ${i < step ? 'bg-blue-500' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* ── STEP 0 ── */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Search by ASIN</h2>
            <div className="flex gap-3">
              <input
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="e.g. B08N5WRWNW"
                value={asinInput}
                onChange={e => setAsinInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
              />
              <Btn onClick={handleLookup} loading={loading}>Look Up</Btn>
            </div>
          </div>

          {product && (
            <>
              <div className="card p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Product</h2>
                <div className="flex gap-4">
                  {product.image_url && (
                    <img
                      src={product.image_url}
                      alt=""
                      className="w-20 h-20 object-contain rounded border border-gray-200 bg-gray-50 p-1 shrink-0"
                    />
                  )}
                  <div className="min-w-0 space-y-1">
                    <p className="text-gray-900 text-sm font-medium leading-snug line-clamp-2">
                      {product.title}
                    </p>
                    <p className="text-gray-500 text-xs">{product.brand} · ASIN: {product.asin}</p>
                    {product.bsr > 0 && (
                      <p className="text-gray-500 text-xs">
                        BSR #{product.bsr.toLocaleString()} in {product.category}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3 pt-1">
                      {[
                        ['L', product.length_in, 'in'],
                        ['W', product.width_in,  'in'],
                        ['H', product.height_in, 'in'],
                        ['Wt', product.weight_lbs,'lbs'],
                      ].map(([lbl, val, unit]) => val ? (
                        <span key={lbl} className="text-gray-600 text-xs bg-gray-100 px-2 py-0.5 rounded">
                          {lbl}: {Number(val).toFixed(2)} {unit}
                        </span>
                      ) : null)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="card p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Fee Estimate</h2>
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Your Sale Price ($)</label>
                    <input
                      type="number" min="0" step="0.01"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      value={price}
                      onChange={e => setPrice(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleEstimateFees()}
                    />
                  </div>
                  <Btn onClick={handleEstimateFees} loading={loading} disabled={!price}>Estimate</Btn>
                </div>

                {feesError && (
                  <p className="text-amber-600 text-xs mt-2 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    ⚠ {feesError}
                  </p>
                )}

                {fees && (
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      ['Referral Fee',  fees.referral_fee,  false],
                      ['FBA Fee',       fees.fba_fee,       false],
                      ['Total Fees',    fees.total_fee,     false],
                      ['Net Proceeds',  fees.net_proceeds,  true],
                    ].map(([label, val, highlight]) => (
                      <div key={label} className={`rounded-lg p-3 border ${highlight ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                        <p className="text-gray-500 text-xs">{label}</p>
                        <p className={`text-lg font-bold mt-0.5 ${highlight ? 'text-green-700' : 'text-gray-900'}`}>
                          {fmt$(val)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Btn onClick={() => setStep(1)}>Continue to Shipment Details →</Btn>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── STEP 1 ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Units &amp; Condition</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Quantity</label>
                <input
                  type="number" min="1"
                  className={inp}
                  value={qty}
                  onChange={e => setQty(parseInt(e.target.value) || 1)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Condition</label>
                <select className={inp} value={condition} onChange={e => setCondition(e.target.value)}>
                  {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs text-gray-500 mb-1">Label Prep</label>
              <select className={inp} value={labelPrep} onChange={e => setLabelPrep(e.target.value)}>
                <option value="SELLER_LABEL">Seller Labels (I will label)</option>
                <option value="AMAZON_LABEL_ONLY">Amazon Labels (fee applies)</option>
                <option value="NO_LABEL">No Label Required</option>
              </select>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Ship From Address</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Name / Company</label>
                <input className={inp} value={shipFrom.name} onChange={e => setShipFrom(s => ({ ...s, name: e.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Address Line 1</label>
                <input className={inp} value={shipFrom.line1} onChange={e => setShipFrom(s => ({ ...s, line1: e.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Address Line 2 (optional)</label>
                <input className={inp} value={shipFrom.line2} onChange={e => setShipFrom(s => ({ ...s, line2: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">City</label>
                <input className={inp} value={shipFrom.city} onChange={e => setShipFrom(s => ({ ...s, city: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">State</label>
                <select className={inp} value={shipFrom.state} onChange={e => setShipFrom(s => ({ ...s, state: e.target.value }))}>
                  {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ZIP Code</label>
                <input className={inp} value={shipFrom.zip} onChange={e => setShipFrom(s => ({ ...s, zip: e.target.value }))} />
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Box Dimensions</h2>
            <p className="text-gray-500 text-xs mb-3">One row per box you will send.</p>
            {packages.map((pkg, i) => (
              <div key={i} className="flex gap-2 items-end mb-2">
                {pkgFields.map(([label, field]) => (
                  <div key={field} className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-1">{label}</label>
                    <input
                      type="number" min="0" step="0.1"
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      value={pkg[field]}
                      onChange={e => updatePkg(i, field, e.target.value)}
                    />
                  </div>
                ))}
                <button
                  onClick={() => removePkg(i)}
                  disabled={packages.length === 1}
                  className="text-gray-400 hover:text-red-500 text-xl pb-1 disabled:opacity-30"
                >×</button>
              </div>
            ))}
            <button onClick={addPkg} className="text-blue-600 hover:text-blue-700 text-sm mt-1 font-medium">
              + Add box
            </button>
          </div>

          <div className="flex justify-between">
            <Btn variant="secondary" onClick={() => setStep(0)}>← Back</Btn>
            <Btn
              onClick={handleCreateShipment}
              loading={loading}
              disabled={!shipFrom.name || !shipFrom.line1 || !shipFrom.city || !shipFrom.zip}
            >
              Create Shipment →
            </Btn>
          </div>
        </div>
      )}

      {/* ── STEP 2 ── */}
      {step === 2 && plan && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Fulfillment Center Assignment</h2>
            <dl className="space-y-2">
              <Row label="Amazon Shipment ID" value={shipmentRecord?.amazon_shipment_id} mono />
              <Row label="Destination FC"     value={plan.destination_fc} />
              {plan.ship_to_address && (
                <Row
                  label="Ship To"
                  value={[
                    plan.ship_to_address.addressLine1,
                    plan.ship_to_address.city,
                    plan.ship_to_address.stateOrProvinceCode,
                    plan.ship_to_address.postalCode,
                  ].filter(Boolean).join(', ')}
                />
              )}
              {shipmentRecord?.optimized_eligible != null && (
                <Row
                  label="Amazon Optimized Shipping"
                  value={shipmentRecord.optimized_eligible ? '✓ Eligible' : 'Not available for this shipment'}
                  valueClass={shipmentRecord.optimized_eligible ? 'text-green-600 font-medium' : 'text-gray-500'}
                />
              )}
            </dl>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Confirm Box Dimensions</h2>
            <p className="text-gray-500 text-xs mb-3">Submitted to Amazon for the UPS partnered carrier rate.</p>
            {packages.map((pkg, i) => (
              <div key={i} className="flex gap-2 items-end mb-2">
                {pkgFields.map(([label, field]) => (
                  <div key={field} className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-1">{label}</label>
                    <input
                      type="number" min="0" step="0.1"
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                      value={pkg[field]}
                      onChange={e => updatePkg(i, field, e.target.value)}
                    />
                  </div>
                ))}
                <button onClick={() => removePkg(i)} disabled={packages.length === 1} className="text-gray-400 hover:text-red-500 text-xl pb-1 disabled:opacity-30">×</button>
              </div>
            ))}
            <button onClick={addPkg} className="text-blue-600 hover:text-blue-700 text-sm mt-1 font-medium">+ Add box</button>
          </div>

          <div className="flex justify-between">
            <Btn variant="secondary" onClick={() => setStep(1)}>← Back</Btn>
            <Btn onClick={handleSetTransport} loading={loading}>Get Shipping Rate →</Btn>
          </div>
        </div>
      )}

      {/* ── STEP 3 ── */}
      {step === 3 && rate && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">UPS Partnered Carrier Rate</h2>
            <dl className="space-y-2 mb-4">
              <Row label="Status"         value={rate.status} />
              <Row
                label="Estimated Cost"
                value={`${fmt$(rate.estimated_cost)} ${rate.currency || 'USD'}`}
                valueClass="text-2xl font-bold text-green-700"
              />
            </dl>
            {rate.status !== 'ESTIMATED' && (
              <p className="text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Amazon is still calculating the rate. The confirmation will proceed with the final rate.
              </p>
            )}
          </div>

          {(fees?.referral_fee || fees?.fba_fee || rate?.estimated_cost) && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Cost Summary</h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  ['Referral Fee',  fees?.referral_fee],
                  ['FBA Fee',       fees?.fba_fee],
                  ['Shipping Cost', rate.estimated_cost],
                ].map(([label, val]) => (
                  <div key={label} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-gray-500 text-xs">{label}</p>
                    <p className="text-gray-900 font-semibold mt-0.5">{fmt$(val)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <strong>Before confirming:</strong> The UPS rate will be charged to your Amazon account. You have a 24-hour void window after confirmation.
          </div>

          <div className="flex justify-between gap-3">
            <Btn variant="secondary" onClick={() => setStep(2)}>← Back</Btn>
            <div className="flex gap-3">
              <Btn variant="danger" onClick={handleVoid} loading={loading}>Void Rate</Btn>
              <Btn onClick={handleConfirm} loading={loading}>Confirm &amp; Pay →</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 4 ── */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-green-100 border-2 border-green-500 rounded-full flex items-center justify-center text-green-700 font-bold text-lg">✓</div>
              <div>
                <p className="text-gray-900 font-semibold">Transport confirmed!</p>
                <p className="text-gray-500 text-sm">Your UPS partnered carrier rate is locked in.</p>
              </div>
            </div>
            <dl className="space-y-2">
              <Row label="Amazon Shipment ID" value={shipmentRecord?.amazon_shipment_id} mono />
              <Row label="Destination FC"     value={plan?.destination_fc} />
              <Row label="Shipping Cost"      value={fmt$(rate?.estimated_cost)} valueClass="text-green-700 font-semibold" />
            </dl>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Box Labels</h2>
            <p className="text-gray-500 text-sm mb-4">
              Print and attach labels to each box before dropping off at UPS.
            </p>
            {!labelUrl ? (
              <Btn onClick={handleGetLabels} loading={loading}>Download Labels (PDF)</Btn>
            ) : (
              <a
                href={labelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                <DownloadIcon className="w-4 h-4" /> Open Labels PDF
              </a>
            )}
          </div>

          <div className="flex justify-between">
            <button
              onClick={resetAll}
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              ← Start New Shipment
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Btn({ children, onClick, loading, disabled, variant = 'primary' }) {
  const base = 'inline-flex items-center gap-2 font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const styles = {
    primary:   'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-white border border-gray-300 hover:bg-gray-50 text-gray-700',
    danger:    'bg-red-600 hover:bg-red-700 text-white',
  }
  return (
    <button className={`${base} ${styles[variant]}`} onClick={onClick} disabled={loading || disabled}>
      {loading && <SpinIcon className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  )
}

function Row({ label, value, mono, valueClass }) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-0.5">
      <dt className="text-gray-500 text-sm shrink-0">{label}</dt>
      <dd className={`text-sm text-right break-all ${mono ? 'font-mono text-gray-700' : 'text-gray-900'} ${valueClass || ''}`}>
        {value ?? '—'}
      </dd>
    </div>
  )
}

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500'

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
