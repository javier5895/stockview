import { useState, useEffect } from 'react'

/* ─── Gauge chart ────────────────────────────────────────────── */
/*
 * Arc orientation: SA=225 means 0% starts at lower-left (7-8 o'clock),
 * sweeps 270° clockwise → 20% at top (12 o'clock) → 40% at lower-right (4-5 o'clock).
 * Two-layer depth effect:
 *   Layer 1 (bottom): colored zone arcs at outer radius (thin colored rim)
 *   Layer 2 (top):    dark inner arc at smaller radius covering the inner portion
 * This leaves only the outer colored rim visible, with a dark groove inward.
 */
const ROE_ROIC_THRESHOLDS = [
  { val: 5,        color: '#991b1b' },
  { val: 15,       color: '#d97706' },
  { val: 35,       color: '#86efac' },
  { val: Infinity, color: '#16a34a' },
]
const ROA_THRESHOLDS = [
  { val: 5,        color: '#991b1b' },
  { val: 10,       color: '#d97706' },
  { val: 15,       color: '#86efac' },
  { val: Infinity, color: '#16a34a' },
]

function GaugeChart({ value, industryVal, label, title, maxVal = 40, thresholds = ROE_ROIC_THRESHOLDS, ticks }) {
  const cx = 110, cy = 125
  const SA = 225, SWEEP = 270

  const COLOR_R = 85, COLOR_SW = 14
  const TRACK_R = 73, TRACK_SW = 20
  const TICK_R  = 116   // radius for tick labels (outside the arc)
  const NEEDLE_LEN = 60

  const TRC = 'var(--gauge-track)'

  function toRad(deg) { return (deg - 90) * Math.PI / 180 }

  function arcPath(r, startDeg, sweepDeg) {
    const a2 = startDeg + sweepDeg
    const sx = cx + r * Math.cos(toRad(startDeg))
    const sy = cy + r * Math.sin(toRad(startDeg))
    const ex = cx + r * Math.cos(toRad(a2))
    const ey = cy + r * Math.sin(toRad(a2))
    return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`
  }

  function valToAngle(v) {
    return SA + (Math.min(Math.max(v, 0), maxVal) / maxVal) * SWEEP
  }

  const zones = (() => {
    const out = []
    let prev = 0
    for (const t of thresholds) {
      const end = Math.min(t.val, maxVal)
      if (end > prev) { out.push({ s: prev / maxVal, e: end / maxVal, c: t.color }); prev = end }
      if (prev >= maxVal) break
    }
    return out
  })()

  const tickVals = ticks ?? [0, maxVal * 0.25, maxVal * 0.5, maxVal * 0.75, maxVal]

  function needleTip(v) {
    const a = valToAngle(v)
    return [cx + NEEDLE_LEN * Math.cos(toRad(a)), cy + NEEDLE_LEN * Math.sin(toRad(a))]
  }

  return (
    <div className="gauge-wrap">
      <p className="gauge-title">{title}</p>
      <svg viewBox="-18 -10 256 250" width="250" style={{ display: 'block' }}>

        {/* Colored zone arcs */}
        {zones.map((z, i) => {
          const startAngle = SA + z.s * SWEEP
          const sweepAngle = (z.e - z.s) * SWEEP
          if (sweepAngle < 0.5) return null
          return <path key={i} d={arcPath(COLOR_R, startAngle, sweepAngle)}
            fill="none" stroke={z.c} strokeWidth={COLOR_SW} strokeLinecap="butt" />
        })}

        {/* Dark inner overlay */}
        <path d={arcPath(TRACK_R, SA, SWEEP)}
          fill="none" stroke={TRC} strokeWidth={TRACK_SW} strokeLinecap="butt" />

        {/* Tick labels around the arc */}
        {tickVals.map((v, i) => {
          const angle = valToAngle(v)
          const lx = cx + TICK_R * Math.cos(toRad(angle))
          const ly = cy + TICK_R * Math.sin(toRad(angle))
          const label = `${Number.isInteger(v) ? v : v.toFixed(1)}%`
          return (
            <text key={i} x={lx.toFixed(1)} y={ly.toFixed(1)}
              textAnchor="middle" dominantBaseline="middle"
              fontSize="13" style={{ fill: 'var(--text-muted)' }}>
              {label}
            </text>
          )
        })}

        {/* Industry needle */}
        {industryVal != null && (() => {
          const [nx, ny] = needleTip(industryVal)
          return <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)}
            stroke="#2dd4bf" strokeWidth={2.5} strokeLinecap="round" />
        })()}

        {/* Company needle */}
        {value != null && (() => {
          const [nx, ny] = needleTip(value)
          return <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)}
            stroke="#60a5fa" strokeWidth={4} strokeLinecap="round" />
        })()}

        {/* Center hub */}
        <circle cx={cx} cy={cy} r={5} style={{ fill: 'var(--surface2)', stroke: 'var(--border)' }} strokeWidth={1.5} />

      </svg>

      <div className="gauge-info">
        <div className="gauge-info-label">{label}</div>
        <div className="gauge-legend-row">
          <span className="gauge-legend-name" style={{ color: '#60a5fa' }}>Company</span>
          <span className="gauge-legend-val" style={{ color: '#60a5fa' }}>{value != null ? `${value.toFixed(1)}%` : '—'}</span>
        </div>
        <div className="gauge-legend-row">
          <span className="gauge-legend-name" style={{ color: '#2dd4bf' }}>Industry</span>
          <span className="gauge-legend-val" style={{ color: '#2dd4bf' }}>{industryVal != null ? `${industryVal.toFixed(1)}%` : '—'}</span>
        </div>
      </div>
    </div>
  )
}

/* ─── Metric bar ─────────────────────────────────────────────── */
function MetricBar({ value, target, met }) {
  const maxVal    = target * 2
  const fillPct   = value !== null ? Math.min(Math.max(value / maxVal * 100, 0), 100) : 0
  const fillColor = met ? '#16a34a' : value === null ? 'var(--border)' : '#dc2626'

  return (
    <div className="prof-bar-wrap">
      <div className="prof-bar-track" style={{ background: 'var(--border2)' }}>
        <div className="prof-bar-fill" style={{ width: `${fillPct}%`, background: fillColor }} />
        <div className="prof-bar-target" style={{ left: '50%' }} />
      </div>
      <div className="prof-bar-legend">
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>0%</span>
        <span style={{ color: '#eab308', fontSize: 10, fontWeight: 600 }}>Target&nbsp;{target}%</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{target * 2}%</span>
      </div>
    </div>
  )
}

/* ─── Metric row ─────────────────────────────────────────────── */
function MetricRow({ index, metric }) {
  const { name, value, target, description } = metric
  const met   = value !== null && value >= target
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
        <MetricBar value={value} target={target} met={met} />
      </div>
      <div className="prof-row-right">
        <span className="prof-value" style={{ color }}>
          {value !== null ? `${value.toFixed(1)}%` : '—'}
        </span>
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
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--text-strong)">
        {met}/{total}
      </text>
    </svg>
  )
}

/* ─── Panel ──────────────────────────────────────────────────── */
export default function ProfitabilityPanel({ ticker, dark }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setData(null); setLoading(true); setError(null)
    fetch(`/api/stock/${ticker}/profitability`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [ticker])

  const ind    = data?.industry ?? {}
  const getVal = id => data?.metrics?.find(m => m.id === id)?.value ?? null

  return (
    <>
    <div className="card prof-card">
      <div className="prof-header">
        <div className="prof-icon-wrap">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
        </div>
        <div className="prof-header-text">
          <h3 className="prof-title">Profitability</h3>
          <p className="prof-subtitle">Can the business generate returns?</p>
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
        <div className="prof-state prof-error">Could not load profitability data.</div>
      )}

      {data && !loading && (
        <div className="prof-list">
          {data.metrics.map((m, i) => (
            <MetricRow key={m.id} index={i + 1} metric={m} dark={dark} />
          ))}
        </div>
      )}
    </div>

    {/* ── Gauge card ── */}
    {data && !loading && (
      <div className="card prof-gauges-card">
        <div className="prof-gauges">
          <GaugeChart value={getVal('roe')}  industryVal={ind.roe}  label="ROE"  title="Return on Equity"       maxVal={40} thresholds={ROE_ROIC_THRESHOLDS} ticks={[0,10,20,30,40]} />
          <GaugeChart value={getVal('roic')} industryVal={ind.roic} label="ROIC" title="Return on Inv. Capital" maxVal={40} thresholds={ROE_ROIC_THRESHOLDS} ticks={[0,10,20,30,40]} />
          <GaugeChart value={getVal('roa')}  industryVal={ind.roa}  label="ROA"  title="Return on Assets"       maxVal={20} thresholds={ROA_THRESHOLDS}      ticks={[0,5,10,15,20]} />
        </div>
      </div>
    )}
  </>
  )
}
