// Shared receipt domain — types, constants, validation, defect encoding.
// Consumed by the office Receipts page and the Yard receiving flow so both
// stay aligned on item-type/process coupling, defect schema, and condition_notes
// serialisation.

import { apiFetch } from '../auth'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReceiptLine = {
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

export type Receipt = {
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
  source_docuware_document_id?: string
  notes: string
  lines: ReceiptLine[]
  line_count?: number
  documents?: ReceiptDocument[]
  grn_document_id?: string
  grn_docuware_doc_id?: string
  grn_generated_at?: string
}

// Server-side photo / attachment record. Phase 1 only emits defect photos
// (category = 'defect_photo'); other categories will surface here as new
// capture flows ship.
export type ReceiptDocument = {
  id: string
  receipt_line_id?: string
  category?: string
  document_type: string
  filename: string
  content_type: string
  storage_key: string
  file_size?: number
  source: string
  docuware_document_id: string
  docuware_status: 'pending' | 'in_progress' | 'synced' | 'failed' | string
  docuware_error?: string
  uploaded_by?: string
  created_at: string
}

export type LineEdit = {
  received_quantity?: number
  quantity_discrepancy?: string
  internal_description?: string
  item_code?: string
  description?: string
  material_size?: string
  material_thickness?: string
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

export type ReceiptEdit = {
  customer_name?: string
  supplier_name?: string
  purchase_order_number?: string
  delivery_note_number?: string
  weighbridge_ticket_number?: string
  vehicle_registration?: string
  job_number?: string
  notes?: string
}

export type DefectOption = {
  key: string
  label: string
  options: string[]
  default: string
  mitigations: Record<string, string[]>
}

export type DefectCategory = {
  id: string
  title: string
  items: DefectOption[]
}

// Selected mitigations per item — array of mitigation labels the receiver ticked
export type MitigationSelection = Record<string, string[]>
// Per-item, per-mitigation quantity
export type MitigationQuantity = Record<string, Record<string, number>>

// ─── Status / option constants ───────────────────────────────────────────────

export const STATUS_LABELS: Record<string, string> = {
  draft:        'Draft',
  received:     'Received',
  quality_hold: 'Quality Hold',
  matched:      'Matched',
  archived:     'Archived',
}

export const STATUS_BADGE: Record<string, string> = {
  draft:        'badge-default',
  received:     'badge-blue',
  quality_hold: 'badge-amber',
  matched:      'badge-green',
  archived:     'badge-purple',
}

export const NEXT_STATUSES: Record<string, string[]> = {
  draft:        ['received'],
  received:     ['matched', 'quality_hold'],
  quality_hold: ['received', 'matched'],
  matched:      ['archived'],
  archived:     [],
}

export const PROCESS_OPTIONS = [
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

export const BAY_OPTIONS = [
  'None', 'Plant 2~3', 'Shotblast',
  'R1','R2','R3','R4','R5','R6','R7','R8','R9','R10',
  'R11','R12','R13','R14','R15','R16','R17','R18','R19','R20',
  'R21','R22','R23','R24','Other',
]

export const QTY_DISCREPANCY_OPTIONS = [
  { value: 'none',  label: 'None' },
  { value: 'short', label: 'Short Supplied' },
  { value: 'over',  label: 'Over Supplied' },
]

export const ITEM_TYPE_OPTIONS = [
  { value: '',            label: '— Select item type —' },
  { value: 'blacksteel',  label: 'Black Steel' },
  { value: 'galvanised',  label: 'Galvanised' },
  { value: 'other',       label: 'Other' },
]

export const PACKAGING_OPTIONS = [
  { value: '',        label: '— Select packaging —' },
  { value: 'pallet',  label: 'Pallet' },
  { value: 'crate',   label: 'Crate' },
  { value: 'bundle',  label: 'Bundle' },
  { value: 'loose',   label: 'Loose' },
  { value: 'bin',     label: 'Bin' },
  { value: 'other',   label: 'Other' },
]

// Processes disabled per item type (matches old system logic exactly)
export const DISABLED_PROCESSES: Record<string, string[]> = {
  galvanised: ['galvanising', 'galvanising_paint', 'shotblast_galvanising'],
  blacksteel: ['strip_only', 'strip_regalvanise', 'strip_galvanising_paint', 'shotblast_strip_regalvanising', 'shotblast_strip_regalvanising_paint'],
}

export const DEFAULT_PROCESS: Record<string, string> = {
  galvanised: 'strip_regalvanise',
}

// ─── Process helpers ─────────────────────────────────────────────────────────

export function availableProcesses(itemType: string) {
  const disabled = DISABLED_PROCESSES[itemType] ?? []
  return PROCESS_OPTIONS.map(o => ({ ...o, disabled: disabled.includes(o.value) }))
}

export function defaultProcessForType(itemType: string, current: string): string {
  const disabled = DISABLED_PROCESSES[itemType] ?? []
  if (disabled.includes(current)) return DEFAULT_PROCESS[itemType] ?? ''
  return current
}

// Validation — returns list of missing required fields
export function validateLine(line: ReceiptLine, edits: LineEdit): string[] {
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

// ─── Defect categories (mirrors old system exactly) ──────────────────────────

export const DEFECT_CATEGORIES: DefectCategory[] = [
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
export const MITIGATION_NO_QTY = new Set(['rust', 'threadedArticle', 'nonConformingPreGalv', 'delamination', 'damaged', 'paint'])

// ─── Defect helpers ──────────────────────────────────────────────────────────

export function defaultDefectValues(): Record<string, string> {
  const vals: Record<string, string> = {}
  for (const cat of DEFECT_CATEGORIES)
    for (const item of cat.items)
      vals[item.key] = item.default
  return vals
}

export function hasAnyDefect(defects: Record<string, string>): boolean {
  for (const cat of DEFECT_CATEGORIES)
    for (const item of cat.items)
      if ((defects[item.key] ?? item.default) !== item.default) return true
  return false
}

export function buildConditionNotes(
  defects: Record<string, string>,
  mitigations: MitigationSelection,
  quantities: MitigationQuantity,
  additionalComments: string,
): string {
  const output: Record<string, any> = {}

  for (const cat of DEFECT_CATEGORIES) {
    for (const item of cat.items) {
      const val = defects[item.key] ?? item.default
      if (val === item.default) continue

      // Boolean defects (yes/no)
      if (item.options.length === 2 && item.options.includes('yes')) {
        output[item.key] = val === 'yes'
      } else {
        // String defects (specific values)
        output[item.key] = val
      }

      // Mitigation selections
      const selected = mitigations[item.key] ?? []
      if (selected.length > 0) {
        const mitigationKey = item.key + 'Mitigation'
        const mitsWithQty: string[] = []
        for (const mit of selected) {
          if (MITIGATION_NO_QTY.has(item.key)) {
            mitsWithQty.push(mit)
          } else {
            const q = quantities[item.key]?.[mit]
            mitsWithQty.push(q != null ? `${mit}=${q}` : mit)
          }
        }
        output[mitigationKey] = mitsWithQty
      }

      // Quantity fields for holes (if present)
      if (item.key === 'holesInadequate') {
        const holeQtys = quantities[item.key]
        if (holeQtys) {
          output['ventHolesQty'] = holeQtys['Vent holes required'] ?? 0
          output['drainHolesQty'] = holeQtys['Drain holes required'] ?? 0
          output['jigHolesQty'] = holeQtys['Jig holes required'] ?? 0
        }
      }
      if (item.key === 'enclosedCavity') {
        const holeQtys = quantities[item.key]
        if (holeQtys) {
          output['cavityVentHolesQty'] = holeQtys['Cavity Vent holes required'] ?? 0
        }
      }
    }
  }

  if (additionalComments.trim()) {
    output['additionalComments'] = additionalComments.trim()
  }

  return JSON.stringify(output)
}

export function parseConditionNotes(notes: string): {
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

  try {
    const data = JSON.parse(notes)

    for (const cat of DEFECT_CATEGORIES) {
      for (const item of cat.items) {
        if (data[item.key] !== undefined) {
          if (typeof data[item.key] === 'boolean') {
            defects[item.key] = data[item.key] ? 'yes' : item.default
          } else if (typeof data[item.key] === 'string') {
            if (item.options.includes(data[item.key])) {
              defects[item.key] = data[item.key]
            }
          }
        }

        const mitigationKey = item.key + 'Mitigation'
        if (data[mitigationKey] && Array.isArray(data[mitigationKey])) {
          const selected: string[] = []
          const qtyMap: Record<string, number> = {}
          for (const token of data[mitigationKey]) {
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

        if (item.key === 'holesInadequate') {
          const qtyMap: Record<string, number> = {}
          if (data['ventHolesQty']) qtyMap['Vent holes required'] = data['ventHolesQty']
          if (data['drainHolesQty']) qtyMap['Drain holes required'] = data['drainHolesQty']
          if (data['jigHolesQty']) qtyMap['Jig holes required'] = data['jigHolesQty']
          if (Object.keys(qtyMap).length) quantities[item.key] = qtyMap
        }
        if (item.key === 'enclosedCavity') {
          const qtyMap: Record<string, number> = {}
          if (data['cavityVentHolesQty']) qtyMap['Cavity Vent holes required'] = data['cavityVentHolesQty']
          if (Object.keys(qtyMap).length) quantities[item.key] = qtyMap
        }
      }
    }

    if (data['additionalComments']) {
      comments = data['additionalComments']
    }
  } catch {
    // Legacy text-format fallback (pre-JSON condition_notes)
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
  }
  return { defects, mitigations, quantities, comments }
}

// ─── Bulk defect helpers ─────────────────────────────────────────────────────

// A defect key paired with a severity value and optional mitigations for bulk ops.
export type BulkDefectEntry = {
  key: string
  severity: string      // non-default value, e.g. 'light', 'yes', 'heavy'
  mitigations: string[] // toggle-only in bulk mode — no quantities
}

// Diff emitted by DefectModal in bulk mode. The backend applies add/remove
// against each line's existing condition_notes rather than replacing wholesale.
export type BulkDefectDiff = {
  add: BulkDefectEntry[]   // defects the receiver added or kept (with chosen severity)
  remove: string[]         // defect keys the receiver explicitly removed
}

// Compute the intersection of defects across multiple lines' condition_notes.
// A defect is "common" only if every line has it flagged. Severity conflicts
// (different values on different lines) are represented as kind='mixed'.
export type DefectIntersectionEntry = {
  key: string
  kind: 'all'              // same non-default severity on every line
  severity: string
  mitigations: string[]    // mitigations common to ALL lines for this defect
} | {
  key: string
  kind: 'mixed'            // flagged on all lines but severities differ
  severities: string[]     // distinct values present
  mitigations: string[]    // mitigations common to ALL lines for this defect
}

export function defectIntersection(conditionNotesArr: string[]): DefectIntersectionEntry[] {
  if (conditionNotesArr.length === 0) return []

  const parsed = conditionNotesArr.map(n => parseConditionNotes(n))

  // Find defect keys flagged (non-default) on every line
  const allItems = DEFECT_CATEGORIES.flatMap(c => c.items)
  const result: DefectIntersectionEntry[] = []

  for (const item of allItems) {
    const vals = parsed.map(p => p.defects[item.key] ?? item.default)
    // Must be non-default on every line
    if (vals.some(v => v === item.default)) continue

    const uniqueVals = [...new Set(vals)]

    // Common mitigations: only those present on every line
    const mitSets = parsed.map(p => new Set(p.mitigations[item.key] ?? []))
    const commonMits = mitSets.length > 0
      ? [...mitSets[0]].filter(m => mitSets.every(s => s.has(m)))
      : []

    if (uniqueVals.length === 1) {
      result.push({ key: item.key, kind: 'all', severity: uniqueVals[0], mitigations: commonMits })
    } else {
      result.push({ key: item.key, kind: 'mixed', severities: uniqueVals, mitigations: commonMits })
    }
  }

  return result
}

// ─── Display helpers ─────────────────────────────────────────────────────────

export function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function qty(n: number) {
  if (!n && n !== 0) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

// ─── GRN creation ────────────────────────────────────────────────────────────
// "Create GRN" is the no-POD-on-arrival path — used for after-hours captures or
// walk-in deliveries where DocuWare doesn't yet have a POD record. Posts to
// the backend which creates a fresh receipt and queues a GRN document upload
// to the DocuWare Documents cabinet.

export type CreateGRNLine = {
  delivery_note: string
  item_code: string
  item_description: string
  item_size: string
  item_quantity: string
  weight: string
  material_markings: string
  material_length: string
  job_number: string
  other: string
}

export type CreateGRNInput = {
  delivery_note_number: string
  order_number: string
  vehicle_registration: string
  delivery_date: string
  weighbridge_ticket_number: string
  company: string
  fabricator: string
  job_comments: string
  stored_by: string
  completion_date: string
  product_name: string
  processing_status: string
  lines: CreateGRNLine[]
}

export async function createGRN(input: CreateGRNInput): Promise<Receipt> {
  const res = await apiFetch('/grns', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: 'failed to create GRN' }))
    throw new Error(errBody.error || `failed to create GRN (${res.status})`)
  }
  return res.json()
}

// ─── Defect photos ────────────────────────────────────────────────────────────

export async function uploadDefectPhoto(
  receiptId: string,
  lineId: string,
  file: File,
): Promise<ReceiptDocument> {
  const form = new FormData()
  form.append('photo', file, file.name || 'defect.jpg')
  const res = await apiFetch(`/receipts/${receiptId}/lines/${lineId}/photos`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: 'failed to upload photo' }))
    throw new Error(errBody.error || `failed to upload photo (${res.status})`)
  }
  return res.json()
}

export async function deleteDefectPhoto(receiptId: string, photoId: string): Promise<void> {
  const res = await apiFetch(`/receipts/${receiptId}/photos/${photoId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    const errBody = await res.json().catch(() => ({ error: 'failed to delete photo' }))
    throw new Error(errBody.error || `failed to delete photo (${res.status})`)
  }
}

// Returns a URL the <img> tag can use. The endpoint is auth-required, so
// we have to fetch it as a blob and build an object URL — direct <img src>
// won't carry the bearer token.
export async function fetchDefectPhotoBlobUrl(
  receiptId: string,
  photoId: string,
): Promise<string> {
  const res = await apiFetch(`/receipts/${receiptId}/photos/${photoId}`, { method: 'GET' })
  if (!res.ok) throw new Error(`failed to fetch photo (${res.status})`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

// Fetch the generated GRN PDF as a blob URL the caller can hand to a new
// tab via window.open(...). Same auth-token-via-blob trick as photos.
export async function fetchGRNBlobUrl(receiptId: string): Promise<string> {
  const res = await apiFetch(`/receipts/${receiptId}/grn`, { method: 'GET' })
  if (!res.ok) {
    if (res.status === 404) throw new Error('GRN not generated yet')
    throw new Error(`failed to fetch GRN (${res.status})`)
  }
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}
