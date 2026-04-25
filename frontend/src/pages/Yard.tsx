import React, { useCallback, useEffect, useState } from 'react'
import { apiFetch, clearToken } from '../auth'
import { useToast } from '../components/Toast'
import {
  type Receipt,
  type ReceiptLine,
  type LineEdit,
  DEFECT_CATEGORIES,
  availableProcesses,
  defaultDefectValues,
  hasAnyDefect,
  buildConditionNotes,
} from '../lib/receipts'
import '../styles/yard.css'

// ── Yard-compressed defect set ────────────────────────────────────────────────
// Subset of the canonical DEFECT_CATEGORIES surfaced inside the walkthrough.
// Keep keys aligned with lib/receipts so buildConditionNotes serialises them
// the same way the office UI does.
const YARD_DEFECT_KEYS = [
  'damaged', 'rust', 'paint', 'oilGreaseDiesel',
  'weldingFlux', 'weldingSplatter', 'burr',
  'sharpEdges', 'holesInadequate', 'threadedArticle',
] as const

type YardDefect = {
  key: string
  label: string
  options: string[]
  default: string
}

const ALL_DEFECT_ITEMS = DEFECT_CATEGORIES.flatMap(c => c.items)
const YARD_DEFECTS: YardDefect[] = YARD_DEFECT_KEYS
  .map(k => ALL_DEFECT_ITEMS.find(i => i.key === k))
  .filter((i): i is NonNullable<typeof i> => !!i)
  .map(i => ({ key: i.key, label: i.label, options: i.options, default: i.default }))

function hasAnyYardDefect(d: Record<string, string>) {
  return YARD_DEFECTS.some(def => (d[def.key] ?? def.default) !== def.default)
}

// ── Icons (minimal inline set so we don't depend on the design's Icon comp) ──
type IconName = 'truck' | 'flag' | 'check' | 'play' | 'doc' | 'minus' | 'plus' | 'alert' | 'close' | 'chevL' | 'chevR'
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
  defects?: Record<string, string>
  hasDefects?: boolean
  defects_done?: boolean
  notes?: string
  received?: boolean
}
type LineStateMap = Record<string, YardLineState>

// Disabled-process map matches the canonical lib but expressed for the yard's
// 3-option item-type radio (lib uses 'galvanised'/'blacksteel'/'other').
function disabledForType(itemType?: string): string[] {
  if (!itemType) return []
  return availableProcesses(itemType).filter(o => o.disabled).map(o => o.value)
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
  const [lineState, setLineState] = useState<LineStateMap>({})
  const [savingLineId, setSavingLineId] = useState<string | null>(null)
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const { showToast } = useToast()

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

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
    const notes = (st.notes ?? '').trim()
    const hasDefects = !!(st.defects && st.hasDefects)
    if (hasDefects || notes) {
      edit.condition_notes = buildConditionNotes(st.defects ?? {}, {}, {}, notes)
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
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message === 'unauthorized' ? 'Session expired — sign in again' : 'Network error — try again' }
    } finally { setSavingLineId(null) }
  }, [])

  if (view === 'walk' && active) {
    return (
      <YardWalkthrough
        pod={active}
        lineState={lineState}
        updateLine={updateLine}
        savingLineId={savingLineId}
        onPersistLine={persistLine}
        onExit={() => setView('detail')}
        onComplete={() => setView('detail')}
      />
    )
  }

  return (
    <div className="yard-shell">
      <YardTopbar online={online} queueCount={0}/>

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
        />
      )}
      {!loading && !error && view === 'detail' && active && (
        <YardLoadDetail
          pod={active}
          lineState={lineState}
          onBack={() => setView('list')}
          onWalk={() => setView('walk')}
          onIssueGRN={() => showToast('GRN issuance is not wired up yet', 'info')}
        />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// TOPBAR
// ════════════════════════════════════════════════════════════════════════════
function YardTopbar({ online, queueCount }: { online: boolean; queueCount: number }) {
  return (
    <div className="yard-topbar">
      <div className="yard-topbar__brand">
        <div className="yard-topbar__logo">TG</div>
        <div>
          <div className="yard-topbar__title">Yard Receiving</div>
          <div className="yard-topbar__sub">Transvaal Galvanisers · Nigel</div>
        </div>
      </div>
      <div className={'yard-conn ' + (online ? 'yard-conn--online' : 'yard-conn--offline')}>
        <span className="yard-conn__dot"/>
        {online ? 'Online' : 'Offline'}
        {queueCount > 0 && <span className="yard-conn__queue">{queueCount} queued</span>}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// LIST
// ════════════════════════════════════════════════════════════════════════════
function YardLoadsList({ pods, lineState, onOpen }: {
  pods: Receipt[]
  lineState: LineStateMap
  onOpen: (id: string) => void
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
    const grnIssued = p.status === 'archived' // best proxy until GRN status lands
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
        {visible.map(p => (
          <button key={p.id} className="yard-load-card" onClick={() => onOpen(p.id)}>
            <div className="yard-load-card__plate">
              <Icon name="truck" size={24}/>
            </div>
            <div className="yard-load-card__main">
              <div className="yard-load-card__row">
                <div className="yard-load-card__num">{p.delivery_note_number || p.receipt_number || '—'}</div>
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
              {p._done > 0 && p._total > 0 && (
                <div className="yard-progress-ring" style={{ ['--p' as any]: Math.round((p._done/p._total)*100) }}>
                  <div className="yard-progress-ring__inner">{p._done}/{p._total}</div>
                </div>
              )}
              <Icon name="chevR" size={28}/>
            </div>
          </button>
        ))}
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
function YardLoadDetail({ pod, lineState, onBack, onWalk, onIssueGRN }: {
  pod: Receipt
  lineState: LineStateMap
  onBack: () => void
  onWalk: () => void
  onIssueGRN: () => void
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
  const grnIssued = pod.status === 'archived'

  return (
    <div className="yard-page">
      <div className="yard-detail__topbar">
        <button className="yard-back" onClick={onBack}>
          <Icon name="chevL" size={28}/> Loads
        </button>
        <span className="yard-detail__num">{pod.delivery_note_number || pod.receipt_number}</span>
      </div>

      <div className="yard-detail__hero">
        <div>
          <div className="yard-detail__customer">{pod.customer_name || pod.supplier_name || '—'}</div>
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

      <div className="yard-detail__cta">
        {!allDone && !grnIssued && total > 0 && (
          <button className="yard-btn-primary yard-btn-xl" onClick={onWalk}>
            <Icon name="play" size={22}/>
            {firstUndoneIdx > 0 ? 'Resume walkthrough' : 'Start walkthrough'}
            <span className="yard-btn-xl__sub">{total - done} line{total-done !== 1 ? 's' : ''} to check</span>
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
          <button className="yard-btn-ghost yard-btn-xl" onClick={onIssueGRN}>
            <Icon name="doc" size={22}/>
            View GRN <span className="mono">{pod.receipt_number}</span>
          </button>
        )}
      </div>

      <div className="yard-detail__list-header">
        <span>Line items</span>
        <button className="yard-link" onClick={onWalk}>Open in walkthrough →</button>
      </div>
      <div className="yard-detail__lines">
        {lines.map((l, idx) => (
          <YardLineSummary
            key={l.id}
            line={l}
            idx={idx}
            state={lineState[l.id] || {}}
          />
        ))}
        {lines.length === 0 && (
          <div className="yard-empty">
            <div className="yard-empty__title">No lines on this load yet</div>
            <div className="yard-empty__sub">Lines arrive when DocuWare pushes them.</div>
          </div>
        )}
      </div>
    </div>
  )
}

function YardLineSummary({ line, idx, state }: { line: ReceiptLine; idx: number; state: YardLineState }) {
  const received = state.received || line.receiving_status === 'received'
  const flagged = (state.discrepancy && state.discrepancy !== 'none')
    || state.hasDefects
    || line.discrepancy === 'defects_noted'
  const cls = received ? (flagged ? 'yard-line--flagged' : 'yard-line--ok') : 'yard-line--pending'
  return (
    <div className={'yard-line ' + cls}>
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
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// WALKTHROUGH
// ════════════════════════════════════════════════════════════════════════════
const STEPS = ['qty', 'type', 'process', 'packaging', 'defects', 'review'] as const
type Step = typeof STEPS[number]

function YardWalkthrough({ pod, lineState, updateLine, savingLineId, onPersistLine, onExit, onComplete }: {
  pod: Receipt
  lineState: LineStateMap
  updateLine: (lineId: string, patch: Partial<YardLineState>) => void
  savingLineId: string | null
  onPersistLine: (receiptId: string, line: ReceiptLine, st: YardLineState) => Promise<{ ok: true } | { ok: false; error: string }>
  onExit: () => void
  onComplete: () => void
}) {
  const lines = pod.lines || []
  const firstUndone = lines.findIndex(l => !(l.receiving_status === 'received' || lineState[l.id]?.received))
  const [idx, setIdx] = useState(firstUndone === -1 ? 0 : firstUndone)
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

  const goNext = () => { if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1]) }
  const goPrev = () => {
    if (stepIdx > 0) setStep(STEPS[stepIdx - 1])
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
          <div className="yard-walk__delivery">{pod.delivery_note_number || pod.receipt_number} · {pod.customer_name}</div>
          <div className="yard-walk__progress">Line <strong>{idx+1}</strong> of <strong>{total}</strong></div>
        </div>
        <div className="yard-walk__steps">
          {STEPS.slice(0,5).map((s, i) => (
            <span key={s} className={'yard-walk__dot ' + (i < stepIdx ? 'done' : i === stepIdx ? 'now' : '')}/>
          ))}
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
  const setDefect = (key: string, val: string) => {
    const newDef = { ...defects, [key]: val }
    set({ defects: newDef, hasDefects: hasAnyYardDefect(newDef) || hasAnyDefect(newDef), defects_done: true })
  }
  const skipAll = () => {
    set({ defects: defaultDefectValues(), hasDefects: false, defects_done: true })
  }
  return (
    <div>
      <h2 className="walk-step__title">Any defects?</h2>
      <p className="walk-step__sub">Tap a row that doesn't match — leave the rest</p>

      <button className="walk-skip-all" onClick={skipAll}>
        <Icon name="check" size={18}/> All clean — no defects
      </button>

      <div className="defect-list">
        {YARD_DEFECTS.map(d => {
          const val = defects[d.key] ?? d.default
          const flagged = val !== d.default
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
            </div>
          )
        })}
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
  const flaggedDefects = YARD_DEFECTS.filter(d => state.defects && state.defects[d.key] !== d.default)
  const processLabel = availableProcesses(state.item_type || '').find(p => p.value === state.process)?.label

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
        <div className="review-row review-row--col">
          <span className="k">Defects</span>
          {flaggedDefects.length === 0 ? (
            <span className="yard-pill yard-pill--success" style={{ alignSelf: 'flex-start' }}><Icon name="check" size={12}/> None</span>
          ) : (
            <div className="review-defects">
              {flaggedDefects.map(d => (
                <span key={d.key} className="yard-pill yard-pill--warn">
                  {d.label}: {state.defects?.[d.key]}
                </span>
              ))}
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

      {flagged && (
        <div className="review-warn">
          <Icon name="alert" size={18}/>
          This line will be flagged on the GRN
        </div>
      )}
    </div>
  )
}

