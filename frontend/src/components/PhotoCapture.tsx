// PhotoCapture — single-photo capture/upload control used by the defect
// flow. Tablet-first: uses the native camera via `capture="environment"`.
//
// States the parent can drive:
//   - empty       → "Take Photo" button
//   - uploading   → spinner + filename
//   - existing    → thumbnail + sync badge + Replace / Remove
//
// The component is intentionally dumb: it doesn't talk to the API itself.
// The parent owns upload/delete (so the DefectModal can sequence those
// against its own save). All bytes flow through onSelect(file).

import React, { useEffect, useRef, useState } from 'react'

export type PhotoSyncStatus = 'pending' | 'in_progress' | 'synced' | 'failed' | string

export type PhotoCaptureProps = {
  /** Existing photo's blob URL (caller fetches via fetchDefectPhotoBlobUrl). */
  existingUrl?: string | null
  /** DocuWare sync state, drives the badge. */
  existingStatus?: PhotoSyncStatus
  existingFilename?: string
  /** Disabled while a request is in-flight from the parent. */
  busy?: boolean
  /** Fired when the receiver picks a new photo. */
  onSelect: (file: File) => void
  /** Fired when receiver removes the existing photo (only allowed if pending). */
  onRemove?: () => void
}

const ACCEPT = 'image/jpeg,image/png,image/heic,image/heif,image/webp'

export default function PhotoCapture({
  existingUrl,
  existingStatus,
  existingFilename,
  busy,
  onSelect,
  onRemove,
}: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pickError, setPickError] = useState<string | null>(null)

  function openPicker() {
    setPickError(null)
    inputRef.current?.click()
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset value so picking the same file twice still fires `change`.
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setPickError('Please pick an image file.')
      return
    }
    onSelect(file)
  }

  const removable = !!existingUrl && existingStatus === 'pending'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        capture="environment"
        onChange={handleChange}
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
      />

      {existingUrl ? (
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Thumbnail url={existingUrl} alt={existingFilename || 'Defect photo'} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1, minWidth: 180 }}>
            <SyncBadge status={existingStatus} />
            {existingFilename && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                {existingFilename}
              </span>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={openPicker}
                disabled={busy}
                style={{ minHeight: 40 }}
              >
                Replace
              </button>
              {removable && onRemove && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onRemove}
                  disabled={busy}
                  style={{ minHeight: 40 }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          disabled={busy}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1rem',
            minHeight: 52,
            border: '1.5px dashed var(--border)',
            borderRadius: 'var(--radius-lg)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: busy ? 'progress' : 'pointer',
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          <CameraIcon />
          {busy ? 'Uploading…' : 'Take Photo'}
        </button>
      )}

      {pickError && (
        <span role="alert" style={{ fontSize: '0.75rem', color: 'var(--color-danger, #b91c1c)' }}>
          {pickError}
        </span>
      )}
    </div>
  )
}

function Thumbnail({ url, alt }: { url: string; alt: string }) {
  return (
    <img
      src={url}
      alt={alt}
      style={{
        width: 96,
        height: 96,
        objectFit: 'cover',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
      }}
    />
  )
}

function SyncBadge({ status }: { status?: PhotoSyncStatus }) {
  const cfg: Record<string, { label: string; bg: string; fg: string }> = {
    pending: { label: 'Queued for DocuWare', bg: 'rgba(245,158,11,0.12)', fg: 'var(--amber, #b45309)' },
    in_progress: { label: 'Uploading to DocuWare…', bg: 'rgba(59,130,246,0.12)', fg: 'var(--blue, #1d4ed8)' },
    synced: { label: 'Synced to DocuWare', bg: 'rgba(34,197,94,0.12)', fg: 'var(--green, #166534)' },
    failed: { label: 'Sync failed — will retry', bg: 'rgba(239,68,68,0.12)', fg: 'var(--color-danger, #b91c1c)' },
  }
  const c = cfg[status || 'pending'] || cfg.pending
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.375rem',
        alignSelf: 'flex-start',
        padding: '0.25rem 0.625rem',
        borderRadius: '999px',
        background: c.bg,
        color: c.fg,
        fontSize: '0.7rem',
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: c.fg }} />
      {c.label}
    </span>
  )
}

function CameraIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

// useObjectUrl is a small helper for callers: takes a Promise<string>
// (typically `fetchDefectPhotoBlobUrl(...)`), tracks the resulting blob URL,
// and revokes it on unmount/replace to avoid leaks.
export function useObjectUrl(getter: (() => Promise<string>) | null) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let current: string | null = null
    if (!getter) {
      setUrl(null)
      return
    }
    getter()
      .then(u => {
        if (cancelled) {
          URL.revokeObjectURL(u)
          return
        }
        current = u
        setUrl(u)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
      if (current) URL.revokeObjectURL(current)
    }
  }, [getter])

  return url
}
