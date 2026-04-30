import { useState } from 'react'
import { api } from '../api'

const STEPS = ['Find Product', 'Shipment Details', 'FC Assignment', 'Shipping Rate', 'Labels']

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC',
  'ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']

const CONDITIONS = ['NewItem','UsedLikeNew','UsedVeryGood','UsedGood','UsedAcceptable']

const fmt$ = (v) => v != null ? `$${Number(v).toFixed(2)}` : '—'

export default function ShipToAmazon() {
  const [step, setStep]           = useState(0)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  // Step 0 — ASIN lookup
  const [asinInput, setAsinInput] = useState('')
  const [product, setProduct]     = useState(null)
  const [price, setPrice]         = useState('')
  const [fees, setFees]           = useState(null)

  // Step 1 — Shipment details
  const [qty, setQty]             = useState(1)
  const [condition, setCondition] = useState('NewItem')
  const [labelPrep, setLabelPrep] = useState('SELLER_LABEL')
  const [shipFrom, setShipFrom]   = useState({
    name: '', line1: '', line2: '', city: '', state: 'TX', zip: '', country: 'US',
  })
  const [packages, setPackages]   = useState([{ length_in: '', width_in: '', height_in: '', weight_lbs: '' }])

  // Step 2 — Plan result
  const [plan, setPlan]           = useState(null)
  const [shipmentRecord, setShipmentRecord] = useState(null)

  // Step 3 — Transport rate
  const [rate, setRate]           = useState(null)
  const [confirmed, setConfirmed] = useState(false)

  // Step 4 — Labels
  const [labelUrl, setLabelUrl]   = useState('')

  // ── helpers ─────────────────────────────────────────────────────────────────
  const err = (msg) => { setError(msg); setLoading(false) }

  // ── Step 0: lookup ASIN + fees ──────────────────────────────────────────────
  async function handleLookup() {
    if (!asinInput.trim()) return
    setError(''); setLoading(true); setProduct(null); setFees(null)
    try {
      const p = await api.fbaLookup(asinInput.trim())
      setProduct(p)
      setLoading(false)
    } catch (e) { err(e.message) }
  }

  async function handleEstimateFees() {
    if (!product || !price) return
    setError(''); setLoading(true)
    try {
      const f = await api.fbaFees(product.asin, parseFloat(price))
      setFees(f)
      setLoading(false)
    } catch (e) { err(e.message) }
  }

  // ── Step 1 → Step 2: create plan + shipment ─────────────────────────────────
  async function handleCreateShipment() {
    setError(''); setLoading(true)
    const items = [{ sku: product.asin, asin: product.asin, qty, condition }]
    const from = {
      name:        shipFrom.name,
      addressLine1: shipFrom.line1,
      addressLine2: shipFrom.line2 || undefined,
      city:        shipFrom.city,
      stateOrProvinceCode: shipFrom.state,
      postalCode:  shipFrom.zip,
      countryCode: shipFrom.country,
    }
    try {
      const plans = await api.fbaPlan(items, from, labelPrep)
      if (!plans || plans.length === 0) { err('No shipment plan returned — check ASIN and address'); return }
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
      setLoading(false)
      setStep(2)
    } catch (e) { err(e.message) }
  }

  // ── Step 2 → Step 3: submit transport ───────────────────────────────────────
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
      setLoading(false)
      setStep(3)
    } catch (e) { err(e.message) }
  }

  // ── Step 3: confirm transport ───────────────────────────────────────────────
  async function handleConfirm() {
    setError(''); setLoading(true)
    try {
      await api.fbaConfirmTransport(shipmentRecord.id)
      setConfirmed(true)
      setLoading(false)
      setStep(4)
    } catch (e) { err(e.message) }
  }

  async function handleVoid() {
    if (!window.confirm('Void this shipping rate? This cannot be undone.')) return
    setError(''); setLoading(true)
    try {
      await api.fbaVoidTransport(shipmentRecord.id)
      setRate(null); setConfirmed(false); setStep(2); setLoading(false)
    } catch (e) { err(e.message) }
  }

  // ── Step 4: get labels ──────────────────────────────────────────────────────
  async function handleGetLabels() {
    setError(''); setLoading(true)
    try {
      const res = await api.fbaGetLabels(shipmentRecord.id)
      setLabelUrl(res.label_url)
      setLoading(false)
    } catch (e) { err(e.message) }
  }

  // ── package row helpers ─────────────────────────────────────────────────────
  function updatePkg(i, field, val) {
    setPackages(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p))
  }
  function addPkg()    { setPackages(prev => [...prev, { length_in: '', width_in: '', height_in: '', weight_lbs: '' }]) }
  function removePkg(i){ setPackages(prev => prev.filter((_, idx) => idx !== i)) }

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Ship to Amazon FBA</h1>
        <p className="text-slate-400 text-sm mt-1">Create an inbound shipment, get FC routing, partnered UPS rates, and box labels.</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {STEPS.map((label, i) => (
          <div key={i} className="flex items-center flex-1 min-w-0">
            <div className={`flex items-center gap-2 shrink-0 ${i <= step ? 'text-blue-400' : 'text-slate-500'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2
                ${i < step  ? 'bg-blue-600 border-blue-600 text-white' :
                  i === step ? 'border-blue-400 text-blue-400' :
                               'border-slate-600 text-slate-500'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className="text-xs font-medium hidden sm:block whitespace-nowrap">{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 ${i < step ? 'bg-blue-600' : 'bg-slate-700'}`} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* ── STEP 0: Find Product ── */}
      {step === 0 && (
        <div className="space-y-5">
          <Card title="Search by ASIN">
            <div className="flex gap-3">
              <input
                className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
                placeholder="e.g. B08N5WRWNW"
                value={asinInput}
                onChange={e => setAsinInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
              />
              <Btn onClick={handleLookup} loading={loading}>Look Up</Btn>
            </div>
          </Card>

          {product && (
            <>
              <Card title="Product">
                <div className="flex gap-4">
                  {product.image_url && (
                    <img src={product.image_url} alt="" className="w-20 h-20 object-contain rounded bg-white p-1 shrink-0" />
                  )}
                  <div className="min-w-0 space-y-1">
                    <p className="text-white text-sm font-medium leading-snug line-clamp-2">{product.title}</p>
                    <p className="text-slate-400 text-xs">{product.brand} · ASIN: {product.asin}</p>
                    {product.bsr && (
                      <p className="text-slate-400 text-xs">BSR #{product.bsr.toLocaleString()} in {product.category}</p>
                    )}
                    <div className="flex gap-4 pt-1">
                      {[
                        ['L', product.length_in, 'in'],
                        ['W', product.width_in, 'in'],
                        ['H', product.height_in, 'in'],
                        ['Wt', product.weight_lbs, 'lbs'],
                      ].map(([label, val, unit]) => val ? (
                        <span key={label} className="text-slate-300 text-xs">
                          <span className="text-slate-500">{label}: </span>{Number(val).toFixed(2)} {unit}
                        </span>
                      ) : null)}
                    </div>
                  </div>
                </div>
              </Card>

              <Card title="Fee Estimate">
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="block text-xs text-slate-400 mb-1">Your Sale Price ($)</label>
                    <input
                      type="number" min="0" step="0.01"
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                      value={price}
                      onChange={e => setPrice(e.target.value)}
                    />
                  </div>
                  <Btn onClick={handleEstimateFees} loading={loading} disabled={!price}>Estimate</Btn>
                </div>

                {fees && (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ['Referral Fee',   fees.referral_fee],
                      ['FBA Fee',        fees.fba_fee],
                      ['Total Fees',     fees.total_fee],
                      ['Net Proceeds',   fees.net_proceeds],
                    ].map(([label, val]) => (
                      <div key={label} className="bg-slate-800 rounded-lg p-3">
                        <p className="text-slate-400 text-xs">{label}</p>
                        <p className={`text-lg font-bold mt-0.5 ${label === 'Net Proceeds' ? 'text-green-400' : 'text-white'}`}>
                          {fmt$(val)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <div className="flex justify-end">
                <Btn onClick={() => setStep(1)}>Continue to Shipment Details →</Btn>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── STEP 1: Shipment Details ── */}
      {step === 1 && (
        <div className="space-y-5">
          <Card title="Units & Condition">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Quantity</label>
                <input
                  type="number" min="1"
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Condition</label>
                <select
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  value={condition} onChange={e => setCondition(e.target.value)}
                >
                  {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-xs text-slate-400 mb-1">Label Prep</label>
              <select
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                value={labelPrep} onChange={e => setLabelPrep(e.target.value)}
              >
                <option value="SELLER_LABEL">Seller Labels (I will label)</option>
                <option value="AMAZON_LABEL_ONLY">Amazon Labels (fee applies)</option>
                <option value="NO_LABEL">No Label Required</option>
              </select>
            </div>
          </Card>

          <Card title="Ship From Address">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name / Company" span2>
                <input className={inp} value={shipFrom.name} onChange={e => setShipFrom(s => ({ ...s, name: e.target.value }))} />
              </Field>
              <Field label="Address Line 1" span2>
                <input className={inp} value={shipFrom.line1} onChange={e => setShipFrom(s => ({ ...s, line1: e.target.value }))} />
              </Field>
              <Field label="Address Line 2 (optional)" span2>
                <input className={inp} value={shipFrom.line2} onChange={e => setShipFrom(s => ({ ...s, line2: e.target.value }))} />
              </Field>
              <Field label="City">
                <input className={inp} value={shipFrom.city} onChange={e => setShipFrom(s => ({ ...s, city: e.target.value }))} />
              </Field>
              <Field label="State">
                <select className={inp} value={shipFrom.state} onChange={e => setShipFrom(s => ({ ...s, state: e.target.value }))}>
                  {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </Field>
              <Field label="ZIP Code">
                <input className={inp} value={shipFrom.zip} onChange={e => setShipFrom(s => ({ ...s, zip: e.target.value }))} />
              </Field>
            </div>
          </Card>

          <Card title="Box Dimensions">
            <p className="text-slate-400 text-xs mb-3">Enter one row per box you will send.</p>
            {packages.map((pkg, i) => (
              <div key={i} className="flex gap-2 items-end mb-2">
                {[
                  ['L (in)', 'length_in'],
                  ['W (in)', 'width_in'],
                  ['H (in)', 'height_in'],
                  ['Wt (lbs)', 'weight_lbs'],
                ].map(([label, field]) => (
                  <div key={field} className="flex-1 min-w-0">
                    <label className="block text-xs text-slate-500 mb-1">{label}</label>
                    <input
                      type="number" min="0" step="0.1"
                      className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                      value={pkg[field]} onChange={e => updatePkg(i, field, e.target.value)}
                    />
                  </div>
                ))}
                <button
                  onClick={() => removePkg(i)}
                  disabled={packages.length === 1}
                  className="text-slate-500 hover:text-red-400 text-lg pb-1 disabled:opacity-30"
                >×</button>
              </div>
            ))}
            <button onClick={addPkg} className="text-blue-400 hover:text-blue-300 text-sm mt-1">+ Add box</button>
          </Card>

          <div className="flex justify-between">
            <Btn variant="ghost" onClick={() => setStep(0)}>← Back</Btn>
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

      {/* ── STEP 2: FC Assignment ── */}
      {step === 2 && plan && (
        <div className="space-y-5">
          <Card title="Fulfillment Center Assignment">
            <div className="space-y-3">
              <InfoRow label="Amazon Shipment ID" value={shipmentRecord?.amazon_shipment_id} mono />
              <InfoRow label="Destination FC" value={plan.destination_fc} />
              {plan.ship_to_address && (
                <InfoRow
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
                <InfoRow
                  label="Amazon Optimized Shipping"
                  value={shipmentRecord.optimized_eligible ? '✓ Eligible' : 'Not available for this shipment'}
                  valueClass={shipmentRecord.optimized_eligible ? 'text-green-400' : 'text-slate-400'}
                />
              )}
            </div>
          </Card>

          <Card title="Confirm Box Dimensions">
            <p className="text-slate-400 text-xs mb-3">These will be submitted to Amazon for the UPS partnered carrier rate.</p>
            {packages.map((pkg, i) => (
              <div key={i} className="flex gap-2 items-end mb-2">
                {[['L (in)', 'length_in'],['W (in)', 'width_in'],['H (in)', 'height_in'],['Wt (lbs)', 'weight_lbs']].map(([label, field]) => (
                  <div key={field} className="flex-1 min-w-0">
                    <label className="block text-xs text-slate-500 mb-1">{label}</label>
                    <input
                      type="number" min="0" step="0.1"
                      className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                      value={pkg[field]} onChange={e => updatePkg(i, field, e.target.value)}
                    />
                  </div>
                ))}
                <button onClick={() => removePkg(i)} disabled={packages.length === 1} className="text-slate-500 hover:text-red-400 text-lg pb-1 disabled:opacity-30">×</button>
              </div>
            ))}
            <button onClick={addPkg} className="text-blue-400 hover:text-blue-300 text-sm mt-1">+ Add box</button>
          </Card>

          <div className="flex justify-between">
            <Btn variant="ghost" onClick={() => setStep(1)}>← Back</Btn>
            <Btn onClick={handleSetTransport} loading={loading}>Get Shipping Rate →</Btn>
          </div>
        </div>
      )}

      {/* ── STEP 3: Shipping Rate ── */}
      {step === 3 && rate && (
        <div className="space-y-5">
          <Card title="UPS Partnered Carrier Rate">
            <div className="space-y-3">
              <InfoRow label="Status" value={rate.status} />
              <InfoRow
                label="Estimated Cost"
                value={`${fmt$(rate.estimated_cost)} ${rate.currency || 'USD'}`}
                valueClass="text-2xl font-bold text-green-400"
              />
            </div>
            {rate.status !== 'ESTIMATED' && (
              <p className="text-amber-400 text-xs mt-3">
                Amazon is still calculating the rate. You can refresh or proceed — confirmation happens when you click Confirm.
              </p>
            )}
          </Card>

          <Card title="Cost Summary">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                ['Referral Fee',       fees?.referral_fee],
                ['FBA Fee',            fees?.fba_fee],
                ['Shipping Cost',      rate.estimated_cost],
              ].map(([label, val]) => (
                <div key={label} className="bg-slate-800 rounded-lg p-3">
                  <p className="text-slate-400 text-xs">{label}</p>
                  <p className="text-white font-semibold mt-0.5">{fmt$(val)}</p>
                </div>
              ))}
            </div>
          </Card>

          <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-4 text-sm text-amber-300">
            <strong>Before confirming:</strong> The UPS rate will be charged to your Amazon account. You have a 24-hour void window after confirmation.
          </div>

          <div className="flex justify-between gap-3">
            <Btn variant="ghost" onClick={() => setStep(2)}>← Back</Btn>
            <div className="flex gap-3">
              <Btn variant="danger" onClick={handleVoid} loading={loading}>Void Rate</Btn>
              <Btn onClick={handleConfirm} loading={loading}>Confirm &amp; Pay →</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 4: Labels ── */}
      {step === 4 && (
        <div className="space-y-5">
          <Card title="Shipment Confirmed">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center text-white text-lg">✓</div>
              <div>
                <p className="text-white font-semibold">Transport confirmed!</p>
                <p className="text-slate-400 text-sm">Your UPS partnered carrier rate is locked in.</p>
              </div>
            </div>
            <div className="space-y-2">
              <InfoRow label="Amazon Shipment ID" value={shipmentRecord?.amazon_shipment_id} mono />
              <InfoRow label="Destination FC"     value={plan?.destination_fc} />
              <InfoRow label="Shipping Cost"      value={fmt$(rate?.estimated_cost)} valueClass="text-green-400 font-semibold" />
            </div>
          </Card>

          <Card title="Box Labels">
            <p className="text-slate-400 text-sm mb-4">Download your FBA box labels to print and attach to each box before dropping off at UPS.</p>
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
          </Card>

          <div className="flex justify-between">
            <Btn variant="ghost" onClick={() => {
              setStep(0); setProduct(null); setFees(null); setAsinInput(''); setPrice('')
              setPlan(null); setShipmentRecord(null); setRate(null); setConfirmed(false); setLabelUrl('')
              setPackages([{ length_in: '', width_in: '', height_in: '', weight_lbs: '' }])
            }}>
              Start New Shipment
            </Btn>
            <a href="/fba-history" className="text-blue-400 hover:text-blue-300 text-sm self-center">
              View All Shipments →
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ title, children }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
      {title && <h2 className="text-white font-semibold text-sm mb-4">{title}</h2>}
      {children}
    </div>
  )
}

function Btn({ children, onClick, loading, disabled, variant = 'primary' }) {
  const base = 'inline-flex items-center gap-2 font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const styles = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    ghost:   'bg-slate-700 hover:bg-slate-600 text-slate-200',
    danger:  'bg-red-700 hover:bg-red-600 text-white',
  }
  return (
    <button className={`${base} ${styles[variant]}`} onClick={onClick} disabled={loading || disabled}>
      {loading && <SpinIcon className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  )
}

function Field({ label, children, span2 }) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

function InfoRow({ label, value, mono, valueClass }) {
  return (
    <div className="flex justify-between items-baseline gap-4">
      <span className="text-slate-400 text-sm shrink-0">{label}</span>
      <span className={`text-sm text-right break-all ${mono ? 'font-mono text-slate-200' : 'text-white'} ${valueClass || ''}`}>
        {value ?? '—'}
      </span>
    </div>
  )
}

const inp = 'w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500'

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
