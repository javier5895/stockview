import { useState, useEffect } from 'react'

const API = '/api'

const PERIODS = [
  { label: '1 Day',   key: '1d'  },
  { label: '5 Day',   key: '5d'  },
  { label: '1 Month', key: '1mo' },
  { label: '3 Month', key: '3mo' },
  { label: '6 Month', key: '6mo' },
  { label: 'YTD',     key: 'ytd' },
  { label: '1 Year',  key: '1y'  },
  { label: '5 Year',  key: '5y'  },
]

function fmt(n, dec = 2) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function SkeletonRow({ cols = 6 }) {
  return (
    <tr className="sec-row">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="sec-td">
          <div className="sec-skel" style={{ width: i === 1 ? 120 : 60, height: 14 }} />
        </td>
      ))}
    </tr>
  )
}

function PctBadge({ value }) {
  if (value == null) return <span className="sec-muted">—</span>
  const pos = value >= 0
  return (
    <span className={pos ? 'sec-pos' : 'sec-neg'}>
      {pos ? '+' : ''}{value.toFixed(2)}%
    </span>
  )
}

/* ── Drilldown panel ─────────────────────────────────────────── */
function HoldingsPanel({ row }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setData(null)
    fetch(`${API}/sectors/${row.etf}/holdings`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [row.etf])

  const stocks = data?.stocks ?? []

  return (
    <div className="sec-drill">
      <div className="sec-drill-table-wrap">
        <table className="sec-table">
          <thead>
            <tr>
              <th className="sec-th">Ticker</th>
              <th className="sec-th">Name</th>
              <th className="sec-th sec-th-num">Weight (%)</th>
              <th className="sec-th sec-th-num">Last Price ($)</th>
              <th className="sec-th sec-th-num">Prev. Close ($)</th>
              <th className="sec-th sec-th-num">Change ($)</th>
              <th className="sec-th sec-th-num">Change (%)</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={7} />)
              : stocks.map((s, i) => {
                  const sp = s.change >= 0
                  return (
                    <tr key={i} className="sec-row">
                      <td className="sec-td sec-td-ticker">
                        <span className="sec-ticker-badge">{s.symbol}</span>
                      </td>
                      <td className="sec-td sec-td-sector">{s.name}</td>
                      <td className="sec-td sec-td-num sec-muted">{fmt(s.weight)}%</td>
                      <td className="sec-td sec-td-num">{fmt(s.price)}</td>
                      <td className="sec-td sec-td-num sec-muted">{fmt(s.prevClose)}</td>
                      <td className={`sec-td sec-td-num ${sp ? 'sec-pos' : 'sec-neg'}`}>
                        {sp ? '+' : ''}{fmt(s.changeDollar)}
                      </td>
                      <td className={`sec-td sec-td-num ${sp ? 'sec-pos' : 'sec-neg'}`}>
                        {sp ? '+' : ''}{s.change.toFixed(2)}%
                      </td>
                    </tr>
                  )
                })
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Main page ───────────────────────────────────────────────── */
export default function SectorPage() {
  const [sectors, setSectors] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod]   = useState('1d')

  useEffect(() => {
    setLoading(true)
    const url = period === '1d'
      ? `${API}/sectors`
      : `${API}/sectors/history?period=${period}`
    fetch(url)
      .then(r => r.json())
      .then(d => { setSectors(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [period])

  const sorted    = [...sectors].sort((a, b) => b.change - a.change)
  const maxAbs    = Math.max(...sorted.map(s => Math.abs(s.change)), 0.01)
  const lastDate  = sectors[0]?.lastDate  ?? ''
  const startDate = sectors[0]?.startDate ?? ''
  const avgChange = sectors.length
    ? sectors.reduce((s, x) => s + x.change, 0) / sectors.length : 0

  return (
    <div className="sector-page">
      <div className="sector-container">

        {/* Header */}
        <div className="sector-header">
          <div>
            <h1 className="sector-title">Sector Heatmap</h1>
            <p className="sector-subtitle">11 S&P 500 sectors via SPDR ETFs · updated every 60s</p>
          </div>
          {sectors.length > 0 && (
            <div className={`sector-avg-card ${avgChange >= 0 ? 'pos' : 'neg'}`}>
              <span className="sector-avg-pill-label">Market Avg</span>
              <span className="sector-avg-pill-arrow">{avgChange >= 0 ? '▲' : '▼'}</span>
              <span className="sector-avg-pill-value">{avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%</span>
            </div>
          )}
        </div>

        {/* Period tabs */}
        <div className="sec-period-tabs">
          {PERIODS.map(p => (
            <button
              key={p.key}
              className={`sec-period-btn ${period === p.key ? 'active' : ''}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="sec-table-card card">
          <table className="sec-table">
            <thead>
              <tr>
                <th className="sec-th sec-th-ticker">Ticker</th>
                <th className="sec-th sec-th-sector">Sector</th>
                <th className="sec-th sec-th-num">
                  Last Price ($)
                  {lastDate && <div className="sec-th-date">{lastDate}</div>}
                </th>
                <th className="sec-th sec-th-num">
                  Start Price ($)
                  {startDate && <div className="sec-th-date">{startDate}</div>}
                </th>
                <th className="sec-th sec-th-num">Change ($)</th>
                <th className="sec-th sec-th-num">Holdings</th>
                <th className="sec-th sec-th-bar">Change (%)</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 11 }).map((_, i) => <SkeletonRow key={i} cols={7} />)
                : sorted.map(row => {
                    const pos    = row.change >= 0
                    const barPct = (Math.abs(row.change) / maxAbs) * 100
                    return (
                      <tr key={row.etf} className="sec-row">
                        <td className="sec-td sec-td-ticker">
                          <span className="sec-ticker-badge">{row.etf}</span>
                        </td>
                        <td className="sec-td sec-td-sector">{row.sector}</td>
                        <td className="sec-td sec-td-num">{fmt(row.price)}</td>
                        <td className="sec-td sec-td-num sec-muted">{fmt(row.prevClose)}</td>
                        <td className={`sec-td sec-td-num ${pos ? 'sec-pos' : 'sec-neg'}`}>
                          {row.changeDollar != null ? (pos ? '+' : '') + fmt(row.changeDollar) : '—'}
                        </td>
                        <td className="sec-td sec-td-num sec-muted">{row.holdings || '—'}</td>
                        <td className="sec-td sec-td-bar">
                          <div className="sec-bar-wrap">
                            <div className="sec-bar-track">
                              <div
                                className={`sec-bar ${pos ? 'sec-bar-pos' : 'sec-bar-neg'}`}
                                style={{ width: `${barPct}%` }}
                              />
                            </div>
                            <span className={`sec-bar-label ${pos ? 'sec-pos' : 'sec-neg'}`}>
                              {pos ? '+' : ''}{row.change.toFixed(2)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>

        <p className="sector-footer">Data via SPDR Sector ETFs · Sized by approximate S&P 500 weight · Updated every 60s</p>
      </div>
    </div>
  )
}
