import { useState, useMemo, useEffect } from 'react'
import StockChart from '../components/StockChart'
import SnowflakePanel from '../components/SnowflakePanel'
import CompetitorsPanel from '../components/CompetitorsPanel'
import AboutPanel from '../components/AboutPanel'
import FundamentalsPanel from '../components/FundamentalsPanel'
import ValuationPanel from '../components/ValuationPanel'
import FinancialsPanel from '../components/FinancialsPanel'
import { getStock, getPeriodData, getKeyStats, PERIODS } from '../mockData'

const RETURN_PERIODS = [
  { label: '1 day',        p: '1D'  },
  { label: '5 days',       p: '5D'  },
  { label: '1 month',      p: '1M'  },
  { label: '6 months',     p: '6M'  },
  { label: 'Year to date', p: 'YTD' },
  { label: '1 year',       p: '1Y'  },
  { label: '5 years',      p: '5Y'  },
  { label: 'All time',     p: 'Max' },
]

function fmtReturn(pct) {
  const sign = pct >= 0 ? '+' : ''
  if (Math.abs(pct) >= 1000) return `${sign}${(pct / 1000).toFixed(2)}K%`
  return `${sign}${pct.toFixed(2)}%`
}

function TrendUp() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
}
function TrendDown() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
}

/* ─── Range Bar ──────────────────────────────────────────────── */
function RangeBar({ low, high, current }) {
  const pct = Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100))
  return (
    <div className="range-wrap">
      <span className="range-edge">${low.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
      <div className="range-track">
        <div className="range-filled" style={{ width: `${pct}%` }} />
        <div className="range-dot" style={{ left: `${pct}%` }} />
      </div>
      <span className="range-edge">${high.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
    </div>
  )
}

/* ─── Info Row ───────────────────────────────────────────────── */
function InfoRow({ label, value, valueClass }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className={`info-value ${valueClass ?? ''}`}>{value}</span>
    </div>
  )
}

function InfoRowRange({ label, low, high, current }) {
  return (
    <div className="info-row info-row--range">
      <span className="info-label">{label}</span>
      <div className="info-range-right">
        <RangeBar low={low} high={high} current={current} />
      </div>
    </div>
  )
}

/* ─── Tab Bar ────────────────────────────────────────────────── */
const TABS = ['Summary', 'Financials', 'Key Metrics', 'Valuation', 'News', 'Dividends']

function TabBar({ active, onChange }) {
  return (
    <div className="stock-tabs">
      {TABS.map(t => (
        <button
          key={t}
          className={`stock-tab-btn ${active === t ? 'active' : ''}`}
          onClick={() => onChange(t)}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

/* ─── Panels ─────────────────────────────────────────────────── */
function TradingPanel({ stats, dark }) {
  const fmt = n => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
  return (
    <div className="info-panel">
      <h4 className="info-panel-title">Trading Information</h4>

      <InfoRow label="Previous Close" value={fmt(stats.prevClose)} />
      <InfoRowRange
        label="Day Range"
        low={stats.dayLow} high={stats.dayHigh}
        current={stats.currentPrice}
      />
      <InfoRowRange
        label="52-Week Range"
        low={stats.w52Low} high={stats.w52High}
        current={stats.currentPrice}
      />
      <InfoRow label="Bid / Ask" value={`${fmt(stats.bid)} / ${fmt(stats.ask)}`} />
      <InfoRow label="Volume" value={stats.volume} />
      <InfoRow label="Avg Volume" value={stats.avgVolume} />
      <InfoRow label="Market Cap" value={`$${stats.marketCap}`} />
      <InfoRow label="Shares Outstanding" value={stats.shares} />
      {stats.earningsDate && (
        <InfoRow label="Earnings Date" value={stats.earningsDate} />
      )}
    </div>
  )
}

function MetricsPanel({ stats }) {
  const pct = (n, pos) => {
    const sign = n > 0 ? '+' : ''
    const cls = pos ? (n > 0 ? 'val-green' : 'val-red') : ''
    return { v: `${sign}${n.toFixed(1)}%`, c: cls }
  }
  const rev = pct(stats.revGrowth, true)

  return (
    <div className="info-panel">
      <h4 className="info-panel-title">Key Metrics</h4>

      <InfoRow label="P/E Ratio (TTM)"    value={stats.pe.toFixed(1)} />
      <InfoRow label="Price / Sales"      value={stats.ps.toFixed(1)} />
      <InfoRow label="EPS (TTM)"          value={`$${stats.eps.toFixed(2)}`} />
      <InfoRow
        label="Dividend Yield"
        value={stats.divYield > 0 ? `${stats.divYield.toFixed(2)}%` : '—'}
        valueClass={stats.divYield > 0 ? 'val-green' : ''}
      />
      <InfoRow label="Beta (5Y)"          value={stats.beta.toFixed(2)} />
      <InfoRow label="Return on Equity"   value={`${stats.roe.toFixed(1)}%`} />
      <InfoRow label="Profit Margin"      value={`${stats.profitMargin.toFixed(1)}%`} />
      <InfoRow
        label="Revenue Growth (YoY)"
        value={rev.v}
        valueClass={rev.c}
      />
    </div>
  )
}

/* ─── Stock Page ─────────────────────────────────────────────── */
export default function StockPage({ ticker, dark, onBack, onNavigate }) {
  const [period, setPeriod] = useState('1D')
  const [activeTab, setActiveTab] = useState('Summary')
  const [realChartData, setRealChartData] = useState(null)
  const [realQuote, setRealQuote] = useState(null)
  const [realReturns, setRealReturns] = useState(null)
  const [realTradingInfo, setRealTradingInfo] = useState(null)
  const [realAbout, setRealAbout] = useState(null)
  const [realFounded, setRealFounded] = useState(null)

  const stock   = useMemo(() => getStock(ticker),      [ticker])
  const chartData = useMemo(() => getPeriodData(ticker, period), [ticker, period])

  useEffect(() => {
    setRealChartData(null)
    let cancelled = false
    const fetchChart = () => {
      fetch(`/api/stock/${ticker}/chart?period=${period}`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(json => { if (!cancelled) setRealChartData(json.data) })
        .catch(() => { if (!cancelled) setRealChartData(null) })
    }
    fetchChart()
    // Poll every 60 s on 1D so new 1-minute bars appear automatically
    const interval = period === '1D' ? setInterval(fetchChart, 60_000) : null
    return () => { cancelled = true; if (interval) clearInterval(interval) }
  }, [ticker, period])

  useEffect(() => {
    setRealQuote(null)
    let cancelled = false
    const fetchQuote = () => {
      fetch(`/api/stock/${ticker}/quote`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(json => { if (!cancelled) setRealQuote(json) })
        .catch(() => { if (!cancelled) setRealQuote(null) })
    }
    fetchQuote()
    // Keep the live price current every 30 s
    const interval = setInterval(fetchQuote, 30_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [ticker])

  useEffect(() => {
    setRealReturns(null)
    let cancelled = false
    fetch(`/api/stock/${ticker}/returns`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(json => { if (!cancelled) setRealReturns(json) })
      .catch(() => { if (!cancelled) setRealReturns(null) })
    return () => { cancelled = true }
  }, [ticker])

  useEffect(() => {
    setRealTradingInfo(null)
    let cancelled = false
    fetch(`/api/stock/${ticker}/trading-info`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(json => { if (!cancelled) setRealTradingInfo(json) })
      .catch(() => { if (!cancelled) setRealTradingInfo(null) })
    return () => { cancelled = true }
  }, [ticker])

  useEffect(() => {
    setRealAbout(null)
    let cancelled = false
    fetch(`/api/stock/${ticker}/about`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(json => { if (!cancelled) setRealAbout(json) })
      .catch(() => { if (!cancelled) setRealAbout(null) })
    return () => { cancelled = true }
  }, [ticker])

  useEffect(() => {
    setRealFounded(null)
    let cancelled = false
    fetch(`/api/stock/${ticker}/founded`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(json => { if (!cancelled) setRealFounded(json.founded) })
      .catch(() => { if (!cancelled) setRealFounded(null) })
    return () => { cancelled = true }
  }, [ticker])

  const displayChartData = realChartData ?? chartData
  const stats   = useMemo(() => getKeyStats(ticker),   [ticker])
  const returns = useMemo(() =>
    RETURN_PERIODS.map(({ label, p }) => {
      const data = getPeriodData(ticker, p)
      const first = data[0]?.price
      const last  = data[data.length - 1]?.price
      const pct   = first ? ((last - first) / first) * 100 : 0
      return { label, p, pct }
    }), [ticker])

  const displayPrice    = realQuote?.currentPrice  ?? stock.currentPrice
  const displayPrevClose = realQuote?.previousClose ?? stock.previousClose
  const displayChange   = realQuote?.change        ?? stock.change
  const displayChangePct = realQuote?.changePct     ?? stock.changePct
  const isPos      = displayChange >= 0

  // Chart color:
  //   1D → matches today's change vs prev close (same as the price pill)
  //   All other periods → end price vs start price of the displayed data
  const chartIsPos = useMemo(() => {
    if (!displayChartData || displayChartData.length < 2) return isPos
    if (period === '1D') return isPos
    return displayChartData[displayChartData.length - 1].price >= displayChartData[0].price
  }, [displayChartData, isPos, period])

  const accentColor = isPos ? '#16a34a' : '#dc2626'
  const accentBg    = isPos ? (dark ? 'rgba(22,163,74,0.18)' : '#dcfce7')  : (dark ? 'rgba(220,38,38,0.18)' : '#fee2e2')
  const accentText  = isPos ? (dark ? '#4ade80' : '#15803d')               : (dark ? '#f87171' : '#b91c1c')

  return (
    <div className="stock-page">

      {/* Back */}
      <button className="back-btn" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Markets
      </button>

      {/* Company name + badges */}
      <div className="sp-header">
        <div>
          <div className="company-name-row">
            <h2 className="company-name">{stock.name}</h2>
            <span className="ticker-badge">{stock.ticker}</span>
            <span className="exchange-badge">{stock.exchange}</span>
          </div>
          <p className="company-meta">{stock.sector} · Market Cap {stock.currency} {stock.marketCap}</p>
        </div>
      </div>

      {/* Tab bar */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Single-column layout */}
      <div className="sp-left">
          {activeTab !== 'Valuation' && activeTab !== 'Financials' && <div className="card sp-chart-card">
            {/* Price */}
            <div className="price-block">
              <div className="price-row">
                <span className="price-currency">USD</span>
                <span className="price-value">
                  {displayPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="change-pill" style={{ background: accentBg, color: accentText }}>
                  {isPos ? <TrendUp /> : <TrendDown />}
                  {isPos ? '+' : ''}${Math.abs(displayChange).toFixed(2)}&nbsp;({isPos ? '+' : ''}{displayChangePct.toFixed(2)}%)
                </span>
              </div>
              <p className="prev-close">Prev. close: <strong>${displayPrevClose.toFixed(2)}</strong></p>
            </div>

            {/* Chart — untouched */}
            <div className="chart-area">
              <StockChart
                data={displayChartData}
                previousClose={displayPrevClose}
                period={period}
                isPositive={chartIsPos}
                dark={dark}
              />
            </div>

            {/* Period selector */}
            <div className="period-row">
              {PERIODS.map(p => (
                <button
                  key={p}
                  className={`period-btn ${period === p ? 'active' : ''}`}
                  style={period === p ? { color: accentColor, borderBottomColor: accentColor } : {}}
                  onClick={() => setPeriod(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>}

          {activeTab === 'Valuation' ? (

            /* ── Valuation Tab ────────────────────────────── */
            <ValuationPanel ticker={ticker} dark={dark} />

          ) : activeTab === 'Financials' ? (

            /* ── Financials Tab ───────────────────────────── */
            <FinancialsPanel ticker={ticker} dark={dark} />

          ) : (

            /* ── Summary (default) Tab ────────────────────── */
            <>
              {/* Returns row */}
              <div className="returns-row">
                {returns.map(({ label, p, pct }) => {
                  const displayPct = realReturns?.[p] ?? pct
                  const isPos = displayPct >= 0
                  return (
                    <button
                      key={p}
                      className={`return-item ${period === p ? 'active' : ''}`}
                      onClick={() => setPeriod(p)}
                    >
                      <span className="return-label">{label}</span>
                      <span className="return-pct" style={{ color: isPos ? '#16a34a' : '#dc2626' }}>
                        {fmtReturn(displayPct)}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Trading Information */}
              <TradingPanel stats={realTradingInfo ?? stats} dark={dark} />

              {/* About the Company */}
              <AboutPanel ticker={ticker} realData={realAbout} realFounded={realFounded} />

              {/* Snowflake Analysis */}
              <SnowflakePanel ticker={ticker} dark={dark} />

              {/* Competitors */}
              <CompetitorsPanel
                ticker={ticker}
                companyName={stock.name}
                dark={dark}
                onSelect={onNavigate}
              />
            </>

          )}
      </div>
    </div>
  )
}
