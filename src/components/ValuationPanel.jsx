import { useState, useEffect, useMemo, useRef } from 'react'
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

function LearnModal({ onClose, title, content }) {
  return (
    <div className="learn-overlay" onClick={onClose}>
      <div className="learn-modal" onClick={e => e.stopPropagation()}>
        <div className="learn-modal-header">
          <h3 className="learn-modal-title">{title}</h3>
          <button className="learn-modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="learn-modal-body">
          {content.split('\n\n').map((para, i) => (
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
    if (n == null) return '—'
    if (n >= 1e12) return `US$${(n / 1e12).toFixed(2)}t`
    if (n >= 1e9)  return `US$${(n / 1e9).toFixed(2)}b`
    return `US$${(n / 1e6).toFixed(0)}m`
  }
  const fmtRatio = (v, suffix = 'x') => v != null ? `${Number(v).toFixed(1)}${suffix}` : '—'

  const configs = {
    PE: {
      keyText: `As ${ticker} is profitable we use its Price-To-Earnings Ratio for relative valuation analysis.`,
      question: `What is ${ticker}'s PE Ratio?`,
      rows: [
        { label: 'PE Ratio', value: fmtRatio(data.pe) },
      ],
      footer: `The above table shows the Price to Earnings ratio for ${ticker}. This is calculated by dividing ${ticker}'s market cap by their current earnings.`,
    },
    PS: {
      keyText: `We use the Price-To-Sales Ratio as it captures ${ticker}'s revenue generation capacity relative to its market value.`,
      question: `What is ${ticker}'s PS Ratio?`,
      rows: [
        { label: 'PS Ratio', value: fmtRatio(data.ps) },
      ],
      footer: `The above table shows the Price to Sales ratio for ${ticker}. This is calculated by dividing ${ticker}'s market cap by their annual revenue.`,
    },
    PB: {
      keyText: `We use the Price-To-Book Ratio as it shows ${ticker}'s market value relative to its net asset (book) value.`,
      question: `What is ${ticker}'s PB Ratio?`,
      rows: [
        { label: 'PB Ratio', value: fmtRatio(data.pb) },
      ],
      footer: `The above table shows the Price to Book ratio for ${ticker}. This is calculated by dividing ${ticker}'s market cap by their total book value.`,
    },
    Others: {
      keyText: `EV/EBITDA provides a capital-structure-neutral view of ${ticker}'s valuation, removing the effect of financing and non-cash charges.`,
      question: `What is ${ticker}'s EV/EBITDA?`,
      rows: [
        { label: 'EV/EBITDA', value: fmtRatio(data.evEbitda) },
      ],
      footer: `The above table shows the EV/EBITDA ratio for ${ticker}. This is calculated by dividing the enterprise value by earnings before interest, taxes, depreciation and amortisation.`,
    },
  }

  const cfg = configs[active]

  return (
    <div className="kvm-section">
      {learnOpen && (
        <LearnModal
          title="Key Valuation Metric"
          content={LEARN_CONTENT}
          onClose={() => setLearnOpen(false)}
        />
      )}

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

/* ─── PE vs Fair PE Gauge ────────────────────────────────────── */
function PeGauge({ currentPE, fairPE, dark }) {
  const W = 360, H = 220
  const cx = W / 2, cy = H - 32
  const R_OUT = 118, R_IN = 68
  const BW = 82, BH = 48, BR = 6   // box dimensions

  const rawMax = Math.max(fairPE * 2.1, currentPE * 1.4)
  const maxPE  = Math.ceil(rawMax / 10) * 10

  // angle: v=0 → π (left), v=maxPE → 0 (right)
  const ang = v => Math.PI * (1 - Math.min(v, maxPE) / maxPE)
  const f   = n => n.toFixed(2)
  const pt  = (v, r) => {
    const a = ang(v)
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) }
  }

  // Annular sector — full gauge is exactly 180° so large-arc-flag is ALWAYS 0
  const arcPath = (v1, v2, rO, rI) => {
    const p0o = pt(v1, rO), p1o = pt(v2, rO)
    const p0i = pt(v1, rI), p1i = pt(v2, rI)
    return [
      `M${f(p0o.x)} ${f(p0o.y)}`,
      `A${rO} ${rO} 0 0 1 ${f(p1o.x)} ${f(p1o.y)}`,
      `L${f(p1i.x)} ${f(p1i.y)}`,
      `A${rI} ${rI} 0 0 0 ${f(p0i.x)} ${f(p0i.y)}Z`,
    ].join(' ')
  }

  const cur  = Math.min(currentPE, maxPE * 0.97)
  const fair = Math.min(fairPE,    maxPE * 0.97)
  const needleTip = pt(cur, R_OUT - 5)
  const tc  = dark ? '#64748b' : '#94a3b8'
  const bg  = dark ? '#141e2e' : '#ffffff'

  // Five evenly-spaced ticks
  const ticks = [0, 1, 2, 3, 4].map(i => Math.round(maxPE * i / 4 * 10) / 10)

  // ── Label box positions with spread-apart logic ──────────────
  const LIFT = R_OUT + 54          // radius at which box centres float
  const fpLP = pt(fair, LIFT)
  const cpLP = pt(cur,  LIFT)

  let fpBx = fpLP.x - BW / 2
  let cpBx = cpLP.x - BW / 2

  // Spread boxes apart so they never overlap (keep 8 px gap)
  const needed = BW + 8
  const gap    = cpBx - fpBx
  if (Math.abs(gap) < needed) {
    const push = (needed - Math.abs(gap)) / 2
    if (cpLP.x >= fpLP.x) { cpBx += push; fpBx -= push }
    else                   { fpBx += push; cpBx -= push }
  }
  const clampX = x => Math.max(4, Math.min(W - BW - 4, x))
  fpBx = clampX(fpBx)
  cpBx = clampX(cpBx)
  const fpBy = Math.max(4, fpLP.y - BH)
  const cpBy = Math.max(4, cpLP.y - BH)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} overflow="hidden"
      style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block' }}>

      {/* Background arc */}
      <path d={arcPath(0, maxPE, R_OUT, R_IN)} fill={dark ? '#112011' : '#e8f5e9'} />
      {/* Green zone: 0 → fairPE */}
      <path d={arcPath(0, fair, R_OUT, R_IN)} fill="#15803d" />
      {/* Red zone: fairPE → max */}
      <path d={arcPath(fair, maxPE, R_OUT, R_IN)} fill="#b91c1c" />
      {/* Inner fill — cover the ring's hollow centre */}
      <path d={`M${f(cx-R_IN)} ${f(cy)} A${R_IN} ${R_IN} 0 0 1 ${f(cx+R_IN)} ${f(cy)} Z`} fill={bg} />

      {/* Needle */}
      <line x1={f(cx)} y1={f(cy)} x2={f(needleTip.x)} y2={f(needleTip.y)}
        stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" />
      <circle cx={f(cx)} cy={f(cy)} r="8" fill={bg} stroke="#3b82f6" strokeWidth="2.5" />

      {/* Axis tick labels */}
      {ticks.map((v, i) => {
        let tx, ty, anc
        if (i === 0) {
          // Below the left arc endpoint — clear of the green arc
          tx = cx - R_OUT; ty = cy + 16; anc = 'middle'
        } else if (i === 4) {
          // Below the right arc endpoint — clear of the red arc
          tx = cx + R_OUT; ty = cy + 16; anc = 'middle'
        } else {
          const lp = pt(v, R_OUT + 22)
          tx = lp.x; ty = lp.y + 4; anc = 'middle'
        }
        return (
          <text key={i} x={f(tx)} y={f(ty)} textAnchor={anc}
            fontSize="11" fontWeight="600" fill={tc}>
            {v.toFixed(1)}x
          </text>
        )
      })}

      {/* Clear rect spanning both boxes + the gap between them — hides any tick
          labels that fall in that region before the coloured boxes are drawn */}
      {(() => {
        const x1 = Math.min(fpBx, cpBx) - 2
        const x2 = Math.max(fpBx + BW, cpBx + BW) + 2
        const y1 = Math.min(fpBy, cpBy) - 2
        const y2 = Math.max(fpBy + BH, cpBy + BH) + 2
        return <rect x={f(x1)} y={f(y1)} width={f(x2 - x1)} height={f(y2 - y1)} fill={bg} />
      })()}

      {/* Fair PE box (yellow) */}
      <g>
        <rect x={f(fpBx)} y={f(fpBy)} width={BW} height={BH} rx={BR} fill="#eab308" />
        <text x={f(fpBx+BW/2)} y={f(fpBy+15)} textAnchor="middle" fontSize="9" fontWeight="700" fill="#000">Fair PE</text>
        <text x={f(fpBx+BW/2)} y={f(fpBy+35)} textAnchor="middle" fontSize="15" fontWeight="700" fill="#000">{fairPE.toFixed(1)}x</text>
      </g>

      {/* Current PE box (blue) */}
      <g>
        <rect x={f(cpBx)} y={f(cpBy)} width={BW} height={BH} rx={BR} fill="#2563eb" />
        <text x={f(cpBx+BW/2)} y={f(cpBy+15)} textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">Current PE</text>
        <text x={f(cpBx+BW/2)} y={f(cpBy+35)} textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff">{currentPE.toFixed(1)}x</text>
      </g>
    </svg>
  )
}

function PeVsFairSection({ ticker, currentPE, fairPE, dark }) {
  if (!currentPE || !fairPE) return null
  const isGoodValue = currentPE < fairPE
  const criterionText = isGoodValue
    ? `${ticker} is good value based on its Price-To-Earnings Ratio (${currentPE.toFixed(1)}x) compared to the estimated Fair Price-To-Earnings Ratio (${fairPE.toFixed(1)}x).`
    : `${ticker} is trading above its estimated Fair Price-To-Earnings Ratio (${fairPE.toFixed(1)}x) with a current PE of ${currentPE.toFixed(1)}x.`

  return (
    <>
      <h3 className="peers-title">Price to Earnings Ratio vs Fair Ratio</h3>
      <p className="peers-subtitle">
        What is {ticker}'s PE Ratio compared to its{' '}
        <span style={{ borderBottom: '1px dotted currentColor', cursor: 'default' }}>Fair PE Ratio</span>?{' '}
        This is the expected PE Ratio taking into account the company's forecast earnings
        growth, profit margins and other risk factors.
      </p>
      <div className="pe-fair-layout">
        <div className="pe-fair-gauge-wrap">
          <PeGauge currentPE={currentPE} fairPE={fairPE} dark={dark} />
        </div>
        <div className="pe-fair-criterion">
          <VCriterion
            label="Price-To-Earnings vs Fair Ratio"
            met={isGoodValue}
            text={criterionText}
          />
        </div>
      </div>
    </>
  )
}

/* ─── Peers learn content ────────────────────────────────────── */
const PEERS_LEARN_CONTENT = `Preferred Ratio vs Peers
Peers are the companies that are most similar to the company we are valuing. Arriving at a relevant list of peers includes things like what products they make or services they provide, but also things like their size, growth rates and structure of their income statement and balance sheets.

Selecting a group of peers is a difficult task, requiring years of experience. Our peers algorithm gives you the power of that experience by selecting peers, using a range of data points.

For a more detailed breakdown of how we select relevant peers, please check out our Help Centre.`

/* ─── Ratio options ──────────────────────────────────────────── */
const RATIO_OPTIONS = [
  { key: 'pe', label: 'Price to Earnings', short: 'PE', criterionLabel: 'Price-To-Earnings vs Peers' },
  { key: 'ps', label: 'Price to Sales',    short: 'PS', criterionLabel: 'Price-To-Sales vs Peers'    },
  { key: 'pb', label: 'Price to Book',     short: 'PB', criterionLabel: 'Price-To-Book vs Peers'     },
]

/* ─── Peers Bar Chart ────────────────────────────────────────── */
function PeersBarChart({ items, peerAvg, dark, ratioShort }) {
  const sorted = [
    ...items.filter(d => d.isMain),
    ...items.filter(d => !d.isMain).sort((a, b) => b.value - a.value),
  ]

  const maxVal   = Math.ceil(Math.max(...sorted.map(d => d.value)) / 10) * 10 + 5
  const pct      = v => `${(v / maxVal * 100).toFixed(3)}%`
  const tickStep = maxVal <= 25 ? 5 : 10
  const ticks    = []
  for (let v = 0; v <= maxVal; v += tickStep) ticks.push(v)

  const muted  = dark ? '#64748b' : '#94a3b8'
  const overBg = dark ? 'rgba(120,15,15,0.45)' : 'rgba(220,38,38,0.07)'

  return (
    <div className="pchart-wrap">
      <div className="pchart-inner">
        <div className="pchart-bars-area">
          <div className="pchart-overlay" style={{ left: pct(peerAvg), background: overBg }} />
          <div className="pchart-avg-line" style={{ left: pct(peerAvg) }} />
          <div className="pchart-avg-bubble" style={{ left: pct(peerAvg) }}>
            Peer Avg {peerAvg.toFixed(1)}x
          </div>

          <div className="pchart-bars">
            {sorted.map((item, i) => {
              const shortName = item.name.split(' ')[0]
              return (
                <div key={i} className="pchart-bar-row">
                  <div
                    className={`pchart-bar${item.isMain ? ' pchart-bar--main' : ''}`}
                    style={{ width: pct(item.value) }}
                  >
                    <span className="pchart-pe">{item.value.toFixed(1)}x</span>
                    {item.isMain
                      ? <span className="pchart-badge">{shortName}</span>
                      : <span className="pchart-name">{item.name}</span>
                    }
                  </div>
                </div>
              )
            })}
          </div>

          <div className="pchart-axis">
            {ticks.map(v => (
              <span key={v} className="pchart-tick" style={{ left: pct(v), color: muted }}>
                {v === 0 ? ratioShort : v}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Ratio Dropdown Button ──────────────────────────────────── */
function RatioDropdown({ selected, onSelect, dark }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className={`peers-ratio-btn${dark ? ' peers-ratio-btn--dark' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="peers-ratio-star">★</span>
        <span>{selected.label}</span>
        <span className="peers-ratio-chevron">{open ? '▲' : '▾'}</span>
      </button>
      {open && (
        <div className={`peers-ratio-dropdown${dark ? ' peers-ratio-dropdown--dark' : ''}`}>
          {RATIO_OPTIONS.map(o => (
            <button
              key={o.key}
              className={`peers-ratio-option${o.key === selected.key ? ' active' : ''}${dark ? ' dark' : ''}`}
              onClick={() => { onSelect(o); setOpen(false) }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Peers Section ──────────────────────────────────────────── */
function PeersSection({ ticker, dark }) {
  const [peersData,  setPeersData]  = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [ratio,      setRatio]      = useState(RATIO_OPTIONS[0])
  const [learnOpen,  setLearnOpen]  = useState(false)

  const mockData = useMemo(() => getPeersComparison(ticker), [ticker])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPeersData(null)

    fetch(`/api/stock/${ticker}/peers`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { if (!cancelled) { setPeersData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })

    return () => { cancelled = true }
  }, [ticker])

  const rawItems = (peersData ?? mockData).items

  // Attach `.value` for the selected ratio, fall back to pe if missing
  const chartItems = rawItems
    .map(item => ({ ...item, value: item[ratio.key] ?? item.pe }))
    .filter(item => item.value != null && item.value > 0)

  const peers = chartItems.filter(i => !i.isMain)
  const peerAvg = peers.length
    ? +(peers.reduce((s, i) => s + i.value, 0) / peers.length).toFixed(1)
    : chartItems[0]?.value ?? 0

  return (
    <>
      {learnOpen && (
        <LearnModal
          title="Preferred Ratio vs Peers"
          content={PEERS_LEARN_CONTENT}
          onClose={() => setLearnOpen(false)}
        />
      )}

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 className="peers-title" style={{ margin: 0 }}>{ratio.label} Ratio vs Peers</h3>
          {loading && <span className="val-loading-dot" title="Fetching live peers…" />}
          {!loading && peersData && (
            <span style={{ fontSize: 10, color: dark ? '#4ade80' : '#16a34a', fontWeight: 600 }}>Live</span>
          )}
          {!loading && error && (
            <span style={{ fontSize: 10, color: dark ? '#94a3b8' : '#64748b' }}>(mock data)</span>
          )}
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
        <RatioDropdown selected={ratio} onSelect={setRatio} dark={dark} />
      </div>

      <p className="peers-subtitle">How does {ticker}'s {ratio.short} Ratio compare to its peers?</p>
      <PeersBarChart items={chartItems} peerAvg={peerAvg} dark={dark} ratioShort={ratio.short} />

      {/* Criterion */}
      {(() => {
        const mainItem = chartItems.find(i => i.isMain)
        if (!mainItem || peerAvg === 0) return null
        const v    = mainItem.value
        const met  = v < peerAvg
        const text = met
          ? `${ticker} is good value based on its ${ratio.label} (${v.toFixed(1)}x) compared to the peer average (${peerAvg.toFixed(1)}x).`
          : `${ticker} is trading at a premium based on its ${ratio.label} (${v.toFixed(1)}x) compared to the peer average (${peerAvg.toFixed(1)}x).`
        return (
          <div className="val-criteria" style={{ marginTop: 14 }}>
            <VCriterion label={ratio.criterionLabel} met={met} text={text} />
          </div>
        )
      })()}
    </>
  )
}

const RATING_COLOR = {
  'Strong Buy': '#15803d', 'Buy': '#16a34a',
  'Hold': '#b45309',
  'Sell': '#dc2626',      'Strong Sell': '#991b1b',
}

/* ─── Valuation Score Ring ───────────────────────────────────── */
function ValScoreRing({ criteria }) {
  const met   = criteria.filter(c => c.met).length
  const total = criteria.length
  const pct   = total > 0 ? met / total : 0

  const verdict = met >= 4 ? 'Undervalued'
                : met === 3 ? 'Fair Valued'
                :              'Overvalued'
  const verdictColor = met >= 4 ? '#16a34a'
                     : met === 3 ? '#d97706'
                     :              '#dc2626'

  const r = 42, cx = 52, cy = 52, sw = 7
  const circ = 2 * Math.PI * r

  return (
    <div className="card val-score-card">
      <div className="val-score-inner">
        {/* Ring */}
        <div className="val-score-ring-wrap">
          <svg width="104" height="104" viewBox="0 0 104 104">
            <circle cx={cx} cy={cy} r={r} fill="none"
              stroke="var(--border2)" strokeWidth={sw} />
            <circle cx={cx} cy={cy} r={r} fill="none"
              stroke={verdictColor} strokeWidth={sw}
              strokeDasharray={`${circ * pct} ${circ}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${cx} ${cy})`} />
            <text x={cx} y={cy} textAnchor="middle"
              dominantBaseline="central"
              fontSize="22" fontWeight="700" fill="var(--text-strong)">
              {met}/{total}
            </text>
          </svg>
          <span className="val-score-label" style={{ color: verdictColor }}>
            {verdict.toUpperCase()}
          </span>
        </div>

        {/* Criteria list */}
        <div className="val-score-criteria">
          {criteria.map((c, i) => (
            <div key={i} className="val-score-item">
              <span className={`val-score-dot ${c.met ? 'val-score-dot--met' : 'val-score-dot--miss'}`} />
              <span className="val-score-item-label">{c.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─── Panel ──────────────────────────────────────────────────── */
export default function ValuationPanel({ ticker, dark }) {
  // Real valuation data fetched from backend
  const [liveData,    setLiveData]    = useState(null)
  const [liveLoading,  setLiveLoading]  = useState(true)
  const [peersScore,   setPeersScore]   = useState(null)

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

  // Fetch peers just for the score criteria (backend cache means no extra cost)
  useEffect(() => {
    let cancelled = false
    setPeersScore(null)
    fetch(`/api/stock/${ticker}/peers`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(json => { if (!cancelled) setPeersScore(json) })
      .catch(() => {})
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

  // Merge live key metrics (from EDGAR + yFinance) over the mock placeholders
  const km = liveData?.keyMetrics ?? {}
  const keyMetricData = {
    ...mockVal,
    pe:        km.pe        ?? mockVal.pe,
    ps:        km.ps        ?? mockVal.ps,
    pb:        km.pb        ?? mockVal.pb,
    evEbitda:  km.evEbitda  ?? mockVal.evEbitda,
    mcNum:     km.marketCap ?? mockVal.mcNum,
    earnings:  km.earnings  ?? mockVal.earnings,
    revenue:   km.revenue   ?? mockVal.revenue,
    bookValue: km.bookValue ?? mockVal.bookValue,
    ebitda:    km.ebitda    ?? mockVal.ebitda,
  }

  // ── 6 Valuation criteria ──────────────────────────────────────
  // Peer averages from the peers fetch (exclude main ticker)
  const peerItems   = peersScore?.items?.filter(i => !i.isMain) ?? []
  const avg = key => {
    const vals = peerItems.map(p => p[key]).filter(v => v != null && v > 0)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  const peerAvgPE = avg('pe')
  const peerAvgPS = avg('ps')
  const peerAvgPB = avg('pb')

  const pe = km.pe ?? d.currentPE
  const ps = km.ps
  const pb = km.pb
  const evEbitda = km.evEbitda

  const criteria = [
    {
      label: 'Price below fair value',
      met:   d.currentPrice < d.fairValue,
    },
    {
      label: `PE${pe != null && d.fairPE ? ` · ${pe.toFixed(1)}x vs ${d.fairPE.toFixed(1)}x fair` : ''}`,
      met:   !!(pe && d.fairPE && pe < d.fairPE),
    },
    {
      label: `PS${ps != null && peerAvgPS ? ` · ${ps.toFixed(1)}x vs ${peerAvgPS.toFixed(1)}x peers` : ''}`,
      met:   !!(ps && peerAvgPS && ps < peerAvgPS),
    },
    {
      label: `PB${pb != null && peerAvgPB ? ` · ${pb.toFixed(1)}x vs ${peerAvgPB.toFixed(1)}x peers` : ''}`,
      met:   !!(pb && peerAvgPB && pb < peerAvgPB),
    },
    {
      label: `PE vs Peers${pe != null && peerAvgPE ? ` · ${pe.toFixed(1)}x vs ${peerAvgPE.toFixed(1)}x avg` : ''}`,
      met:   !!(pe && peerAvgPE && pe < peerAvgPE),
    },
  ]

  return (
    <>
      {/* ── Score Card ── */}
      <ValScoreRing criteria={criteria} />

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
        <KeyMetricSection ticker={ticker} data={keyMetricData} />
      </div>

      {/* ── Card 3: PE vs Peers ── */}
      <div className="card valuation-panel">
        <PeersSection ticker={ticker} dark={dark} />
      </div>

      {/* ── Card 4: PE vs Fair PE ── */}
      {(d.currentPE || d.fairPE) && (
        <div className="card valuation-panel">
          <PeVsFairSection
            ticker={ticker}
            currentPE={d.currentPE}
            fairPE={d.fairPE}
            dark={dark}
          />
        </div>
      )}
    </>
  )
}
