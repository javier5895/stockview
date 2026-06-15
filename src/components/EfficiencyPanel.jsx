import { useState, useEffect } from 'react'

/* ─── Bar ────────────────────────────────────────────────────── */
function MetricBar({ value, target, direction, unit }) {
  const tc  = 'var(--border2)'
  const met = value !== null && (direction === 'higher' ? value >= target : value <= target)

  // Centre-zero for trend/binary metrics (target = 0, direction = higher)
  if (target === 0 && direction === 'higher') {
    const absMax = Math.max(Math.abs(value ?? 0) * 1.6, unit === '$B' ? 10 : 20)
    const clamp  = Math.max(-absMax, Math.min(absMax, value ?? 0))
    const half   = Math.abs(clamp) / absMax * 50
    const isPos  = value !== null && value >= 0
    const negLbl = unit === '$B' ? '$0' : 'Declining'
    const posLbl = unit === '$B' ? 'Growing' : 'Improving'
    return (
      <div className="prof-bar-wrap">
        <div className="growth-bar-center-track" style={{ background: tc }}>
          <div className="growth-bar-neg" style={{ width: isPos ? 0 : `${half}%`, opacity: value == null ? 0 : 1 }} />
          <div className="growth-bar-zero" />
          <div className="growth-bar-pos" style={{ width: isPos ? `${half}%` : 0, opacity: value == null ? 0 : 1 }} />
        </div>
        <div className="prof-bar-legend">
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{negLbl}</span>
          <span style={{ color: '#eab308', fontSize: 10, fontWeight: 600 }}>0</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{posLbl}</span>
        </div>
      </div>
    )
  }

  // Standard bar: 0 → target*2, target always at 50%
  const maxVal  = target * 2
  const fillPct = value !== null ? Math.min(Math.max(value / maxVal * 100, 0), 100) : 0
  const color   = met ? '#16a34a' : '#dc2626'
  const fmt     = v => unit === 'x' ? `${v}×` : `${v}${unit}`

  return (
    <div className="prof-bar-wrap">
      <div className="prof-bar-track" style={{ background: tc }}>
        <div className="prof-bar-fill" style={{ width: `${fillPct}%`, background: color }} />
        <div className="prof-bar-target" style={{ left: '50%' }} />
      </div>
      <div className="prof-bar-legend">
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>0</span>
        <span style={{ color: '#eab308', fontSize: 10, fontWeight: 600 }}>
          {direction === 'lower' ? '<' : '>'}&nbsp;{fmt(target)}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{fmt(maxVal)}</span>
      </div>
    </div>
  )
}

/* ─── Format value by unit ───────────────────────────────────── */
function fmtValue(value, unit) {
  if (value === null) return '—'
  if (unit === '%')  return `${value > 0 ? '' : ''}${value.toFixed(1)}%`
  if (unit === 'x')  return `${value.toFixed(2)}×`
  if (unit === '$B') return `$${value.toFixed(1)}B`
  return value.toFixed(2)
}

/* ─── Metric row ─────────────────────────────────────────────── */
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
        <MetricBar value={value} target={target} direction={direction} unit={unit} />
      </div>

      <div className="prof-row-right">
        <div style={{ textAlign: 'right' }}>
          <div className="prof-value" style={{ color }}>{fmtValue(value, unit)}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{targetLabel}</div>
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
export default function EfficiencyPanel({ ticker }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setData(null); setLoading(true); setError(null)
    fetch(`/api/stock/${ticker}/efficiency`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [ticker])

  return (
    <div className="card prof-card">
      <div className="prof-header">
        <div className="prof-icon-wrap">
          {/* gear / settings icon */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </div>
        <div className="prof-header-text">
          <h3 className="prof-title">Efficiency</h3>
          <p className="prof-subtitle">Does management allocate capital well?</p>
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
        <div className="prof-state prof-error">Could not load efficiency data.</div>
      )}

      {data && !loading && (
        <div className="prof-list">
          {data.metrics.map((m, i) => (
            <MetricRow key={m.id} index={i + 1} metric={m} />
          ))}
        </div>
      )}
    </div>
  )
}
