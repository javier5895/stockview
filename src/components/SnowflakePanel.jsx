import { useState, useEffect } from 'react'

/* ─── Radar geometry ─────────────────────────────────────────── */
const AXES   = ['VALUE', 'PROFITAB.', 'GROWTH', 'HEALTH', 'EFFIC.']
const LABELS = ['Valuation', 'Profitability', 'Growth', 'Health', 'Efficiency']

const CX = 210, CY = 140, MAX_R = 95, LABEL_R = 126
const ANGLES   = AXES.map((_, i) => (i * 2 * Math.PI / 5) - Math.PI / 2)
const ANCHORS  = ['middle', 'start', 'start', 'end', 'end']
const BASELINES = ['auto', 'middle', 'hanging', 'hanging', 'middle']

function pt(r, i) {
  return [CX + r * Math.cos(ANGLES[i]), CY + r * Math.sin(ANGLES[i])]
}
function ringPts(r) {
  return AXES.map((_, i) => pt(r, i).map(v => v.toFixed(2)).join(',')).join(' ')
}

/* ─── Radar chart ────────────────────────────────────────────── */
function SnowflakeChart({ scores, dark }) {
  const gridColor  = dark ? 'rgba(255,255,255,0.1)'  : 'rgba(0,0,0,0.08)'
  const axisColor  = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'
  const labelColor = dark ? '#64748b' : '#94a3b8'
  const dataPoints = scores
    .map((s, i) => pt((s / 5) * MAX_R, i).map(v => v.toFixed(2)).join(','))
    .join(' ')

  return (
    <svg viewBox="0 0 420 292" width="100%" style={{ display: 'block' }}>
      {[19, 38, 57, 76, 95].map(r => (
        <polygon key={r} points={ringPts(r)} fill="none" stroke={gridColor} strokeWidth={1} />
      ))}
      {AXES.map((_, i) => {
        const [x2, y2] = pt(MAX_R, i)
        return <line key={i} x1={CX} y1={CY} x2={x2.toFixed(2)} y2={y2.toFixed(2)}
          stroke={axisColor} strokeWidth={1} />
      })}
      <polygon points={dataPoints}
        fill="rgba(217,119,6,0.28)" stroke="#d97706" strokeWidth={2} strokeLinejoin="round" />
      {scores.map((s, i) => {
        const [x, y] = pt((s / 5) * MAX_R, i)
        return <circle key={i} cx={x.toFixed(2)} cy={y.toFixed(2)} r={3.5} fill="#d97706" />
      })}
      {AXES.map((label, i) => {
        const [x, y] = pt(LABEL_R, i)
        return (
          <text key={label}
            x={x.toFixed(2)} y={y.toFixed(2)}
            textAnchor={ANCHORS[i]} dominantBaseline={BASELINES[i]}
            fontSize={11} fontWeight={700} letterSpacing={1}
            fill={labelColor}
          >
            {label}
          </text>
        )
      })}
    </svg>
  )
}

/* ─── Score bar (orange dots) ────────────────────────────────── */
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

/* ─── Score helpers ──────────────────────────────────────────── */
function toScore(met, total) {
  if (!total) return 0
  return Math.round(met / total * 5)
}

function valScore(d) {
  if (!d) return 0
  let s = 0
  if (d.isUndervalued)                         s += 2
  if (d.isUndervalued && d.discountPct > 10)   s += 1
  if (d.isUndervalued && d.discountPct > 20)   s += 1
  const r = (d.analystRating || '').toLowerCase()
  if (r === 'buy' || r === 'strong buy')        s += 1
  return Math.min(5, s)
}

// Score-based description per category
const DESCRIPTIONS = {
  Valuation: [
    'No upside — trading significantly above analyst consensus.',
    'Well above the analyst consensus price target with limited upside.',
    'Slightly above the analyst consensus price target.',
    'Fairly valued relative to the analyst consensus price target.',
    'Trading below fair value with meaningful upside to analyst target.',
    'Significantly undervalued — strong upside to analyst consensus target.',
  ],
  Profitability: [
    'Unprofitable — key margin and return metrics well below benchmarks.',
    'Weak profitability with most margins and returns below target levels.',
    'Below-average profitability — several metrics falling short of targets.',
    'Adequate profitability with most key metrics near industry benchmarks.',
    'Strong profit margins and high returns on capital and equity.',
    'Exceptional profitability — exceeds targets across all margins and returns.',
  ],
  Growth: [
    'Revenues and earnings are declining — no growth targets met.',
    'Stagnant growth — most revenue and earnings targets are missed.',
    'Below-target growth — limited expansion in revenues and earnings.',
    'Moderate growth with some revenue and earnings metrics on track.',
    'Strong growth in revenue, earnings, and free cash flow.',
    'Outstanding growth trajectory — all key metrics ahead of targets.',
  ],
  Health: [
    'Severe balance sheet stress — high leverage and weak liquidity.',
    'Significant financial health concerns — elevated debt and liquidity risks.',
    'Elevated leverage or liquidity concerns present on the balance sheet.',
    'Adequate balance sheet health with manageable debt levels.',
    'Healthy balance sheet with low leverage and solid liquidity ratios.',
    'Rock-solid balance sheet — excellent liquidity and very low leverage.',
  ],
  Efficiency: [
    'Very poor capital allocation — assets significantly underperforming.',
    'Poor efficiency — low asset turnover and weak capital deployment.',
    'Below-average capital efficiency with room for meaningful improvement.',
    'Adequate efficiency with assets generating reasonable returns.',
    'Strong capital efficiency — good asset utilization and active buybacks.',
    'Highly efficient — exceptional capital allocation and asset utilization.',
  ],
}

// Build categorised bullets for all 5 metrics
function buildInsights(scores) {
  const rewards = [], neutral = [], risks = []
  scores.forEach(({ label, score }) => {
    const text = (DESCRIPTIONS[label] ?? [])[score] ?? `${label} data unavailable.`
    if (score >= 4)      rewards.push(text)
    else if (score >= 3) neutral.push(text)
    else                 risks.push(text)
  })
  return { rewards, neutral, risks }
}

function analysisSentence(scores) {
  const avg = scores.reduce((s, c) => s + c.score, 0) / scores.length
  if (avg >= 4)   return 'Excellent all-round fundamentals.'
  if (avg >= 3.2) return 'Good fundamentals with solid prospects.'
  if (avg >= 2.5) return 'Mixed fundamentals — some areas need improvement.'
  return 'Several fundamental weaknesses detected.'
}

/* ─── Panel ──────────────────────────────────────────────────── */
export default function SnowflakePanel({ ticker, dark }) {
  const [scores,  setScores]  = useState(null)   // [{label, score}]
  const [loading, setLoading] = useState(true)
  const [name,    setName]    = useState(ticker)

  useEffect(() => {
    let cancelled = false
    setScores(null)
    setLoading(true)

    const base = `/api/stock/${ticker}`

    Promise.all([
      fetch(`${base}/valuation`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/profitability`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/growth`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/health`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/efficiency`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${base}/about`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([val, prof, grow, health, eff, about]) => {
      if (cancelled) return
      const computed = [
        { label: 'Valuation',    score: valScore(val) },
        { label: 'Profitability',score: toScore(prof?.met, prof?.total) },
        { label: 'Growth',       score: toScore(grow?.met, grow?.total) },
        { label: 'Health',       score: toScore(health?.met, health?.total) },
        { label: 'Efficiency',   score: toScore(eff?.met,  eff?.total) },
      ]
      setScores(computed)
      if (about?.name) setName(about.name)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [ticker])

  const { rewards, neutral, risks } = scores
    ? buildInsights(scores)
    : { rewards: [], neutral: [], risks: [] }
  const radarScores = scores ? scores.map(s => s.score) : [0, 0, 0, 0, 0]

  return (
    <div className="card sf-panel">
      <div className="sf-grid">

        {/* Left: name + rewards / risks */}
        <div className="sf-left">
          <h3 className="sf-title">{name} — Stock Overview</h3>

          {loading ? (
            <p className="sf-desc" style={{ color: 'var(--text-muted)' }}>Loading analysis…</p>
          ) : (
            <>
              {rewards.length > 0 && (
                <div className="sf-section">
                  <p className="sf-section-label">Rewards</p>
                  {rewards.map((item, i) => (
                    <div key={i} className="sf-item">
                      <span className="sf-reward-icon">★</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              )}
              {neutral.length > 0 && (
                <div className="sf-section">
                  <p className="sf-section-label">Analysis</p>
                  {neutral.map((item, i) => (
                    <div key={i} className="sf-item">
                      <span className="sf-neutral-icon">●</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              )}
              {risks.length > 0 && (
                <div className="sf-section">
                  <p className="sf-section-label">Risk Analysis</p>
                  {risks.map((item, i) => (
                    <div key={i} className="sf-item">
                      <span className="sf-risk-icon">!</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: radar + score bars */}
        <div className="sf-right">
          <SnowflakeChart scores={radarScores} dark={dark} />

          <div className="sf-scores">
            {(scores ?? LABELS.map(label => ({ label, score: 0 }))).map(({ label, score }, i) => (
              <ScoreBar key={label} label={LABELS[i] ?? label} score={score} />
            ))}
          </div>

          {scores && (
            <p className="sf-analysis-desc">{analysisSentence(scores)}</p>
          )}
        </div>

      </div>
    </div>
  )
}
