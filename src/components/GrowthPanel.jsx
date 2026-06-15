import { useState, useEffect } from 'react'

/* ─── Bar — two modes: standard (target > 0) and trend (target = 0) ── */
function MetricBar({ value, target }) {
  const met = value !== null && value >= target
  const tc  = 'var(--border2)'

  if (target === 0) {
    // Centre-zero bar: ±30 % range, green right / red left
    const MAX   = Math.max(Math.abs(value ?? 0) * 1.6, 30)
    const clamp = Math.max(-MAX, Math.min(MAX, value ?? 0))
    const half  = Math.abs(clamp) / MAX * 50   // 0–50 %
    const isPos = value !== null && value >= 0

    return (
      <div className="prof-bar-wrap">
        <div className="growth-bar-center-track" style={{ background: tc }}>
          {/* Negative fill (grows from centre leftward) */}
          <div className="growth-bar-neg"
            style={{ width: isPos ? 0 : `${half}%`, opacity: value === null ? 0 : 1 }} />
          {/* Centre line */}
          <div className="growth-bar-zero" />
          {/* Positive fill (grows from centre rightward) */}
          <div className="growth-bar-pos"
            style={{ width: isPos ? `${half}%` : 0, opacity: value === null ? 0 : 1 }} />
        </div>
        <div className="prof-bar-legend">
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Declining</span>
          <span style={{ color: '#eab308', fontSize: 10, fontWeight: 600 }}>0%</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Growing</span>
        </div>
      </div>
    )
  }

  // Standard bar: 0 → target*2, target marker at midpoint
  const maxVal   = target * 2
  const fillPct  = value !== null ? Math.min(Math.max(value / maxVal * 100, 0), 100) : 0
  const fillColor = met ? '#16a34a' : '#dc2626'

  return (
    <div className="prof-bar-wrap">
      <div className="prof-bar-track" style={{ background: tc }}>
        <div className="prof-bar-fill" style={{ width: `${fillPct}%`, background: fillColor }} />
        <div className="prof-bar-target" style={{ left: '50%' }} />
      </div>
      <div className="prof-bar-legend">
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>0%</span>
        <span style={{ color: '#eab308', fontSize: 10, fontWeight: 600 }}>
          Target&nbsp;{target}%
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{target * 2}%</span>
      </div>
    </div>
  )
}

/* ─── Single metric row ──────────────────────────────────────── */
function MetricRow({ index, metric }) {
  const { name, value, target, description, targetLabel } = metric
  const met   = value !== null && value >= target
  const color = value === null ? 'var(--text-muted)'
              : met            ? '#16a34a'
              :                  '#dc2626'

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
        <MetricBar value={value} target={target} met={met} />
      </div>

      <div className="prof-row-right">
        <div style={{ textAlign: 'right' }}>
          <div className="prof-value" style={{ color }}>
            {value !== null ? `${value > 0 ? '+' : ''}${value.toFixed(1)}%` : '—'}
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
  const dash = circ * pct

  return (
    <svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border2)" strokeWidth={sw} />
      <circle cx={cx} cy={cy} r={r} fill="none"
        stroke={pct >= 0.5 ? '#16a34a' : '#dc2626'} strokeWidth={sw}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`} />
      <text x={cx} y={cy + 5} textAnchor="middle"
        fontSize="13" fontWeight="700" fill="var(--text-strong)">
        {met}/{total}
      </text>
    </svg>
  )
}

/* ─── Panel ──────────────────────────────────────────────────── */
export default function GrowthPanel({ ticker, dark }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setData(null); setLoading(true); setError(null)
    fetch(`/api/stock/${ticker}/growth`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [ticker])

  return (
    <div className="card prof-card">
      {/* Header */}
      <div className="prof-header">
        <div className="prof-icon-wrap">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </svg>
        </div>
        <div className="prof-header-text">
          <h3 className="prof-title">Growth</h3>
          <p className="prof-subtitle">Is the business expanding?</p>
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
        <div className="prof-state prof-error">Could not load growth data.</div>
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
