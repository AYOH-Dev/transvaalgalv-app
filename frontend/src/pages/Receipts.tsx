import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { clearToken, apiFetch } from '../auth'
import { useToast } from '../components/Toast'
import { useCurrentUser } from '../components/CurrentUser'
import {
  type ReceiptLine,
  type Receipt,
  type ReceiptDocument,
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
  uploadDefectPhoto,
  deleteDefectPhoto,
  fetchDefectPhotoBlobUrl,
  fetchGRNBlobUrl,
  type BulkDefectDiff,
} from '../lib/receipts'
import PhotoCapture, { useObjectUrl, type PhotoSyncStatus } from '../components/PhotoCapture'
import { DefectModal } from '../components/DefectModal'
import { BulkLineEditSheet, type BulkPatch } from '../components/BulkLineEditSheet'


// ─── Main component ───────────────────────────────────────────────────────────

export default function Receipts({ onLogout }: { onLogout?: () => void }) {
  const { showToast } = useToast()
  const { user } = useCurrentUser()
  const isAdmin = user?.role === 'admin'
  const [receipts, setReceipts]   = useState<Receipt[]>([])
  const [filtered, setFiltered]   = useState<Receipt[]>([])
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [search, setSearch]       = useState('')
  // Admin-only toggle. Defaults off so the active list stays focused.
  const [showArchived, setShowArchived] = useState(false)
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

  // Bulk operations — per-receipt line selection; at most one sheet open at a time
  const [bulkSelected, setBulkSelected] = useState<Record<string, Set<string>>>({})
  const [bulkSheetFor, setBulkSheetFor] = useState<string | null>(null)
  const [bulkSheetBusy, setBulkSheetBusy] = useState(false)
  const [bulkSheetErrors, setBulkSheetErrors] = useState<Record<string, string>>({})

  // Defect modal — store receiptId + lineId so we always look up the live line from state
  const [defectModal, setDefectModal] = useState<{
    receiptId: string
    lineId: string
    initial: Record<string, string>
    initialMitigations: MitigationSelection
    initialQuantities: MitigationQuantity
    initialComments: string
  } | null>(null)

  useEffect(() => { fetchReceipts() }, [showArchived])

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
      const url = showArchived ? '/receipts?include_archived=1' : '/receipts'
      const res = await apiFetch(url)
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
      setReceipts(prev => prev.map(r => r.id === id ? { ...r, lines: full.lines, documents: full.documents ?? [] } : r))
    } catch { /* silently fail, lines will just be empty */ }
    finally { setLoadingLines(null) }
  }

  // viewGRN opens the generated GRN PDF in a new tab. The endpoint is
  // auth-required so we materialise it as a blob URL. We open the popup
  // synchronously inside the click handler to avoid popup blockers, but
  // omit 'noopener' so we can navigate the tab when the blob is ready
  // (window.open with 'noopener' returns null by spec).
  async function viewGRN(receiptId: string) {
    const popup = window.open('about:blank', '_blank')
    if (popup) {
      try {
        popup.document.title = 'Loading GRN…'
        popup.document.body.innerHTML = '<p style="font:14px/1.4 system-ui,sans-serif;padding:1rem">Loading GRN…</p>'
      } catch { /* ignore */ }
    }
    try {
      const url = await fetchGRNBlobUrl(receiptId)
      if (popup && !popup.closed) {
        popup.location.replace(url)
      } else {
        const a = document.createElement('a')
        a.href = url
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
    } catch (err) {
      popup?.close()
      const msg = err instanceof Error ? err.message : 'Failed to load GRN'
      showToast(msg, 'error')
    }
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
      const updated = await res.json() as Receipt & { resynced_lines?: number }
      setReceipts(prev => prev.map(r => r.id === receiptId ? { ...r, ...updated } : r))
      setReceiptEdits(prev => { const n = { ...prev }; delete n[receiptId]; return n })
      const n = updated.resynced_lines ?? 0
      showToast(n > 0 ? `Receipt saved — ${n} line${n === 1 ? '' : 's'} re-syncing to DocuWare` : 'Receipt saved', 'success')
    } catch { showToast('Network error', 'error') }
    finally { setSavingReceipt(null) }
  }

  async function handleBulkApply(receiptId: string, { patch, markReceived, defectDiff }: BulkPatch) {
    const lineIds = [...(bulkSelected[receiptId] ?? [])]
    if (lineIds.length === 0) return
    setBulkSheetBusy(true)
    setBulkSheetErrors({})
    try {
      const finalPatch = { ...patch }
      if (markReceived) finalPatch.receiving_status = 'received'
      const bodyData: Record<string, unknown> = { line_ids: lineIds, patch: finalPatch }
      if (defectDiff && (defectDiff.add.length > 0 || defectDiff.remove.length > 0)) bodyData.defects = defectDiff
      const res = await apiFetch(`/receipts/${receiptId}/lines/bulk-update`, {
        method: 'POST',
        body: JSON.stringify(bodyData),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = body.error || `Save failed (${res.status})`
        const errs: Record<string, string> = {}
        for (const id of lineIds) errs[id] = msg
        setBulkSheetErrors(errs)
        showToast(msg, 'error')
        return
      }
      const body = await res.json() as { updated?: ReceiptLine[]; errors?: Record<string, string> }
      const updated = body.updated ?? []
      const errors = body.errors ?? {}
      if (updated.length > 0) {
        const byId = new Map(updated.map(l => [l.id, l]))
        setReceipts(prev => prev.map(r => r.id === receiptId
          ? { ...r, lines: r.lines.map(l => byId.get(l.id) ?? l) }
          : r))
      }
      if (Object.keys(errors).length > 0) {
        setBulkSheetErrors(errors)
        showToast(`Updated ${updated.length} of ${lineIds.length} — ${Object.keys(errors).length} failed`, 'info')
      } else {
        showToast(`Updated ${updated.length} line${updated.length === 1 ? '' : 's'}`, 'success')
        setBulkSheetFor(null)
        setBulkSelected(prev => { const n = { ...prev }; delete n[receiptId]; return n })
      }
    } catch { showToast('Network error', 'error') }
    finally { setBulkSheetBusy(false) }
  }

  function openDefectModal(receiptId: string, line: ReceiptLine) {    const liveConditionNotes = (lineEdits[line.id]?.condition_notes ?? line.condition_notes) || ''
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

  function findDefectPhoto(receiptId: string, lineId: string): ReceiptDocument | null {
    const r = receipts.find(r => r.id === receiptId)
    if (!r || !r.documents) return null
    return r.documents.find(d => d.category === 'defect_photo' && d.receipt_line_id === lineId) ?? null
  }

  async function handleUploadDefectPhoto(receiptId: string, lineId: string, file: File) {
    const doc = await uploadDefectPhoto(receiptId, lineId, file)
    setReceipts(prev => prev.map(r => {
      if (r.id !== receiptId) return r
      const docs = r.documents ?? []
      // Replace any existing defect photo for this line, else append.
      const next = docs.filter(d => !(d.category === 'defect_photo' && d.receipt_line_id === lineId))
      return { ...r, documents: [...next, doc] }
    }))
    showToast('Photo uploaded', 'success')
  }

  async function handleDeleteDefectPhoto(receiptId: string, photoId: string) {
    await deleteDefectPhoto(receiptId, photoId)
    setReceipts(prev => prev.map(r => {
      if (r.id !== receiptId) return r
      return { ...r, documents: (r.documents ?? []).filter(d => d.id !== photoId) }
    }))
    showToast('Photo removed', 'success')
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
      {/* Bulk edit sheet — portalled to body so it escapes stacking context */}
      {bulkSheetFor && (() => {
        const sheetReceipt = receipts.find(r => r.id === bulkSheetFor)
        const sheetLines = (sheetReceipt?.lines ?? []).filter(l => bulkSelected[bulkSheetFor!]?.has(l.id))
        return createPortal(
          <BulkLineEditSheet
            selectedLines={sheetLines}
            busy={bulkSheetBusy}
            errorByLineId={bulkSheetErrors}
            onApply={p => handleBulkApply(bulkSheetFor!, p)}
            onClose={() => { if (!bulkSheetBusy) { setBulkSheetFor(null); setBulkSheetErrors({}) } }}
          />,
          document.body,
        )
      })()}

      {/* Defect modal — portalled to body to escape any stacking context */}
      {defectModal && createPortal((() => {
        const liveLine = receipts
          .flatMap(r => r.lines || [])
          .find(l => l.id === defectModal.lineId)
        const label = liveLine
          ? `${liveLine.description || liveLine.material_description || liveLine.item_code || 'Line'} (Line ${liveLine.line_number})`
          : 'Line'
        const existingPhoto = findDefectPhoto(defectModal.receiptId, defectModal.lineId)
        return (
          <DefectModal
            mode="single"
            lineLabel={label}
            initial={defectModal.initial}
            initialMitigations={defectModal.initialMitigations}
            initialQuantities={defectModal.initialQuantities}
            additionalComments={defectModal.initialComments}
            existingPhoto={existingPhoto}
            receiptId={defectModal.receiptId}
            onUploadPhoto={file => handleUploadDefectPhoto(defectModal.receiptId, defectModal.lineId, file)}
            onDeletePhoto={async () => {
              if (existingPhoto) await handleDeleteDefectPhoto(defectModal.receiptId, existingPhoto.id)
            }}
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
          {isAdmin && (
            <button
              type="button"
              className={`btn btn-sm ${showArchived ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setShowArchived(s => !s)}
              disabled={loading}
              title="Include archived receipts"
              aria-pressed={showArchived}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 4 }}><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
              {showArchived ? 'Hide archived' : 'Show archived'}
            </button>
          )}
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

                        {/* Bulk selection action bar */}
                        {(bulkSelected[r.id]?.size ?? 0) > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.5rem 0.75rem', background: 'var(--blue)', borderRadius: 'var(--radius)', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff', flex: 1 }}>
                              {bulkSelected[r.id].size} line{bulkSelected[r.id].size === 1 ? '' : 's'} selected
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              style={{ background: '#fff', color: 'var(--blue)', border: 'none', fontWeight: 600 }}
                              onClick={() => { setBulkSheetErrors({}); setBulkSheetFor(r.id) }}
                            >
                              Bulk edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              style={{ color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.4)' }}
                              onClick={() => setBulkSelected(prev => { const n = { ...prev }; delete n[r.id]; return n })}
                            >
                              Clear
                            </button>
                          </div>
                        )}

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
                                  <label style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginTop: '0.125rem', cursor: 'pointer' }}>
                                    <input
                                      type="checkbox"
                                      checked={bulkSelected[r.id]?.has(line.id) ?? false}
                                      onChange={() => setBulkSelected(prev => {
                                        const cur = new Set(prev[r.id] ?? [])
                                        if (cur.has(line.id)) cur.delete(line.id); else cur.add(line.id)
                                        return { ...prev, [r.id]: cur }
                                      })}
                                      aria-label={`Select line ${line.line_number}`}
                                      style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--blue)' }}
                                    />
                                  </label>
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
                                      <DefectPhotoSummary receiptId={r.id} photo={findDefectPhoto(r.id, line.id)} />
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
                                        <input type="text" value={lv('stored_in') as string} onChange={e => patchLineEdit(line.id, 'stored_in', e.target.value)} placeholder="e.g. Cold room, Wash bay" style={inputStyle} />
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

                    {/* Status transitions + View GRN */}
                    {(nextStatuses.length > 0 || r.grn_document_id) && (
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
                        {r.grn_document_id && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => viewGRN(r.id)}
                            style={{ marginLeft: 'auto' }}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.3rem' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                            View GRN
                          </button>
                        )}
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

function DefectPhotoSummary({ receiptId, photo }: { receiptId: string; photo: ReceiptDocument | null }) {
  const photoId = photo?.id ?? null
  const getter = React.useMemo(
    () => (photoId ? () => fetchDefectPhotoBlobUrl(receiptId, photoId) : null),
    [receiptId, photoId],
  )
  const url = useObjectUrl(getter)
  if (!photo) return null
  return (
    <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center', flexWrap: 'wrap' }}>
      {url ? (
        <img
          src={url}
          alt={photo.filename || 'Defect photo'}
          style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
        />
      ) : (
        <div style={{ width: 56, height: 56, background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Defect photo</span>
        <DefectPhotoSyncBadge status={photo.docuware_status} />
      </div>
    </div>
  )
}

function DefectPhotoSyncBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; bg: string; fg: string }> = {
    pending: { label: 'Queued', bg: 'rgba(245,158,11,0.12)', fg: 'var(--amber, #b45309)' },
    in_progress: { label: 'Uploading…', bg: 'rgba(59,130,246,0.12)', fg: 'var(--blue, #1d4ed8)' },
    synced: { label: 'Synced', bg: 'rgba(34,197,94,0.12)', fg: 'var(--green, #166534)' },
    failed: { label: 'Failed — will retry', bg: 'rgba(239,68,68,0.12)', fg: 'var(--color-danger, #b91c1c)' },
  }
  const c = cfg[status] || cfg.pending
  return (
    <span style={{ fontSize: '0.6875rem', fontWeight: 600, padding: '0.125rem 0.5rem', borderRadius: '999px', background: c.bg, color: c.fg, alignSelf: 'flex-start' }}>
      {c.label}
    </span>
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
