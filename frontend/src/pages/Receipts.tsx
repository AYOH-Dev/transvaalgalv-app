import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { clearToken, apiFetch } from '../auth'
import { useToast } from '../components/Toast'

// ─── Types ───────────────────────────────────────────────────────────────────

type ReceiptLine = {
  id: string
  line_number: number
  item_code: string
  description: string
  material_code: string
  material_description: string
  material_size: string
  material_markings: string
  material_thickness: string
  material_length: string
  weight: string
  internal_description: string
  item_type: string
  packaging_method: string
  accessories: string
  comments: string
  required_galv_thickness: string
  process: string
  expected_quantity: number
  received_quantity: number
  unit_of_measure: string
  receiving_status: string
  discrepancy: string
  quantity_discrepancy: string
  condition_notes: string
  stored_in: string
  bay: string
}

type Receipt = {
  id: string
  receipt_number: string
  customer_name: string
  supplier_name: string
  purchase_order_number: string
  delivery_note_number: string
  weighbridge_ticket_number: string
  vehicle_registration: string
  job_number: string
  status: string
  sync_status: string
  received_at: string
  docuware_doc_url: string
  notes: string
  lines: ReceiptLine[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  draft:        'Draft',
  received:     'Received',
  quality_hold: 'Quality Hold',
  matched:      'Matched',
  archived:     'Archived',
}

const STATUS_BADGE: Record<string, string> = {
  draft:        'badge-default',
  received:     'badge-blue',
  quality_hold: 'badge-amber',
  matched:      'badge-green',
  archived:     'badge-purple',
}

const NEXT_STATUSES: Record<string, string[]> = {
  draft:        ['received'],
  received:     ['matched', 'quality_hold'],
  quality_hold: ['received', 'matched'],
  matched:      ['archived'],
  archived:     [],
}

const PROCESS_OPTIONS = [
  { value: '', label: '— Select process —' },
  { value: 'galvanising',                          label: 'Galvanising' },
  { value: 'double_dip',                           label: 'Double-Dip' },
  { value: 'galvanising_paint',                    label: 'Galvanising & Paint' },
  { value: 'strip_only',                           label: 'Strip Only' },
  { value: 'strip_regalvanise',                    label: 'Strip & Regalvanise' },
  { value: 'strip_galvanising_paint',              label: 'Strip, Galvanising & Paint' },
  { value: 'shotblast_only',                       label: 'Shotblast Only' },
  { value: 'shotblast_galvanising',                label: 'Shotblast & Galvanising' },
  { value: 'shotblast_strip_regalvanising',        label: 'Shotblast, Strip & Regalvanising' },
  { value: 'shotblast_strip_regalvanising_paint',  label: 'Shotblast, Strip, Regalvanising & Paint' },
  { value: 'doesnt_fit_bath',                      label: "Doesn't fit in bath" },
  { value: 'outsourcing_required',                 label: 'Outsourcing required' },
  { value: 'not_suitable',                         label: 'Not suitable for process' },
  { value: 'unsafe',                               label: 'Unsafe (Did not offload)' },
  { value: 'other',                                label: 'Other' },
]

const BAY_OPTIONS = [
  'None', 'Plant 2~3', 'Shotblast',
  'R1','R2','R3','R4','R5','R6','R7','R8','R9','R10',
  'R11','R12','R13','R14','R15','R16','R17','R18','R19','R20',
  'R21','R22','R23','R24','Other',
]

const QTY_DISCREPANCY_OPTIONS = [
  { value: 'none',  label: 'None' },
  { value: 'short', label: 'Short Supplied' },
  { value: 'over',  label: 'Over Supplied' },
]

const ITEM_TYPE_OPTIONS = [
  { value: '',            label: '— Select item type —' },
  { value: 'blacksteel',  label: 'Black Steel' },
  { value: 'galvanised',  label: 'Galvanised' },
  { value: 'other',       label: 'Other' },
]

const PACKAGING_OPTIONS = [
  { value: '',        label: '— Select packaging —' },
  { value: 'pallet',  label: 'Pallet' },
  { value: 'crate',   label: 'Crate' },
  { value: 'bundle',  label: 'Bundle' },
  { value: 'loose',   label: 'Loose' },
  { value: 'bin',     label: 'Bin' },
  { value: 'other',   label: 'Other' },
]

// Processes disabled per item type (matches old system logic exactly)
const DISABLED_PROCESSES: Record<string, string[]> = {
  galvanised: ['galvanising', 'galvanising_paint', 'shotblast_galvanising'],
  blacksteel: ['strip_only', 'strip_regalvanise', 'strip_galvanising_paint', 'shotblast_strip_regalvanising', 'shotblast_strip_regalvanising_paint'],
}
const DEFAULT_PROCESS: Record<string, string> = {
  galvanised: 'strip_regalvanise',
}

function availableProcesses(itemType: string) {
  const disabled = DISABLED_PROCESSES[itemType] ?? []
  return PROCESS_OPTIONS.map(o => ({ ...o, disabled: disabled.includes(o.value) }))
}

function defaultProcessForType(itemType: string, current: string): string {
  const disabled = DISABLED_PROCESSES[itemType] ?? []
  if (disabled.includes(current)) return DEFAULT_PROCESS[itemType] ?? ''
  return current
}

// Validation — returns list of missing required fields
function validateLine(line: ReceiptLine, edits: LineEdit): string[] {
  const missing: string[] = []
  const v = (field: keyof ReceiptLine) =>
    (field in edits ? (edits as any)[field] : line[field]) as string

  if (!v('item_type'))        missing.push('Item Type')
  if (!v('process'))          missing.push('Process')
  if (!v('packaging_method')) missing.push('Packaging Method')

  const qtyDisc = v('quantity_discrepancy')
  if (qtyDisc && qtyDisc !== 'none') {
    const received = (('received_quantity' in edits ? edits.received_quantity : line.received_quantity) ?? 0) as number
    const expected = line.expected_quantity
    if (qtyDisc === 'short' && received >= expected) missing.push('Received Qty must be less than Expected for Short Supplied')
    if (qtyDisc === 'over'  && received <= expected) missing.push('Received Qty must be greater than Expected for Over Supplied')
  }

  return missing
}

// ─── Defect categories (mirrors old system exactly) ───────────────────────────

type DefectOption = {
  key: string
  label: string
  options: string[]
  default: string
  mitigations: Record<string, string[]>
}

type DefectCategory = {
  id: string
  title: string
  items: DefectOption[]
}

const DEFECT_CATEGORIES: DefectCategory[] = [
  {
    id: 'priority_defects_1', title: 'Priority Defects (1)',
    items: [
      { key: 'holesInadequate', label: 'Holes Inadequate', options: ['no', 'yes'], default: 'no',
        mitigations: { no: [], yes: ['Vent holes required', 'Drain holes required', 'Jig holes required'] } },
      { key: 'paint', label: 'Paint', options: ['none', 'little', 'a lot'], default: 'none',
        mitigations: { none: [], little: ['Thinners required'], 'a lot': ['Shotblasting required'] } },
      { key: 'oilGreaseDiesel', label: 'Oil, Grease or Diesel', options: ['none', 'little', 'a lot'], default: 'none',
        mitigations: { none: [], little: [], 'a lot': [] } },
    ],
  },
  {
    id: 'priority_defects_2', title: 'Priority Defects (2)',
    items: [
      { key: 'damaged', label: 'Damaged', options: ['none', 'dented', 'bent', 'crack', 'deep scratch', 'multiple damages'], default: 'none',
        mitigations: { none: [], dented: ['Send to boilershop'], bent: ['Send to boilershop'], crack: ['Send to boilershop'], 'deep scratch': ['Send to boilershop'], 'multiple damages': ['Send to boilershop'] } },
      { key: 'burr', label: 'Burr', options: ['none', 'little', 'a lot'], default: 'none',
        mitigations: { none: [], little: [], 'a lot': [] } },
      { key: 'weldingFlux', label: 'Welding Flux', options: ['no', 'yes'], default: 'no',
        mitigations: { no: [], yes: [] } },
    ],
  },
  {
    id: 'structural', title: 'Other Structural Issues',
    items: [
      { key: 'sharpEdges', label: 'Sharp Edges', options: ['no', 'yes'], default: 'no',
        mitigations: { no: [], yes: [] } },
      { key: 'possibleDistortion', label: 'Possible Distortion', options: ['no', 'possible', 'very likely (thickness <5mm)'], default: 'no',
        mitigations: { no: [], possible: [], 'very likely (thickness <5mm)': [] } },
    ],
  },
  {
    id: 'surface', title: 'Other Surface Quality',
    items: [
      { key: 'rust', label: 'Rust', options: ['normal', 'porosity', 'irreparable'], default: 'normal',
        mitigations: { normal: [], porosity: ['Shotblasting required'], irreparable: ['Send to boilershop'] } },
    ],
  },
  {
    id: 'welding', title: 'Other Welding Related',
    items: [
      { key: 'weldingSplatter', label: 'Welding or Cutting Splatter', options: ['no', 'yes'], default: 'no',
        mitigations: { no: [], yes: [] } },
      { key: 'delamination', label: 'Delamination', options: ['no', 'yes'], default: 'no',
        mitigations: { no: [], yes: ['Shotblasting required'] } },
    ],
  },
  {
    id: 'coating', title: 'Coating & Processing',
    items: [
      { key: 'nonConformingPreGalv', label: 'Non-Conforming Pre-Galvanization', options: ['no', 'yes'], default: 'no',
        mitigations: { no: [], yes: ['Send to stripping'] } },
      { key: 'pinHoles', label: 'Pin Holes', options: ['none', 'few', 'a lot (porosity)'], default: 'none',
        mitigations: { none: [], few: [], 'a lot (porosity)': [] } },
      { key: 'enclosedCavity', label: 'Enclosed Cavity', options: ['no', 'yes'], default: 'no',
        mitigations: { no: [], yes: ['Cavity Vent holes required'] } },
    ],
  },
  {
    id: 'assembly', title: 'Assembly & Fit',
    items: [
      { key: 'noHanging', label: 'No Hanging Method', options: ['no', 'yes'], default: 'no',
        mitigations: { no: [], yes: ['Lifting lug-nut required', 'Hang notch required'] } },
      { key: 'threadedArticle', label: 'Threaded Article', options: ['no', 'yes'], default: 'no',
        mitigations: { no: [], yes: ['Galv stop required'] } },
      { key: 'articleOverlap', label: 'Article Overlap/Continuous Weld', options: ['no', 'yes'], default: 'no',
        mitigations: { no: [], yes: ['Article Overlap Vent Hole required'] } },
    ],
  },
]

// Items whose mitigations are checkbox-only (no quantity input) — matches old system exactly
const MITIGATION_NO_QTY = new Set(['rust', 'threadedArticle', 'nonConformingPreGalv', 'delamination', 'damaged', 'paint'])

// Selected mitigations per item — an array of mitigation labels the receiver has ticked
type MitigationSelection = Record<string, string[]>
// Per-item, per-mitigation quantity
type MitigationQuantity = Record<string, Record<string, number>>

function defaultDefectValues(): Record<string, string> {
  const vals: Record<string, string> = {}
  for (const cat of DEFECT_CATEGORIES)
    for (const item of cat.items)
      vals[item.key] = item.default
  return vals
}

function hasAnyDefect(defects: Record<string, string>): boolean {
  for (const cat of DEFECT_CATEGORIES)
    for (const item of cat.items)
      if ((defects[item.key] ?? item.default) !== item.default) return true
  return false
}

function buildConditionNotes(
  defects: Record<string, string>,
  mitigations: MitigationSelection,
  quantities: MitigationQuantity,
  additionalComments: string,
): string {
  const findings: string[] = []
  for (const cat of DEFECT_CATEGORIES) {
    for (const item of cat.items) {
      const val = defects[item.key] ?? item.default
      if (val === item.default) continue

      const selected = mitigations[item.key] ?? []
      const renderedMits = selected.map(mit => {
        if (MITIGATION_NO_QTY.has(item.key)) return mit
        const q = quantities[item.key]?.[mit]
        return q != null ? `${mit}=${q}` : mit
      })
      const suffix = renderedMits.length ? ` (${renderedMits.join(', ')})` : ''
      findings.push(`${item.label}: ${val}${suffix}`)
    }
  }
  if (additionalComments.trim()) findings.push(`Notes: ${additionalComments.trim()}`)
  return findings.join(' | ')
}

function parseConditionNotes(notes: string): {
  defects: Record<string, string>
  mitigations: MitigationSelection
  quantities: MitigationQuantity
  comments: string
} {
  const defects = defaultDefectValues()
  const mitigations: MitigationSelection = {}
  const quantities: MitigationQuantity = {}
  let comments = ''
  if (!notes) return { defects, mitigations, quantities, comments }

  const parts = notes.split(' | ')
  for (const part of parts) {
    if (part.startsWith('Notes: ')) {
      comments = part.slice(7)
      continue
    }
    const colonIdx = part.indexOf(': ')
    if (colonIdx === -1) continue
    const rawLabel = part.slice(0, colonIdx)
    const afterColon = part.slice(colonIdx + 2)

    // Split out mitigation suffix: "value (mit1=qty, mit2, mit3=5)"
    const mitMatch = afterColon.match(/^(.+?)\s*\((.+)\)$/)
    const rawVal = mitMatch ? mitMatch[1].trim() : afterColon
    const mitBlob = mitMatch ? mitMatch[2] : ''

    for (const cat of DEFECT_CATEGORIES) {
      for (const item of cat.items) {
        if (item.label !== rawLabel || !item.options.includes(rawVal)) continue
        defects[item.key] = rawVal
        if (!mitBlob) continue
        const selected: string[] = []
        const qtyMap: Record<string, number> = {}
        for (const token of mitBlob.split(',').map(t => t.trim()).filter(Boolean)) {
          const eqIdx = token.lastIndexOf('=')
          if (eqIdx !== -1) {
            const mitName = token.slice(0, eqIdx).trim()
            const mitQty = parseInt(token.slice(eqIdx + 1).trim(), 10)
            selected.push(mitName)
            if (!Number.isNaN(mitQty)) qtyMap[mitName] = mitQty
          } else {
            selected.push(token)
          }
        }
        if (selected.length) mitigations[item.key] = selected
        if (Object.keys(qtyMap).length) quantities[item.key] = qtyMap
      }
    }
  }
  return { defects, mitigations, quantities, comments }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function qty(n: number) {
  if (!n && n !== 0) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

// ─── Line edit state ──────────────────────────────────────────────────────────

type LineEdit = {
  received_quantity?: number
  quantity_discrepancy?: string
  internal_description?: string
  item_type?: string
  packaging_method?: string
  accessories?: string
  comments?: string
  required_galv_thickness?: string
  process?: string
  bay?: string
  stored_in?: string
  receiving_status?: string
  discrepancy?: string
  condition_notes?: string
}

// ─── Receipt edit state ───────────────────────────────────────────────────────

type ReceiptEdit = {
  customer_name?: string
  supplier_name?: string
  purchase_order_number?: string
  delivery_note_number?: string
  weighbridge_ticket_number?: string
  vehicle_registration?: string
  job_number?: string
  notes?: string
}

// ─── Defect Modal ─────────────────────────────────────────────────────────────

type DefectModalProps = {
  lineLabel: string
  initial: Record<string, string>
  initialMitigations: MitigationSelection
  initialQuantities: MitigationQuantity
  additionalComments: string
  onConfirm: (defects: Record<string, string>, mitigations: MitigationSelection, quantities: MitigationQuantity, additionalComments: string) => void
  onClose: () => void
}

function DefectModal({ lineLabel, initial, initialMitigations, initialQuantities, additionalComments: initialComments, onConfirm, onClose }: DefectModalProps) {
  const [step, setStep] = useState(0)
  const [defects, setDefects] = useState<Record<string, string>>(initial)
  const [mitigations, setMitigations] = useState<MitigationSelection>(initialMitigations)
  const [quantities, setQuantities] = useState<MitigationQuantity>(initialQuantities)
  const [comments, setComments] = useState(initialComments)
  const [showSummary, setShowSummary] = useState(false)
  const total = DEFECT_CATEGORIES.length
  const category = DEFECT_CATEGORIES[step]

  function setDefect(key: string, value: string) {
    setDefects(prev => ({ ...prev, [key]: value }))
    // If user reverts to default, clear any selected mitigations / quantities for this item
    const item = DEFECT_CATEGORIES.flatMap(c => c.items).find(i => i.key === key)
    if (item && value === item.default) {
      setMitigations(prev => { const n = { ...prev }; delete n[key]; return n })
      setQuantities(prev => { const n = { ...prev }; delete n[key]; return n })
    }
  }

  function toggleMitigation(itemKey: string, mit: string) {
    setMitigations(prev => {
      const current = prev[itemKey] ?? []
      const next = current.includes(mit) ? current.filter(m => m !== mit) : [...current, mit]
      const out = { ...prev }
      if (next.length) out[itemKey] = next; else delete out[itemKey]
      return out
    })
    // When unticking, clear the qty so parse/serialize stays clean
    setQuantities(prev => {
      if ((mitigations[itemKey] ?? []).includes(mit)) {
        const item = { ...(prev[itemKey] ?? {}) }
        delete item[mit]
        const out = { ...prev }
        if (Object.keys(item).length) out[itemKey] = item; else delete out[itemKey]
        return out
      }
      // Ticking: default to 0 if qty field applies
      if (!MITIGATION_NO_QTY.has(itemKey)) {
        return { ...prev, [itemKey]: { ...(prev[itemKey] ?? {}), [mit]: 0 } }
      }
      return prev
    })
  }

  function setMitigationQty(itemKey: string, mit: string, value: number) {
    setQuantities(prev => ({
      ...prev,
      [itemKey]: { ...(prev[itemKey] ?? {}), [mit]: value },
    }))
  }

  const nonDefaultCount = DEFECT_CATEGORIES.reduce((n, cat) =>
    n + cat.items.filter(item => (defects[item.key] ?? item.default) !== item.default).length, 0)
  const totalItems = DEFECT_CATEGORIES.reduce((n, cat) => n + cat.items.length, 0)
  const pct = Math.round((nonDefaultCount / totalItems) * 100)

  function optionLabel(opt: string, isYesNo: boolean) {
    if (isYesNo) return opt === 'no' ? 'No Issues' : 'Issues Found'
    return opt.charAt(0).toUpperCase() + opt.slice(1)
  }

  const summaryLines = DEFECT_CATEGORIES.flatMap(cat => cat.items.map(item => {
    const val = defects[item.key] ?? item.default
    if (val === item.default) return null
    const selected = mitigations[item.key] ?? []
    const rendered = selected.map(m => {
      if (MITIGATION_NO_QTY.has(item.key)) return m
      const q = quantities[item.key]?.[m]
      return q != null && q > 0 ? `${m} × ${q}` : m
    })
    return { key: item.key, label: item.label, val, mitigations: rendered }
  })).filter(Boolean) as { key: string; label: string; val: string; mitigations: string[] }[]

  if (showSummary) {
    return (
      <div className="app-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="defect-summary-title">
        <div className="app-modal app-modal--lg" style={{ maxWidth: 640 }}>
          <div className="app-modal__header">
            <h2 className="app-modal__title" id="defect-summary-title">Defect Summary</h2>
            <button className="btn-icon" onClick={onClose} aria-label="Close">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div className="app-modal__body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>{lineLabel}</p>
            {summaryLines.length === 0 && comments.trim() === '' ? (
              <p style={{ color: 'var(--green)', fontWeight: 600 }}>No defects detected.</p>
            ) : (
              <ul style={{ margin: 0, padding: '0 0 0 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                {summaryLines.map(s => (
                  <li key={s.key} style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                    <strong>{s.label}:</strong> {s.val}
                    {s.mitigations.length > 0 && (
                      <span style={{ color: 'var(--amber)', marginLeft: '0.375rem' }}>→ {s.mitigations.join(', ')}</span>
                    )}
                  </li>
                ))}
                {comments.trim() && (
                  <li style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    <strong>Notes:</strong> {comments.trim()}
                  </li>
                )}
              </ul>
            )}
          </div>
          <div className="app-modal__footer">
            <button className="btn btn-ghost" onClick={() => setShowSummary(false)}>Back</button>
            <button className="btn btn-success" onClick={() => onConfirm(defects, mitigations, quantities, comments)}>Confirm & Save</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="defect-modal-title">
      <div className="app-modal app-modal--lg" style={{ maxWidth: 700, display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
        {/* Header */}
        <div className="app-modal__header">
          <div>
            <h2 className="app-modal__title" id="defect-modal-title">Capture Defects</h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>{lineLabel}</p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ padding: '0.75rem 1.5rem 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.375rem' }}>
            <span>Step {step + 1} of {total} — {category.title}</span>
            <span>{pct}% flagged</span>
          </div>
          <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 999, marginBottom: '0.75rem' }}>
            <div style={{ height: '100%', width: `${((step) / total) * 100}%`, background: 'var(--blue)', borderRadius: 999, transition: 'width 0.25s ease' }} />
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="app-modal__body" style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {category.items.map(item => {
              const val = defects[item.key] ?? item.default
              const isNonDefault = val !== item.default
              const isYesNo = item.options[0] === 'no' || item.options[0] === 'yes'
              const availableMitigations = item.mitigations[val] ?? []
              const selectedMits = mitigations[item.key] ?? []
              return (
                <div key={item.key} style={{
                  background: isNonDefault ? 'var(--amber-dim)' : 'var(--surface)',
                  border: `1px solid ${isNonDefault ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-lg)', padding: '1rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>{item.label}</span>
                    {isNonDefault && (
                      <span style={{ fontSize: '0.75rem', background: 'var(--amber)', color: '#fff', borderRadius: 999, padding: '0.15rem 0.5rem', fontWeight: 600 }}>Flagged</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.625rem' }}>
                    {item.options.map(opt => (
                      <label key={opt} style={{
                        display: 'flex', alignItems: 'center', gap: '0.375rem',
                        padding: '0.4375rem 0.875rem',
                        borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.875rem',
                        border: `1.5px solid ${val === opt ? 'var(--blue)' : 'var(--border)'}`,
                        background: val === opt ? 'var(--blue-dim)' : 'var(--surface)',
                        color: val === opt ? 'var(--blue)' : 'var(--text-secondary)',
                        fontWeight: val === opt ? 600 : 400,
                        transition: 'all 0.1s',
                        userSelect: 'none',
                      }}>
                        <input
                          type="radio"
                          name={`defect-${item.key}`}
                          value={opt}
                          checked={val === opt}
                          onChange={() => setDefect(item.key, opt)}
                          style={{ display: 'none' }}
                        />
                        {optionLabel(opt, isYesNo)}
                      </label>
                    ))}
                  </div>
                  {availableMitigations.length > 0 && (
                    <div style={{ marginTop: '0.75rem', padding: '0.75rem 0.875rem', background: 'rgba(245,158,11,0.12)', borderRadius: 'var(--radius)', border: '1px solid rgba(245,158,11,0.3)' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mitigation Options</span>
                      <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {availableMitigations.map(m => {
                          const checked = selectedMits.includes(m)
                          const showQty = !MITIGATION_NO_QTY.has(item.key)
                          const q = quantities[item.key]?.[m] ?? 0
                          return (
                            <div key={m} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, cursor: 'pointer', color: '#92400e', fontSize: '0.875rem' }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleMitigation(item.key, m)}
                                  style={{ width: 16, height: 16, accentColor: 'var(--amber)' }}
                                />
                                <span>{m}</span>
                              </label>
                              {showQty && (
                                <input
                                  type="number"
                                  min="0"
                                  value={checked ? q : ''}
                                  onChange={e => setMitigationQty(item.key, m, parseInt(e.target.value || '0', 10) || 0)}
                                  disabled={!checked}
                                  placeholder="Qty"
                                  aria-label={`${m} quantity`}
                                  style={{ width: 80, padding: '0.3rem 0.5rem', fontSize: '0.8125rem', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 'var(--radius-sm)', background: checked ? '#fff' : 'rgba(255,255,255,0.4)', color: checked ? 'var(--text-primary)' : 'var(--text-muted)' }}
                                />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Additional comments on last step */}
            {step === total - 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Additional Comments</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  placeholder="Any other observations…"
                  value={comments}
                  onChange={e => setComments(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="app-modal__footer" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-ghost" onClick={() => step === 0 ? onClose() : setStep(s => s - 1)}>
            {step === 0 ? 'Cancel' : '← Previous'}
          </button>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
            {step + 1} / {total}
          </span>
          {step < total - 1 ? (
            <button className="btn btn-primary" onClick={() => setStep(s => s + 1)}>Next →</button>
          ) : (
            <button className="btn btn-success" onClick={() => setShowSummary(true)}>Review &amp; Confirm</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Receipts({ onLogout }: { onLogout?: () => void }) {
  const { showToast } = useToast()
  const [receipts, setReceipts]   = useState<Receipt[]>([])
  const [filtered, setFiltered]   = useState<Receipt[]>([])
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [search, setSearch]       = useState('')
  const [expandedId, setExpanded]       = useState<string | null>(null)
  const [loadingLines, setLoadingLines] = useState<string | null>(null)
  const [saving, setSaving]             = useState<string | null>(null)
  const [lineEdits, setLineEdits]       = useState<Record<string, LineEdit>>({})
  const [savingLine, setSavingLine]     = useState<string | null>(null)
  const [receiptEdits, setReceiptEdits] = useState<Record<string, ReceiptEdit>>({})
  const [savingReceipt, setSavingReceipt] = useState<string | null>(null)

  // Defect modal — store receiptId + lineId so we always look up the live line from state
  const [defectModal, setDefectModal] = useState<{
    receiptId: string
    lineId: string
    initial: Record<string, string>
    initialMitigations: MitigationSelection
    initialQuantities: MitigationQuantity
    initialComments: string
  } | null>(null)

  useEffect(() => { fetchReceipts() }, [])

  useEffect(() => {
    const q = search.toLowerCase()
    setFiltered(q
      ? receipts.filter(r =>
          r.receipt_number?.toLowerCase().includes(q) ||
          r.customer_name?.toLowerCase().includes(q) ||
          r.supplier_name?.toLowerCase().includes(q) ||
          r.delivery_note_number?.toLowerCase().includes(q) ||
          r.weighbridge_ticket_number?.toLowerCase().includes(q))
      : receipts
    )
  }, [receipts])

  useEffect(() => {
    setFiltered(receipts)
    setExpanded(null)
  }, [search])

  async function fetchReceipts(attempt = 1) {
    setError(''); setLoading(true)
    try {
      const res = await apiFetch('/receipts')
      if (res.status === 401) { clearToken(); onLogout?.(); return }
      if (!res.ok) { setError(`Failed to load receipts (${res.status})`); return }
      const data = await res.json()
      setReceipts(data.receipts || [])
    } catch (err) {
      if ((err as Error).message === 'unauthorized') { clearToken(); onLogout?.(); return }
      if (attempt < 3) {
        setTimeout(() => fetchReceipts(attempt + 1), 1000)
        return
      }
      const msg = (err as Error)?.message || String(err)
      setError(`Network error — ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  async function expandReceipt(id: string) {
    if (expandedId === id) { setExpanded(null); return }
    setExpanded(id)
    const existing = receipts.find(r => r.id === id)
    if (existing && existing.lines && existing.lines.length > 0) return
    setLoadingLines(id)
    try {
      const res = await apiFetch(`/receipts/${id}`)
      if (!res.ok) return
      const full: Receipt = await res.json()
      setReceipts(prev => prev.map(r => r.id === id ? { ...r, lines: full.lines } : r))
    } catch { /* silently fail, lines will just be empty */ }
    finally { setLoadingLines(null) }
  }

  async function updateStatus(receipt: Receipt, newStatus: string) {
    setSaving(receipt.id)
    try {
      const res = await apiFetch(`/receipts/${receipt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        showToast(body.error || 'Failed to update status', 'error')
        return
      }
      const updated: Receipt = await res.json()
      setReceipts(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r))
      showToast(`Status → ${STATUS_LABELS[newStatus] ?? newStatus}`, 'success')
    } catch { showToast('Network error', 'error') }
    finally { setSaving(null) }
  }

  function patchLineEdit(lineId: string, field: keyof LineEdit, value: string | number) {
    setLineEdits(prev => ({ ...prev, [lineId]: { ...prev[lineId], [field]: value } }))
  }

  async function saveLineEdit(receiptId: string, lineId: string, extraFields?: Partial<LineEdit>) {
    const edits = { ...lineEdits[lineId], ...extraFields }
    if (!edits || Object.keys(edits).length === 0) return
    setSavingLine(lineId)
    try {
      const res = await apiFetch(`/receipts/${receiptId}/lines/${lineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edits),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        showToast(body.error || 'Failed to save line', 'error')
        return
      }
      const updatedLine: ReceiptLine = await res.json()
      setReceipts(prev => prev.map(r => {
        if (r.id !== receiptId) return r
        return { ...r, lines: r.lines.map(l => l.id === updatedLine.id ? updatedLine : l) }
      }))
      setLineEdits(prev => { const n = { ...prev }; delete n[lineId]; return n })
      showToast('Line saved', 'success')
    } catch { showToast('Network error', 'error') }
    finally { setSavingLine(null) }
  }

  function lineVal<K extends keyof ReceiptLine>(lineId: string, line: ReceiptLine, field: K): ReceiptLine[K] {
    const edits = lineEdits[lineId]
    return (edits && field in edits ? (edits as any)[field] : line[field]) as ReceiptLine[K]
  }

  function patchReceiptEdit(receiptId: string, field: keyof ReceiptEdit, value: string) {
    setReceiptEdits(prev => ({ ...prev, [receiptId]: { ...prev[receiptId], [field]: value } }))
  }

  function receiptVal(receiptId: string, receipt: Receipt, field: keyof ReceiptEdit): string {
    const edits = receiptEdits[receiptId]
    return (edits && field in edits ? edits[field] : (receipt as any)[field]) as string ?? ''
  }

  async function saveReceiptEdit(receiptId: string) {
    const edits = receiptEdits[receiptId]
    if (!edits || Object.keys(edits).length === 0) return
    setSavingReceipt(receiptId)
    try {
      const res = await apiFetch(`/receipts/${receiptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edits),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        showToast(body.error || 'Failed to save receipt', 'error')
        return
      }
      const updated: Receipt = await res.json()
      setReceipts(prev => prev.map(r => r.id === receiptId ? { ...r, ...updated } : r))
      setReceiptEdits(prev => { const n = { ...prev }; delete n[receiptId]; return n })
      showToast('Receipt saved', 'success')
    } catch { showToast('Network error', 'error') }
    finally { setSavingReceipt(null) }
  }

  function openDefectModal(receiptId: string, line: ReceiptLine) {
    const liveConditionNotes = (lineEdits[line.id]?.condition_notes ?? line.condition_notes) || ''
    const { defects, mitigations, quantities, comments } = parseConditionNotes(liveConditionNotes)
    setDefectModal({
      receiptId,
      lineId: line.id,
      initial: defects,
      initialMitigations: mitigations,
      initialQuantities: quantities,
      initialComments: comments,
    })
  }

  function handleDefectConfirm(
    defects: Record<string, string>,
    mitigations: MitigationSelection,
    quantities: MitigationQuantity,
    additionalComments: string,
  ) {
    if (!defectModal) return
    const { receiptId, lineId } = defectModal
    const conditionNotes = buildConditionNotes(defects, mitigations, quantities, additionalComments)
    const hasDefects = hasAnyDefect(defects)
    setDefectModal(null)
    saveLineEdit(receiptId, lineId, {
      condition_notes: conditionNotes,
      discrepancy: hasDefects ? 'defects_noted' : '',
    })
  }

  return (
    <div>
      {/* Defect modal — portalled to body to escape any stacking context */}
      {defectModal && createPortal((() => {
        const liveLine = receipts
          .flatMap(r => r.lines || [])
          .find(l => l.id === defectModal.lineId)
        const label = liveLine
          ? `${liveLine.description || liveLine.material_description || liveLine.item_code || 'Line'} (Line ${liveLine.line_number})`
          : 'Line'
        return (
          <DefectModal
            lineLabel={label}
            initial={defectModal.initial}
            initialMitigations={defectModal.initialMitigations}
            initialQuantities={defectModal.initialQuantities}
            additionalComments={defectModal.initialComments}
            onConfirm={handleDefectConfirm}
            onClose={() => setDefectModal(null)}
          />
        )
      })(), document.body)}

      <div className="page-header">
        <div>
          <h1 className="page-title">Receipts</h1>
          {!loading && <p className="page-subtitle">{filtered.length} receipt{filtered.length !== 1 ? 's' : ''}</p>}
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost btn-sm" onClick={fetchReceipts} disabled={loading}>
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'spin' : ''} aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '1.25rem' }}>
        <input
          type="search"
          className="search-input"
          style={{ width: '100%' }}
          placeholder="Search receipt, customer, delivery note…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search receipts"
        />
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="skel" style={{ width: '40%', height: 16 }} />
              <span className="skel" style={{ width: '60%', height: 13 }} />
            </div>
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state__icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <p className="empty-state__title">{search ? 'No matching receipts' : 'No receipts yet'}</p>
          <p className="empty-state__desc">{search ? 'Try a different search term.' : 'Receipts will appear here when DocuWare pushes them.'}</p>
          {search && <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear search</button>}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="receipt-list" role="list">
          {filtered.map(r => {
            const isOpen = expandedId === r.id
            const nextStatuses = NEXT_STATUSES[r.status] ?? []
            return (
              <div key={r.id} className={`receipt-card${isOpen ? ' receipt-card--open' : ''}`} role="listitem">
                {/* Summary row */}
                <button className="receipt-card__row" onClick={() => expandReceipt(r.id)} aria-expanded={isOpen}>
                  <div className="receipt-card__icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  </div>
                  <div className="receipt-card__info">
                    <span className="receipt-card__num">
                      {r.delivery_note_number || r.receipt_number || '—'}
                    </span>
                    <span className="receipt-card__supplier">
                      {r.customer_name || r.supplier_name || '—'}
                      {r.weighbridge_ticket_number ? ` · WB ${r.weighbridge_ticket_number}` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexShrink: 0 }}>
                    <span className={`badge ${STATUS_BADGE[r.status] ?? 'badge-default'}`}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} className="hide-mobile">{fmtDate(r.received_at)}</span>
                    <svg className={`receipt-card__chevron${isOpen ? ' receipt-card__chevron--open' : ''}`} xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
                  </div>
                </button>

                {/* Expanded detail */}
                {isOpen && (
                  <div className="receipt-card__detail">

                    {/* ── Receipt header — editable fields ── */}
                    <div style={{ marginBottom: '1.25rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.625rem 1rem', marginBottom: '0.75rem' }}>
                        <EditField label="Customer"        value={receiptVal(r.id, r, 'customer_name')}             onChange={v => patchReceiptEdit(r.id, 'customer_name', v)} />
                        <EditField label="Fabricator"      value={receiptVal(r.id, r, 'supplier_name')}             onChange={v => patchReceiptEdit(r.id, 'supplier_name', v)} />
                        <EditField label="Delivery Note"   value={receiptVal(r.id, r, 'delivery_note_number')}      onChange={v => patchReceiptEdit(r.id, 'delivery_note_number', v)} />
                        <EditField label="Order #"         value={receiptVal(r.id, r, 'purchase_order_number')}     onChange={v => patchReceiptEdit(r.id, 'purchase_order_number', v)} />
                        <EditField label="Weighbridge #"   value={receiptVal(r.id, r, 'weighbridge_ticket_number')} onChange={v => patchReceiptEdit(r.id, 'weighbridge_ticket_number', v)} />
                        <EditField label="Vehicle Reg"     value={receiptVal(r.id, r, 'vehicle_registration')}      onChange={v => patchReceiptEdit(r.id, 'vehicle_registration', v)} />
                        <EditField label="Job Number"      value={receiptVal(r.id, r, 'job_number')}                onChange={v => patchReceiptEdit(r.id, 'job_number', v)} />
                        <div>
                          <div style={labelStyle}>Date</div>
                          <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', padding: '0.375rem 0' }}>{fmtDate(r.received_at)}</div>
                        </div>
                        <div>
                          <div style={labelStyle}>Sync</div>
                          <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', padding: '0.375rem 0' }}>{r.sync_status}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        {r.docuware_doc_url && (
                          <a href={r.docuware_doc_url} target="_blank" rel="noopener noreferrer"
                             style={{ fontSize: '0.8125rem', color: 'var(--blue)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            View in DocuWare
                          </a>
                        )}
                        {receiptEdits[r.id] && Object.keys(receiptEdits[r.id]).length > 0 && (
                          <button className="btn btn-primary btn-sm" onClick={() => saveReceiptEdit(r.id)} disabled={savingReceipt === r.id} style={{ marginLeft: 'auto' }}>
                            {savingReceipt === r.id ? '…' : 'Save Details'}
                          </button>
                        )}
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid var(--border)', marginBottom: '1.25rem' }} />

                    {/* ── Lines ── */}
                    {loadingLines === r.id && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
                        {[1,2,3].map(i => (
                          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1rem' }}>
                            <span className="skel" style={{ width: '50%', height: 14, display: 'block' }} />
                          </div>
                        ))}
                      </div>
                    )}
                    {!loadingLines && r.lines && r.lines.length > 0 && (
                      <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
                          Line Items ({r.lines.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {r.lines.map(line => {
                            const dirty = lineEdits[line.id] && Object.keys(lineEdits[line.id]).length > 0
                            const isSaving = savingLine === line.id
                            const lv = (f: keyof ReceiptLine) => lineVal(line.id, line, f)
                            const condNotes = lv('condition_notes') as string
                            const hasDefects = (lv('discrepancy') as string) === 'defects_noted'
                            const isReceived = (lv('receiving_status') as string) === 'received'
                            const itemType = lv('item_type') as string
                            const qtyDisc = lv('quantity_discrepancy') as string
                            const showRcvdQty = qtyDisc && qtyDisc !== 'none'
                            const processes = availableProcesses(itemType)
                            const validationErrors = validateLine(line, lineEdits[line.id] ?? {})
                            const canReceive = !isReceived && validationErrors.length === 0
                            const handleItemTypeChange = (val: string) => {
                              const newProcess = defaultProcessForType(val, lv('process') as string)
                              patchLineEdit(line.id, 'item_type', val)
                              if (newProcess !== (lv('process') as string)) patchLineEdit(line.id, 'process', newProcess)
                            }

                            return (
                              <div key={line.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>

                                {/* Line header */}
                                <div style={{ padding: '0.75rem 1rem', background: isReceived ? 'var(--green-dim, #f0fdf4)' : 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>
                                      {line.description || line.material_description || line.item_code || '—'}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.125rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                      {line.item_code && <span>Item: {line.item_code}</span>}
                                      {line.material_code && <span>Code: {line.material_code}</span>}
                                      {line.material_size && <span>Size: {line.material_size}</span>}
                                      {line.material_markings && <span>Markings: {line.material_markings}</span>}
                                      {line.weight && <span>Weight: {line.weight}</span>}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Line {line.line_number}</span>
                                    {isReceived && <span className="badge badge-green" style={{ fontSize: '0.7rem' }}>Received</span>}
                                  </div>
                                </div>

                                {/* ── Line editor sections ── */}
                                {(true) && (<>
                                  <AccordionSection title="Item Details" defaultOpen>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.625rem' }}>
                                      {/* Read-only item info */}
                                      {line.item_code && <div><div style={labelStyle}>Item Code</div><div style={{ fontSize: '0.875rem', padding: '0.375rem 0', color: 'var(--text-primary)' }}>{line.item_code}</div></div>}
                                      {line.description && <div><div style={labelStyle}>Description</div><div style={{ fontSize: '0.875rem', padding: '0.375rem 0', color: 'var(--text-primary)' }}>{line.description}</div></div>}
                                      {line.material_size && <div><div style={labelStyle}>Item Size</div><div style={{ fontSize: '0.875rem', padding: '0.375rem 0', color: 'var(--text-primary)' }}>{line.material_size}</div></div>}
                                      {line.material_markings && <div><div style={labelStyle}>Markings</div><div style={{ fontSize: '0.875rem', padding: '0.375rem 0', color: 'var(--text-primary)' }}>{line.material_markings}</div></div>}
                                      {line.material_length && <div><div style={labelStyle}>Length</div><div style={{ fontSize: '0.875rem', padding: '0.375rem 0', color: 'var(--text-primary)' }}>{line.material_length}</div></div>}
                                      {line.material_thickness && <div><div style={labelStyle}>Thickness</div><div style={{ fontSize: '0.875rem', padding: '0.375rem 0', color: 'var(--text-primary)' }}>{line.material_thickness}</div></div>}
                                      {line.weight && <div><div style={labelStyle}>Weight</div><div style={{ fontSize: '0.875rem', padding: '0.375rem 0', color: 'var(--text-primary)' }}>{line.weight}</div></div>}
                                      {/* Editable */}
                                      <LineField label="Internal Description" style={{ gridColumn: 'span 2' }}>
                                        <input type="text" value={lv('internal_description') as string} onChange={e => patchLineEdit(line.id, 'internal_description', e.target.value)} placeholder="Internal name / description" style={inputStyle} />
                                      </LineField>
                                      <LineField label="Item Type *">
                                        <select value={itemType} onChange={e => handleItemTypeChange(e.target.value)} style={{ ...inputStyle, borderColor: !itemType ? 'var(--amber)' : 'var(--border)' }}>
                                          {ITEM_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                      </LineField>
                                      <LineField label="Req. Galv Thickness">
                                        <input type="text" value={lv('required_galv_thickness') as string} onChange={e => patchLineEdit(line.id, 'required_galv_thickness', e.target.value)} placeholder="e.g. 85µm" style={inputStyle} />
                                      </LineField>
                                    </div>
                                  </AccordionSection>

                                  {/* ── Section: Process & Packaging ── */}
                                  <AccordionSection title="Process & Packaging" defaultOpen>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.625rem' }}>
                                      <LineField label="Process *" style={{ gridColumn: 'span 2' }}>
                                        <select
                                          value={lv('process') as string}
                                          onChange={e => patchLineEdit(line.id, 'process', e.target.value)}
                                          style={{ ...inputStyle, borderColor: !(lv('process') as string) ? 'var(--amber)' : 'var(--border)' }}
                                          disabled={!itemType}
                                        >
                                          {processes.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
                                        </select>
                                        {!itemType && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Select Item Type first</div>}
                                      </LineField>
                                      <LineField label="Packaging Method *">
                                        <select value={lv('packaging_method') as string} onChange={e => patchLineEdit(line.id, 'packaging_method', e.target.value)} style={{ ...inputStyle, borderColor: !(lv('packaging_method') as string) ? 'var(--amber)' : 'var(--border)' }}>
                                          {PACKAGING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                      </LineField>
                                    </div>
                                  </AccordionSection>

                                  {/* ── Section: Quantity ── */}
                                  <AccordionSection title="Quantity" defaultOpen>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.625rem' }}>
                                      <div>
                                        <div style={labelStyle}>Expected Qty</div>
                                        <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)', padding: '0.375rem 0' }}>{qty(line.expected_quantity)}</div>
                                      </div>
                                      <LineField label="Qty Discrepancy">
                                        <select value={qtyDisc} onChange={e => patchLineEdit(line.id, 'quantity_discrepancy', e.target.value)} style={inputStyle}>
                                          {QTY_DISCREPANCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                      </LineField>
                                      {showRcvdQty && (
                                        <LineField label="Received Qty">
                                          <input type="number" min="0" step="any"
                                            value={lv('received_quantity') as number}
                                            onChange={e => patchLineEdit(line.id, 'received_quantity', parseFloat(e.target.value) || 0)}
                                            style={inputStyle} aria-label="Received quantity" />
                                        </LineField>
                                      )}
                                    </div>
                                  </AccordionSection>

                                  {/* ── Section: Defects & Discrepancies ── */}
                                  <AccordionSection title="Defects & Discrepancies">
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                      <button
                                        className={`btn btn-sm ${hasDefects ? 'btn-danger' : 'btn-ghost'}`}
                                        onClick={() => openDefectModal(r.id, line)}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', alignSelf: 'flex-start' }}
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                                        {hasDefects ? 'Edit Defects' : 'Capture Defects'}
                                      </button>
                                      {condNotes && (
                                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', background: hasDefects ? 'var(--amber-dim)' : 'var(--surface-2)', border: `1px solid ${hasDefects ? 'rgba(245,158,11,0.3)' : 'var(--border)'}`, borderRadius: 'var(--radius)', padding: '0.625rem 0.75rem' }}>
                                          {condNotes}
                                        </div>
                                      )}
                                    </div>
                                  </AccordionSection>

                                  {/* ── Section: Storage & Comments ── */}
                                  <AccordionSection title="Storage & Comments">
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.625rem' }}>
                                      <LineField label="Bay">
                                        <select value={lv('bay') as string} onChange={e => patchLineEdit(line.id, 'bay', e.target.value)} style={inputStyle}>
                                          <option value="">— Select bay —</option>
                                          {BAY_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                      </LineField>
                                      <LineField label="Stored In">
                                        <input type="text" value={lv('stored_in') as string} onChange={e => patchLineEdit(line.id, 'stored_in', e.target.value)} placeholder="Storage area" style={inputStyle} />
                                      </LineField>
                                      <LineField label="Accessories" style={{ gridColumn: 'span 2' }}>
                                        <input type="text" value={lv('accessories') as string} onChange={e => patchLineEdit(line.id, 'accessories', e.target.value)} placeholder="e.g. bolts, brackets" style={inputStyle} />
                                      </LineField>
                                      <LineField label="Comments" style={{ gridColumn: 'span 2' }}>
                                        <textarea value={lv('comments') as string} onChange={e => patchLineEdit(line.id, 'comments', e.target.value)} placeholder="General comments" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                                      </LineField>
                                    </div>
                                  </AccordionSection>

                                  {/* Save / Receive bar */}
                                  <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    {validationErrors.length > 0 && !isReceived && (
                                      <div style={{ fontSize: '0.75rem', color: 'var(--amber)', display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.75rem' }}>
                                        {validationErrors.map(e => <span key={e}>⚠ {e}</span>)}
                                      </div>
                                    )}
                                    <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
                                      {dirty && (
                                        <button className="btn btn-ghost btn-sm" onClick={() => saveLineEdit(r.id, line.id)} disabled={isSaving}>
                                          {isSaving ? '…' : 'Save'}
                                        </button>
                                      )}
                                      {!isReceived && (
                                        <button
                                          className="btn btn-success btn-sm"
                                          disabled={isSaving || !canReceive}
                                          title={validationErrors.length ? validationErrors.join(', ') : undefined}
                                          onClick={() => saveLineEdit(r.id, line.id, { receiving_status: 'received' })}
                                        >
                                          {isSaving ? '…' : 'Receive Line'}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  </>)}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {!loadingLines && (!r.lines || r.lines.length === 0) && expandedId === r.id && (
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>No line items on this receipt.</p>
                    )}

                    {/* Status transitions */}
                    {nextStatuses.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                        {nextStatuses.map(ns => (
                          <button
                            key={ns}
                            className={`btn btn-sm ${ns === 'matched' ? 'btn-success' : ns === 'quality_hold' ? 'btn-danger' : 'btn-ghost'}`}
                            onClick={() => updateStatus(r, ns)}
                            disabled={saving === r.id}
                          >
                            {saving === r.id ? '…' : `Mark ${STATUS_LABELS[ns] ?? ns}`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.2rem',
}

const inputStyle: React.CSSProperties = {
  padding: '0.375rem 0.5rem', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)', fontSize: '0.875rem',
  background: 'var(--surface)', color: 'var(--text-primary)', width: '100%',
}

// ─── Helper components ────────────────────────────────────────────────────────

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <input
        type="text" value={value}
        onChange={e => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  )
}

function LineField({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  )
}

function AccordionSection({ title, children, defaultOpen }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', padding: '0.625rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'left' }}
      >
        {title}
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div style={{ padding: '0.75rem 1rem 0.875rem' }}>
          {children}
        </div>
      )}
    </div>
  )
}
