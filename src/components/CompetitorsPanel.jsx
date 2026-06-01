import { useMemo } from 'react'
import { getCompetitors } from '../mockData'

/* ─── Mini Radar ─────────────────────────────────────────────── */
const AXES = ['VALUE', 'FUTURE', 'PAST', 'HEALTH', 'DIVIDEND']
const CX = 70, CY = 56, MAX_R = 35
const ANGLES = AXES.map((_, i) => (i * 2 * Math.PI / 5) - Math.PI / 2)

function pt(r, i) {
  return [CX + r * Math.cos(ANGLES[i]), CY + r * Math.sin(ANGLES[i])]
}
function ringPts(r) {
  return AXES.map((_, i) => pt(r, i).map(v => v.toFixed(1)).join(',')).join(' ')
}

function scoreColor(total) {
  if (total >= 17) return { stroke: '#22c55e', fill: 'rgba(34,197,94,0.26)' }
  if (total >= 12) return { stroke: '#d97706', fill: 'rgba(217,119,6,0.26)'  }
  return               { stroke: '#f97316', fill: 'rgba(249,115,22,0.22)' }
}

function MiniRadar({ scores, dark }) {
  const total = scores.reduce((a, b) => a + b, 0)
  const { stroke, fill } = scoreColor(total)
  const gridColor = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'
  const axisColor = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.09)'
  const labelColor = dark ? '#475569' : '#cbd5e1'

  const dataPts = scores
    .map((s, i) => pt((s / 5) * MAX_R, i).map(v => v.toFixed(1)).join(','))
    .join(' ')

  return (
    <svg viewBox="0 0 140 112" style={{ width: '100%', display: 'block' }}>
      {/* Rings */}
      {[7, 14, 21, 28, 35].map(r => (
        <polygon key={r} points={ringPts(r)} fill="none" stroke={gridColor} strokeWidth={0.8} />
      ))}
      {/* Spokes */}
      {AXES.map((_, i) => {
        const [x2, y2] = pt(MAX_R, i)
        return <line key={i} x1={CX} y1={CY} x2={x2.toFixed(1)} y2={y2.toFixed(1)} stroke={axisColor} strokeWidth={0.8} />
      })}
      {/* Data shape */}
      <polygon points={dataPts} fill={fill} stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
      {/* Dots */}
      {scores.map((s, i) => {
        const [x, y] = pt((s / 5) * MAX_R, i)
        return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={2.5} fill={stroke} />
      })}
      {/* Axis labels */}
      {AXES.map((label, i) => {
        const lx = CX + 48 * Math.cos(ANGLES[i])
        const ly = CY + 48 * Math.sin(ANGLES[i])
        return (
          <text key={label} x={lx.toFixed(1)} y={ly.toFixed(1)}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={6} fontWeight={700} letterSpacing={0.8} fill={labelColor}
          >{label}</text>
        )
      })}
    </svg>
  )
}

/* ─── Panel ──────────────────────────────────────────────────── */
export default function CompetitorsPanel({ ticker, companyName, dark, onSelect }) {
  const competitors = useMemo(() => getCompetitors(ticker), [ticker])

  return (
    <div className="card competitors-panel">
      <h3 className="competitors-title">{companyName} — Competitors</h3>
      <div className="competitors-grid">
        {competitors.map(comp => (
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
            <p className="comp-cap">US${comp.marketCap}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
