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
  { value: 'partnered_ups',   label: 'Amazon Partnered Carrier (UPS)' },
  { value: 'non_partnered',   label: 'Non-Partnered Carrier' },
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
// FBA SHIPMENT — matches Boxem's "Create New Shipment" layout
// ─────────────────────────────────────────────────────────────────────────────
function FBAShipmentForm() {
  // Shipment creation phase vs. products phase
  const [phase, setPhase] = useState('form') // 'form' | 'products' | 'rate' | 'done'

  // Credentials / ship-from
  const [creds, setCreds]         = useState(null)
  const [editingAddr, setEditingAddr] = useState(false)
  const [addrForm, setAddrForm]   = useState({
    name: '', line1: '', line2: '', city: '', state: 'TX', zip: '', country: 'US',
  })

  // Form fields (Details)
  const [shipmentName, setShipmentName] = useState(nowLabel)
  const [fulfillmentType] = useState('Amazon FBA')

  // Shipping & Origin
  const [shipMethod, setShipMethod] = useState('partnered_ups')

  // Packaging & Labeling
  const [boxContents, setBoxContents]   = useState('INDIVIDUAL_ITEMS')
  const [labelPrep, setLabelPrep]       = useState('SELLER_LABEL')
  const [autoPrice, setAutoPrice]       = useState(false)
  const [autoPrintFnsku, setAutoPrint]  = useState(false)
  const [fnSkuOnAssign, setFnOnAssign]  = useState(false)
  const [fnSkuOnQty, setFnOnQty]        = useState(false)

  // Meta Data toggles
  const [showBuyCost, setShowBuyCost]   = useState(true)
  const [showSupplier, setShowSupplier] = useState(false)
  const [showDatePurchased, setShowDate]= useState(false)

  // Products phase
  const [asinInput, setAsinInput]   = useState('')
  const [products, setProducts]     = useState([]) // [{asin, title, image_url, bsr, qty, condition, fees, feesLoading}]
  const [asinLoading, setAsinLoading] = useState(false)
  const [asinError, setAsinError]   = useState('')
  const [packages, setPackages]     = useState([{ length_in:'', width_in:'', height_in:'', weight_lbs:'' }])

  // Result
  const [creating, setCreating]     = useState(false)
  const [shipmentRecord, setShipmentRecord] = useState(null)
  const [plan, setPlan]             = useState(null)
  const [rate, setRate]             = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [labelUrl, setLabelUrl]     = useState('')
  const [error, setError]           = useState('')

  useEffect(() => {
    api.getAmazonCredentials().then(c => {
      setCreds(c)
      if (c?.ship_from) {
        const sf = c.ship_from
        setAddrForm({
          name:    sf.name    || c.store_name || '',
          line1:   sf.addressLine1 || '',
          line2:   sf.addressLine2 || '',
          city:    sf.city    || '',
          state:   sf.stateOrProvinceCode || 'TX',
          zip:     sf.postalCode || '',
          country: sf.countryCode || 'US',
        })
      } else if (c?.store_name) {
        setAddrForm(a => ({ ...a, name: c.store_name }))
      }
    }).catch(() => {})
  }, [])

  const shipFromFilled = addrForm.name && addrForm.line1 && addrForm.city && addrForm.zip

  async function handleSaveAddress() {
    const payload = {
      name: addrForm.name,
      addressLine1: addrForm.line1,
      ...(addrForm.line2 ? { addressLine2: addrForm.line2 } : {}),
      city: addrForm.city,
      stateOrProvinceCode: addrForm.state,
      postalCode: addrForm.zip,
      countryCode: addrForm.country,
    }
    await api.saveShipFrom(payload).catch(() => {})
    setEditingAddr(false)
  }

  async function handleAsinLookup() {
    const asin = asinInput.trim().toUpperCase()
    if (!asin) return
    setAsinError(''); setAsinLoading(true)
    try {
      const p = await api.fbaLookup(asin)
      const entry = { ...p, qty: 1, condition: 'NewItem', fees: null, feesLoading: true }
      setProducts(prev => {
        if (prev.find(x => x.asin === p.asin)) return prev
        return [...prev, entry]
      })
      setAsinInput('')
      // Auto-estimate fees at a default price
      api.fbaFees(p.asin, p.buy_box || 19.99).then(f => {
        setProducts(prev => prev.map(x => x.asin === p.asin ? { ...x, fees: f, feesLoading: false } : x))
      }).catch(() => {
        setProducts(prev => prev.map(x => x.asin === p.asin ? { ...x, feesLoading: false } : x))
      })
    } catch (e) { setAsinError(e.message) }
    finally { setAsinLoading(false) }
  }

  function removeProduct(asin) { setProducts(prev => prev.filter(p => p.asin !== asin)) }
  function updateProduct(asin, field, val) {
    setProducts(prev => prev.map(p => p.asin === asin ? { ...p, [field]: val } : p))
  }
  function updatePkg(i, field, val) {
    setPackages(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p))
  }

  async function handleCreateShipment() {
    if (!shipFromFilled) { setError('Please complete your ship-from address first.'); return }
    if (!products.length) { setError('Add at least one product.'); return }
    setError(''); setCreating(true)
    const from = {
      name: addrForm.name,
      addressLine1: addrForm.line1,
      ...(addrForm.line2 ? { addressLine2: addrForm.line2 } : {}),
      city: addrForm.city,
      stateOrProvinceCode: addrForm.state,
      postalCode: addrForm.zip,
      countryCode: addrForm.country,
    }
    const items = products.map(p => ({ sku: p.asin, asin: p.asin, qty: p.qty, condition: p.condition }))
    try {
      const plans = await api.fbaPlan(items, from, labelPrep)
      if (!plans?.length) { setError('No shipment plan returned — check address and ASINs'); setCreating(false); return }
      const thePlan = plans[0]; setPlan(thePlan)
      const p0 = products[0]
      const rec = await api.fbaCreateShipment({
        plan: thePlan,
        shipment_name: shipmentName,
        from_address: from,
        items,
        asin:         p0.asin,
        seller_sku:   p0.asin,
        title:        p0.title,
        quantity:     products.reduce((s, p) => s + (p.qty || 1), 0),
        referral_fee: p0.fees?.referral_fee,
        fba_fee:      p0.fees?.fba_fee,
      })
      setShipmentRecord(rec)
      setPhase('rate')
    } catch (e) { setError(e.message) }
    finally { setCreating(false) }
  }

  async function handleSetTransport() {
    if (!shipmentRecord) return
    setError(''); setCreating(true)
    const pkgs = packages.map(p => ({
      length_in: parseFloat(p.length_in), width_in: parseFloat(p.width_in),
      height_in: parseFloat(p.height_in), weight_lbs: parseFloat(p.weight_lbs),
    }))
    try {
      const r = await api.fbaSetTransport(shipmentRecord.id, pkgs, shipMethod === 'partnered_ups')
      setRate(r)
    } catch (e) { setError(e.message) }
    finally { setCreating(false) }
  }

  async function handleConfirm() {
    setError(''); setConfirming(true)
    try {
      await api.fbaConfirmTransport(shipmentRecord.id)
      setPhase('done')
    } catch (e) { setError(e.message) }
    finally { setConfirming(false) }
  }

  async function handleGetLabels() {
    setError('')
    try {
      const res = await api.fbaGetLabels(shipmentRecord.id)
      setLabelUrl(res.label_url)
    } catch (e) { setError(e.message) }
  }

  function resetAll() {
    setPhase('form'); setProducts([]); setPackages([{ length_in:'', width_in:'', height_in:'', weight_lbs:'' }])
    setShipmentRecord(null); setPlan(null); setRate(null); setLabelUrl('')
    setError(''); setShipmentName(nowLabel())
  }

  if (phase === 'done') {
    return (
      <div className="max-w-2xl space-y-4">
        <div className="card p-6 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <span className="text-green-600 text-2xl font-bold">✓</span>
          </div>
          <h2 className="text-lg font-bold text-gray-900">Shipment Confirmed!</h2>
          <p className="text-gray-500 text-sm mt-1">Your UPS rate is locked in and the shipment is on its way.</p>
          <div className="mt-4 bg-gray-50 rounded-lg p-4 text-left space-y-2">
            <InfoRow label="Shipment ID"    value={shipmentRecord?.amazon_shipment_id} mono />
            <InfoRow label="Destination FC" value={plan?.destination_fc} />
            <InfoRow label="Shipping Cost"  value={fmt$(rate?.estimated_cost)} valueClass="text-green-700 font-semibold" />
          </div>
          <div className="mt-5 flex gap-3 justify-center">
            {!labelUrl ? (
              <button onClick={handleGetLabels}
                className="btn-primary text-sm">Download Box Labels (PDF)</button>
            ) : (
              <a href={labelUrl} target="_blank" rel="noopener noreferrer"
                className="btn-primary text-sm flex items-center gap-2">
                <DownloadIcon className="w-4 h-4" /> Open Labels PDF
              </a>
            )}
            <button onClick={resetAll} className="btn-secondary text-sm">Create Another Shipment</button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'rate') {
    return (
      <div className="max-w-2xl space-y-4">
        {error && <ErrorBanner msg={error} />}
        <div className="card p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Shipment Created</h2>
          <div className="space-y-2 mb-5">
            <InfoRow label="Amazon Shipment ID" value={shipmentRecord?.amazon_shipment_id} mono />
            <InfoRow label="Destination FC"     value={plan?.destination_fc} />
            {plan?.ship_to_address && (
              <InfoRow label="Ship To" value={[
                plan.ship_to_address.addressLine1, plan.ship_to_address.city,
                plan.ship_to_address.stateOrProvinceCode, plan.ship_to_address.postalCode,
              ].filter(Boolean).join(', ')} />
            )}
            {shipmentRecord?.optimized_eligible != null && (
              <InfoRow
                label="Amazon Optimized"
                value={shipmentRecord.optimized_eligible ? '✓ Eligible' : 'Not available'}
                valueClass={shipmentRecord.optimized_eligible ? 'text-green-600' : 'text-gray-400'}
              />
            )}
          </div>

          <SectionHeader title="Box Dimensions" />
          <p className="text-gray-500 text-xs mb-3">Provide dims for each box. Required for the UPS partnered rate.</p>
          {packages.map((pkg, i) => (
            <div key={i} className="flex gap-2 items-end mb-2">
              {[['L (in)', 'length_in'],['W (in)', 'width_in'],['H (in)', 'height_in'],['Wt (lbs)', 'weight_lbs']].map(([lbl, fld]) => (
                <div key={fld} className="flex-1 min-w-0">
                  <label className="block text-xs text-gray-400 mb-1">{lbl}</label>
                  <input type="number" min="0" step="0.1" className={inpSm}
                    value={pkg[fld]} onChange={e => updatePkg(i, fld, e.target.value)} />
                </div>
              ))}
              <button onClick={() => setPackages(p => p.filter((_, j) => j !== i))}
                disabled={packages.length === 1}
                className="text-gray-400 hover:text-red-500 text-xl pb-1 disabled:opacity-30">×</button>
            </div>
          ))}
          <button onClick={() => setPackages(p => [...p, { length_in:'', width_in:'', height_in:'', weight_lbs:'' }])}
            className="text-blue-600 hover:text-blue-700 text-sm font-medium mt-1">+ Add box</button>

          {rate && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center justify-between">
              <span className="text-green-800 text-sm font-medium">Estimated Shipping Cost</span>
              <span className="text-green-700 text-xl font-bold">{fmt$(rate.estimated_cost)} {rate.currency || 'USD'}</span>
            </div>
          )}

          <div className="mt-5 flex gap-3">
            {!rate ? (
              <button onClick={handleSetTransport} disabled={creating}
                className="btn-primary text-sm flex items-center gap-2">
                {creating && <SpinIcon className="w-4 h-4 animate-spin" />}
                Get Shipping Rate
              </button>
            ) : (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex-1">
                  <strong>Confirm to pay:</strong> The UPS rate is charged to your Amazon account. You have 24h to void.
                </div>
                <button onClick={handleConfirm} disabled={confirming}
                  className="btn-primary text-sm flex items-center gap-2 shrink-0">
                  {confirming && <SpinIcon className="w-4 h-4 animate-spin" />}
                  Confirm &amp; Pay
                </button>
                <button onClick={async () => { await api.fbaVoidTransport(shipmentRecord.id); setRate(null) }}
                  className="btn-secondary text-sm text-red-600 shrink-0">Void</button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── phase === 'form' ──
  return (
    <div className="max-w-2xl space-y-0">
      {error && <div className="mb-4"><ErrorBanner msg={error} /></div>}

      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Create New Shipment</h2>
        </div>

        {/* ── DETAILS ── */}
        <Section title="Details">
          <FormRow label="Shipment Name">
            <input className={inp} value={shipmentName} onChange={e => setShipmentName(e.target.value)} />
          </FormRow>
          <FormRow label="Fulfillment Type">
            <input className={`${inp} bg-gray-50 text-gray-500`} value={fulfillmentType} readOnly />
          </FormRow>
        </Section>

        {/* ── SHIPPING & ORIGIN ── */}
        <Section title="Shipping & Origin">
          <FormRow label="Ship From">
            {editingAddr ? (
              <div className="space-y-2 w-full">
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">Name / Company</label>
                    <input className={inp} value={addrForm.name} onChange={e => setAddrForm(a => ({ ...a, name: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">Address Line 1</label>
                    <input className={inp} value={addrForm.line1} onChange={e => setAddrForm(a => ({ ...a, line1: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">Address Line 2 (optional)</label>
                    <input className={inp} value={addrForm.line2} onChange={e => setAddrForm(a => ({ ...a, line2: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">City</label>
                    <input className={inp} value={addrForm.city} onChange={e => setAddrForm(a => ({ ...a, city: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">State</label>
                    <select className={inp} value={addrForm.state} onChange={e => setAddrForm(a => ({ ...a, state: e.target.value }))}>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">ZIP</label>
                    <input className={inp} value={addrForm.zip} onChange={e => setAddrForm(a => ({ ...a, zip: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSaveAddress} className="btn-primary text-xs py-1.5 px-3">Save Address</button>
                  <button onClick={() => setEditingAddr(false)} className="btn-secondary text-xs py-1.5 px-3">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="w-full border border-gray-200 rounded-lg p-3 bg-gray-50">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-800 uppercase tracking-wide">
                      {addrForm.name || creds?.store_name || <span className="text-gray-400 normal-case font-normal">Not set</span>}
                    </p>
                    {shipFromFilled ? (
                      <p className="text-gray-500 text-xs mt-0.5">
                        {addrForm.line1}{addrForm.line2 ? `, ${addrForm.line2}` : ''},{' '}
                        {addrForm.city} {addrForm.state} {addrForm.zip}
                      </p>
                    ) : (
                      <p className="text-amber-600 text-xs mt-0.5">Address not set — click Edit Address</p>
                    )}
                  </div>
                  <button onClick={() => setEditingAddr(true)}
                    className="text-blue-600 hover:text-blue-700 text-xs font-medium shrink-0">
                    Edit Address
                  </button>
                </div>
              </div>
            )}
          </FormRow>
          <FormRow label="Ship Method">
            <select className={inp} value={shipMethod} onChange={e => setShipMethod(e.target.value)}>
              {SHIP_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </FormRow>
        </Section>

        {/* ── PACKAGING & LABELING ── */}
        <Section title="Packaging & Labeling">
          <FormRow label="Box Contents">
            <select className={inp} value={boxContents} onChange={e => setBoxContents(e.target.value)}>
              {BOX_CONTENTS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </FormRow>
          <FormRow label="Label Prep">
            <select className={inp} value={labelPrep} onChange={e => setLabelPrep(e.target.value)}>
              {LABEL_PREPS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </FormRow>
          <FormRow label="Auto Pricing">
            <Toggle value={autoPrice} onChange={setAutoPrice} label="Auto-fill list price" />
          </FormRow>
          <FormRow label="Auto-Print FNSKU">
            <div className="space-y-2 w-full">
              <Toggle value={fnSkuOnAssign} onChange={setFnOnAssign} label="After assigning to boxes" />
              <Toggle value={fnSkuOnQty}    onChange={setFnOnQty}    label="On quantity update" />
            </div>
          </FormRow>
        </Section>

        {/* ── META DATA ── */}
        <Section title="Meta Data">
          <FormRow label="">
            <div className="space-y-2 w-full">
              <Toggle value={showBuyCost}  onChange={setShowBuyCost}  label="Buy Cost Input" />
              <Toggle value={showSupplier} onChange={setShowSupplier} label="Supplier Input" />
              <Toggle value={showDatePurchased} onChange={setShowDate} label="Date Purchased Input" />
            </div>
          </FormRow>
        </Section>

        {/* ── ADD PRODUCTS ── */}
        <Section title="Add Products">
          <div className="w-full space-y-3">
            <div className="flex gap-2">
              <input
                className={`${inp} flex-1`}
                placeholder="Enter ASIN (e.g. B08N5WRWNW)"
                value={asinInput}
                onChange={e => setAsinInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleAsinLookup()}
              />
              <button onClick={handleAsinLookup} disabled={asinLoading}
                className="btn-primary text-sm flex items-center gap-2 shrink-0">
                {asinLoading && <SpinIcon className="w-3.5 h-3.5 animate-spin" />}
                Add
              </button>
            </div>
            {asinError && <p className="text-red-600 text-xs">{asinError}</p>}

            {products.map(p => (
              <div key={p.asin} className="border border-gray-200 rounded-lg p-3 flex gap-3">
                {p.image_url && (
                  <img src={p.image_url} alt="" className="w-14 h-14 object-contain rounded border border-gray-100 bg-gray-50 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 line-clamp-1">{p.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{p.asin}</p>
                  {p.bsr > 0 && <p className="text-xs text-gray-400">BSR #{p.bsr.toLocaleString()}</p>}
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <div>
                      <label className="block text-xs text-gray-400">Qty</label>
                      <input type="number" min="1" className="w-16 border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                        value={p.qty} onChange={e => updateProduct(p.asin, 'qty', parseInt(e.target.value) || 1)} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400">Condition</label>
                      <select className="border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                        value={p.condition} onChange={e => updateProduct(p.asin, 'condition', e.target.value)}>
                        {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    {showBuyCost && (
                      <div>
                        <label className="block text-xs text-gray-400">Buy Cost</label>
                        <input type="number" min="0" step="0.01" placeholder="$0.00"
                          className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                          value={p.buyCost || ''} onChange={e => updateProduct(p.asin, 'buyCost', e.target.value)} />
                      </div>
                    )}
                    {p.feesLoading && <span className="text-gray-400 text-xs">Loading fees…</span>}
                    {p.fees && !p.feesLoading && (
                      <div className="flex gap-2 text-xs">
                        <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-600">Ref: {fmt$(p.fees.referral_fee)}</span>
                        <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-600">FBA: {fmt$(p.fees.fba_fee)}</span>
                        <span className="bg-green-100 px-2 py-0.5 rounded text-green-700 font-medium">Net: {fmt$(p.fees.net_proceeds)}</span>
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={() => removeProduct(p.asin)} className="text-gray-300 hover:text-red-500 text-xl self-start shrink-0">×</button>
              </div>
            ))}
          </div>
        </Section>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <p className="text-xs text-gray-400">{products.length} product{products.length !== 1 ? 's' : ''} added</p>
          <button
            onClick={handleCreateShipment}
            disabled={creating || !products.length || !shipFromFilled}
            className="btn-primary flex items-center gap-2"
          >
            {creating && <SpinIcon className="w-4 h-4 animate-spin" />}
            Create Shipment →
          </button>
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
    api.getProducts({ limit: 500 })
      .then(data => setInventory(Array.isArray(data) ? data : (data?.items || [])))
      .catch(e => setError(e.message))
      .finally(() => setLoadingInv(false))
  }, [])

  const filtered = inventory.filter(p => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (p.title || '').toLowerCase().includes(q) ||
           (p.asin  || '').toLowerCase().includes(q) ||
           (p.brand || '').toLowerCase().includes(q)
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
                      <p className="text-sm font-medium text-gray-900 truncate">{p.title || p.asin}</p>
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
                  <p className="text-sm font-medium text-gray-900 line-clamp-1">{s.product.title}</p>
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
