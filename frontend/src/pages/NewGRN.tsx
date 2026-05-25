// NewGRN — manual capture screen for goods received without a pre-imported POD
// (after-hours arrivals, walk-in deliveries). Ported from the legacy PlanetPress
// "Create New POD" page; renamed because the receiver is generating a GRN, not
// proving someone else's delivery.

import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { useCurrentUser } from '../components/CurrentUser'
import { createGRN, type CreateGRNLine } from '../lib/receipts'

const ALPHANUMERIC = /^[a-zA-Z0-9-]+$/

function emptyLine(): CreateGRNLine {
  return {
    delivery_note: '',
    item_code: '',
    item_description: '',
    item_size: '',
    item_quantity: '',
    weight: '',
    material_markings: '',
    material_length: '',
    job_number: '',
    other: '',
  }
}

export default function NewGRN() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useCurrentUser()

  // Header
  const [deliveryNote, setDeliveryNote] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [vehicleReg, setVehicleReg] = useState('')
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().split('T')[0])
  const [weighbridge, setWeighbridge] = useState('')
  const [company, setCompany] = useState('')
  const [fabricator, setFabricator] = useState('')

  // Additional
  const [jobComments, setJobComments] = useState('')
  const [productName, setProductName] = useState('')
  const [processingStatus, setProcessingStatus] = useState('pending')
  const [storedBy, setStoredBy] = useState('')
  const [completionDate, setCompletionDate] = useState('')

  // Lines
  const [lines, setLines] = useState<CreateGRNLine[]>([emptyLine()])

  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Allow URL pre-fill (?wbt=...) — matches legacy entry point from a scan/lookup.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const wbt = params.get('wbt')
    if (wbt) setWeighbridge(wbt)
  }, [])

  // Default Stored By to logged-in user's display name once it loads.
  useEffect(() => {
    if (!storedBy && user?.display_name) setStoredBy(user.display_name)
  }, [user, storedBy])

  const today = useMemo(() => new Date().toISOString().split('T')[0], [])

  function setLineField(index: number, field: keyof CreateGRNLine, value: string) {
    setLines(prev => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)))
  }

  function addLine() {
    setLines(prev => [...prev, { ...emptyLine(), delivery_note: deliveryNote }])
  }

  function removeLine(index: number) {
    if (lines.length === 1) {
      toast.warning('At least one item is required')
      return
    }
    setLines(prev => prev.filter((_, i) => i !== index))
  }

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!deliveryNote.trim()) e.deliveryNote = 'Required'
    else if (!ALPHANUMERIC.test(deliveryNote.trim())) e.deliveryNote = 'Letters, digits, hyphen only'
    if (!orderNumber.trim()) e.orderNumber = 'Required'
    else if (!ALPHANUMERIC.test(orderNumber.trim())) e.orderNumber = 'Letters, digits, hyphen only'
    if (!vehicleReg.trim()) e.vehicleReg = 'Required'
    if (!deliveryDate) e.deliveryDate = 'Required'
    else if (deliveryDate > today) e.deliveryDate = 'Cannot be in the future'
    if (!weighbridge.trim()) e.weighbridge = 'Required'
    else if (!ALPHANUMERIC.test(weighbridge.trim())) e.weighbridge = 'Letters, digits, hyphen only'
    if (!company.trim()) e.company = 'Required'
    if (!storedBy.trim()) e.storedBy = 'Required'
    if (processingStatus === 'completed' && !completionDate) e.completionDate = 'Required when completed'
    if (completionDate && completionDate < deliveryDate) e.completionDate = 'Cannot be before delivery date'

    lines.forEach((line, i) => {
      const q = line.item_quantity.trim()
      if (q && (isNaN(Number(q)) || Number(q) <= 0)) {
        e[`line${i}_quantity`] = 'Must be > 0'
      }
    })

    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (submitting) return
    if (!validate()) {
      toast.error('Please fix the errors in the form')
      return
    }

    setSubmitting(true)
    try {
      const receipt = await createGRN({
        delivery_note_number: deliveryNote.trim(),
        order_number: orderNumber.trim(),
        vehicle_registration: vehicleReg.trim(),
        delivery_date: deliveryDate,
        weighbridge_ticket_number: weighbridge.trim(),
        company: company.trim(),
        fabricator: fabricator.trim(),
        job_comments: jobComments.trim(),
        stored_by: storedBy.trim(),
        completion_date: completionDate,
        product_name: productName.trim(),
        processing_status: processingStatus,
        // Mirror header weighbridge/delivery-note onto every line at submit time,
        // matching legacy behaviour. Receivers shouldn't have to re-key these.
        lines: lines.map(l => ({ ...l, delivery_note: l.delivery_note || deliveryNote.trim() })),
      })
      toast.success(`GRN created — receipt ${receipt.receipt_number}`)
      navigate('/receipts')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to create GRN'
      toast.error(msg)
      setSubmitting(false)
    }
  }

  function handleCancel() {
    const dirty = deliveryNote || orderNumber || vehicleReg || weighbridge || company || fabricator || jobComments || productName || lines.some(l => Object.values(l).some(v => v))
    if (dirty && !window.confirm('You have unsaved changes. Discard?')) return
    navigate('/')
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Create GRN</h1>
          <p className="page-subtitle">
            Capture a goods received note when no POD has been pre-imported (after-hours, walk-ins).
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Delivery Details */}
        <div className="section">
          <div className="section__header"><h2 className="section__title">Delivery Details</h2></div>
          <div className="section__body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>

            <div className="form-field">
              <label className="form-label" htmlFor="deliveryNote">Delivery Note Number *</label>
              <input id="deliveryNote" className="form-input" value={deliveryNote} onChange={e => setDeliveryNote(e.target.value)} required />
              {errors.deliveryNote && <span style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{errors.deliveryNote}</span>}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="orderNumber">Order Number *</label>
              <input id="orderNumber" className="form-input" value={orderNumber} onChange={e => setOrderNumber(e.target.value)} required />
              {errors.orderNumber && <span style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{errors.orderNumber}</span>}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="vehicleReg">Vehicle Registration *</label>
              <input id="vehicleReg" className="form-input" value={vehicleReg} onChange={e => setVehicleReg(e.target.value)} required />
              {errors.vehicleReg && <span style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{errors.vehicleReg}</span>}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="deliveryDate">Delivery Date *</label>
              <input id="deliveryDate" className="form-input" type="date" max={today} value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} required />
              {errors.deliveryDate && <span style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{errors.deliveryDate}</span>}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="weighbridge">Weighbridge Ticket Number *</label>
              <input id="weighbridge" className="form-input" value={weighbridge} onChange={e => setWeighbridge(e.target.value)} required />
              {errors.weighbridge && <span style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{errors.weighbridge}</span>}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="company">Company *</label>
              <input id="company" className="form-input" value={company} onChange={e => setCompany(e.target.value)} required />
              {errors.company && <span style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{errors.company}</span>}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="fabricator">Fabricator</label>
              <input id="fabricator" className="form-input" value={fabricator} onChange={e => setFabricator(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="section">
          <div className="section__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 className="section__title">Items</h2>
            <button type="button" className="btn btn-primary btn-sm" onClick={addLine}>+ Add Item</button>
          </div>
          <div className="section__body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {lines.map((line, i) => (
              <div key={i} style={{ border: '1px solid var(--surface-3)', borderRadius: 'var(--radius-sm)', padding: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem', alignItems: 'end' }}>
                <div className="form-field">
                  <label className="form-label">Item Code</label>
                  <input className="form-input" value={line.item_code} onChange={e => {
                    const code = e.target.value
                    setLines(prev => prev.map((l, idx) => {
                      if (idx !== i) return l
                      // Auto-fill markings from item code if markings is empty or still matches the old item code
                      const markings = (!l.material_markings || l.material_markings === l.item_code) ? code : l.material_markings
                      return { ...l, item_code: code, material_markings: markings }
                    }))
                  }} />
                </div>
                <div className="form-field">
                  <label className="form-label">Description</label>
                  <input className="form-input" value={line.item_description} onChange={e => setLineField(i, 'item_description', e.target.value)} />
                </div>
                <div className="form-field">
                  <label className="form-label">Size</label>
                  <input className="form-input" value={line.item_size} onChange={e => setLineField(i, 'item_size', e.target.value)} />
                </div>
                <div className="form-field">
                  <label className="form-label">Qty</label>
                  <input className="form-input" type="number" min="1" value={line.item_quantity} onChange={e => setLineField(i, 'item_quantity', e.target.value)} />
                  {errors[`line${i}_quantity`] && <span style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{errors[`line${i}_quantity`]}</span>}
                </div>
                <div className="form-field">
                  <label className="form-label">Weight</label>
                  <input className="form-input" value={line.weight} onChange={e => setLineField(i, 'weight', e.target.value)} placeholder="Total weight" />
                </div>
                <div className="form-field">
                  <label className="form-label">Material Markings</label>
                  <input className="form-input" value={line.material_markings} onChange={e => setLineField(i, 'material_markings', e.target.value)} placeholder={line.item_code || 'defaults to item code'} />
                </div>
                <div className="form-field">
                  <label className="form-label">Material Length</label>
                  <input className="form-input" value={line.material_length} onChange={e => setLineField(i, 'material_length', e.target.value)} />
                </div>
                <div className="form-field">
                  <label className="form-label">Job Number</label>
                  <input className="form-input" value={line.job_number} onChange={e => setLineField(i, 'job_number', e.target.value)} />
                </div>
                <div className="form-field">
                  <label className="form-label">Other</label>
                  <input className="form-input" value={line.other} onChange={e => setLineField(i, 'other', e.target.value)} />
                </div>
                <div>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => removeLine(i)} aria-label={`Remove line ${i + 1}`}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="section">
          <div className="section__header"><h2 className="section__title">Notes &amp; Storage</h2></div>
          <div className="section__body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-field">
              <label className="form-label" htmlFor="jobComments">Job Comments</label>
              <textarea id="jobComments" className="form-textarea" rows={3} value={jobComments} onChange={e => setJobComments(e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              <div className="form-field">
                <label className="form-label" htmlFor="receivedBy">Received By</label>
                <input
                  id="receivedBy"
                  className="form-input"
                  value={user?.display_name ?? ''}
                  readOnly
                  aria-readonly="true"
                  title="Auto-filled from your login. Cannot be changed after submit."
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="storedBy">Stored By *</label>
                <input id="storedBy" className="form-input" value={storedBy} onChange={e => setStoredBy(e.target.value)} required />
                {errors.storedBy && <span style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{errors.storedBy}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={handleCancel} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save GRN'}
          </button>
        </div>
      </form>
    </div>
  )
}
