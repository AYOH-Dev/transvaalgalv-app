import React, { useState } from 'react'
import {
  type ReceiptDocument,
  type MitigationSelection,
  type MitigationQuantity,
  type BulkDefectDiff,
  type DefectIntersectionEntry,
  DEFECT_CATEGORIES,
  MITIGATION_NO_QTY,
  defaultDefectValues,
  fetchDefectPhotoBlobUrl,
} from '../lib/receipts'
import PhotoCapture, { useObjectUrl, type PhotoSyncStatus } from './PhotoCapture'

// ─── Single mode ─────────────────────────────────────────────────────────────

type SingleModeProps = {
  mode: 'single'
  lineLabel: string
  initial: Record<string, string>
  initialMitigations: MitigationSelection
  initialQuantities: MitigationQuantity
  additionalComments: string
  existingPhoto: ReceiptDocument | null
  receiptId: string
  onUploadPhoto: (file: File) => Promise<void>
  onDeletePhoto: () => Promise<void>
  onConfirm: (defects: Record<string, string>, mitigations: MitigationSelection, quantities: MitigationQuantity, additionalComments: string) => void
  onClose: () => void
}

// ─── Bulk mode ───────────────────────────────────────────────────────────────

type BulkModeProps = {
  mode: 'bulk'
  lineCount: number
  // Intersection of defects across all selected lines, pre-computed by caller.
  intersection: DefectIntersectionEntry[]
  onConfirm: (diff: BulkDefectDiff) => void
  onClose: () => void
}

export type DefectModalProps = SingleModeProps | BulkModeProps

// ─── Component ───────────────────────────────────────────────────────────────

export function DefectModal(props: DefectModalProps) {
  return props.mode === 'bulk'
    ? <BulkDefectModal {...props} />
    : <SingleDefectModal {...props} />
}

// ─── Single (extracted from Receipts.tsx, behaviour unchanged) ────────────────

function SingleDefectModal({ lineLabel, initial, initialMitigations, initialQuantities, additionalComments: initialComments, existingPhoto, receiptId, onUploadPhoto, onDeletePhoto, onConfirm, onClose }: SingleModeProps) {
  const [defects, setDefectsState] = useState<Record<string, string>>(initial)
  const [mitigations, setMitigations] = useState<MitigationSelection>(initialMitigations)
  const [quantities, setQuantities] = useState<MitigationQuantity>(initialQuantities)
  const [comments, setComments] = useState(initialComments)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

  const photoId = existingPhoto?.id ?? null
  const photoGetter = React.useMemo(
    () => (photoId ? () => fetchDefectPhotoBlobUrl(receiptId, photoId) : null),
    [photoId, receiptId],
  )
  const blobUrl = useObjectUrl(photoGetter)

  async function handlePick(file: File) {
    setPhotoError(null); setPhotoBusy(true)
    try { await onUploadPhoto(file) }
    catch (e) { setPhotoError(e instanceof Error ? e.message : 'Upload failed') }
    finally { setPhotoBusy(false) }
  }

  async function handleRemove() {
    setPhotoError(null); setPhotoBusy(true)
    try { await onDeletePhoto() }
    catch (e) { setPhotoError(e instanceof Error ? e.message : 'Delete failed') }
    finally { setPhotoBusy(false) }
  }

  function setDefect(key: string, value: string) {
    setDefectsState(prev => ({ ...prev, [key]: value }))
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
    setQuantities(prev => ({ ...prev, [itemKey]: { ...(prev[itemKey] ?? {}), [mit]: value } }))
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
    const firstNonDefault = item.options.find(o => o !== item.default) ?? item.options[0]
    setDefect(itemKey, firstNonDefault)
    setPickerOpen(false); setPickerSearch('')
  }

  function removeDefect(itemKey: string) {
    const item = allItems.find(i => i.key === itemKey)
    if (!item) return
    setDefect(itemKey, item.default)
  }

  return (
    <div className="app-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="defect-modal-title">
      <div className="app-modal app-modal--lg" style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
        <div className="app-modal__header">
          <div>
            <h2 className="app-modal__title" id="defect-modal-title">Capture Defects</h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>{lineLabel}</p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ padding: '0.625rem 1.5rem', borderBottom: '1px solid var(--border)', background: flaggedItems.length === 0 ? 'rgba(34,197,94,0.06)' : 'var(--amber-dim)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem' }}>
          {flaggedItems.length === 0 ? (
            <><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span style={{ color: 'var(--green)', fontWeight: 600 }}>No defects flagged</span></>
          ) : (
            <><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span style={{ color: 'var(--amber)', fontWeight: 600 }}>{flaggedItems.length} defect{flaggedItems.length === 1 ? '' : 's'} flagged</span></>
          )}
        </div>

        <div className="app-modal__body" style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            {flaggedItems.map(item => {
              const val = defects[item.key] ?? item.default
              const isYesNo = item.options[0] === 'no' || item.options[0] === 'yes'
              const availableMitigations = item.mitigations[val] ?? []
              const selectedMits = mitigations[item.key] ?? []
              return (
                <div key={item.key} style={{ background: 'var(--surface)', border: '1.5px solid rgba(245,158,11,0.6)', borderRadius: 'var(--radius-lg)', padding: '0.875rem 1rem', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.categoryTitle}</span>
                      <h4 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</h4>
                    </div>
                    <button type="button" onClick={() => removeDefect(item.key)} aria-label={`Remove ${item.label}`} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.5rem', borderRadius: 'var(--radius)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '40px', minHeight: '40px' }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {item.options.filter(opt => opt !== item.default).map(opt => {
                      const selected = val === opt
                      return (
                        <button type="button" key={opt} onClick={() => setDefect(item.key, opt)} style={{ padding: '0.5rem 0.875rem', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.8125rem', border: `1.5px solid ${selected ? 'var(--amber)' : 'var(--border)'}`, background: selected ? 'var(--amber-dim)' : 'var(--surface-2)', color: selected ? 'var(--amber)' : 'var(--text-secondary)', fontWeight: selected ? 600 : 500, minHeight: '40px' }}>
                          {optionLabel(opt, isYesNo)}
                        </button>
                      )
                    })}
                  </div>
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
                                <input type="checkbox" checked={checked} onChange={() => toggleMitigation(item.key, m)} style={{ width: 18, height: 18, accentColor: 'var(--amber)', cursor: 'pointer' }} />
                                <span>{m}</span>
                              </label>
                              {showQty && (
                                <input type="number" min="0" value={checked ? q : ''} onChange={e => setMitigationQty(item.key, m, parseInt(e.target.value || '0', 10) || 0)} disabled={!checked} placeholder="Qty" aria-label={`${m} quantity`} style={{ width: 70, padding: '0.5rem', fontSize: '0.8125rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: checked ? '#fff' : 'rgba(0,0,0,0.03)', color: checked ? 'var(--text-primary)' : 'var(--text-muted)', minHeight: '40px' }} />
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

          {!pickerOpen && availableItems.length > 0 && (
            <button type="button" onClick={() => setPickerOpen(true)} style={{ width: '100%', padding: '0.875rem 1rem', borderRadius: 'var(--radius-lg)', border: '1.5px dashed var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', minHeight: '52px', marginBottom: '1rem' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {flaggedItems.length === 0 ? 'Add Defect' : 'Add Another Defect'}
            </button>
          )}

          {pickerOpen && (
            <div style={{ background: 'var(--surface-2)', border: '1.5px solid var(--blue)', borderRadius: 'var(--radius-lg)', padding: '0.875rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input type="search" autoFocus value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} placeholder="Search defect type…" aria-label="Search defect type" style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.875rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text-primary)', minHeight: '40px' }} />
                <button type="button" onClick={() => { setPickerOpen(false); setPickerSearch('') }} className="btn btn-ghost btn-sm" aria-label="Close picker">Cancel</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem', maxHeight: 320, overflowY: 'auto' }}>
                {filteredAvailable.map(item => (
                  <button type="button" key={item.key} onClick={() => addDefect(item.key)} style={{ textAlign: 'left', padding: '0.625rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.125rem', minHeight: '52px' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</span>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.categoryTitle}</span>
                  </button>
                ))}
                {filteredAvailable.length === 0 && <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '0.5rem' }}>No matches.</span>}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Defect Photo <span style={{ textTransform: 'none', fontWeight: 500, color: 'var(--text-muted)' }}>(optional)</span>
            </label>
            <PhotoCapture existingUrl={blobUrl} existingStatus={existingPhoto?.docuware_status as PhotoSyncStatus | undefined} existingFilename={existingPhoto?.filename} busy={photoBusy} onSelect={handlePick} onRemove={existingPhoto ? handleRemove : undefined} />
            {photoError && <span role="alert" style={{ fontSize: '0.75rem', color: 'var(--color-danger, #b91c1c)' }}>{photoError}</span>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Additional Comments</label>
            <textarea className="form-textarea" rows={3} placeholder="Any other observations…" value={comments} onChange={e => setComments(e.target.value)} style={{ minHeight: '88px' }} />
          </div>
        </div>

        <div className="app-modal__footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-success" onClick={() => onConfirm(defects, mitigations, quantities, comments)}>Save Defects</button>
        </div>
      </div>
    </div>
  )
}

// ─── Bulk (merge semantics — add/remove diff, no photo, toggle-only mits) ─────

function BulkDefectModal({ lineCount, intersection, onConfirm, onClose }: BulkModeProps) {
  const allItems = DEFECT_CATEGORIES.flatMap(cat => cat.items.map(it => ({ ...it, categoryTitle: cat.title })))

  // Build initial state from intersection.
  // kind='all'   → pre-selected with known severity
  // kind='mixed' → pre-selected with sentinel 'mixed' (user must resolve)
  const initDefects: Record<string, string> = {}
  const initMitigations: MitigationSelection = {}
  for (const entry of intersection) {
    initDefects[entry.key] = entry.kind === 'all' ? entry.severity : 'mixed'
    if (entry.mitigations.length) initMitigations[entry.key] = [...entry.mitigations]
  }

  const [defects, setDefectsState] = useState<Record<string, string>>(initDefects)
  const [mitigations, setMitigations] = useState<MitigationSelection>(initMitigations)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')

  // Track which keys were in the original intersection so we can compute removes
  const originalKeys = new Set(intersection.map(e => e.key))

  function setDefect(key: string, value: string) {
    setDefectsState(prev => ({ ...prev, [key]: value }))
    const item = allItems.find(i => i.key === key)
    if (item && value === item.default) {
      setMitigations(prev => { const n = { ...prev }; delete n[key]; return n })
    }
  }

  function removeDefect(key: string) {
    const item = allItems.find(i => i.key === key)
    if (!item) return
    setDefect(key, item.default)
  }

  function addDefect(itemKey: string) {
    const item = allItems.find(i => i.key === itemKey)
    if (!item) return
    const firstNonDefault = item.options.find(o => o !== item.default) ?? item.options[0]
    setDefect(itemKey, firstNonDefault)
    setPickerOpen(false); setPickerSearch('')
  }

  function toggleMitigation(itemKey: string, mit: string) {
    setMitigations(prev => {
      const current = prev[itemKey] ?? []
      const next = current.includes(mit) ? current.filter(m => m !== mit) : [...current, mit]
      const out = { ...prev }
      if (next.length) out[itemKey] = next; else delete out[itemKey]
      return out
    })
  }

  const flaggedItems = allItems.filter(it => {
    const v = defects[it.key]
    return v != null && v !== it.default
  })
  const flaggedKeys = new Set(flaggedItems.map(it => it.key))
  const availableItems = allItems.filter(it => !flaggedKeys.has(it.key))
  const filteredAvailable = pickerSearch.trim()
    ? availableItems.filter(it =>
        it.label.toLowerCase().includes(pickerSearch.toLowerCase()) ||
        it.categoryTitle.toLowerCase().includes(pickerSearch.toLowerCase()))
    : availableItems

  function handleConfirm() {
    const add: BulkDefectDiff['add'] = []
    const remove: string[] = []

    for (const item of flaggedItems) {
      const sev = defects[item.key]
      // Skip if user left severity as 'mixed' without resolving — treat as no change
      if (sev === 'mixed') continue
      add.push({ key: item.key, severity: sev, mitigations: mitigations[item.key] ?? [] })
    }

    // Keys that were in the intersection but the user removed
    for (const key of originalKeys) {
      const item = allItems.find(i => i.key === key)
      if (!item) continue
      const v = defects[key] ?? item.default
      if (v === item.default) remove.push(key)
    }

    onConfirm({ add, remove })
  }

  const unresolvedMixed = flaggedItems.filter(it => defects[it.key] === 'mixed')

  return (
    <div className="app-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="defect-modal-title">
      <div className="app-modal app-modal--lg" style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
        <div className="app-modal__header">
          <div>
            <h2 className="app-modal__title" id="defect-modal-title">Bulk Defects · {lineCount} lines</h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>
              Showing defects common to all selected lines. Adding a defect applies to all; removing one strips it from all.
            </p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {unresolvedMixed.length > 0 && (
          <div style={{ padding: '0.625rem 1.5rem', borderBottom: '1px solid var(--border)', background: 'var(--amber-dim)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span style={{ color: 'var(--amber)', fontWeight: 600 }}>
              {unresolvedMixed.length} defect{unresolvedMixed.length === 1 ? '' : 's'} with mixed severities — pick one to apply to all lines, or leave as-is to skip.
            </span>
          </div>
        )}

        <div className="app-modal__body" style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            {flaggedItems.map(item => {
              const val = defects[item.key]
              const isMixed = val === 'mixed'
              const isYesNo = item.options[0] === 'no' || item.options[0] === 'yes'
              const availableMitigations = isMixed ? [] : (item.mitigations[val] ?? [])
              const selectedMits = mitigations[item.key] ?? []

              return (
                <div key={item.key} style={{ background: 'var(--surface)', border: `1.5px solid ${isMixed ? 'var(--blue)' : 'rgba(245,158,11,0.6)'}`, borderRadius: 'var(--radius-lg)', padding: '0.875rem 1rem', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.categoryTitle}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <h4 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</h4>
                        {isMixed && <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '0.125rem 0.5rem', borderRadius: '999px', background: 'rgba(59,130,246,0.12)', color: 'var(--blue)' }}>Mixed — pick severity to unify</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => removeDefect(item.key)} aria-label={`Remove ${item.label} from all lines`} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.5rem', borderRadius: 'var(--radius)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '40px', minHeight: '40px' }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {item.options.filter(opt => opt !== item.default).map(opt => {
                      const selected = val === opt
                      return (
                        <button type="button" key={opt} onClick={() => setDefect(item.key, opt)} style={{ padding: '0.5rem 0.875rem', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.8125rem', border: `1.5px solid ${selected ? 'var(--amber)' : 'var(--border)'}`, background: selected ? 'var(--amber-dim)' : 'var(--surface-2)', color: selected ? 'var(--amber)' : 'var(--text-secondary)', fontWeight: selected ? 600 : 500, minHeight: '40px' }}>
                          {isYesNo ? (opt === 'no' ? 'No Issues' : 'Issues Found') : (opt.charAt(0).toUpperCase() + opt.slice(1))}
                        </button>
                      )
                    })}
                  </div>

                  {/* Mitigations — toggle-only in bulk mode (no qty inputs) */}
                  {!isMixed && availableMitigations.length > 0 && (
                    <div style={{ marginTop: '0.875rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--border)' }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Mitigations</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                        {availableMitigations.map(m => {
                          const checked = selectedMits.includes(m)
                          return (
                            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8125rem', minHeight: '40px' }}>
                              <input type="checkbox" checked={checked} onChange={() => toggleMitigation(item.key, m)} style={{ width: 18, height: 18, accentColor: 'var(--amber)', cursor: 'pointer' }} />
                              <span>{m}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {!pickerOpen && availableItems.length > 0 && (
            <button type="button" onClick={() => setPickerOpen(true)} style={{ width: '100%', padding: '0.875rem 1rem', borderRadius: 'var(--radius-lg)', border: '1.5px dashed var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', minHeight: '52px', marginBottom: '1rem' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {flaggedItems.length === 0 ? 'Add Defect to All Lines' : 'Add Another Defect to All Lines'}
            </button>
          )}

          {pickerOpen && (
            <div style={{ background: 'var(--surface-2)', border: '1.5px solid var(--blue)', borderRadius: 'var(--radius-lg)', padding: '0.875rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input type="search" autoFocus value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} placeholder="Search defect type…" aria-label="Search defect type" style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.875rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text-primary)', minHeight: '40px' }} />
                <button type="button" onClick={() => { setPickerOpen(false); setPickerSearch('') }} className="btn btn-ghost btn-sm" aria-label="Close picker">Cancel</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem', maxHeight: 320, overflowY: 'auto' }}>
                {filteredAvailable.map(item => (
                  <button type="button" key={item.key} onClick={() => addDefect(item.key)} style={{ textAlign: 'left', padding: '0.625rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.125rem', minHeight: '52px' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</span>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.categoryTitle}</span>
                  </button>
                ))}
                {filteredAvailable.length === 0 && <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '0.5rem' }}>No matches.</span>}
              </div>
            </div>
          )}
        </div>

        <div className="app-modal__footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-success" onClick={handleConfirm}>Apply to {lineCount} lines</button>
        </div>
      </div>
    </div>
  )
}
