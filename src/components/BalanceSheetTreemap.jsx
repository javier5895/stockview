import { useState, useEffect } from 'react'

function fmtB(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  if (abs >= 1000) return `US$${(v / 1000).toFixed(1)}T`
  return `US$${v.toFixed(1)}b`
}

const COLORS = {
  asset:     { bg: '#4ade80', text: '#14532d' },
  liability: { bg: '#4ade80', text: '#14532d' },
  equity:    { bg: '#4ade80', text: '#14532d' },
  debt:      { bg: '#ef4444', text: '#fff' },
}

function TreeBlock({ label, value, color, style }) {
  const { bg, text } = COLORS[color] || COLORS.asset
  const h = style?.height ?? 999
  const tiny  = h < 36   // single compressed line
  const small = h < 60   // label + value on same row

  return (
    <div style={{
      background: bg,
      border: '2px solid #1a1a1a',
      boxSizing: 'border-box',
      overflow: 'hidden',
      padding: tiny ? '4px 8px' : small ? '6px 10px' : '10px 12px',
      display: 'flex',
      flexDirection: small ? 'row' : 'column',
      alignItems: small ? 'center' : 'flex-start',
      justifyContent: 'flex-start',
      gap: small ? 6 : 0,
      minHeight: 0,
      ...style,
    }}>
      <div style={{
        fontSize: tiny ? 11 : 13,
        fontWeight: 700,
        color: text,
        lineHeight: 1.3,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        flexShrink: 1,
        minWidth: 0,
      }}>{label}</div>
      <div style={{
        fontSize: tiny ? 10 : 12,
        color: text,
        opacity: 0.8,
        marginTop: small ? 0 : 3,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>{fmtB(value)}</div>
    </div>
  )
}

/* Two-column layout within a panel, matching the reference design */
function Panel({ title, items, totalHeight = 400 }) {
  if (!items || items.length === 0) return null
  const total = items.reduce((s, i) => s + (i.value || 0), 0)
  if (total === 0) return null

  const filtered = items.filter(i => (i.value || 0) > 0.05)
  const left  = filtered.slice(0, 2)
  const right = filtered.slice(2)
  const leftTotal  = left.reduce((s, i)  => s + (i.value || 0), 0)
  const rightTotal = right.reduce((s, i) => s + (i.value || 0), 0)
  const grandTotal = leftTotal + rightTotal

  /* Compute pixel heights so every column fills exactly totalHeight with no gaps */
  function itemHeights(col, colTotal) {
    if (!col.length || colTotal <= 0) return col.map(() => 0)
    const heights = col.map(item => Math.max(0, Math.floor((item.value || 0) / colTotal * totalHeight)))
    const diff = totalHeight - heights.reduce((a, b) => a + b, 0)
    // Apply remainder to the largest item to avoid any gap/overflow
    const maxIdx = heights.indexOf(Math.max(...heights))
    heights[maxIdx] = Math.max(0, heights[maxIdx] + diff)
    return heights
  }

  const leftH  = itemHeights(left,  leftTotal)
  const rightH = itemHeights(right, rightTotal)
  const leftW  = grandTotal > 0 ? `${(leftTotal  / grandTotal * 100).toFixed(2)}%` : '60%'
  const rightW = grandTotal > 0 ? `${(rightTotal / grandTotal * 100).toFixed(2)}%` : '40%'

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', height: totalHeight, gap: 0 }}>
        {/* Left column */}
        <div style={{ width: leftW, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          {left.map((item, i) => (
            <TreeBlock key={i} {...item} style={{ height: leftH[i], flexShrink: 0 }} />
          ))}
        </div>
        {/* Right column */}
        <div style={{ width: rightW, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          {right.map((item, i) => (
            <TreeBlock key={i} {...item} style={{ height: rightH[i], flexShrink: 0 }} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function BalanceSheetTreemap({ ticker }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setData(null); setLoading(true); setError(null)
    fetch(`/api/stock/${ticker}/balance-sheet-snapshot`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [ticker])

  return (
    <div className="card deq-card">
      <div className="deq-header">
        <div className="prof-icon-wrap">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>
        <div className="prof-header-text">
          <h3 className="prof-title">Balance Sheet</h3>
          <p className="prof-subtitle">{data?.date ? `As of ${data.date}` : 'Latest annual filing'}</p>
        </div>
      </div>

      <div className="prof-divider" />

      {loading && <div className="prof-state"><div className="deq-skeleton" /></div>}
      {error && !loading && <div className="prof-state prof-error">Could not load balance sheet data.</div>}

      {data && !loading && !error && (
        <div style={{ padding: '8px 20px 24px', display: 'flex', gap: 20 }}>
          <Panel title="Assets"           items={data.assets}      totalHeight={420} />
          <Panel title="Liabilities + Equity" items={data.liabilities} totalHeight={420} />
        </div>
      )}
    </div>
  )
}
