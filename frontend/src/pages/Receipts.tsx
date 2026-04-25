import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { clearToken, apiFetch } from '../auth'
import { useToast } from '../components/Toast'
import {
  type ReceiptLine,
  type Receipt,
  type LineEdit,
  type ReceiptEdit,
  type MitigationSelection,
  type MitigationQuantity,
  STATUS_LABELS,
  STATUS_BADGE,
  NEXT_STATUSES,
  PROCESS_OPTIONS,
  BAY_OPTIONS,
  QTY_DISCREPANCY_OPTIONS,
  ITEM_TYPE_OPTIONS,
  PACKAGING_OPTIONS,
  DEFECT_CATEGORIES,
  MITIGATION_NO_QTY,
  availableProcesses,
  defaultProcessForType,
  validateLine,
  defaultDefectValues,
  hasAnyDefect,
  buildConditionNotes,
  parseConditionNotes,
  fmtDate,
  qty,
} from '../lib/receipts'

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
  const [defects, setDefects] = useState<Record<string, string>>(initial)
  const [mitigations, setMitigations] = useState<MitigationSelection>(initialMitigations)
  const [quantities, setQuantities] = useState<MitigationQuantity>(initialQuantities)
  const [comments, setComments] = useState(initialComments)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')

  function setDefect(key: string, value: string) {
    setDefects(prev => ({ ...prev, [key]: value }))
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
    setQuantities(prev => {
      if ((mitigations[itemKey] ?? []).includes(mit)) {
        const item = { ...(prev[itemKey] ?? {}) }
        delete item[mit]
        const out = { ...prev }
        if (Object.keys(item).length) out[itemKey] = item; else delete out[itemKey]
        return out
      }
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

  const allItems = DEFECT_CATEGORIES.flatMap(cat => cat.items.map(it => ({ ...it, categoryTitle: cat.title })))
  const flaggedItems = allItems.filter(it => (defects[it.key] ?? it.default) !== it.default)
  const flaggedKeys = new Set(flaggedItems.map(it => it.key))
  const availableItems = allItems.filter(it => !flaggedKeys.has(it.key))
  const filteredAvailable = pickerSearch.trim()
    ? availableItems.filter(it =>
        it.label.toLowerCase().includes(pickerSearch.toLowerCase()) ||
        it.categoryTitle.toLowerCase().includes(pickerSearch.toLowerCase()))
    : availableItems

  function optionLabel(opt: string, isYesNo: boolean) {
    if (isYesNo) return opt === 'no' ? 'No Issues' : 'Issues Found'
    return opt.charAt(0).toUpperCase() + opt.slice(1)
  }

  function addDefect(itemKey: string) {
    const item = allItems.find(i => i.key === itemKey)
    if (!item) return
    // Pick the first non-default option as the initial value
    const firstNonDefault = item.options.find(o => o !== item.default) ?? item.options[0]
    setDefect(itemKey, firstNonDefault)
    setPickerOpen(false)
    setPickerSearch('')
  }

  function removeDefect(itemKey: string) {
    const item = allItems.find(i => i.key === itemKey)
    if (!item) return
    setDefect(itemKey, item.default)
  }

  return (
    <div className="app-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="defect-modal-title">
      <div className="app-modal app-modal--lg" style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
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

        {/* Status strip */}
        <div style={{ padding: '0.625rem 1.5rem', borderBottom: '1px solid var(--border)', background: flaggedItems.length === 0 ? 'rgba(34,197,94,0.06)' : 'var(--amber-dim)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem' }}>
          {flaggedItems.length === 0 ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span style={{ color: 'var(--green)', fontWeight: 600 }}>No defects flagged</span>
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span style={{ color: 'var(--amber)', fontWeight: 600 }}>{flaggedItems.length} defect{flaggedItems.length === 1 ? '' : 's'} flagged</span>
            </>
          )}
        </div>

        {/* Body */}
        <div className="app-modal__body" style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          {/* Defect chips — one per flagged item */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            {flaggedItems.map(item => {
              const val = defects[item.key] ?? item.default
              const isYesNo = item.options[0] === 'no' || item.options[0] === 'yes'
              const availableMitigations = item.mitigations[val] ?? []
              const selectedMits = mitigations[item.key] ?? []

              return (
                <div
                  key={item.key}
                  style={{
                    background: 'var(--surface)',
                    border: '1.5px solid rgba(245,158,11,0.6)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '0.875rem 1rem',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  }}
                >
                  {/* Chip header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.categoryTitle}</span>
                      <h4 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDefect(item.key)}
                      aria-label={`Remove ${item.label}`}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.5rem', borderRadius: 'var(--radius)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '40px', minHeight: '40px' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>

                  {/* Severity / value pills */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {item.options.filter(opt => opt !== item.default).map(opt => {
                      const selected = val === opt
                      return (
                        <button
                          type="button"
                          key={opt}
                          onClick={() => setDefect(item.key, opt)}
                          style={{
                            padding: '0.5rem 0.875rem',
                            borderRadius: 'var(--radius)',
                            cursor: 'pointer',
                            fontSize: '0.8125rem',
                            border: `1.5px solid ${selected ? 'var(--amber)' : 'var(--border)'}`,
                            background: selected ? 'var(--amber-dim)' : 'var(--surface-2)',
                            color: selected ? 'var(--amber)' : 'var(--text-secondary)',
                            fontWeight: selected ? 600 : 500,
                            minHeight: '40px',
                          }}
                        >
                          {optionLabel(opt, isYesNo)}
                        </button>
                      )
                    })}
                  </div>

                  {/* Mitigations */}
                  {availableMitigations.length > 0 && (
                    <div style={{ marginTop: '0.875rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--border)' }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Mitigations</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                        {availableMitigations.map(m => {
                          const checked = selectedMits.includes(m)
                          const showQty = !MITIGATION_NO_QTY.has(item.key)
                          const q = quantities[item.key]?.[m] ?? 0
                          return (
                            <div key={m} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, cursor: 'pointer', fontSize: '0.8125rem', minHeight: '40px' }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleMitigation(item.key, m)}
                                  style={{ width: 18, height: 18, accentColor: 'var(--amber)', cursor: 'pointer' }}
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
                                  style={{
                                    width: 70,
                                    padding: '0.5rem',
                                    fontSize: '0.8125rem',
                                    border: '1px solid var(--border)',
                                    borderRadius: 'var(--radius-sm)',
                                    background: checked ? '#fff' : 'rgba(0,0,0,0.03)',
                                    color: checked ? 'var(--text-primary)' : 'var(--text-muted)',
                                    minHeight: '40px',
                                  }}
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
          </div>

          {/* + Add Defect picker */}
          {!pickerOpen && availableItems.length > 0 && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              style={{
                width: '100%',
                padding: '0.875rem 1rem',
                borderRadius: 'var(--radius-lg)',
                border: '1.5px dashed var(--border)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                minHeight: '52px',
                marginBottom: '1rem',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {flaggedItems.length === 0 ? 'Add Defect' : 'Add Another Defect'}
            </button>
          )}

          {pickerOpen && (
            <div style={{ background: 'var(--surface-2)', border: '1.5px solid var(--blue)', borderRadius: 'var(--radius-lg)', padding: '0.875rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input
                  type="search"
                  autoFocus
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                  placeholder="Search defect type…"
                  aria-label="Search defect type"
                  style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.875rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text-primary)', minHeight: '40px' }}
                />
                <button
                  type="button"
                  onClick={() => { setPickerOpen(false); setPickerSearch('') }}
                  className="btn btn-ghost btn-sm"
                  aria-label="Close picker"
                >
                  Cancel
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem', maxHeight: 320, overflowY: 'auto' }}>
                {filteredAvailable.map(item => (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() => addDefect(item.key)}
                    style={{
                      textAlign: 'left',
                      padding: '0.625rem 0.75rem',
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.125rem',
                      minHeight: '52px',
                    }}
                  >
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</span>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.categoryTitle}</span>
                  </button>
                ))}
                {filteredAvailable.length === 0 && (
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '0.5rem' }}>No matches.</span>
                )}
              </div>
            </div>
          )}

          {/* Additional comments */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Additional Comments</label>
            <textarea
              className="form-textarea"
              rows={3}
              placeholder="Any other observations…"
              value={comments}
              onChange={e => setComments(e.target.value)}
              style={{ minHeight: '88px' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="app-modal__footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-success" onClick={() => onConfirm(defects, mitigations, quantities, comments)}>
            Save Defects
          </button>
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

  // Per-receipt line filter state (keyed by receipt id)
  type LineStatusFilter = 'all' | 'draft' | 'received' | 'defects'
  const [lineSearch, setLineSearch] = useState<Record<string, string>>({})
  const [lineStatusFilter, setLineStatusFilter] = useState<Record<string, LineStatusFilter>>({})

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
                      {r.weighbridge_ticket_number ? `WB ${r.weighbridge_ticket_number}` : (r.receipt_number || '—')}
                    </span>
                    <span className="receipt-card__supplier">
                      {r.customer_name || r.supplier_name || '—'}
                      {r.delivery_note_number ? ` · DN ${r.delivery_note_number}` : ''}
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
                    {!loadingLines && r.lines && r.lines.length > 0 && (() => {
                      const search = (lineSearch[r.id] ?? '').trim().toLowerCase()
                      const statusFilter: LineStatusFilter = lineStatusFilter[r.id] ?? 'all'
                      const showFilterBar = r.lines.length > 3
                      const matchesFilter = (line: ReceiptLine) => {
                        if (search) {
                          const haystack = [
                            line.item_code, line.description, line.material_code,
                            line.material_description, line.material_size, line.material_markings,
                            line.internal_description,
                          ].filter(Boolean).join(' ').toLowerCase()
                          if (!haystack.includes(search)) return false
                        }
                        if (statusFilter === 'draft'    && line.receiving_status !== 'draft')    return false
                        if (statusFilter === 'received' && line.receiving_status !== 'received') return false
                        if (statusFilter === 'defects'  && line.discrepancy      !== 'defects_noted') return false
                        return true
                      }
                      const visibleCount = r.lines.filter(matchesFilter).length
                      const statusCounts = {
                        all:      r.lines.length,
                        draft:    r.lines.filter(l => l.receiving_status === 'draft').length,
                        received: r.lines.filter(l => l.receiving_status === 'received').length,
                        defects:  r.lines.filter(l => l.discrepancy === 'defects_noted').length,
                      }
                      const clearFilters = () => {
                        setLineSearch(prev => { const n = { ...prev }; delete n[r.id]; return n })
                        setLineStatusFilter(prev => { const n = { ...prev }; delete n[r.id]; return n })
                      }
                      const chip = (key: LineStatusFilter, label: string, count: number) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setLineStatusFilter(prev => ({ ...prev, [r.id]: key }))}
                          style={{
                            padding: '0.375rem 0.75rem',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            borderRadius: '999px',
                            border: '1px solid ' + (statusFilter === key ? 'var(--blue)' : 'var(--border)'),
                            background: statusFilter === key ? 'var(--blue)' : 'var(--surface)',
                            color: statusFilter === key ? '#fff' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {label} <span style={{ opacity: 0.75, marginLeft: 2 }}>{count}</span>
                        </button>
                      )
                      return (
                      <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Line Items ({r.lines.length})
                          </div>
                          {showFilterBar && (search || statusFilter !== 'all') && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Showing {visibleCount} of {r.lines.length}
                            </span>
                          )}
                        </div>

                        {showFilterBar && (
                          <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface-2, #f8fafc)', padding: '0.625rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                              <input
                                type="search"
                                value={lineSearch[r.id] ?? ''}
                                onChange={e => setLineSearch(prev => ({ ...prev, [r.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Escape') setLineSearch(prev => { const n = { ...prev }; delete n[r.id]; return n }) }}
                                placeholder="Search item code, description, size…"
                                aria-label="Search line items"
                                style={{ width: '100%', padding: '0.5rem 2rem 0.5rem 2rem', fontSize: '0.8125rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                              />
                              {(lineSearch[r.id] ?? '') && (
                                <button
                                  type="button"
                                  onClick={() => setLineSearch(prev => { const n = { ...prev }; delete n[r.id]; return n })}
                                  aria-label="Clear search"
                                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'inline-flex' }}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                              {chip('all',      'All',      statusCounts.all)}
                              {chip('draft',    'Draft',    statusCounts.draft)}
                              {chip('received', 'Received', statusCounts.received)}
                              {chip('defects',  'Defects',  statusCounts.defects)}
                            </div>
                          </div>
                        )}

                        {showFilterBar && visibleCount === 0 && (
                          <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
                            No lines match.{' '}
                            <button type="button" onClick={clearFilters} style={{ border: 'none', background: 'none', color: 'var(--blue)', cursor: 'pointer', fontWeight: 600, padding: 0 }}>Clear filters</button>
                          </div>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {r.lines.map(line => {
                            const visible = matchesFilter(line)
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
                              <div key={line.id} style={{ display: visible ? 'block' : 'none', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>

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
                      )
                    })()}
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
