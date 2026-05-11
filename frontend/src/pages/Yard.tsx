import React, { useCallback, useEffect, useState } from 'react'
import { apiBaseUrl, apiFetch, clearToken } from '../auth'
import { BRAND } from '../lib/branding'
import { useToast } from '../components/Toast'
import {
  type Receipt,
  type ReceiptLine,
  type LineEdit,
  type ReceiptEdit,
  type MitigationSelection,
  type MitigationQuantity,
  type BulkDefectDiff,
  DEFECT_CATEGORIES,
  MITIGATION_NO_QTY,
  BAY_OPTIONS,
  availableProcesses,
  defaultDefectValues,
  hasAnyDefect,
  buildConditionNotes,
  uploadDefectPhoto,
  fetchGRNBlobUrl,
} from '../lib/receipts'
import PhotoCapture from '../components/PhotoCapture'
import { BulkLineEditSheet, type BulkPatch } from '../components/BulkLineEditSheet'
import '../styles/yard.css'

// All defect items flattened from the canonical category list. The yard surfaces
// the full set so receivers can flag every mitigatable defect — they're the
// source of truth for downstream processing.
const ALL_DEFECT_ITEMS = DEFECT_CATEGORIES.flatMap(c => c.items)

// ── Icons (minimal inline set so we don't depend on the design's Icon comp) ──
type IconName = 'truck' | 'flag' | 'check' | 'play' | 'doc' | 'minus' | 'plus' | 'alert' | 'close' | 'chevL' | 'chevR' | 'pencil'
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const s = size
  const common = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'truck':  return <svg {...common}><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
    case 'flag':   return <svg {...common}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
    case 'check':  return <svg {...common}><polyline points="20 6 9 17 4 12"/></svg>
    case 'play':   return <svg {...common}><polygon points="5 3 19 12 5 21 5 3"/></svg>
    case 'doc':    return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    case 'minus':  return <svg {...common}><line x1="5" y1="12" x2="19" y2="12"/></svg>
    case 'plus':   return <svg {...common}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    case 'alert':  return <svg {...common}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    case 'close':  return <svg {...common}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    case 'chevL':  return <svg {...common}><polyline points="15 18 9 12 15 6"/></svg>
    case 'chevR':  return <svg {...common}><polyline points="9 18 15 12 9 6"/></svg>
    case 'pencil': return <svg {...common}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
  }
}

// ── Per-line yard state ──────────────────────────────────────────────────────
// Lives in the Yard root so list/detail/walkthrough share it. Persisted to the
// backend lazily on markReceived (one PATCH per line).
type YardLineState = {
  received_quantity?: number
  discrepancy?: 'none' | 'short' | 'over'
  item_type?: string
  process?: string
  packaging?: string
  bay?: string
  stored_in?: string
  accessories?: string
  comments?: string
  defects?: Record<string, string>
  mitigations?: MitigationSelection
  quantities?: MitigationQuantity
  hasDefects?: boolean
  defects_done?: boolean
  notes?: string
  received?: boolean
  // Defect photo held in memory until the line is confirmed. Strategy B:
  // upload only after the line PATCH succeeds in markReceived, so a
  // cleared/abandoned defect doesn't leave an orphaned photo on the server.
  defectPhoto?: File
}
type LineStateMap = Record<string, YardLineState>

// Disabled-process map matches the canonical lib but expressed for the yard's
// 3-option item-type radio (lib uses 'galvanised'/'blacksteel'/'other').
function disabledForType(itemType?: string): string[] {
  if (!itemType) return []
  return availableProcesses(itemType).filter(o => o.disabled).map(o => o.value)
}

// ── Reachability indicator ──────────────────────────────────────────────────
// "Online" means the API responded to /ready in the last poll. We also flip
// to offline immediately on browser network events so the receiver sees a
// fresh signal without waiting for the next poll. Re-checks on focus too,
// so a tablet coming out of sleep gets an immediate refresh.
const READY_POLL_MS = 30_000
function useApiReachable(): boolean {
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const check = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (!cancelled) setOnline(false)
        return
      }
      // Bypass apiFetch — /ready is unauthenticated and we don't want a 401
      // to clear the token while polling.
      const url = (apiBaseUrl().replace(/\/$/, '')) + '/ready'
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } })
        if (!cancelled) setOnline(res.ok)
      } catch {
        if (!cancelled) setOnline(false)
      }
    }
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { check(); schedule() }, READY_POLL_MS)
    }

    check()
    schedule()

    const onOnline  = () => { setOnline(true);  check() }
    const onOffline = () => setOnline(false)
    const onFocus   = () => check()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return online
}

// ════════════════════════════════════════════════════════════════════════════
// ROOT
// ════════════════════════════════════════════════════════════════════════════
export default function Yard({ onLogout }: { onLogout?: () => void }) {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<'list' | 'detail' | 'walk'>('list')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [walkStartLineId, setWalkStartLineId] = useState<string | null>(null)
  const [lineState, setLineState] = useState<LineStateMap>({})
  const [savingLineId, setSavingLineId] = useState<string | null>(null)
  const online = useApiReachable()
  const { showToast } = useToast()
  const [outdoor, setOutdoor] = useOutdoorMode()

  const fetchReceipts = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await apiFetch('/receipts')
      if (res.status === 401) { clearToken(); onLogout?.(); return }
      if (!res.ok) { setError(`Failed to load (${res.status})`); return }
      const data = await res.json()
      setReceipts(data.receipts || [])
    } catch (err) {
      if ((err as Error).message === 'unauthorized') { clearToken(); onLogout?.(); return }
      setError('Network error')
    } finally { setLoading(false) }
  }, [onLogout])

  useEffect(() => { fetchReceipts() }, [fetchReceipts])

  // Lazy-load lines for the active receipt when entering detail
  useEffect(() => {
    if (view !== 'detail' || !activeId) return
    const r = receipts.find(x => x.id === activeId)
    if (!r || (r.lines && r.lines.length > 0)) return
    apiFetch(`/receipts/${activeId}`)
      .then(res => res.ok ? res.json() : null)
      .then((full: Receipt | null) => {
        if (!full) return
        setReceipts(prev => prev.map(x => x.id === activeId ? { ...x, lines: full.lines } : x))
      })
      .catch(() => { /* ignore — empty lines surfaced as empty state */ })
  }, [view, activeId, receipts])

  const active = receipts.find(p => p.id === activeId) || null

  const updateLine = useCallback((lineId: string, patch: Partial<YardLineState>) => {
    setLineState(s => ({ ...s, [lineId]: { ...s[lineId], ...patch } }))
  }, [])

  const persistLine = useCallback(async (receiptId: string, line: ReceiptLine, st: YardLineState): Promise<{ ok: true } | { ok: false; error: string }> => {
    const edit: LineEdit = {
      received_quantity: st.received_quantity ?? line.expected_quantity,
      quantity_discrepancy: st.discrepancy ?? 'none',
      item_type: st.item_type,
      process: st.process,
      packaging_method: st.packaging,
      receiving_status: 'received',
    }
    // Storage fields are optional — only send when the receiver supplied a
    // value, so omitted fields don't blank out anything saved earlier.
    if (st.bay !== undefined)         edit.bay = st.bay
    if (st.stored_in !== undefined)   edit.stored_in = st.stored_in
    if (st.accessories !== undefined) edit.accessories = st.accessories
    if (st.comments !== undefined)    edit.comments = st.comments
    const notes = (st.notes ?? '').trim()
    const hasDefects = !!(st.defects && st.hasDefects)
    if (hasDefects || notes) {
      edit.condition_notes = buildConditionNotes(
        st.defects ?? {},
        st.mitigations ?? {},
        st.quantities ?? {},
        notes,
      )
    }
    if (hasDefects) edit.discrepancy = 'defects_noted'

    setSavingLineId(line.id)
    try {
      const res = await apiFetch(`/receipts/${receiptId}/lines/${line.id}`, {
        method: 'PATCH',
        body: JSON.stringify(edit),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { ok: false, error: body.error || `Save failed (${res.status})` }
      }
      const updatedLine: ReceiptLine = await res.json()
      setReceipts(prev => prev.map(r => r.id === receiptId
        ? { ...r, lines: r.lines.map(l => l.id === updatedLine.id ? updatedLine : l) }
        : r))

      // Strategy B: upload the held-in-memory defect photo only after the
      // line PATCH succeeds. Failure here is non-fatal — the line is already
      // saved with its defect flag, and the receiver can re-attach the
      // photo from the Receipts page. Surface the partial-success via toast.
      if (hasDefects && st.defectPhoto) {
        try {
          await uploadDefectPhoto(receiptId, line.id, st.defectPhoto)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'photo upload failed'
          showToast(`Line saved, but photo upload failed: ${msg}`, 'error')
        }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message === 'unauthorized' ? 'Session expired — sign in again' : 'Network error — try again' }
    } finally { setSavingLineId(null) }
  }, [showToast])

  // Bulk apply: single round-trip to the backend bulk endpoint. The server
  // applies the patch per line and returns per-line results; partial success
  // is the contract.
  const persistBulk = useCallback(async (
    receiptId: string,
    lineIds: string[],
    edit: LineEdit,
    markReceived: boolean,
    defects?: BulkDefectDiff,
  ): Promise<{ updated: ReceiptLine[]; errors: Record<string, string> }> => {
    const patch: LineEdit = { ...edit }
    if (markReceived) patch.receiving_status = 'received'

    let updated: ReceiptLine[] = []
    let errors: Record<string, string> = {}
    try {
      const reqBody: Record<string, unknown> = { line_ids: lineIds, patch }
      if (defects && (defects.add.length > 0 || defects.remove.length > 0)) reqBody.defects = defects
      const res = await apiFetch(`/receipts/${receiptId}/lines/bulk-update`, {
        method: 'POST',
        body: JSON.stringify(reqBody),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        // Whole-batch failure (auth/validation/etc) — surface against every id.
        const msg = body.error || `Save failed (${res.status})`
        for (const id of lineIds) errors[id] = msg
        return { updated, errors }
      }
      const body = await res.json() as { updated?: ReceiptLine[]; errors?: Record<string, string> }
      updated = body.updated ?? []
      errors = body.errors ?? {}
    } catch (err) {
      const msg = (err as Error).message === 'unauthorized'
        ? 'Session expired — sign in again'
        : 'Network error — try again'
      for (const id of lineIds) errors[id] = msg
      return { updated, errors }
    }

    if (updated.length) {
      const byId = new Map(updated.map(l => [l.id, l]))
      setReceipts(prev => prev.map(r => r.id === receiptId
        ? { ...r, lines: r.lines.map(l => byId.get(l.id) ?? l) }
        : r))
      // Mirror per-line behavior: persisting receiving_status='received' should
      // also flip the lineState flag so list/walkthrough views update.
      if (markReceived) {
        setLineState(prev => {
          const next = { ...prev }
          for (const l of updated) {
            next[l.id] = { ...next[l.id], received: true }
          }
          return next
        })
      }
    }
    return { updated, errors }
  }, [])

  const [viewingPODFor, setViewingPODFor] = useState<string | null>(null)
  const [podModal, setPodModal] = useState<{ url: string; receiptId: string } | null>(null)
  const viewPOD = useCallback(async (receiptId: string) => {
    setViewingPODFor(receiptId)
    try {
      const res = await apiFetch(`/receipts/${receiptId}/pod-link`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (res.status === 404)      showToast('No POD on file for this load', 'info')
        else if (res.status === 503) showToast('POD viewer is not configured', 'error')
        else                         showToast(body.error || `Failed to open POD (${res.status})`, 'error')
        return
      }
      const { url } = await res.json() as { url: string }
      setPodModal({ url, receiptId })
    } catch {
      showToast('Network error — could not open POD', 'error')
    } finally {
      setViewingPODFor(null)
    }
  }, [showToast])

  const persistReceipt = useCallback(async (receiptId: string, edits: ReceiptEdit): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (Object.keys(edits).length === 0) return { ok: true }
    try {
      const res = await apiFetch(`/receipts/${receiptId}`, {
        method: 'PATCH',
        body: JSON.stringify(edits),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { ok: false, error: body.error || `Save failed (${res.status})` }
      }
      const body = await res.json() as Receipt & { resynced_lines?: number }
      setReceipts(prev => prev.map(r => r.id === receiptId ? { ...r, ...body } : r))
      const n = body.resynced_lines ?? 0
      if (n > 0) {
        showToast(`Header updated — ${n} line${n === 1 ? '' : 's'} re-syncing to DocuWare`, 'info')
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message === 'unauthorized' ? 'Session expired — sign in again' : 'Network error — try again' }
    }
  }, [showToast])

  // viewGRN fetches the generated PDF and opens it in a new tab. The
  // endpoint is auth-required so we materialise the response as a blob URL.
  //
  // Two browser-spec gotchas we have to work around:
  //   - window.open(url, '_blank', 'noopener') returns null by spec, so we
  //     can't navigate it later — we omit 'noopener' here and sever opener
  //     ourselves once the popup has navigated.
  //   - Popup blockers fire if window.open isn't called synchronously from
  //     a user gesture. We open with a same-origin loader page first so the
  //     tab stays clean (no flash of about:blank), then navigate to the blob
  //     URL once it's ready.
  const viewGRN = useCallback(async (receiptId: string) => {
    const popup = window.open('about:blank', '_blank')
    if (popup) {
      try {
        popup.document.title = 'Loading GRN…'
        popup.document.body.style.cssText = 'margin:0;background:#0b1220;color:#cbd5e1;font:14px/1.4 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh'
        popup.document.body.innerHTML = '<div>Loading GRN…</div>'
      } catch {
        // Cross-origin or permissions issue — ignore, popup will still navigate.
      }
    }
    try {
      const url = await fetchGRNBlobUrl(receiptId)
      if (popup && !popup.closed) {
        popup.location.replace(url)
      } else {
        // Popup blocked or closed — fall back to a temporary anchor click,
        // which most browsers treat as a continuation of the user gesture.
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
  }, [showToast])

  // Issue GRN: PATCH receipt status to 'matched'. The backend then
  // generates the GRN PDF and queues the DocuWare push. From the yard
  // operator's perspective this is the final tap that "issues the GRN".
  const issueGRN = useCallback(async (receiptId: string) => {
    try {
      const res = await apiFetch(`/receipts/${receiptId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'matched' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        showToast(body.error || `Failed to issue GRN (${res.status})`, 'error')
        return
      }
      const body = await res.json() as Receipt & { resynced_lines?: number }
      setReceipts(prev => prev.map(r => r.id === receiptId ? { ...r, ...body } : r))
      showToast('GRN issued — uploading to DocuWare', 'success')
    } catch (err) {
      const msg = (err as Error).message === 'unauthorized'
        ? 'Session expired — sign in again'
        : 'Network error — try again'
      showToast(msg, 'error')
    }
  }, [showToast])

  if (view === 'walk' && active) {
    return (
      <YardWalkthrough
        pod={active}
        startLineId={walkStartLineId}
        lineState={lineState}
        updateLine={updateLine}
        savingLineId={savingLineId}
        onPersistLine={persistLine}
        onExit={() => { setWalkStartLineId(null); setView('detail') }}
        onComplete={() => { setWalkStartLineId(null); setView('detail') }}
      />
    )
  }

  return (
    <div className={'yard-shell' + (outdoor ? ' yard-shell--outdoor' : '')}>
      <YardTopbar online={online} queueCount={0} outdoor={outdoor} onToggleOutdoor={() => setOutdoor(v => !v)}/>

      {loading && (
        <div className="yard-page">
          <div className="yard-empty"><div className="yard-empty__title">Loading loads…</div></div>
        </div>
      )}
      {error && !loading && (
        <div className="yard-page">
          <div className="yard-empty">
            <div className="yard-empty__title">{error}</div>
            <div className="yard-empty__sub"><button className="yard-link" onClick={fetchReceipts}>Try again</button></div>
          </div>
        </div>
      )}
      {!loading && !error && view === 'list' && (
        <YardLoadsList
          pods={receipts}
          lineState={lineState}
          onOpen={(id) => { setActiveId(id); setView('detail') }}
          onViewPOD={viewPOD}
          viewingPODFor={viewingPODFor}
        />
      )}
      {!loading && !error && view === 'detail' && active && (
        <YardLoadDetail
          pod={active}
          lineState={lineState}
          savingLineId={savingLineId}
          onBack={() => setView('list')}
          onWalk={(lineId) => { setWalkStartLineId(lineId ?? null); setView('walk') }}
          onConfirmAsExpected={async (line) => {
            const res = await persistLine(active.id, line, lineState[line.id] || {})
            if (res.ok) {
              updateLine(line.id, { received: true })
              showToast('Line confirmed', 'success')
            } else {
              showToast(res.error, 'error')
            }
          }}
          onIssueGRN={() => issueGRN(active.id)}
          onViewGRN={() => viewGRN(active.id)}
          onSaveHeader={persistReceipt}
          onBulkApply={persistBulk}
          onViewPOD={viewPOD}
          viewingPODFor={viewingPODFor}
        />
      )}
      {podModal && <YardPODModal url={podModal.url} onClose={() => setPodModal(null)}/>}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// TOPBAR
// ════════════════════════════════════════════════════════════════════════════
function YardTopbar({ online, queueCount, outdoor, onToggleOutdoor }: {
  online: boolean
  queueCount: number
  outdoor: boolean
  onToggleOutdoor: () => void
}) {
  return (
    <div className="yard-topbar">
      <div className="yard-topbar__brand">
        <div className="yard-topbar__logo">{BRAND.monogram}</div>
        <div>
          <div className="yard-topbar__title">Yard Receiving</div>
          <div className="yard-topbar__sub">{BRAND.fullName} · {BRAND.location}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          className={'yard-outdoor-toggle' + (outdoor ? ' is-on' : '')}
          onClick={onToggleOutdoor}
          aria-pressed={outdoor}
          title={outdoor ? 'Outdoor mode: ON — bigger type for direct sun. Tap to switch off.' : 'Tap to enable outdoor mode (bigger type for direct sun).'}
        >
          {/* Sun icon */}
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
          </svg>
          <span>{outdoor ? 'Outdoor' : 'Indoor'}</span>
        </button>
        <div
          className={'yard-conn ' + (online ? 'yard-conn--online' : 'yard-conn--offline')}
          title={online ? 'API reachable — submissions will save' : "Can't reach the server — submissions will fail until reconnected"}
        >
          <span className="yard-conn__dot"/>
          {online ? 'Online' : 'Offline'}
          {queueCount > 0 && <span className="yard-conn__queue">{queueCount} queued</span>}
        </div>
      </div>
    </div>
  )
}

// useOutdoorMode — persist the receiver's preference. Outdoor stays on across
// reloads so a receiver who picked it once doesn't have to re-toggle every
// shift. Stored under a yard-specific key so we don't collide with other prefs.
const OUTDOOR_KEY = 'yard:outdoor-mode'
function useOutdoorMode(): [boolean, (updater: (v: boolean) => boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try { return window.localStorage.getItem(OUTDOOR_KEY) === '1' } catch { return false }
  })
  const update = useCallback((updater: (v: boolean) => boolean) => {
    setOn(prev => {
      const next = updater(prev)
      try { window.localStorage.setItem(OUTDOOR_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }, [])
  return [on, update]
}

// ════════════════════════════════════════════════════════════════════════════
// LIST
// ════════════════════════════════════════════════════════════════════════════
function YardLoadsList({ pods, lineState, onOpen, onViewPOD, viewingPODFor }: {
  pods: Receipt[]
  lineState: LineStateMap
  onOpen: (id: string) => void
  onViewPOD: (receiptId: string) => void
  viewingPODFor: string | null
}) {
  const [filter, setFilter] = useState<'today' | 'all' | 'done'>('today')

  // A receipt is treated as "done" once every line has receiving_status === 'received'
  // (either persisted or marked locally in lineState). "GRN issued" is folded in via
  // future status tracking; for now we approximate using the persisted status.
  const enriched = pods.map(p => {
    const lines = p.lines || []
    const total = lines.length
    const done = lines.filter(l => l.receiving_status === 'received' || lineState[l.id]?.received).length
    const flagged = lines.filter(l => {
      const ls = lineState[l.id]
      return (ls && ((ls.discrepancy && ls.discrepancy !== 'none') || ls.hasDefects))
        || l.discrepancy === 'defects_noted'
        || (l.quantity_discrepancy && l.quantity_discrepancy !== 'none' && l.quantity_discrepancy !== '')
    }).length
    const allDone = total > 0 && done === total
    // Phase 2: 'matched' is when the GRN gets generated + pushed to DocuWare.
    // 'archived' is a later admin-only state (post-cleanup); treat both as
    // GRN-issued so the yard reflects either state correctly.
    const grnIssued = p.status === 'matched' || p.status === 'archived'
    return { ...p, _total: total, _done: done, _flagged: flagged, _allDone: allDone, _grnIssued: grnIssued }
  })

  const visible = enriched.filter(p => {
    if (filter === 'done') return p._allDone || p._grnIssued
    if (filter === 'today') return !p._grnIssued
    return true
  })

  return (
    <div className="yard-page">
      <div className="yard-page__header">
        <h1 className="yard-h1">Today's loads</h1>
        <p className="yard-sub">Pick a load to receive</p>
      </div>

      <div className="yard-tabs" role="tablist">
        <button className={'yard-tab ' + (filter === 'today' ? 'yard-tab--active' : '')} onClick={() => setFilter('today')}>
          Open <span className="yard-tab__count">{enriched.filter(p => !p._grnIssued).length}</span>
        </button>
        <button className={'yard-tab ' + (filter === 'done' ? 'yard-tab--active' : '')} onClick={() => setFilter('done')}>
          Done <span className="yard-tab__count">{enriched.filter(p => p._allDone || p._grnIssued).length}</span>
        </button>
        <button className={'yard-tab ' + (filter === 'all' ? 'yard-tab--active' : '')} onClick={() => setFilter('all')}>All</button>
      </div>

      <div className="yard-loads">
        {visible.map(p => {
          const podBusy = viewingPODFor === p.id
          const onCardKey: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p.id) }
          }
          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              className="yard-load-card"
              onClick={() => onOpen(p.id)}
              onKeyDown={onCardKey}
            >
              <div className="yard-load-card__plate">
                <Icon name="truck" size={24}/>
              </div>
              <div className="yard-load-card__main">
                <div className="yard-load-card__row">
                  <div className="yard-load-card__num">
                    {p.weighbridge_ticket_number
                      ? `WB ${p.weighbridge_ticket_number}`
                      : (p.delivery_note_number || p.receipt_number || '—')}
                  </div>
                  {p._grnIssued && <span className="yard-pill yard-pill--success">GRN issued</span>}
                  {p._allDone && !p._grnIssued && <span className="yard-pill yard-pill--ready">Ready for GRN</span>}
                  {!p._allDone && p._done > 0 && <span className="yard-pill yard-pill--progress">In progress</span>}
                </div>
                <div className="yard-load-card__customer">{p.customer_name || p.supplier_name || '—'}</div>
                <div className="yard-load-card__meta">
                  <span><Icon name="truck" size={14}/> {p.vehicle_registration || '—'}</span>
                  <span>·</span>
                  <span>{p._total} line{p._total !== 1 ? 's' : ''}</span>
                  {p._flagged > 0 && <><span>·</span><span style={{ color: 'var(--yard-amber)' }}><Icon name="flag" size={14}/> {p._flagged} flagged</span></>}
                </div>
              </div>
              <div className="yard-load-card__right">
                {p.source_docuware_document_id && (
                  <button
                    type="button"
                    className="yard-pod-btn yard-pod-btn--compact"
                    onClick={(e) => { e.stopPropagation(); onViewPOD(p.id) }}
                    disabled={podBusy}
                    title="Open POD in DocuWare viewer"
                    aria-label="View POD"
                  >
                    <Icon name="doc" size={16}/> {podBusy ? '…' : 'POD'}
                  </button>
                )}
                {p._done > 0 && p._total > 0 && (
                  <div className="yard-progress-ring" style={{ ['--p' as any]: Math.round((p._done/p._total)*100) }}>
                    <div className="yard-progress-ring__inner">{p._done}/{p._total}</div>
                  </div>
                )}
                <Icon name="chevR" size={28}/>
              </div>
            </div>
          )
        })}
        {visible.length === 0 && (
          <div className="yard-empty">
            <div className="yard-empty__title">Nothing in this view</div>
            <div className="yard-empty__sub">Try a different tab</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// DETAIL
// ════════════════════════════════════════════════════════════════════════════
function YardLoadDetail({ pod, lineState, savingLineId, onBack, onWalk, onConfirmAsExpected, onIssueGRN, onViewGRN, onSaveHeader, onBulkApply, onViewPOD, viewingPODFor }: {
  pod: Receipt
  lineState: LineStateMap
  savingLineId: string | null
  onBack: () => void
  onWalk: (lineId?: string) => void
  onConfirmAsExpected: (line: ReceiptLine) => Promise<void> | void
  onIssueGRN: () => void
  onViewGRN: () => void
  onSaveHeader: (receiptId: string, edits: ReceiptEdit) => Promise<{ ok: true } | { ok: false; error: string }>
  onBulkApply: (receiptId: string, lineIds: string[], edit: LineEdit, markReceived: boolean, defects?: BulkDefectDiff) => Promise<{ updated: ReceiptLine[]; errors: Record<string, string> }>
  onViewPOD: (receiptId: string) => void
  viewingPODFor: string | null
}) {
  const lines = pod.lines || []
  const total = lines.length
  const done = lines.filter(l => l.receiving_status === 'received' || lineState[l.id]?.received).length
  const flagged = lines.filter(l => {
    const ls = lineState[l.id]
    return (ls && ((ls.discrepancy && ls.discrepancy !== 'none') || ls.hasDefects))
      || l.discrepancy === 'defects_noted'
  }).length
  const allDone = done === total && total > 0
  const firstUndoneIdx = lines.findIndex(l => !(l.receiving_status === 'received' || lineState[l.id]?.received))
  // 'matched' is when the GRN gets issued; 'archived' is the later auto-archive
  // state. Either means the GRN exists. (Mirrors the list-card precedence above.)
  const grnIssued = pod.status === 'matched' || pod.status === 'archived'

  const [editing, setEditing] = useState(false)
  const [edits, setEdits] = useState<ReceiptEdit>({})
  const [headerSaving, setHeaderSaving] = useState(false)
  const [headerError, setHeaderError] = useState<string | null>(null)

  // Line-list search + status filter. Worth the cost on loads with many
  // lines (we've seen 68+); kept simple — substring match on item code,
  // description, line number, material size/markings.
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'received' | 'flagged'>('all')

  // Multi-select for bulk actions. Scoped to this load — cleared on back-nav
  // because the component unmounts. Hidden once the GRN is issued.
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set())
  const toggleSelect = useCallback((lineId: string) => {
    setSelectedLineIds(prev => {
      const next = new Set(prev)
      if (next.has(lineId)) next.delete(lineId); else next.add(lineId)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelectedLineIds(new Set()), [])

  // Bulk-edit sheet state. Per-line errors surface inside the sheet so the
  // receiver can see which lines failed and retry without losing the edit.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetBusy, setSheetBusy] = useState(false)
  const [sheetErrors, setSheetErrors] = useState<Record<string, string>>({})
  const { showToast: showSheetToast } = useToast()

  const openSheet = () => { setSheetErrors({}); setSheetOpen(true) }
  const closeSheet = () => { if (!sheetBusy) { setSheetOpen(false); setSheetErrors({}) } }

  const applyBulk = async ({ patch, markReceived, defectDiff }: BulkPatch) => {
    const ids = [...selectedLineIds]
    if (ids.length === 0) return
    setSheetBusy(true)
    setSheetErrors({})
    try {
      const { updated, errors } = await onBulkApply(pod.id, ids, patch, markReceived, defectDiff)
      const failedCount = Object.keys(errors).length
      if (failedCount === 0) {
        showSheetToast(`Updated ${updated.length} line${updated.length === 1 ? '' : 's'}`, 'success')
        setSheetOpen(false)
        setSelectedLineIds(prev => {
          const next = new Set(prev)
          for (const l of updated) next.delete(l.id)
          return next
        })
      } else {
        setSheetErrors(errors)
        showSheetToast(
          `Updated ${updated.length} of ${ids.length} — ${failedCount} failed`,
          updated.length === 0 ? 'error' : 'info',
        )
        // Keep failed lines selected so the receiver can retry; drop the
        // successful ones so a retry only re-runs the failures.
        setSelectedLineIds(prev => {
          const next = new Set(prev)
          for (const l of updated) next.delete(l.id)
          return next
        })
      }
    } finally {
      setSheetBusy(false)
    }
  }

  const filteredLines = lines.filter((l) => {
    const st = lineState[l.id] || {}
    const isReceived = st.received || l.receiving_status === 'received'
    const isFlagged = (st.discrepancy && st.discrepancy !== 'none') || st.hasDefects || l.discrepancy === 'defects_noted'
    if (statusFilter === 'pending'  && isReceived) return false
    if (statusFilter === 'received' && !isReceived) return false
    if (statusFilter === 'flagged'  && !isFlagged)  return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    const hay = [
      l.item_code, l.description, l.material_description, l.material_size,
      l.material_markings, String(l.line_number),
    ].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })

  // Bulk-action select-all targets only currently-visible (filtered) lines so
  // the receiver can scope a bulk action by status/search before selecting.
  const visibleIds = filteredLines.map(l => l.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedLineIds.has(id))
  const someVisibleSelected = visibleIds.some(id => selectedLineIds.has(id))
  const toggleSelectAllVisible = () => {
    setSelectedLineIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id)
      } else {
        for (const id of visibleIds) next.add(id)
      }
      return next
    })
  }

  const headerVal = (field: keyof ReceiptEdit): string =>
    (field in edits ? (edits[field] ?? '') : ((pod as any)[field] ?? '')) as string
  const patch = (field: keyof ReceiptEdit, value: string) =>
    setEdits(prev => ({ ...prev, [field]: value }))
  const cancelEdit = () => { setEdits({}); setHeaderError(null); setEditing(false) }
  const saveEdit = async () => {
    setHeaderSaving(true); setHeaderError(null)
    const res = await onSaveHeader(pod.id, edits)
    setHeaderSaving(false)
    if (!res.ok) { setHeaderError(res.error); return }
    setEdits({}); setEditing(false)
  }

  return (
    <div className="yard-page">
      <div className="yard-detail__topbar">
        <button className="yard-back" onClick={onBack}>
          <Icon name="chevL" size={28}/> Loads
        </button>
        <span className="yard-detail__num">
          {pod.weighbridge_ticket_number
            ? `WB ${pod.weighbridge_ticket_number}`
            : (pod.delivery_note_number || pod.receipt_number)}
        </span>
      </div>

      <div className="yard-detail__hero">
        <div>
          <div className="yard-detail__customer-row">
            <div className="yard-detail__customer">{pod.customer_name || pod.supplier_name || '—'}</div>
            {pod.source_docuware_document_id && (
              <button
                type="button"
                className="yard-pod-btn"
                onClick={() => onViewPOD(pod.id)}
                disabled={viewingPODFor === pod.id}
                title="Open POD in DocuWare viewer"
              >
                <Icon name="doc" size={16}/> {viewingPODFor === pod.id ? 'Opening…' : 'View POD'}
              </button>
            )}
            {!editing && !grnIssued && (
              <button className="yard-edit-btn" onClick={() => setEditing(true)} aria-label="Edit details">
                <Icon name="pencil" size={16}/> Edit details
              </button>
            )}
          </div>
          <div className="yard-detail__meta">
            <div><span className="k">PO</span><span className="v mono">{pod.purchase_order_number || '—'}</span></div>
            <div><span className="k">Vehicle</span><span className="v mono">{pod.vehicle_registration || '—'}</span></div>
            {pod.weighbridge_ticket_number && <div><span className="k">WB</span><span className="v mono">{pod.weighbridge_ticket_number}</span></div>}
            <div><span className="k">Lines</span><span className="v">{total}</span></div>
          </div>
        </div>
        <div className="yard-detail__hero-right">
          <div className="yard-bigring" style={{ ['--p' as any]: Math.round((done/Math.max(total,1))*100) }}>
            <div className="yard-bigring__inner">
              <div className="yard-bigring__num">{done}<span>/{total}</span></div>
              <div className="yard-bigring__lbl">Received</div>
            </div>
          </div>
          {flagged > 0 && <div className="yard-detail__flagged"><Icon name="flag" size={16}/> {flagged} flagged</div>}
        </div>
      </div>

      {editing && (
        <div className="yard-edit-card">
          <div className="yard-edit-card__title">Edit load details</div>
          <p className="yard-edit-card__sub">Fix anything the POD got wrong.</p>
          <div className="yard-edit-grid">
            <YardField label="Customer"        value={headerVal('customer_name')}             onChange={v => patch('customer_name', v)}/>
            <YardField label="Fabricator"      value={headerVal('supplier_name')}             onChange={v => patch('supplier_name', v)}/>
            <YardField label="Delivery Note"   value={headerVal('delivery_note_number')}      onChange={v => patch('delivery_note_number', v)} mono/>
            <YardField label="Order #"         value={headerVal('purchase_order_number')}     onChange={v => patch('purchase_order_number', v)} mono/>
            <YardField label="Weighbridge #"   value={headerVal('weighbridge_ticket_number')} onChange={v => patch('weighbridge_ticket_number', v)} mono/>
            <YardField label="Vehicle Reg"     value={headerVal('vehicle_registration')}      onChange={v => patch('vehicle_registration', v)} mono/>
            <YardField label="Job Number"      value={headerVal('job_number')}                onChange={v => patch('job_number', v)} mono/>
          </div>
          {headerError && <div className="yard-edit-card__error" role="alert"><Icon name="alert" size={16}/> {headerError}</div>}
          <div className="yard-edit-card__actions">
            <button className="yard-btn-ghost yard-btn-lg" onClick={cancelEdit} disabled={headerSaving}>Cancel</button>
            <button className="yard-btn-primary yard-btn-lg yard-btn-flex" onClick={saveEdit} disabled={headerSaving || Object.keys(edits).length === 0}>
              {headerSaving ? 'Saving…' : 'Save details'}
            </button>
          </div>
        </div>
      )}

      <div className="yard-detail__cta">
        {!allDone && !grnIssued && total > 0 && (
          <button className="yard-btn-primary yard-btn-xl" onClick={() => onWalk()}>
            <Icon name="play" size={22}/>
            {firstUndoneIdx > 0 ? 'Resume walkthrough' : 'Start walkthrough'}
            <span className="yard-btn-xl__sub">{total - done} line{total-done !== 1 ? 's' : ''} to check · or tap any line below</span>
          </button>
        )}
        {allDone && !grnIssued && (
          <button className="yard-btn-success yard-btn-xl" onClick={onIssueGRN}>
            <Icon name="check" size={22}/>
            Issue GRN
            <span className="yard-btn-xl__sub">All lines reconciled</span>
          </button>
        )}
        {grnIssued && (
          <button className="yard-btn-ghost yard-btn-xl" onClick={onViewGRN}>
            <Icon name="doc" size={22}/>
            View GRN <span className="mono">{pod.receipt_number}</span>
          </button>
        )}
      </div>

      <div className="yard-detail__list-header">
        <span>Line items</span>
        <button className="yard-link" onClick={() => onWalk()}>Open in walkthrough →</button>
      </div>

      {lines.length > 0 && (
        <div className="yard-line-toolbar">
          {!grnIssued && (
            <label className="yard-line-selectall" title={allVisibleSelected ? 'Clear visible selection' : 'Select all visible'}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={el => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected }}
                onChange={toggleSelectAllVisible}
                aria-label="Select all visible lines"
              />
              <span>Select</span>
            </label>
          )}
          <input
            type="search"
            className="yard-line-search"
            placeholder="Search item code, description, size…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search lines"
          />
          <div className="yard-line-chips" role="tablist" aria-label="Filter lines by status">
            {(['all','pending','received','flagged'] as const).map(key => {
              const count = key === 'all' ? total
                : key === 'pending'  ? total - done
                : key === 'received' ? done
                : flagged
              const label = key === 'all' ? 'All' : key[0].toUpperCase() + key.slice(1)
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === key}
                  className={'yard-line-chip' + (statusFilter === key ? ' is-active' : '')}
                  onClick={() => setStatusFilter(key)}
                >
                  {label} <span className="yard-line-chip__count">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="yard-detail__lines">
        {filteredLines.map((l) => (
          <YardLineSummary
            key={l.id}
            line={l}
            idx={lines.indexOf(l)}
            state={lineState[l.id] || {}}
            saving={savingLineId === l.id}
            disabled={grnIssued}
            selectable={!grnIssued}
            selected={selectedLineIds.has(l.id)}
            onToggleSelect={() => toggleSelect(l.id)}
            onConfirm={() => onConfirmAsExpected(l)}
            onWalk={() => onWalk(l.id)}
          />
        ))}
        {lines.length > 0 && filteredLines.length === 0 && (
          <div className="yard-empty">
            <div className="yard-empty__title">No lines match</div>
            <div className="yard-empty__sub">
              <button className="yard-link" onClick={() => { setSearch(''); setStatusFilter('all') }}>Clear filters</button>
            </div>
          </div>
        )}
        {lines.length === 0 && (
          <div className="yard-empty">
            <div className="yard-empty__title">No lines on this load yet</div>
            <div className="yard-empty__sub">Lines arrive when DocuWare pushes them.</div>
          </div>
        )}
      </div>

      {selectedLineIds.size > 0 && (
        <div className="yard-bulkbar" role="region" aria-label="Bulk action">
          <div className="yard-bulkbar__count">
            <strong>{selectedLineIds.size}</strong> selected
          </div>
          <div className="yard-bulkbar__actions">
            <button
              type="button"
              className="yard-btn-ghost yard-btn-md"
              onClick={clearSelection}
            >
              Clear
            </button>
            <button
              type="button"
              className="yard-btn-primary yard-btn-md"
              onClick={openSheet}
            >
              Bulk Action
            </button>
          </div>
        </div>
      )}

      {sheetOpen && (
        <BulkLineEditSheet
          selectedLines={lines.filter(l => selectedLineIds.has(l.id))}
          busy={sheetBusy}
          errorByLineId={sheetErrors}
          onApply={applyBulk}
          onClose={closeSheet}
        />
      )}
    </div>
  )
}

function YardLineSummary({ line, idx, state, saving, disabled, selectable, selected, onToggleSelect, onConfirm, onWalk }: {
  line: ReceiptLine
  idx: number
  state: YardLineState
  saving: boolean
  disabled: boolean
  selectable: boolean
  selected: boolean
  onToggleSelect: () => void
  onConfirm: () => void
  onWalk: () => void
}) {
  const received = state.received || line.receiving_status === 'received'
  const flagged = (state.discrepancy && state.discrepancy !== 'none')
    || state.hasDefects
    || line.discrepancy === 'defects_noted'
  const cls = received ? (flagged ? 'yard-line--flagged' : 'yard-line--ok') : 'yard-line--pending'
  return (
    <div className={'yard-line ' + cls + (selected ? ' yard-line--selected' : '')}>
      {selectable && (
        <label
          className="yard-line__select"
          onClick={e => e.stopPropagation()}
          aria-label={`Select line ${idx+1}`}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
          />
        </label>
      )}
      <div className="yard-line__num">{String(idx+1).padStart(2,'0')}</div>
      <div className="yard-line__main">
        <div className="yard-line__desc">{line.description || line.material_description || line.item_code || `Line ${line.line_number}`}</div>
        <div className="yard-line__sub">
          <span className="mono">{line.item_code}</span>
          <span> · {line.expected_quantity} {line.unit_of_measure} expected</span>
        </div>
      </div>
      <div className="yard-line__status">
        {!received && <span className="yard-pill yard-pill--neutral">Pending</span>}
        {received && !flagged && <span className="yard-pill yard-pill--success"><Icon name="check" size={12}/> Received</span>}
        {received &&  flagged && <span className="yard-pill yard-pill--warn"><Icon name="flag" size={12}/> Flagged</span>}
      </div>
      {!received && !disabled && (
        <div className="yard-line__actions">
          <button
            type="button"
            className="yard-btn-success yard-btn-md"
            onClick={onConfirm}
            disabled={saving}
            aria-label={`Confirm line ${idx+1} as expected`}
            title="Mark this line received with the expected quantity. Use 'Has issues' if anything's off."
          >
            <Icon name="check" size={16}/> {saving ? 'Saving…' : 'Confirm'}
          </button>
          <button
            type="button"
            className="yard-btn-ghost yard-btn-md"
            onClick={onWalk}
            disabled={saving}
            aria-label={`Open line ${idx+1} in walkthrough`}
            title="Open the walkthrough for this line if there's a discrepancy or defect."
          >
            <Icon name="flag" size={16}/> Has issues
          </button>
        </div>
      )}
    </div>
  )
}

function YardField({ label, value, onChange, mono }: {
  label: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
}) {
  return (
    <label className="yard-field">
      <span className="yard-field__label">{label}</span>
      <input
        type="text"
        className={'yard-field__input' + (mono ? ' yard-field__input--mono' : '')}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// POD MODAL — iframes the DocuWare integration URL.
// DocuWare supports framing on /WebClient/1/Integration; if it ever blocks us
// (X-Frame-Options or CSP frame-ancestors), the iframe stays blank — we show a
// fallback banner offering to open in a new tab so the receiver isn't stuck.
// ════════════════════════════════════════════════════════════════════════════
function YardPODModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [showFallback, setShowFallback] = useState(false)

  // Lock background scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Watchdog: if the iframe never loads within 6s, surface a fallback
  useEffect(() => {
    if (loaded) return
    const t = window.setTimeout(() => setShowFallback(true), 6000)
    return () => window.clearTimeout(t)
  }, [loaded])

  return (
    <div className="yard-pod-modal" role="dialog" aria-modal="true" aria-label="POD viewer">
      <div className="yard-pod-modal__bar">
        <div className="yard-pod-modal__title"><Icon name="doc" size={18}/> POD</div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="yard-pod-modal__open"
        >
          Open in new tab ↗
        </a>
        <button className="yard-pod-modal__close" onClick={onClose} aria-label="Close POD">
          <Icon name="close" size={22}/>
        </button>
      </div>
      <div className="yard-pod-modal__body">
        {!loaded && !showFallback && (
          <div className="yard-pod-modal__loading">Loading POD…</div>
        )}
        {showFallback && !loaded && (
          <div className="yard-pod-modal__fallback">
            <div className="yard-pod-modal__fallback-title">DocuWare is taking a while.</div>
            <div className="yard-pod-modal__fallback-sub">
              If the document doesn't appear, open it in a new tab.
            </div>
            <a href={url} target="_blank" rel="noopener noreferrer" className="yard-btn-primary yard-btn-lg">
              Open in new tab
            </a>
          </div>
        )}
        <iframe
          src={url}
          className={'yard-pod-modal__frame' + (loaded ? ' yard-pod-modal__frame--loaded' : '')}
          title="DocuWare POD"
          onLoad={() => setLoaded(true)}
          // sandbox allowances DocuWare's WebClient needs to render and authenticate.
          // omit allow-top-navigation so DocuWare can't navigate the parent page.
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads"
        />
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// WALKTHROUGH
// ════════════════════════════════════════════════════════════════════════════
// 'photo' is conditional: shown only when the receiver flagged a defect on
// the previous step. goNext/goPrev skip it for clean lines so the 90% case
// stays a one-tap walkthrough.
const STEPS = ['qty', 'type', 'process', 'packaging', 'storage', 'defects', 'photo', 'review'] as const
type Step = typeof STEPS[number]

function shouldSkipStep(step: Step, state: YardLineState): boolean {
  return step === 'photo' && !state.hasDefects
}

function YardWalkthrough({ pod, startLineId, lineState, updateLine, savingLineId, onPersistLine, onExit, onComplete }: {
  pod: Receipt
  startLineId: string | null
  lineState: LineStateMap
  updateLine: (lineId: string, patch: Partial<YardLineState>) => void
  savingLineId: string | null
  onPersistLine: (receiptId: string, line: ReceiptLine, st: YardLineState) => Promise<{ ok: true } | { ok: false; error: string }>
  onExit: () => void
  onComplete: () => void
}) {
  const lines = pod.lines || []
  const explicitIdx = startLineId ? lines.findIndex(l => l.id === startLineId) : -1
  const firstUndone = lines.findIndex(l => !(l.receiving_status === 'received' || lineState[l.id]?.received))
  const initialIdx = explicitIdx >= 0 ? explicitIdx : (firstUndone === -1 ? 0 : firstUndone)
  const [idx, setIdx] = useState(initialIdx)
  const [step, setStep] = useState<Step>('qty')
  const [saveError, setSaveError] = useState<string | null>(null)

  const line = lines[idx]
  const state = (line && lineState[line.id]) || {}
  const total = lines.length
  const stepIdx = STEPS.indexOf(step)
  const saving = !!(line && savingLineId === line.id)

  // Previous line's state — drives the "Same as previous" carry-forward affordance
  const prevLine = idx > 0 ? lines[idx - 1] : null
  const prevState = prevLine ? lineState[prevLine.id] : null
  const canCarry = !!prevState && !!(prevState.item_type || prevState.process || prevState.packaging)

  const set = useCallback((patch: Partial<YardLineState>) => {
    if (line) updateLine(line.id, patch)
  }, [line, updateLine])

  const carryForward = () => {
    if (!prevState) return
    set({
      item_type: prevState.item_type ?? state.item_type,
      process:   prevState.process   ?? state.process,
      packaging: prevState.packaging ?? state.packaging,
    })
  }

  // Clear any prior error when the user navigates or edits
  useEffect(() => { setSaveError(null) }, [idx, step])

  const goNext = () => {
    let next = stepIdx + 1
    while (next < STEPS.length && shouldSkipStep(STEPS[next], state)) next++
    if (next < STEPS.length) setStep(STEPS[next])
  }
  const goPrev = () => {
    let prev = stepIdx - 1
    while (prev >= 0 && shouldSkipStep(STEPS[prev], state)) prev--
    if (prev >= 0) setStep(STEPS[prev])
    else if (idx > 0) { setIdx(idx - 1); setStep('review') }
    else onExit()
  }

  const markReceived = async () => {
    if (!line) return
    setSaveError(null)
    const result = await onPersistLine(pod.id, line, { ...state })
    if (!result.ok) { setSaveError(result.error); return }
    updateLine(line.id, { received: true })
    if (idx < total - 1) {
      setIdx(idx + 1)
      setStep('qty')
    } else {
      onComplete()
    }
  }

  if (!line) {
    return (
      <div className="yard-walk">
        <div className="yard-walk__topbar">
          <button className="yard-walk__close" onClick={onExit}><Icon name="close" size={24}/></button>
          <div><div className="yard-walk__progress">No lines</div></div>
          <div/>
        </div>
      </div>
    )
  }

  return (
    <div className="yard-walk">
      <div className="yard-walk__topbar">
        <button className="yard-walk__close" onClick={onExit} aria-label="Exit walkthrough">
          <Icon name="close" size={24}/>
        </button>
        <div>
          <div className="yard-walk__delivery">
            {(pod.weighbridge_ticket_number ? `WB ${pod.weighbridge_ticket_number}` : (pod.delivery_note_number || pod.receipt_number))} · {pod.customer_name}
          </div>
          <div className="yard-walk__progress">Line <strong>{idx+1}</strong> of <strong>{total}</strong></div>
        </div>
        <div className="yard-walk__steps">
          {STEPS.slice(0, STEPS.length - 1)
            .filter(s => !shouldSkipStep(s, state))
            .map((s) => {
              const i = STEPS.indexOf(s)
              return (
                <span key={s} className={'yard-walk__dot ' + (i < stepIdx ? 'done' : i === stepIdx ? 'now' : '')}/>
              )
            })}
        </div>
      </div>

      <div className="yard-walk__line-card">
        <div className="yard-walk__line-num">{String(idx+1).padStart(2,'0')}</div>
        <div className="yard-walk__line-info">
          <div className="yard-walk__line-desc">{line.description || line.material_description || line.item_code}</div>
          <div className="yard-walk__line-meta">
            <span className="mono">{line.item_code}</span>
            {line.material_size && <span> · {line.material_size}</span>}
            {line.weight && <span> · {line.weight} kg/u</span>}
          </div>
        </div>
        <div className="yard-walk__line-expected">
          <div className="k">Expected</div>
          <div className="v">{line.expected_quantity}</div>
          <div className="u">{line.unit_of_measure}</div>
        </div>
      </div>

      <div className="yard-walk__body">
        {canCarry && (step === 'type' || step === 'process' || step === 'packaging') && (
          <button className="yard-carry" onClick={carryForward}>
            <Icon name="check" size={16}/> Same as line {idx} {carryDescription(prevState, step)}
          </button>
        )}
        {step === 'qty'       && <StepQuantity  line={line} state={state} set={set}/>}
        {step === 'type'      && <StepItemType  state={state} set={set}/>}
        {step === 'process'   && <StepProcess   state={state} set={set}/>}
        {step === 'packaging' && <StepPackaging state={state} set={set}/>}
        {step === 'defects'   && <StepDefects   state={state} set={set}/>}
        {step === 'photo'     && <StepPhoto     state={state} set={set}/>}
        {step === 'storage'   && <StepStorage   state={state} set={set}/>}
        {step === 'review'    && <StepReview    line={line} state={state} set={set} idx={idx} total={total}/>}
      </div>

      {saveError && (
        <div className="yard-walk__error" role="alert">
          <Icon name="alert" size={18}/>
          <span>{saveError}</span>
          <button className="yard-link" onClick={markReceived} disabled={saving}>{saving ? 'Retrying…' : 'Retry'}</button>
        </div>
      )}

      <div className="yard-walk__footer">
        <button className="yard-btn-ghost yard-btn-lg" onClick={goPrev} disabled={saving}>
          <Icon name="chevL" size={22}/> Back
        </button>
        {step !== 'review' ? (
          <button
            className="yard-btn-primary yard-btn-lg yard-btn-flex"
            onClick={goNext}
            disabled={!canAdvance(step, state)}
          >
            Next <Icon name="chevR" size={22}/>
          </button>
        ) : (
          <button className="yard-btn-success yard-btn-lg yard-btn-flex" onClick={markReceived} disabled={saving}>
            <Icon name="check" size={22}/> {saving ? 'Saving…' : (idx === total - 1 ? 'Finish load' : 'Confirm & next line')}
          </button>
        )}
      </div>
    </div>
  )
}

function carryDescription(prev: YardLineState | null, step: Step): string {
  if (!prev) return ''
  if (step === 'type' && prev.item_type) {
    const map: Record<string, string> = { blacksteel: 'Black Steel', galvanised: 'Galvanised', other: 'Other' }
    return `(${map[prev.item_type] ?? prev.item_type})`
  }
  if (step === 'process' && prev.process) {
    const label = availableProcesses(prev.item_type || '').find(o => o.value === prev.process)?.label
    return label ? `(${label})` : ''
  }
  if (step === 'packaging' && prev.packaging) {
    return `(${prev.packaging.charAt(0).toUpperCase()}${prev.packaging.slice(1)})`
  }
  return ''
}

function canAdvance(step: Step, state: YardLineState): boolean {
  if (step === 'qty')       return state.received_quantity != null && !!state.discrepancy
  if (step === 'type')      return !!state.item_type
  if (step === 'process')   return !!state.process
  if (step === 'packaging') return !!state.packaging
  if (step === 'defects')   return state.defects_done === true
  // Photo is optional — receiver can skip with no file selected.
  if (step === 'photo')     return true
  // Storage is optional — bay/stored_in/accessories/comments can be left blank.
  if (step === 'storage')   return true
  return true
}

// ── Steps ─────────────────────────────────────────────────────────────────────

function StepQuantity({ line, state, set }: {
  line: ReceiptLine
  state: YardLineState
  set: (p: Partial<YardLineState>) => void
}) {
  const expected = line.expected_quantity
  const received = state.received_quantity ?? expected
  const discrepancy = state.discrepancy

  const setQty = (q: number) => {
    const clean = Math.max(0, q)
    let auto: 'none' | 'short' | 'over' = 'none'
    if (clean < expected) auto = 'short'
    else if (clean > expected) auto = 'over'
    set({ received_quantity: clean, discrepancy: auto })
  }

  return (
    <div>
      <h2 className="walk-step__title">How many did you receive?</h2>
      <p className="walk-step__sub">Expected <strong>{expected} {line.unit_of_measure}</strong></p>

      <div className="big-counter">
        <button className="big-counter__btn" onClick={() => setQty(received - 1)} aria-label="Decrease">
          <Icon name="minus" size={36}/>
        </button>
        <div className="big-counter__display">
          <input
            type="number"
            value={received}
            onChange={e => setQty(parseInt(e.target.value) || 0)}
            inputMode="numeric"
            aria-label="Received quantity"
          />
          <span className="big-counter__unit">{line.unit_of_measure}</span>
        </div>
        <button className="big-counter__btn" onClick={() => setQty(received + 1)} aria-label="Increase">
          <Icon name="plus" size={36}/>
        </button>
      </div>

      <div className="qty-shortcuts">
        <button className="qty-chip" onClick={() => setQty(expected)}>= Expected</button>
        <button className="qty-chip" onClick={() => setQty(expected - 1)}>−1</button>
        <button className="qty-chip" onClick={() => setQty(expected - 5)}>−5</button>
        <button className="qty-chip" onClick={() => setQty(expected + 1)}>+1</button>
      </div>

      <div className="discrepancy-banner" data-disc={discrepancy}>
        {discrepancy === 'none'  && <><Icon name="check" size={20}/> Matches the delivery note</>}
        {discrepancy === 'short' && <><Icon name="alert" size={20}/> Short {expected - received} {line.unit_of_measure}</>}
        {discrepancy === 'over'  && <><Icon name="alert" size={20}/> Over {received - expected} {line.unit_of_measure}</>}
      </div>
    </div>
  )
}

function StepItemType({ state, set }: { state: YardLineState; set: (p: Partial<YardLineState>) => void }) {
  const value = state.item_type
  const opts = [
    { v: 'blacksteel', l: 'Black Steel', d: 'Untreated steel for galvanising' },
    { v: 'galvanised', l: 'Galvanised',  d: 'Already galvanised — strip / regalv' },
    { v: 'other',      l: 'Other',       d: 'Specify in notes' },
  ]
  return (
    <div>
      <h2 className="walk-step__title">What kind of material?</h2>
      <p className="walk-step__sub">This drives which processes are available</p>
      <div className="big-radio">
        {opts.map(o => (
          <button
            key={o.v}
            className={'big-radio__opt ' + (value === o.v ? 'big-radio__opt--on' : '')}
            onClick={() => {
              const disabled = disabledForType(o.v)
              const patch: Partial<YardLineState> = { item_type: o.v }
              if (state.process && disabled.includes(state.process)) patch.process = undefined
              set(patch)
            }}
          >
            <div className="big-radio__check">{value === o.v && <Icon name="check" size={22}/>}</div>
            <div>
              <div className="big-radio__label">{o.l}</div>
              <div className="big-radio__desc">{o.d}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function StepProcess({ state, set }: { state: YardLineState; set: (p: Partial<YardLineState>) => void }) {
  const value = state.process
  const itemType = state.item_type
  const opts = availableProcesses(itemType || '').filter(o => o.value && !o.disabled)
  return (
    <div>
      <h2 className="walk-step__title">Which process?</h2>
      <p className="walk-step__sub">{opts.length} options available for {itemType}</p>
      <div className="proc-grid">
        {opts.map(o => (
          <button
            key={o.value}
            className={'proc-chip ' + (value === o.value ? 'proc-chip--on' : '')}
            onClick={() => set({ process: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function StepPackaging({ state, set }: { state: YardLineState; set: (p: Partial<YardLineState>) => void }) {
  const value = state.packaging
  const opts = [
    { v: 'pallet', l: 'Pallet' },
    { v: 'crate',  l: 'Crate' },
    { v: 'bundle', l: 'Bundle' },
    { v: 'loose',  l: 'Loose' },
    { v: 'bin',    l: 'Bin' },
    { v: 'other',  l: 'Other' },
  ]
  return (
    <div>
      <h2 className="walk-step__title">How is it packaged?</h2>
      <div className="big-grid">
        {opts.map(o => (
          <button key={o.v}
                  className={'big-grid__cell ' + (value === o.v ? 'big-grid__cell--on' : '')}
                  onClick={() => set({ packaging: o.v })}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  )
}

function StepDefects({ state, set }: { state: YardLineState; set: (p: Partial<YardLineState>) => void }) {
  const defects = state.defects || defaultDefectValues()
  const mitigations = state.mitigations ?? {}
  const quantities = state.quantities ?? {}

  const setDefect = (key: string, val: string) => {
    const newDef = { ...defects, [key]: val }
    const item = ALL_DEFECT_ITEMS.find(i => i.key === key)
    // If the value reverts to default, drop any mitigations + qtys for this item
    let nextMits = mitigations
    let nextQtys = quantities
    if (item && val === item.default) {
      if (mitigations[key]) {
        nextMits = { ...mitigations }; delete nextMits[key]
      }
      if (quantities[key]) {
        nextQtys = { ...quantities }; delete nextQtys[key]
      }
    }
    set({
      defects: newDef,
      mitigations: nextMits,
      quantities: nextQtys,
      hasDefects: hasAnyDefect(newDef),
      defects_done: true,
    })
  }

  const toggleMitigation = (itemKey: string, mit: string) => {
    const current = mitigations[itemKey] ?? []
    const isOn = current.includes(mit)
    const nextList = isOn ? current.filter(m => m !== mit) : [...current, mit]
    const nextMits: MitigationSelection = { ...mitigations }
    if (nextList.length) nextMits[itemKey] = nextList
    else delete nextMits[itemKey]

    const nextQtys: MitigationQuantity = { ...quantities }
    if (isOn) {
      // removing — drop the qty entry too
      if (nextQtys[itemKey]) {
        const cleaned = { ...nextQtys[itemKey] }
        delete cleaned[mit]
        if (Object.keys(cleaned).length) nextQtys[itemKey] = cleaned
        else delete nextQtys[itemKey]
      }
    } else if (!MITIGATION_NO_QTY.has(itemKey)) {
      // adding — seed qty=0 for items that take quantities (matches office UX)
      nextQtys[itemKey] = { ...(nextQtys[itemKey] ?? {}), [mit]: 0 }
    }
    set({ mitigations: nextMits, quantities: nextQtys, defects_done: true })
  }

  const setMitigationQty = (itemKey: string, mit: string, value: number) => {
    const clean = Math.max(0, value | 0)
    const nextQtys: MitigationQuantity = {
      ...quantities,
      [itemKey]: { ...(quantities[itemKey] ?? {}), [mit]: clean },
    }
    set({ quantities: nextQtys })
  }

  const skipAll = () => {
    set({ defects: defaultDefectValues(), mitigations: {}, quantities: {}, hasDefects: false, defects_done: true })
  }

  return (
    <div>
      <h2 className="walk-step__title">Any defects?</h2>
      <p className="walk-step__sub">Tap a row that doesn't match — leave the rest. When you flag one, pick the mitigation the workshop will need.</p>

      <button className="walk-skip-all" onClick={skipAll}>
        <Icon name="check" size={18}/> All clean — no defects
      </button>

      <div className="defect-categories">
        {DEFECT_CATEGORIES.map(cat => (
          <div key={cat.id} className="defect-category">
            <div className="defect-category__title">{cat.title}</div>
            <div className="defect-list">
              {cat.items.map(d => {
                const val = defects[d.key] ?? d.default
                const flagged = val !== d.default
                const availableMits = d.mitigations[val] ?? []
                const selected = mitigations[d.key] ?? []
                const noQty = MITIGATION_NO_QTY.has(d.key)
                return (
                  <div key={d.key} className={'defect-row ' + (flagged ? 'defect-row--on' : '')}>
                    <div className="defect-row__label">{d.label}</div>
                    <div className="defect-row__opts">
                      {d.options.map(o => (
                        <button key={o}
                                className={'defect-pill ' + (val === o ? 'defect-pill--on' : '')}
                                onClick={() => setDefect(d.key, o)}>
                          {o}
                        </button>
                      ))}
                    </div>
                    {flagged && availableMits.length > 0 && (
                      <div className="defect-row__mits">
                        <div className="defect-row__mits-label">Mitigation</div>
                        <div className="defect-row__mits-list">
                          {availableMits.map(mit => {
                            const on = selected.includes(mit)
                            const qty = quantities[d.key]?.[mit] ?? 0
                            return (
                              <div key={mit} className={'mit-row ' + (on ? 'mit-row--on' : '')}>
                                <button
                                  type="button"
                                  className="mit-row__toggle"
                                  onClick={() => toggleMitigation(d.key, mit)}
                                  aria-pressed={on}
                                >
                                  <span className={'mit-row__check' + (on ? ' mit-row__check--on' : '')}>
                                    {on && <Icon name="check" size={14}/>}
                                  </span>
                                  <span className="mit-row__label">{mit}</span>
                                </button>
                                {on && !noQty && (
                                  <div className="mit-qty">
                                    <button className="mit-qty__btn" onClick={() => setMitigationQty(d.key, mit, qty - 1)} aria-label={`Decrease ${mit}`}>
                                      <Icon name="minus" size={20}/>
                                    </button>
                                    <input
                                      type="number"
                                      className="mit-qty__input"
                                      value={qty}
                                      onChange={e => setMitigationQty(d.key, mit, parseInt(e.target.value || '0', 10))}
                                      inputMode="numeric"
                                      aria-label={`${mit} quantity`}
                                    />
                                    <button className="mit-qty__btn" onClick={() => setMitigationQty(d.key, mit, qty + 1)} aria-label={`Increase ${mit}`}>
                                      <Icon name="plus" size={20}/>
                                    </button>
                                  </div>
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
          </div>
        ))}
      </div>
    </div>
  )
}

function ReviewPhotoPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  if (!url) return null
  return (
    <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
      <img
        src={url}
        alt="Defect photo preview"
        style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
      />
      <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
        Photo will upload when you confirm
      </span>
    </div>
  )
}

function StepPhoto({ state, set }: {
  state: YardLineState
  set: (p: Partial<YardLineState>) => void
}) {
  // Local blob URL for the in-memory File so receiver sees the thumbnail
  // immediately. Cleaned up on replace / unmount.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!state.defectPhoto) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(state.defectPhoto)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [state.defectPhoto])

  return (
    <div>
      <h2 className="walk-step__title">Defect photo</h2>
      <p className="walk-step__sub">
        Optional. The photo is saved to DocuWare with the line so the office has evidence of the defect.
      </p>

      <div style={{ marginTop: '1rem' }}>
        <PhotoCapture
          existingUrl={previewUrl}
          existingStatus={previewUrl ? 'pending' : undefined}
          existingFilename={state.defectPhoto?.name}
          busy={false}
          onSelect={file => set({ defectPhoto: file })}
          onRemove={previewUrl ? () => set({ defectPhoto: undefined }) : undefined}
        />
      </div>

      {!state.defectPhoto && (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
          Skip if you can't take a photo right now — you can attach one later from the Receipts page.
        </p>
      )}
    </div>
  )
}

function StepStorage({ state, set }: {
  state: YardLineState
  set: (p: Partial<YardLineState>) => void
}) {
  const bay = state.bay ?? ''
  return (
    <div>
      <h2 className="walk-step__title">Where is it stored?</h2>
      <p className="walk-step__sub">Pick the bay and add any extra storage detail. All optional — leave blank if unknown.</p>

      <div className="review-notes" style={{ marginTop: 0 }}>
        <span className="review-notes__label">Bay</span>
        <div className="big-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
          {BAY_OPTIONS.map(b => (
            <button
              key={b}
              type="button"
              className={'big-grid__cell ' + (bay === b ? 'big-grid__cell--on' : '')}
              style={{ minHeight: 64, padding: '14px 8px', fontSize: 'var(--yard-fs-md)' }}
              onClick={() => set({ bay: b })}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      <div className="review-notes">
        <label htmlFor="yard-stored-in" className="review-notes__label">Stored In <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.75rem' }}>(free text — e.g. Cold room, Outside)</span></label>
        <input
          id="yard-stored-in"
          type="text"
          className="review-notes__input"
          style={{ minHeight: 48 }}
          placeholder="e.g. Cold room, Wash bay, Outside Plant 2"
          value={state.stored_in ?? ''}
          onChange={e => set({ stored_in: e.target.value })}
        />
      </div>

      <div className="review-notes">
        <label htmlFor="yard-accessories" className="review-notes__label">Accessories</label>
        <input
          id="yard-accessories"
          type="text"
          className="review-notes__input"
          style={{ minHeight: 48 }}
          placeholder="e.g. bolts, brackets"
          value={state.accessories ?? ''}
          onChange={e => set({ accessories: e.target.value })}
        />
      </div>

      <div className="review-notes">
        <label htmlFor="yard-comments" className="review-notes__label">Comments</label>
        <textarea
          id="yard-comments"
          className="review-notes__input"
          placeholder="General comments"
          rows={3}
          value={state.comments ?? ''}
          onChange={e => set({ comments: e.target.value })}
        />
      </div>
    </div>
  )
}

function StepReview({ line, state, set, idx, total }: {
  line: ReceiptLine
  state: YardLineState
  set: (p: Partial<YardLineState>) => void
  idx: number
  total: number
}) {
  const flagged = (state.discrepancy && state.discrepancy !== 'none') || state.hasDefects
  const flaggedDefects = ALL_DEFECT_ITEMS.filter(d => state.defects && (state.defects[d.key] ?? d.default) !== d.default)
  const processLabel = availableProcesses(state.item_type || '').find(p => p.value === state.process)?.label
  const mitigations = state.mitigations ?? {}
  const quantities = state.quantities ?? {}

  return (
    <div>
      <h2 className="walk-step__title">Review line {idx+1}</h2>
      <p className="walk-step__sub">Confirm before moving on{idx < total-1 ? ' to the next line' : ''}</p>

      <div className="review-card">
        <div className="review-row">
          <span className="k">Received</span>
          <span className="v mono">{state.received_quantity} / {line.expected_quantity} {line.unit_of_measure}</span>
        </div>
        <div className="review-row">
          <span className="k">Status</span>
          <span className="v">
            {state.discrepancy === 'none'  && <span className="yard-pill yard-pill--success">Match</span>}
            {state.discrepancy === 'short' && <span className="yard-pill yard-pill--danger">Short {line.expected_quantity - (state.received_quantity ?? 0)}</span>}
            {state.discrepancy === 'over'  && <span className="yard-pill yard-pill--warn">Over {(state.received_quantity ?? 0) - line.expected_quantity}</span>}
          </span>
        </div>
        <div className="review-row"><span className="k">Material</span><span className="v">{state.item_type}</span></div>
        <div className="review-row"><span className="k">Process</span><span className="v">{processLabel || '—'}</span></div>
        <div className="review-row"><span className="k">Packaging</span><span className="v">{state.packaging}</span></div>
        {(state.bay || state.stored_in) && (
          <div className="review-row">
            <span className="k">Storage</span>
            <span className="v">
              {state.bay || '—'}
              {state.stored_in ? ` · ${state.stored_in}` : ''}
            </span>
          </div>
        )}
        {state.accessories && (
          <div className="review-row"><span className="k">Accessories</span><span className="v">{state.accessories}</span></div>
        )}
        {state.comments && (
          <div className="review-row review-row--col">
            <span className="k">Comments</span>
            <span className="v" style={{ whiteSpace: 'pre-wrap' }}>{state.comments}</span>
          </div>
        )}
        <div className="review-row review-row--col">
          <span className="k">Defects</span>
          {flaggedDefects.length === 0 ? (
            <span className="yard-pill yard-pill--success" style={{ alignSelf: 'flex-start' }}><Icon name="check" size={12}/> None</span>
          ) : (
            <div className="review-defects">
              {flaggedDefects.map(d => {
                const mits = mitigations[d.key] ?? []
                const noQty = MITIGATION_NO_QTY.has(d.key)
                return (
                  <div key={d.key} className="review-defect">
                    <span className="yard-pill yard-pill--warn">
                      {d.label}: {state.defects?.[d.key]}
                    </span>
                    {mits.length > 0 && (
                      <div className="review-defect__mits">
                        {mits.map(m => {
                          const qty = quantities[d.key]?.[m]
                          const showQty = !noQty && qty != null
                          return (
                            <span key={m} className="review-defect__mit">
                              <Icon name="check" size={11}/> {m}{showQty ? ` × ${qty}` : ''}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="review-notes">
        <label htmlFor="yard-line-notes" className="review-notes__label">Notes (optional)</label>
        <textarea
          id="yard-line-notes"
          className="review-notes__input"
          placeholder="Anything the office should know about this line"
          value={state.notes ?? ''}
          onChange={e => set({ notes: e.target.value })}
          rows={3}
        />
      </div>

      {state.defectPhoto && (
        <ReviewPhotoPreview file={state.defectPhoto} />
      )}

      {flagged && (
        <div className="review-warn">
          <Icon name="alert" size={18}/>
          This line will be flagged on the GRN
        </div>
      )}
    </div>
  )
}

