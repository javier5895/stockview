import { useState, useEffect } from 'react'
import DebtEquityChart from './DebtEquityChart'

/* ─── Bar — three modes ──────────────────────────────────────── */
function MetricBar({ value, target, direction }) {
  const tc  = 'var(--border2)'
  const met = value !== null && (
    direction === 'higher' ? value >= target : value <= target
  )

  // Centre-zero bar for FCF (target = 0)
  if (target === 0 && direction === 'higher') {
    const MAX   = Math.max(Math.abs(value ?? 0) * 1.6, 5)
    const clamp = Math.max(-MAX, Math.min(MAX, value ?? 0))
    const half  = Math.abs(clamp) / MAX * 50
    const isPos = value !== null && value >= 0
    return (
      <div className="prof-bar-wrap">
        <div className="growth-bar-center-track" style={{ background: tc }}>
          <div className="growth-bar-neg" style={{ width: isPos ? 0 : `${half}%`, opacity: value == null ? 0 : 1 }} />
          <div className="growth-bar-zero" />
          <div className="growth-bar-pos" style={{ width: isPos ? `${half}%` : 0, opacity: value == null ? 0 : 1 }} />
        </div>
        <div className="prof-bar-legend">
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Negative</span>
          <span style={{ color: '#eab308', fontSize: 10, fontWeight: 600 }}>$0</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Positive</span>
        </div>
      </div>
    )
  }

  // Standard bar — scale is 0 → target*2, target marker always at 50%
  const maxVal  = target * 2
  const fillPct = value !== null ? Math.min(Math.max(value / maxVal * 100, 0), 100) : 0
  const color   = met ? '#16a34a' : '#dc2626'

  return (
    <div className="prof-bar-wrap">
      <div className="prof-bar-track" style={{ background: tc }}>
        <div className="prof-bar-fill" style={{ width: `${fillPct}%`, background: color }} />
        <div className="prof-bar-target" style={{ left: '50%' }} />
      </div>
      <div className="prof-bar-legend">
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>0</span>
        <span style={{ color: '#eab308', fontSize: 10, fontWeight: 600 }}>
          {direction === 'lower' ? '<' : '>'}&nbsp;{target}{target < 10 ? '' : '%'}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{maxVal}{target < 10 ? '' : '%'}</span>
      </div>
    </div>
  )
}

/* ─── Format display value by unit ──────────────────────────── */
function fmtValue(value, unit) {
  if (value === null) return '—'
  if (unit === '%')  return `${value.toFixed(1)}%`
  if (unit === 'x')  return `${value.toFixed(2)}×`
  if (unit === '$B') return `$${value.toFixed(1)}B`
  return value.toFixed(2)
}

/* ─── Single metric row ──────────────────────────────────────── */
function MetricRow({ index, metric }) {
  const { name, value, target, direction, unit, description, targetLabel } = metric
  const met   = value !== null && (direction === 'higher' ? value >= target : value <= target)
  const color = value === null ? 'var(--text-muted)' : met ? '#16a34a' : '#dc2626'

  return (
    <div className="prof-row">
      <div className="prof-row-left">
        <span className="prof-index">{index}</span>
        <div>
          <div className="prof-metric-name">{name}</div>
          <div className="prof-metric-desc">{description}</div>
        </div>
      </div>

      <div className="prof-row-center">
        <MetricBar value={value} target={target} direction={direction} />
      </div>

      <div className="prof-row-right">
        <div style={{ textAlign: 'right' }}>
          <div className="prof-value" style={{ color }}>
            {fmtValue(value, unit)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {targetLabel}
          </div>
        </div>
        <span className={`prof-badge ${met ? 'prof-badge--met' : value === null ? 'prof-badge--na' : 'prof-badge--miss'}`}>
          {value === null ? 'N/A' : met ? '✓' : '✗'}
        </span>
      </div>
    </div>
  )
}

/* ─── Score ring ─────────────────────────────────────────────── */
function ScoreRing({ met, total }) {
  const r = 22, cx = 28, cy = 28, sw = 5
  const pct  = total > 0 ? met / total : 0
  const circ = 2 * Math.PI * r
  return (
    <svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border2)" strokeWidth={sw} />
      <circle cx={cx} cy={cy} r={r} fill="none"
        stroke={pct >= 0.5 ? '#16a34a' : '#dc2626'} strokeWidth={sw}
        strokeDasharray={`${circ * pct} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`} />
      <text x={cx} y={cy + 5} textAnchor="middle"
        fontSize="13" fontWeight="700" fill="var(--text-strong)">
        {met}/{total}
      </text>
    </svg>
  )
}

/* ─── Panel ──────────────────────────────────────────────────── */
export default function HealthPanel({ ticker, dark }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setData(null); setLoading(true); setError(null)
    fetch(`/api/stock/${ticker}/health`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [ticker])

  return (
    <>
    <div className="card prof-card">
      {/* Header */}
      <div className="prof-header">
        <div className="prof-icon-wrap">
          {/* shield icon */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <div className="prof-header-text">
          <h3 className="prof-title">Health</h3>
          <p className="prof-subtitle">Is the balance sheet solid?</p>
        </div>
        {data && (
          <div className="prof-score-wrap">
            <ScoreRing met={data.met} total={data.total} />
            <span className="prof-score-label">targets met</span>
          </div>
        )}
      </div>

      <div className="prof-divider" />

      {loading && (
        <div className="prof-state">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="prof-skeleton-row">
              <div className="prof-skeleton prof-skeleton--short" />
              <div className="prof-skeleton prof-skeleton--long" />
              <div className="prof-skeleton prof-skeleton--short" />
            </div>
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="prof-state prof-error">Could not load health data.</div>
      )}

      {data && !loading && (
        <div className="prof-list">
          {data.metrics.map((m, i) => (
            <MetricRow key={m.id} index={i + 1} metric={m} />
          ))}
        </div>
      )}
    </div>

    <DebtEquityChart ticker={ticker} />
</>
  )
}
