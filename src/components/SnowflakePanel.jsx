import { useMemo } from 'react'
import { getSnowflakeData } from '../mockData'

/* ─── Radar Chart ───────────────────────────────────────────── */
const AXES = ['VALUE', 'FUTURE', 'PAST', 'HEALTH', 'DIVIDEND']
const CX = 140, CY = 112, MAX_R = 70, LABEL_R = 95
const ANGLES = AXES.map((_, i) => (i * 2 * Math.PI / 5) - Math.PI / 2)

function pt(r, i) {
  return [CX + r * Math.cos(ANGLES[i]), CY + r * Math.sin(ANGLES[i])]
}
function ringPts(r) {
  return AXES.map((_, i) => pt(r, i).map(v => v.toFixed(2)).join(',')).join(' ')
}

const ANCHORS   = ['middle', 'start', 'start', 'end', 'end']
const BASELINES = ['auto',   'middle', 'hanging', 'hanging', 'middle']

function SnowflakeChart({ scores, dark }) {
  const gridColor  = dark ? 'rgba(255,255,255,0.1)'  : 'rgba(0,0,0,0.08)'
  const axisColor  = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'
  const labelColor = dark ? '#64748b' : '#94a3b8'

  const dataPoints = scores
    .map((s, i) => pt((s / 5) * MAX_R, i).map(v => v.toFixed(2)).join(','))
    .join(' ')

  return (
    <svg viewBox="0 0 280 220" width="100%" style={{ display: 'block' }}>
      {/* Concentric pentagon rings */}
      {[14, 28, 42, 56, 70].map(r => (
        <polygon key={r} points={ringPts(r)} fill="none" stroke={gridColor} strokeWidth={1} />
      ))}

      {/* Axis spokes */}
      {AXES.map((_, i) => {
        const [x2, y2] = pt(MAX_R, i)
        return (
          <line key={i} x1={CX} y1={CY} x2={x2.toFixed(2)} y2={y2.toFixed(2)}
            stroke={axisColor} strokeWidth={1} />
        )
      })}

      {/* Data polygon */}
      <polygon points={dataPoints}
        fill="rgba(217,119,6,0.28)" stroke="#d97706" strokeWidth={2} strokeLinejoin="round" />

      {/* Score dots */}
      {scores.map((s, i) => {
        const [x, y] = pt((s / 5) * MAX_R, i)
        return <circle key={i} cx={x.toFixed(2)} cy={y.toFixed(2)} r={3.5} fill="#d97706" />
      })}

      {/* Axis labels */}
      {AXES.map((label, i) => {
        const [x, y] = pt(LABEL_R, i)
        return (
          <text key={label}
            x={x.toFixed(2)} y={y.toFixed(2)}
            textAnchor={ANCHORS[i]}
            dominantBaseline={BASELINES[i]}
            fontSize={8} fontWeight={700} letterSpacing={1}
            fill={labelColor}
          >
            {label}
          </text>
        )
      })}
    </svg>
  )
}

/* ─── Score Bar ─────────────────────────────────────────────── */
function ScoreBar({ label, score }) {
  return (
    <div className="sf-score-row">
      <span className="sf-score-label">{label}</span>
      <div className="sf-score-track">
        {[1, 2, 3, 4, 5].map(n => (
          <div key={n} className={`sf-score-dot ${n <= score ? 'filled' : ''}`} />
        ))}
      </div>
      <span className="sf-score-num">{score}/5</span>
    </div>
  )
}

/* ─── Panel ─────────────────────────────────────────────────── */
export default function SnowflakePanel({ ticker, dark }) {
  const data = useMemo(() => getSnowflakeData(ticker), [ticker])

  return (
    <div className="card sf-panel">
      <div className="sf-grid">

        {/* Left: description + rewards/risks */}
        <div className="sf-left">
          <h3 className="sf-title">{data.name} — Stock Overview</h3>
          <p className="sf-desc">{data.description}</p>

          <div className="sf-section">
            <p className="sf-section-label">Rewards</p>
            {data.rewards.map((item, i) => (
              <div key={i} className="sf-item">
                <span className="sf-reward-icon">★</span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div className="sf-section">
            <p className="sf-section-label">Risk Analysis</p>
            {data.risks.map((item, i) => (
              <div key={i} className="sf-item">
                <span className="sf-risk-icon">!</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: radar chart + scores */}
        <div className="sf-right">
          <SnowflakeChart scores={data.scores} dark={dark} />

          <div className="sf-scores">
            {['Value', 'Future', 'Past', 'Health', 'Dividend'].map((label, i) => (
              <ScoreBar key={label} label={label} score={data.scores[i]} />
            ))}
          </div>

          <p className="sf-analysis-desc">{data.snowflakeDesc}</p>
        </div>
      </div>
    </div>
  )
}
