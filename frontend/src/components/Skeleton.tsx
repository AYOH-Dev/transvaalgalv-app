import React from 'react'

export function SkeletonStats({ count = 3 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: '1.125rem' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="stat-card" style={{ pointerEvents: 'none' }}>
          <span className="skel skel-circle" style={{ width: 44, height: 44, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="skel" style={{ width: '55%', height: 28 }} />
            <span className="skel" style={{ width: '40%', height: 12 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function SkeletonRows({ rows = 4, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} style={{ padding: '0.875rem 1rem' }}>
              <span className="skel" style={{ width: `${45 + ((r * 13 + c * 7) % 40)}%`, height: 14 }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export function SkeletonCard() {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <span className="skel" style={{ width: '50%', height: 18 }} />
      <span className="skel" style={{ width: '30%', height: 12 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        {[100, 80, 90].map((w, i) => <span key={i} className="skel" style={{ width: `${w}%`, height: 12 }} />)}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <span className="skel" style={{ flex: 1, height: 32, borderRadius: 6 }} />
        <span className="skel" style={{ flex: 1, height: 32, borderRadius: 6 }} />
      </div>
    </div>
  )
}
