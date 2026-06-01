import { useState, useEffect, useMemo } from 'react'
import { getValuation, getPeersComparison } from '../mockData'

/* ─── Gauge ──────────────────────────────────────────────────── */
function ValuationGauge({ currentPrice, fairValue }) {
  const rawPos = currentPrice / fairValue - 0.5
  const pos    = Math.min(1, Math.max(0, rawPos))
  const pct    = `${(pos * 100).toFixed(2)}%`
  const isUnder = currentPrice < fairValue
  const markerColor = isUnder ? '#16a34a' : '#dc2626'

  return (
    <div className="val-gauge">
      <div className="val-gauge-track">
        <div className="val-gauge-fv-line" />
        <div className="val-gauge-marker" style={{ left: pct, background: markerColor }} />
      </div>
      <div className="val-gauge-labels">
        <span className="val-gauge-lbl val-gauge-lbl--under">Undervalued</span>
        <span className="val-gauge-fv-lbl">
          Fair&nbsp;Value&nbsp;
          <strong>${fairValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        </span>
        <span className="val-gauge-lbl val-gauge-lbl--over">Overvalued</span>
      </div>
    </div>
  )
}

/* ─── Method Row ─────────────────────────────────────────────── */
function VRow({ name, value, upside }) {
  const isPos = upside >= 0
  return (
    <div className="val-method-row">
      <div className="val-method-name">{name}</div>
      <span className="val-method-value">
        ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span className={`val-method-upside ${isPos ? 'val-up' : 'val-dn'}`}>
        {isPos ? '+' : ''}{upside.toFixed(1)}%
      </span>
    </div>
  )
}

/* ─── Criterion ──────────────────────────────────────────────── */
function VCriterion({ label, met, text }) {
  const color = met ? '#16a34a' : '#ef4444'
  return (
    <div className="val-criterion">
      <svg className="val-crit-icon" viewBox="0 0 16 16" fill="none" style={{ color }}>
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        {met ? (
          <polyline points="4.5,8.5 7,11 11.5,5.5" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" />
            <line x1="10.5" y1="5.5" x2="5.5" y2="10.5" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" />
          </>
        )}
      </svg>
      <p className="val-crit-body">
        <span className="val-crit-label" style={{ color }}>{label}: </span>
        {text}
      </p>
    </div>
  )
}

/* ─── Key Valuation Metric ───────────────────────────────────── */
const METRIC_TABS = ['PE', 'PS', 'PB', 'Others']

const LEARN_CONTENT = `All valuation metrics suit some stocks better than others. We choose the most relevant data point to use for our relative valuation.

If a company is profitable, we use the Price to Earnings (PE) ratio, which measures how much investors are paying for today's earnings. A high PE ratio may indicate that investors are expecting high growth in the future. This is calculated by dividing the share price by earnings per share.

If a company is not yet making a profit, we use the Price to Sales (PS) ratio, which measures how much investors are paying for today's sales or revenues. This is calculated by dividing the share price by revenue per share.

For some companies like banks or real estate investors, Price to Book (PB) is a useful metric. It looks at what the value of the balance sheet is compared to the market capitalisation of the company. This is calculated by dividing the market capitalisation by the book value of the company.

For more information on how we select the key valuation metrics, please check out our Help Centre.`

function LearnModal({ onClose }) {
  return (
    <div className="learn-overlay" onClick={onClose}>
      <div className="learn-modal" onClick={e => e.stopPropagation()}>
        <div className="learn-modal-header">
          <h3 className="learn-modal-title">Key Valuation Metric</h3>
          <button className="learn-modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="learn-modal-body">
          {LEARN_CONTENT.split('\n\n').map((para, i) => (
            <p key={i} className="learn-modal-para">{para}</p>
          ))}
        </div>
      </div>
    </div>
  )
}

function KeyMetricSection({ ticker, data }) {
  const [active, setActive] = useState('PE')
  const [learnOpen, setLearnOpen] = useState(false)

  const fmtUS = n => {
    if (n >= 1e12) return `US$${(n / 1e12).toFixed(2)}t`
    if (n >= 1e9)  return `US$${(n / 1e9).toFixed(2)}b`
    return `US$${(n / 1e6).toFixed(0)}m`
  }

  const configs = {
    PE: {
      keyText: `As ${ticker} is profitable we use its Price-To-Earnings Ratio for relative valuation analysis.`,
      question: `What is ${ticker}'s PE Ratio?`,
      rows: [
        { label: 'PE Ratio',   value: `${data.pe.toFixed(1)}x` },
        { label: 'Earnings',   value: fmtUS(data.earnings) },
        { label: 'Market Cap', value: fmtUS(data.mcNum) },
      ],
      footer: `The above table shows the Price to Earnings ratio for ${ticker}. This is calculated by dividing ${ticker}'s market cap by their current earnings.`,
    },
    PS: {
      keyText: `We use the Price-To-Sales Ratio as it captures ${ticker}'s revenue generation capacity relative to its market value.`,
      question: `What is ${ticker}'s PS Ratio?`,
      rows: [
        { label: 'PS Ratio',   value: `${data.ps.toFixed(1)}x` },
        { label: 'Revenue',    value: fmtUS(data.revenue) },
        { label: 'Market Cap', value: fmtUS(data.mcNum) },
      ],
      footer: `The above table shows the Price to Sales ratio for ${ticker}. This is calculated by dividing ${ticker}'s market cap by their annual revenue.`,
    },
    PB: {
      keyText: `We use the Price-To-Book Ratio as it shows ${ticker}'s market value relative to its net asset (book) value.`,
      question: `What is ${ticker}'s PB Ratio?`,
      rows: [
        { label: 'PB Ratio',    value: `${data.pb.toFixed(1)}x` },
        { label: 'Book Value',  value: fmtUS(data.bookValue) },
        { label: 'Market Cap',  value: fmtUS(data.mcNum) },
      ],
      footer: `The above table shows the Price to Book ratio for ${ticker}. This is calculated by dividing ${ticker}'s market cap by their total book value.`,
    },
    Others: {
      keyText: `EV/EBITDA provides a capital-structure-neutral view of ${ticker}'s valuation, removing the effect of financing and non-cash charges.`,
      question: `What is ${ticker}'s EV/EBITDA?`,
      rows: [
        { label: 'EV/EBITDA',  value: `${data.evEbitda.toFixed(1)}x` },
        { label: 'EBITDA',     value: fmtUS(data.ebitda) },
        { label: 'Market Cap', value: fmtUS(data.mcNum) },
      ],
      footer: `The above table shows the EV/EBITDA ratio for ${ticker}. This is calculated by dividing the enterprise value by earnings before interest, taxes, depreciation and amortisation.`,
    },
  }

  const cfg = configs[active]

  return (
    <div className="kvm-section">
      {learnOpen && <LearnModal onClose={() => setLearnOpen(false)} />}

      <div className="kvm-header-row">
        <h4 className="kvm-title">Key Valuation Metric</h4>
        <button className="kvm-learn-btn" onClick={() => setLearnOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Learn
        </button>
      </div>
      <p className="kvm-subtitle">
        Which metric is best to use when looking at relative valuation for {ticker}?
      </p>

      <div className="kvm-grid">
        {/* Left: tab switcher + key metric blurb */}
        <div>
          <div className="kvm-tabs">
            {METRIC_TABS.map(t => (
              <button
                key={t}
                className={`kvm-tab ${active === t ? 'active' : ''}`}
                onClick={() => setActive(t)}
              >{t}</button>
            ))}
          </div>
          <div className="kvm-key-box">
            <span className="kvm-star">★</span>
            <p className="kvm-key-text">
              <span className="kvm-key-label">Key metric: </span>
              {cfg.keyText}
            </p>
          </div>
        </div>

        {/* Right: data table */}
        <div className="kvm-table">
          <div className="kvm-table-header">{cfg.question}</div>
          {cfg.rows.map((row, i) => (
            <div key={i} className="kvm-table-row">
              <span className="kvm-table-label">{row.label}</span>
              <span className="kvm-table-value">{row.value}</span>
            </div>
          ))}
          <p className="kvm-table-footer">{cfg.footer}</p>
        </div>
      </div>
    </div>
  )
}

/* ─── Peers Bar Chart ────────────────────────────────────────── */
function PeersBarChart({ items, peerAvg, dark }) {
  const W = 560, earningsW = 82
  const barAreaW = W - earningsW - 8
  const rowH = 54, padT = 44, padB = 26
  const H = padT + items.length * rowH + padB

  const rawMax = Math.max(...items.map(d => d.pe))
  const maxPE  = Math.ceil(rawMax / 10) * 10 + 5
  const xv     = v => (v / maxPE) * barAreaW
  const peerX  = xv(peerAvg)

  const tickStep = maxPE <= 25 ? 5 : 10
  const ticks = []
  for (let v = 0; v <= maxPE; v += tickStep) ticks.push(v)

  const muted   = dark ? '#475569' : '#94a3b8'
  const strong  = dark ? '#f1f5f9' : '#0f172a'
  const axisC   = dark ? '#1e2d42' : '#e2e8f0'
  const overBg  = dark ? 'rgba(120,15,15,0.5)' : 'rgba(220,38,38,0.09)'
  const labelBg = dark ? '#0b1120' : '#f1f5f9'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      {/* Above-avg reddish background */}
      <rect x={peerX} y={padT - 10} width={barAreaW - peerX}
        height={items.length * rowH + 10} fill={overBg} />

      {/* Peer avg vertical line */}
      <line x1={peerX} y1={0} x2={peerX} y2={H - padB}
        stroke="#eab308" strokeWidth={1.5} />

      {/* Peer avg bubble */}
      <rect x={Math.min(peerX - 46, barAreaW - 94)} y={2} width={92} height={22} rx={5}
        fill="#eab308" />
      <text x={Math.min(peerX, barAreaW - 47)} y={17}
        textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#000">
        Peer Avg {peerAvg.toFixed(1)}x
      </text>

      {/* Earnings Growth header */}
      <text x={W - earningsW / 2} y={padT - 14} textAnchor="middle" fontSize={9} fill={muted}>Earnings</text>
      <text x={W - earningsW / 2} y={padT - 4}  textAnchor="middle" fontSize={9} fill={muted}>Growth</text>

      {/* Axis line */}
      <line x1={0} y1={H - padB} x2={barAreaW} y2={H - padB} stroke={axisC} strokeWidth={1} />

      {/* Axis ticks */}
      {ticks.map(v => (
        <text key={v} x={xv(v)} y={H - padB + 14}
          textAnchor="middle" fontSize={9.5} fill={muted}>
          {v === 0 ? 'PE' : v}
        </text>
      ))}

      {/* Bars */}
      {items.map((item, i) => {
        const barY     = padT + i * rowH
        const bw       = xv(item.pe)
        const barColor = item.isMain ? '#22c55e' : '#166534'
        const shortName = item.name.split(' ')[0]
        const dispName  = item.name.length > 22 ? item.name.slice(0, 21) + '…' : item.name
        const egSign    = item.earningsGrowth > 0 ? '+' : ''

        return (
          <g key={i}>
            {/* Bar */}
            <rect x={0} y={barY + 3} width={bw} height={rowH - 10}
              fill={barColor} rx={3} />

            {/* PE label */}
            <text x={8} y={barY + 19} fontSize={13} fontWeight={700} fill="#fff">
              {item.pe.toFixed(1)}x
            </text>

            {/* Company label */}
            {item.isMain ? (
              <>
                <rect x={8} y={barY + 24}
                  width={shortName.length * 7 + 12} height={16} rx={3}
                  fill="#eab308" />
                <text x={15} y={barY + 36} fontSize={10} fontWeight={700} fill="#000">
                  {shortName}
                </text>
              </>
            ) : (
              <text x={8} y={barY + 37} fontSize={10}
                fill={dark ? '#86efac' : '#dcfce7'}>
                {dispName}
              </text>
            )}

            {/* Earnings growth */}
            <text x={W - earningsW / 2} y={barY + rowH / 2 + 5}
              textAnchor="middle" fontSize={11} fontWeight={600} fill={strong}>
              {egSign}{item.earningsGrowth.toFixed(2)}%
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function PeersSection({ ticker, dark }) {
  const data = useMemo(() => getPeersComparison(ticker), [ticker])
  return (
    <>
      <h3 className="peers-title">Price to Earnings Ratio vs Peers</h3>
      <p className="peers-subtitle">How does {ticker}'s PE Ratio compare to its peers?</p>
      <PeersBarChart items={data.items} peerAvg={data.peerAvg} dark={dark} />
    </>
  )
}

const RATING_COLOR = {
  'Strong Buy': '#15803d', 'Buy': '#16a34a',
  'Hold': '#b45309',
  'Sell': '#dc2626',      'Strong Sell': '#991b1b',
}

/* ─── Panel ──────────────────────────────────────────────────── */
export default function ValuationPanel({ ticker, dark }) {
  // Real valuation data fetched from backend
  const [liveData,    setLiveData]    = useState(null)
  const [liveLoading, setLiveLoading] = useState(true)

  // Mock data keeps the Key Metric + Peers sections working instantly
  const mockVal = useMemo(() => getValuation(ticker), [ticker])

  useEffect(() => {
    setLiveData(null)
    setLiveLoading(true)
    let cancelled = false
    fetch(`/api/stock/${ticker}/valuation`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(json => { if (!cancelled) { setLiveData(json); setLiveLoading(false) } })
      .catch(() => { if (!cancelled) { setLiveLoading(false) } })
    return () => { cancelled = true }
  }, [ticker])

  // Use live data when available, fall back to mock
  const d = liveData ?? mockVal

  const isUnder = d.isUndervalued
  const accentBg   = isUnder
    ? (dark ? 'rgba(22,163,74,0.18)'  : '#dcfce7')
    : (dark ? 'rgba(220,38,38,0.18)' : '#fee2e2')
  const accentText = isUnder
    ? (dark ? '#4ade80' : '#15803d')
    : (dark ? '#f87171' : '#b91c1c')

  const fmt = n =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const analystMethod = d.methods?.[0]
  const fvLabel = d.fairValueLabel ?? 'Target Price'

  return (
    <>
      {/* ── Card 1: Valuation ── */}
      <div className="card valuation-panel">
        <div className="val-title-row">
          <h3 className="val-title">Valuation</h3>
          {liveLoading && (
            <span className="val-loading-dot" title="Fetching live data…" />
          )}
        </div>

        <div className="val-summary">
          <div className="val-prices">
            <div className="val-price-block">
              <span className="val-price-lbl">Current Price</span>
              <span className="val-price-big">{fmt(d.currentPrice)}</span>
            </div>
            <span className="val-price-vs">vs.</span>
            <div className="val-price-block">
              <span className="val-price-lbl">{fvLabel}</span>
              <span className="val-price-big">{fmt(d.fairValue)}</span>
            </div>
          </div>

          <span className="val-verdict-pill" style={{ background: accentBg, color: accentText }}>
            {isUnder ? '▼' : '▲'}&nbsp;
            {d.discountPct.toFixed(1)}%&nbsp;
            {isUnder ? 'Below Fair Value' : 'Above Fair Value'}
          </span>
        </div>

        <ValuationGauge currentPrice={d.currentPrice} fairValue={d.fairValue} />

        <div className="val-divider" />

        {/* Methods table */}
        <div className="val-section">
          <div className="val-method-header">
            <span>Method</span>
            <span>Est. Value</span>
            <span>vs. Current</span>
          </div>
          {(d.methods ?? []).map((m, i) => (
            <VRow key={i} name={m.name} value={m.value} upside={m.upside} />
          ))}
        </div>

        {/* Analyst rating badge */}
        {d.analystRating && d.analystTarget && (
          <div className="val-analyst-bar">
            <span
              className="val-analyst-rating"
              style={{
                background: `${RATING_COLOR[d.analystRating] ?? '#2563eb'}18`,
                color: RATING_COLOR[d.analystRating] ?? '#2563eb',
              }}
            >
              {d.analystRating}
            </span>
            <span className="val-analyst-range">
              {d.analystLow && d.analystHigh
                ? `Target range ${fmt(d.analystLow)} – ${fmt(d.analystHigh)}`
                : `Consensus target ${fmt(d.analystTarget)}`}
            </span>
          </div>
        )}

        {/* Criteria */}
        <div className="val-criteria">
          {analystMethod && d.analystTarget && (
            <VCriterion
              label="Below Target Price"
              met={d.currentPrice < d.analystTarget}
              text={`${ticker} (${fmt(d.currentPrice)}) is trading ${d.currentPrice < d.analystTarget ? 'below' : 'above'} the analyst price target of ${fmt(d.analystTarget)}.`}
            />
          )}
        </div>
      </div>

      {/* ── Card 2: Key Valuation Metric ── */}
      <div className="card valuation-panel">
        <KeyMetricSection ticker={ticker} data={mockVal} />
      </div>

      {/* ── Card 3: PE vs Peers ── */}
      <div className="card valuation-panel">
        <PeersSection ticker={ticker} dark={dark} />
      </div>
    </>
  )
}
