import { useMemo, useState } from 'react'
import {
  type ReceiptLine,
  type LineEdit,
  type BulkDefectDiff,
  BAY_OPTIONS,
  ITEM_TYPE_OPTIONS,
  PACKAGING_OPTIONS,
  availableProcesses,
  defectIntersection,
} from '../lib/receipts'
import { DefectModal } from './DefectModal'

export type BulkPatch = {
  patch: LineEdit
  defectDiff?: BulkDefectDiff
  // 'receive' marks selected lines as received in addition to applying patch.
  // Status-flip only — no walkthrough fan-out.
  markReceived: boolean
}

type FieldSummary =
  | { kind: 'all'; value: string }
  | { kind: 'mixed'; values: string[] }
  | { kind: 'empty' }

function summarise(lines: ReceiptLine[], pick: (l: ReceiptLine) => string | undefined): FieldSummary {
  const vals = new Set<string>()
  for (const l of lines) {
    const v = pick(l)
    if (v != null && v !== '') vals.add(v)
  }
  if (vals.size === 0) return { kind: 'empty' }
  if (vals.size === 1) return { kind: 'all', value: [...vals][0] }
  return { kind: 'mixed', values: [...vals] }
}

function summaryBadge(s: FieldSummary, labelFn?: (v: string) => string): string {
  if (s.kind === 'empty') return 'Not set'
  if (s.kind === 'all') return `All: ${labelFn ? labelFn(s.value) : s.value}`
  return `Mixed (${s.values.length} values)`
}

export function BulkLineEditSheet({
  selectedLines,
  busy,
  errorByLineId,
  onApply,
  onClose,
}: {
  selectedLines: ReceiptLine[]
  busy: boolean
  errorByLineId: Record<string, string>
  onApply: (p: BulkPatch) => Promise<void> | void
  onClose: () => void
}) {
  const n = selectedLines.length

  // touched: only fields the receiver explicitly changed get sent
  const [touched, setTouched] = useState<Set<keyof LineEdit>>(new Set())
  const [patch, setPatch] = useState<LineEdit>({})
  const [markReceived, setMarkReceived] = useState(false)
  const [defectDiff, setDefectDiff] = useState<BulkDefectDiff | null>(null)
  const [defectModalOpen, setDefectModalOpen] = useState(false)

  const intersection = useMemo(
    () => defectIntersection(selectedLines.map(l => l.condition_notes || '')),
    [selectedLines],
  )

  const defectBadge = defectDiff
    ? `${defectDiff.add.length} to add, ${defectDiff.remove.length} to remove`
    : intersection.length > 0
      ? `${intersection.length} common defect${intersection.length === 1 ? '' : 's'}`
      : 'No common defects'

  const touch = (field: keyof LineEdit, value: string | undefined) => {
    setTouched(prev => new Set(prev).add(field))
    setPatch(prev => ({ ...prev, [field]: value }))
  }
  const untouch = (field: keyof LineEdit) => {
    setTouched(prev => { const n = new Set(prev); n.delete(field); return n })
    setPatch(prev => { const { [field]: _drop, ...rest } = prev; return rest })
  }

  // Per-field summaries across the selection
  const summaries = useMemo(() => ({
    item_type:        summarise(selectedLines, l => l.item_type),
    process:          summarise(selectedLines, l => l.process),
    packaging_method: summarise(selectedLines, l => l.packaging_method),
    bay:              summarise(selectedLines, l => l.bay),
    stored_in:        summarise(selectedLines, l => l.stored_in),
    accessories:      summarise(selectedLines, l => l.accessories),
    comments:         summarise(selectedLines, l => l.comments),
  }), [selectedLines])

  // Process options: depend on item type. If the receiver selected an item
  // type in this sheet, use that. Otherwise fall back to the lines' shared
  // item type (if any). If types are mixed and untouched, show all options
  // and let the receiver narrow.
  const effectiveItemType = touched.has('item_type')
    ? (patch.item_type ?? '')
    : (summaries.item_type.kind === 'all' ? summaries.item_type.value : '')
  const processOpts = availableProcesses(effectiveItemType || '')

  const itemTypeLabel = (v: string) => ITEM_TYPE_OPTIONS.find(o => o.value === v)?.label ?? v
  const packagingLabel = (v: string) => PACKAGING_OPTIONS.find(o => o.value === v)?.label ?? v
  const processLabel = (v: string) => processOpts.find(o => o.value === v)?.label ?? v

  const hasChanges = touched.size > 0 || markReceived || defectDiff != null
  const failedCount = Object.keys(errorByLineId).length

  const apply = () => {
    if (!hasChanges) return
    onApply({ patch, markReceived, defectDiff: defectDiff ?? undefined })
  }

  return (
    <div className="bulk-sheet__overlay" role="dialog" aria-modal="true" aria-label="Bulk edit lines">
      <div className="bulk-sheet">
        <header className="bulk-sheet__head">
          <div>
            <h2 className="bulk-sheet__title">Bulk edit · {n} line{n === 1 ? '' : 's'}</h2>
            <p className="bulk-sheet__sub">Only the fields you change will be applied. Untouched fields stay as-is.</p>
          </div>
          <button type="button" className="bulk-sheet__close" onClick={onClose} aria-label="Close" disabled={busy}>×</button>
        </header>

        <div className="bulk-sheet__body">
          {/* Item Type */}
          <BulkField
            label="Item Type"
            badge={summaryBadge(summaries.item_type, itemTypeLabel)}
            touched={touched.has('item_type')}
            onClear={() => untouch('item_type')}
          >
            <select
              className="bulk-sheet__input"
              value={touched.has('item_type') ? (patch.item_type ?? '') : ''}
              onChange={e => touch('item_type', e.target.value)}
            >
              {ITEM_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </BulkField>

          {/* Process — depends on item type */}
          <BulkField
            label="Process"
            badge={summaryBadge(summaries.process, processLabel)}
            touched={touched.has('process')}
            onClear={() => untouch('process')}
            note={!effectiveItemType && summaries.item_type.kind === 'mixed' ? 'Pick an item type first to narrow process options.' : undefined}
          >
            <select
              className="bulk-sheet__input"
              value={touched.has('process') ? (patch.process ?? '') : ''}
              onChange={e => touch('process', e.target.value)}
            >
              <option value="">— Select process —</option>
              {processOpts.filter(o => o.value !== '').map(o => (
                <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
              ))}
            </select>
          </BulkField>

          {/* Packaging */}
          <BulkField
            label="Packaging"
            badge={summaryBadge(summaries.packaging_method, packagingLabel)}
            touched={touched.has('packaging_method')}
            onClear={() => untouch('packaging_method')}
          >
            <select
              className="bulk-sheet__input"
              value={touched.has('packaging_method') ? (patch.packaging_method ?? '') : ''}
              onChange={e => touch('packaging_method', e.target.value)}
            >
              {PACKAGING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </BulkField>

          {/* Storage Bay */}
          <BulkField
            label="Storage Bay"
            badge={summaryBadge(summaries.bay)}
            touched={touched.has('bay')}
            onClear={() => untouch('bay')}
          >
            <select
              className="bulk-sheet__input"
              value={touched.has('bay') ? (patch.bay ?? '') : ''}
              onChange={e => touch('bay', e.target.value)}
            >
              <option value="">— Select bay —</option>
              {BAY_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </BulkField>

          {/* Stored In */}
          <BulkField
            label="Stored In"
            badge={summaryBadge(summaries.stored_in)}
            touched={touched.has('stored_in')}
            onClear={() => untouch('stored_in')}
          >
            <input
              type="text"
              className="bulk-sheet__input"
              placeholder="Storage area"
              value={touched.has('stored_in') ? (patch.stored_in ?? '') : ''}
              onChange={e => touch('stored_in', e.target.value)}
            />
          </BulkField>

          {/* Accessories */}
          <BulkField
            label="Accessories"
            badge={summaryBadge(summaries.accessories)}
            touched={touched.has('accessories')}
            onClear={() => untouch('accessories')}
          >
            <input
              type="text"
              className="bulk-sheet__input"
              placeholder="e.g. bolts, brackets"
              value={touched.has('accessories') ? (patch.accessories ?? '') : ''}
              onChange={e => touch('accessories', e.target.value)}
            />
          </BulkField>

          {/* Comments */}
          <BulkField
            label="Comments"
            badge={summaryBadge(summaries.comments)}
            touched={touched.has('comments')}
            onClear={() => untouch('comments')}
          >
            <textarea
              className="bulk-sheet__input"
              rows={3}
              placeholder="General comments"
              value={touched.has('comments') ? (patch.comments ?? '') : ''}
              onChange={e => touch('comments', e.target.value)}
            />
          </BulkField>

          {/* Defects — bulk merge mode */}
          <BulkField
            label="Defects"
            badge={defectBadge}
            touched={defectDiff != null}
            onClear={defectDiff != null ? () => setDefectDiff(null) : undefined}
          >
            <button
              type="button"
              className="bulk-sheet__input"
              style={{ cursor: 'pointer', textAlign: 'left' }}
              onClick={() => setDefectModalOpen(true)}
            >
              {defectDiff
                ? `${defectDiff.add.length} add · ${defectDiff.remove.length} remove — click to edit`
                : `Edit defects for ${n} line${n === 1 ? '' : 's'}`}
            </button>
          </BulkField>

          {/* Receive — status flip only */}
          <div className="bulk-sheet__receive">
            <label>
              <input
                type="checkbox"
                checked={markReceived}
                onChange={e => setMarkReceived(e.target.checked)}
              />
              <span>Mark {n} line{n === 1 ? '' : 's'} as received</span>
            </label>
            <p className="bulk-sheet__hint">Status flip only. Use the walkthrough if any line needs qty/defect attention.</p>
          </div>

          {failedCount > 0 && (
            <div className="bulk-sheet__error" role="alert">
              {failedCount} line{failedCount === 1 ? '' : 's'} failed to update. The successful ones are saved.
            </div>
          )}
        </div>

        <footer className="bulk-sheet__foot">
          <button type="button" className="yard-btn-ghost yard-btn-lg" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="yard-btn-primary yard-btn-lg yard-btn-flex"
            onClick={apply}
            disabled={!hasChanges || busy}
          >
            {busy ? 'Applying…' : `Apply to ${n} line${n === 1 ? '' : 's'}`}
          </button>
        </footer>
      </div>

      {defectModalOpen && (
        <DefectModal
          mode="bulk"
          lineCount={n}
          intersection={intersection}
          onConfirm={diff => { setDefectDiff(diff); setDefectModalOpen(false) }}
          onClose={() => setDefectModalOpen(false)}
        />
      )}
    </div>
  )
}

function BulkField({ label, badge, touched, disabled, note, onClear, children }: {
  label: string
  badge: string
  touched?: boolean
  disabled?: boolean
  note?: string
  onClear?: () => void
  children: React.ReactNode
}) {
  return (
    <div className={'bulk-field' + (touched ? ' bulk-field--touched' : '') + (disabled ? ' bulk-field--disabled' : '')}>
      <div className="bulk-field__head">
        <span className="bulk-field__label">{label}</span>
        <span className={'bulk-field__badge' + (touched ? ' bulk-field__badge--touched' : '')}>
          {touched ? 'Will overwrite' : badge}
        </span>
        {touched && onClear && (
          <button type="button" className="bulk-field__clear" onClick={onClear} aria-label={`Clear ${label} change`}>
            Undo
          </button>
        )}
      </div>
      {children}
      {note && <p className="bulk-field__note">{note}</p>}
    </div>
  )
}
