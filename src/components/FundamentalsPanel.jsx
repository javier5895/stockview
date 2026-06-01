import { useMemo } from 'react'
import { getFundamentals } from '../mockData'

/* ─── Donut Chart ────────────────────────────────────────────── */
function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}
function arc(cx, cy, r, startDeg, endDeg) {
  const s    = polar(cx, cy, r, startDeg)
  const e    = polar(cx, cy, r, endDeg)
  const span = Math.abs(endDeg - startDeg)
  const large = span > 180 ? 1 : 0
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
}

function DonutChart({ data, dark }) {
  const cx = 115, cy = 115, R = 78, sw = 22
  const bg     = dark ? '#1e2d42' : '#e2e8f0'
  const revPct = Math.min(0.55, data.revenue / data.mcNum)
  const earPct = Math.min(revPct * 0.85, Math.min(0.25, data.earnings / data.mcNum))
  const revDeg = revPct * 360
  const earDeg = earPct * 360

  // callout for earnings (starts at top, goes up-left)
  const earMidDeg = earDeg / 2
  const earMid    = polar(cx, cy, R, earMidDeg)
  const earOuter  = polar(cx, cy, R + 28, earMidDeg)
  const earLabel  = { x: earOuter.x - 6, y: earOuter.y - 20 }

  // callout for revenue (midpoint of its arc)
  const revMidDeg = revDeg / 2
  const revMid    = polar(cx, cy, R, revMidDeg)
  const revOuter  = polar(cx, cy, R + 28, revMidDeg)
  const revLabel  = { x: revOuter.x + 4, y: revOuter.y - 20 }

  const textFill  = dark ? '#f1f5f9' : '#0f172a'
  const mutedFill = dark ? '#64748b' : '#94a3b8'

  return (
    <svg viewBox="0 0 230 230" style={{ width: '100%', maxWidth: 230, display: 'block' }}>
      {/* background ring */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={bg} strokeWidth={sw} />
      {/* revenue arc */}
      {revDeg > 1 && (
        <path d={arc(cx, cy, R, 0, revDeg)} fill="none"
          stroke="#3b82f6" strokeWidth={sw} strokeLinecap="round" />
      )}
      {/* earnings arc (on top) */}
      {earDeg > 1 && (
        <path d={arc(cx, cy, R, 0, earDeg)} fill="none"
          stroke="#06b6d4" strokeWidth={sw} strokeLinecap="round" />
      )}

      {/* center text */}
      <text x={cx} y={cy - 10} textAnchor="middle" fontSize={11}
        fontWeight={500} fill={mutedFill}>Market cap</text>
      <text x={cx} y={cy + 8} textAnchor="middle" fontSize={13}
        fontWeight={700} fill={textFill}>{data.marketCapFmt}</text>

      {/* earnings callout */}
      <line x1={earMid.x.toFixed(1)} y1={earMid.y.toFixed(1)}
            x2={earOuter.x.toFixed(1)} y2={earOuter.y.toFixed(1)}
            stroke="#06b6d4" strokeWidth={1} />
      <line x1={earOuter.x.toFixed(1)} y1={earOuter.y.toFixed(1)}
            x2={(earOuter.x - 36).toFixed(1)} y2={earOuter.y.toFixed(1)}
            stroke="#06b6d4" strokeWidth={1} />
      <text x={(earOuter.x - 38).toFixed(1)} y={(earOuter.y - 12).toFixed(1)}
        textAnchor="end" fontSize={10} fill={mutedFill}>Earnings</text>
      <text x={(earOuter.x - 38).toFixed(1)} y={(earOuter.y + 2).toFixed(1)}
        textAnchor="end" fontSize={11} fontWeight={700} fill={textFill}>{data.earningsFmt}</text>

      {/* revenue callout */}
      <line x1={revMid.x.toFixed(1)} y1={revMid.y.toFixed(1)}
            x2={revOuter.x.toFixed(1)} y2={revOuter.y.toFixed(1)}
            stroke="#3b82f6" strokeWidth={1} />
      <line x1={revOuter.x.toFixed(1)} y1={revOuter.y.toFixed(1)}
            x2={(revOuter.x + 36).toFixed(1)} y2={revOuter.y.toFixed(1)}
            stroke="#3b82f6" strokeWidth={1} />
      <text x={(revOuter.x + 40).toFixed(1)} y={(revOuter.y - 12).toFixed(1)}
        textAnchor="start" fontSize={10} fill={mutedFill}>Revenue</text>
      <text x={(revOuter.x + 40).toFixed(1)} y={(revOuter.y + 2).toFixed(1)}
        textAnchor="start" fontSize={11} fontWeight={700} fill={textFill}>{data.revenueFmt}</text>
    </svg>
  )
}

/* ─── Waterfall Chart ────────────────────────────────────────── */
function WaterfallChart({ data, dark }) {
  const W = 310, H = 192, padB = 44, padT = 28
  const barW = 42, gap = 16
  const chartH = H - padB - padT
  const baseY  = H - padB
  const maxVal = data.revenue

  function bh(v) { return Math.max(3, (Math.abs(v) / maxVal) * chartH) }
  function fmtShort(v) {
    if (v >= 1e12) return `$${(v/1e12).toFixed(2)}T`
    if (v >= 1e9)  return `$${(v/1e9).toFixed(1)}B`
    return `$${(v/1e6).toFixed(0)}M`
  }

  const totalW = 5 * (barW + gap) - gap
  const offX   = (W - totalW) / 2
  const xPos   = i => offX + i * (barW + gap)

  const textFill  = dark ? '#94a3b8' : '#64748b'
  const labelFill = dark ? '#f1f5f9' : '#0f172a'
  const connColor = dark ? '#334155' : '#cbd5e1'

  // Each bar: yTop + height in SVG coords (y grows downward)
  const bars = [
    // Revenue: solid from baseline up
    { i:0, lines:['Revenue'],         value: data.revenue,     color:'#3b82f6',
      yTop: baseY - bh(data.revenue),    yH: bh(data.revenue)     },
    // Cost of Rev: floats from revenue-top downward to grossProfit level
    { i:1, lines:['Cost of','Rev.'],   value: data.costOfRev,   color:'#be123c',
      yTop: baseY - bh(data.revenue),    yH: bh(data.costOfRev)   },
    // Gross Profit: solid from baseline
    { i:2, lines:['Gross','Profit'],   value: data.grossProfit, color:'#16a34a',
      yTop: baseY - bh(data.grossProfit), yH: bh(data.grossProfit) },
    // Other Exp: floats from grossProfit-top downward to earnings level
    { i:3, lines:['Other','Exp.'],     value: data.otherExp,    color:'#be123c',
      yTop: baseY - bh(data.grossProfit), yH: bh(data.otherExp)    },
    // Earnings: solid from baseline
    { i:4, lines:['Earnings'],         value: data.earnings,    color:'#0891b2',
      yTop: baseY - bh(data.earnings),   yH: bh(data.earnings)    },
  ]

  // Dashed connector lines between consecutive bars
  const connectors = [
    { fromI:0, toI:1, y: baseY - bh(data.grossProfit) }, // connects at gross profit level
    { fromI:1, toI:2, y: baseY - bh(data.grossProfit) },
    { fromI:2, toI:3, y: baseY - bh(data.earnings)    }, // connects at earnings level
    { fromI:3, toI:4, y: baseY - bh(data.earnings)    },
  ]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      {/* baseline */}
      <line x1={0} y1={baseY} x2={W} y2={baseY} stroke={connColor} strokeWidth={1} />

      {/* connectors */}
      {connectors.map(({ fromI, toI, y }, ci) => (
        <line key={ci}
          x1={(xPos(fromI) + barW).toFixed(1)} y1={y.toFixed(1)}
          x2={xPos(toI).toFixed(1)}           y2={y.toFixed(1)}
          stroke={connColor} strokeWidth={1} strokeDasharray="3 2" />
      ))}

      {/* bars */}
      {bars.map(({ i, lines, value, color, yTop, yH }) => {
        const x = xPos(i)
        return (
          <g key={i}>
            <rect x={x} y={yTop.toFixed(1)} width={barW} height={yH.toFixed(1)}
              fill={color} rx={3} opacity={0.88} />
            {/* value above bar */}
            <text x={(x + barW / 2).toFixed(1)} y={(yTop - 5).toFixed(1)}
              textAnchor="middle" fontSize={8.5} fontWeight={600} fill={labelFill}>
              {fmtShort(value)}
            </text>
            {/* multi-line label below baseline */}
            {lines.map((ln, li) => (
              <text key={li}
                x={(x + barW / 2).toFixed(1)} y={(baseY + 12 + li * 11).toFixed(1)}
                textAnchor="middle" fontSize={8.5} fill={textFill}>{ln}
              </text>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

/* ─── Info Row ───────────────────────────────────────────────── */
function FRow({ label, value }) {
  return (
    <div className="fund-row">
      <span className="fund-row-label">{label}</span>
      <span className="fund-row-value">{value}</span>
    </div>
  )
}

/* ─── Panel ──────────────────────────────────────────────────── */
export default function FundamentalsPanel({ ticker, dark }) {
  const data = useMemo(() => getFundamentals(ticker), [ticker])

  return (
    <div className="card fundamentals-panel">

      {/* ── Earnings & Revenue ── */}
      <section className="fund-section">
        <h3 className="fund-title">Earnings &amp; Revenue</h3>
        <div className="fund-earnings-grid">
          <div className="fund-bar">
            <WaterfallChart data={data} dark={dark} />
          </div>
          <div className="fund-metrics">
            <div className="fund-dates-row">
              <div>
                <p className="fund-meta-lbl">Last Reported Earnings</p>
                <p className="fund-meta-val">{data.lastEarnings}</p>
              </div>
              <div>
                <p className="fund-meta-lbl">Next Earnings Date</p>
                <p className="fund-meta-val">{data.nextEarnings}</p>
              </div>
            </div>
            <FRow label="Earnings per share (EPS)" value={data.epsFmt} />
            <FRow label="Gross Margin"              value={`${data.grossMarginPct}%`} />
            <FRow label="Net Profit Margin"         value={`${data.netMarginPct}%`} />
            <FRow label="Debt / Equity Ratio"       value={`${data.debtEquityPct}%`} />
            <p className="fund-question" style={{ marginTop: 14 }}>
              How did {data.ticker} perform over the long term?
            </p>
            <span className="fund-link">See historical performance and comparison ›</span>
          </div>
        </div>
      </section>

      <div className="fund-divider" />

      {/* ── 3. Dividends ── */}
      <section className="fund-section fund-section--last">
        <h3 className="fund-title">Dividends</h3>
        <div className="fund-div-grid">
          <div className="fund-div-pair">
            <div className="fund-div-stat">
              <span className="fund-div-val">
                {data.divYield > 0 ? `${data.divYield.toFixed(1)}%` : '—'}
              </span>
              <span className="fund-div-lbl">Current Dividend Yield</span>
            </div>
            <div className="fund-div-stat">
              <span className="fund-div-val">
                {data.divYield > 0 ? `${data.payoutRatio}%` : '—'}
              </span>
              <span className="fund-div-lbl">Payout Ratio</span>
            </div>
          </div>
          <div className="fund-div-question">
            <p className="fund-question">Does {data.ticker} pay a reliable dividend?</p>
            <span className="fund-link">See {data.ticker} dividend history and benchmarks ›</span>
          </div>
        </div>
      </section>

    </div>
  )
}
