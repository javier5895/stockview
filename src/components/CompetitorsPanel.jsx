import { useState, useEffect } from 'react'

/* ─── Mini Radar geometry ────────────────────────────────────── */
const AXES   = ['VALUE', 'PROFITAB.', 'GROWTH', 'HEALTH', 'EFFIC.']
const CX = 70, CY = 58, MAX_R = 36
const ANGLES = AXES.map((_, i) => (i * 2 * Math.PI / 5) - Math.PI / 2)
const ANCHORS   = ['middle', 'start', 'start', 'end', 'end']
const BASELINES = ['auto',   'middle', 'hanging', 'hanging', 'middle']

function pt(r, i) {
  return [CX + r * Math.cos(ANGLES[i]), CY + r * Math.sin(ANGLES[i])]
}
function ringPts(r) {
  return AXES.map((_, i) => pt(r, i).map(v => v.toFixed(1)).join(',')).join(' ')
}

function MiniRadar({ scores, dark }) {
  const total = scores.reduce((a, b) => a + b, 0)
  const stroke = total >= 17 ? '#22c55e' : '#d97706'
  const fill   = total >= 17 ? 'rgba(34,197,94,0.22)' : 'rgba(217,119,6,0.22)'
  const gridColor  = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'
  const axisColor  = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.09)'
  const labelColor = dark ? '#475569' : '#cbd5e1'

  const dataPts = scores
    .map((s, i) => pt((s / 5) * MAX_R, i).map(v => v.toFixed(1)).join(','))
    .join(' ')

  return (
    <svg viewBox="0 0 140 116" style={{ width: '100%', display: 'block' }}>
      {[7.2, 14.4, 21.6, 28.8, 36].map(r => (
        <polygon key={r} points={ringPts(r)} fill="none" stroke={gridColor} strokeWidth={0.8} />
      ))}
      {AXES.map((_, i) => {
        const [x2, y2] = pt(MAX_R, i)
        return <line key={i} x1={CX} y1={CY} x2={x2.toFixed(1)} y2={y2.toFixed(1)}
          stroke={axisColor} strokeWidth={0.8} />
      })}
      <polygon points={dataPts} fill={fill} stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
      {scores.map((s, i) => {
        const [x, y] = pt((s / 5) * MAX_R, i)
        return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={2.5} fill={stroke} />
      })}
      {AXES.map((label, i) => {
        const [lx, ly] = pt(50, i)
        return (
          <text key={label} x={lx.toFixed(1)} y={ly.toFixed(1)}
            textAnchor={ANCHORS[i]} dominantBaseline={BASELINES[i]}
            fontSize={6} fontWeight={700} letterSpacing={0.6} fill={labelColor}>
            {label}
          </text>
        )
      })}
    </svg>
  )
}

/* ─── Loading skeleton card ──────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="competitor-card" style={{ pointerEvents: 'none' }}>
      <div className="comp-radar" style={{ opacity: 0.4 }}>
        <MiniRadar scores={[0, 0, 0, 0, 0]} dark={false} />
      </div>
      <div style={{ height: 12, borderRadius: 6, background: 'var(--border2)',
        margin: '8px 16px 4px', animation: 'prof-pulse 1.4s ease-in-out infinite' }} />
      <div style={{ height: 10, borderRadius: 5, background: 'var(--border2)',
        margin: '0 24px 4px', animation: 'prof-pulse 1.4s ease-in-out infinite' }} />
    </div>
  )
}

/* ─── Panel ──────────────────────────────────────────────────── */
export default function CompetitorsPanel({ ticker, companyName, dark, onSelect }) {
  const [peers,   setPeers]   = useState([])   // [{ticker, name, exchange, marketCap, scores}]
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setPeers([])

    // 1. Get peer tickers from FMP
    fetch(`/api/stock/${ticker}/peers`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(async data => {
        if (cancelled) return
        const peerTickers = (data.items ?? [])
          .filter(p => !p.isMain)
          .slice(0, 4)
          .map(p => p.ticker)

        // 2. Fetch scores for each peer in parallel
        const results = await Promise.all(
          peerTickers.map(t =>
            fetch(`/api/stock/${t}/scores`)
              .then(r => r.ok ? r.json() : null)
              .catch(() => null)
          )
        )

        if (cancelled) return
        const valid = results
          .map((d, i) => d ? { ticker: peerTickers[i], ...d } : null)
          .filter(Boolean)
        setPeers(valid)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [ticker])

  return (
    <div className="card competitors-panel">
      <h3 className="competitors-title">{companyName} — Competitors</h3>
      <div className="competitors-grid">
        {loading
          ? [1, 2, 3, 4].map(i => <SkeletonCard key={i} />)
          : peers.map(comp => (
            <button
              key={comp.ticker}
              className="competitor-card"
              onClick={() => onSelect && onSelect(comp.ticker)}
            >
              <div className="comp-radar">
                <MiniRadar scores={comp.scores} dark={dark} />
              </div>
              <p className="comp-name">{comp.name}</p>
              <p className="comp-exchange">{comp.exchange}:{comp.ticker}</p>
              {comp.marketCap && <p className="comp-cap">US{comp.marketCap}</p>}
            </button>
          ))
        }
      </div>
    </div>
  )
}
