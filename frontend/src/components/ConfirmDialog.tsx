import React, { useEffect, useRef } from 'react'

interface Props {
  open: boolean
  title?: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning'
  onConfirm(): void
  onCancel(): void
}

export default function ConfirmDialog({
  open, title = 'Are you sure?', message = 'This action cannot be undone.',
  confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'danger',
  onConfirm, onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const iconColor = variant === 'danger' ? 'var(--red)' : 'var(--amber)'
  const iconBg    = variant === 'danger' ? 'var(--red-dim)' : 'var(--amber-dim)'

  return (
    <div className="app-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="app-modal" style={{ maxWidth: 400 }}>
        <div className="app-modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '1.125rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: iconBg, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {variant === 'danger'
              ? <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              : <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            }
          </div>
          <div>
            <h3 id="confirm-title" style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h3>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{message}</p>
          </div>
        </div>
        <div className="app-modal__footer">
          <button ref={cancelRef} className="btn btn-ghost" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn ${variant === 'danger' ? 'btn-danger' : 'btn-ghost'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
