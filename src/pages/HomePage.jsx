import { useState, useEffect } from 'react'
import Sparkline from '../components/Sparkline'
import SearchBar from '../components/SearchBar'
import MarketNewsPanel from '../components/MarketNewsPanel'
import { INDICES, RECENT_IPOS, TRENDING_TICKERS } from '../mockData'

function IndexCard({ idx, onOpenDetail }) {
  const isPos = idx.change >= 0
  const color = isPos ? '#16a34a' : '#dc2626'
  return (
    <button className="index-card" onClick={() => onOpenDetail(idx)}>
      <div className="index-card-top">
        <span className="index-name">{idx.name}</span>
        <span className="index-change" style={{ color }}>{isPos ? '▲' : '▼'} {Math.abs(idx.change).toFixed(2)}%</span>
      </div>
      <div className="index-card-bottom">
        <Sparkline data={idx.sparkData} color={color} width={90} height={34} />
        <span className="index-value">{idx.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
      </div>
    </button>
  )
}

/* ─── Index Detail Modal ──────────────────────────────────── */
function IndexModal({ idx, onClose }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/index/${idx.ticker}/detail`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setDetail(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [idx.ticker])

  const isPos = (detail?.changePct ?? idx.change) >= 0
  const color = isPos ? '#16a34a' : '#dc2626'
  const colorBg = isPos ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)'

  function StatRow({ label, value }) {
    return (
      <div className="idx-modal-row">
        <span className="idx-modal-label">{label}</span>
        <span className="idx-modal-value">{value ?? '—'}</span>
      </div>
    )
  }

  function ReturnBadge({ label, value }) {
    if (value == null) return null
    const pos = value >= 0
    return (
      <div className="idx-return-badge" style={{ color: pos ? '#16a34a' : '#dc2626', background: pos ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)' }}>
        <span className="idx-return-label">{label}</span>
        <span className="idx-return-val">{pos ? '+' : ''}{value.toFixed(2)}%</span>
      </div>
    )
  }

  const fmt = n => n != null ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'

  return (
    <div className="idx-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="idx-modal">
        {/* Header */}
        <div className="idx-modal-header">
          <div>
            <h3 className="idx-modal-title">{detail?.name ?? idx.name}</h3>
            <p className="idx-modal-desc">{detail?.description}</p>
          </div>
          <button className="idx-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Price hero */}
        <div className="idx-modal-price-row">
          <span className="idx-modal-price">
            {fmt(detail?.current ?? idx.value)}
          </span>
          <span className="idx-modal-change" style={{ color, background: colorBg }}>
            {isPos ? '▲' : '▼'} {Math.abs(detail?.changePct ?? idx.change).toFixed(2)}%
            {detail && <span style={{ marginLeft: 6, opacity: 0.8 }}>({isPos ? '+' : ''}{detail.change.toFixed(2)} pts)</span>}
          </span>
        </div>

        {loading && <div className="idx-modal-loading">Loading details…</div>}

        {detail && (
          <>
            {/* Stats grid */}
            <div className="idx-modal-grid">
              <StatRow label="Previous Close" value={fmt(detail.prevClose)} />
              <StatRow label="Day Range"      value={`${fmt(detail.dayLow)} – ${fmt(detail.dayHigh)}`} />
              <StatRow label="52-Week Range"  value={`${fmt(detail.w52Low)} – ${fmt(detail.w52High)}`} />
              <StatRow label="Volume"         value={detail.volume} />
              <StatRow label="Avg Volume"     value={detail.avgVolume} />
            </div>

            {/* Returns */}
            <div className="idx-returns-section">
              <span className="idx-returns-title">Performance</span>
              <div className="idx-returns-row">
                <ReturnBadge label="YTD"   value={detail.ytdReturn} />
                <ReturnBadge label="1 Year" value={detail.oneYrReturn} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function MoverRow({ item, onSelect }) {
  const isPos = item.change >= 0
  return (
    <tr onClick={() => onSelect(item.ticker)} className="mover-row">
      <td><span className="ticker-link">{item.ticker}</span></td>
      <td className="mover-name">{item.name}</td>
      <td className="mover-price">${item.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      <td className="mover-change" style={{ color: isPos ? '#16a34a' : '#dc2626' }}>
        {isPos ? '+' : ''}{item.change.toFixed(2)}%
      </td>
    </tr>
  )
}


export default function HomePage({ onSelectStock, onNavigate, dark }) {
  const [indices,   setIndices]   = useState(INDICES)        // start with mock
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [gainers,   setGainers]   = useState([])
  const [losers,    setLosers]    = useState([])
  const [moversLoad,setMoversLoad]= useState(true)

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const marketNegative = indices.filter(i => i.change < 0).length >= 2

  useEffect(() => {
    let cancelled = false
    const fetchIndices = () => {
      fetch('/api/indices')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => { if (!cancelled && Array.isArray(data) && data.length) setIndices(data) })
        .catch(() => {})
    }
    fetchIndices()
    const interval = setInterval(fetchIndices, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  useEffect(() => {
    let cancelled = false
    const fetchMovers = () => {
      fetch('/api/movers')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
          if (cancelled) return
          if (data.gainers?.length) setGainers(data.gainers)
          if (data.losers?.length)  setLosers(data.losers)
          setMoversLoad(false)
        })
        .catch(() => { if (!cancelled) setMoversLoad(false) })
    }
    fetchMovers()
    const interval = setInterval(fetchMovers, 5 * 60_000)   // refresh every 5 min
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const [ipos,      setIpos]      = useState(RECENT_IPOS)   // start with mock
  const [ipoLoad,   setIpoLoad]   = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/ipo/recent')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setIpos(data)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIpoLoad(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="home-page">
      {/* Market Indices */}
      <section className="indices-section">
        <p className="section-date">Stock Indexes — {today}</p>
        <div className="indices-grid">
          {indices.map(idx => (
            <IndexCard key={idx.ticker} idx={idx} onOpenDetail={setSelectedIndex} />
          ))}
        </div>
      </section>

      {selectedIndex && (
        <IndexModal idx={selectedIndex} onClose={() => setSelectedIndex(null)} />
      )}

      {/* Hero Search */}
      <section className="hero-section">
        <div className="hero-inner">
          <h1 className="hero-title">Find your next investment</h1>
          <p className="hero-sub">Search 200+ stocks, ETFs and funds with real-time price data and analysis tools.</p>
          <div className="hero-search">
            <SearchBar onSelect={onSelectStock} placeholder="Company name or ticker symbol..." size="lg" dark={dark} />
          </div>
          <div className="trending-row">
            <span className="trending-label">Trending:</span>
            {TRENDING_TICKERS.map(t => (
              <button key={t} className="trending-chip" onClick={() => onSelectStock(t)}>{t}</button>
            ))}
          </div>
        </div>
      </section>

      {/* Gainers & Losers */}
      <section className="movers-section">
        <div className="movers-grid">
          {[
            { title: 'Top Gainers', icon: '▲', cls: 'green', rows: gainers },
            { title: 'Top Losers',  icon: '▼', cls: 'red',   rows: losers  },
          ].map(({ title, icon, cls, rows }) => (
            <div key={title} className="movers-card">
              <div className="movers-header">
                <h3 className="movers-title">
                  <span className={`movers-title-icon ${cls}`}>{icon}</span> {title}
                </h3>
                <span className="movers-date">Live · refreshes every 5 min</span>
              </div>
              <table className="movers-table">
                <thead><tr>
                  <th>Symbol</th><th>Name</th><th>Price</th><th>Change</th>
                </tr></thead>
                <tbody>
                  {moversLoad
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} style={{ opacity: 0.4, pointerEvents: 'none' }}>
                          {[50, 160, 70, 60].map((w, j) => (
                            <td key={j}><div style={{ height: 13, width: w, borderRadius: 4, background: 'var(--border2)', animation: 'prof-pulse 1.4s ease-in-out infinite' }} /></td>
                          ))}
                        </tr>
                      ))
                    : rows.map(r => <MoverRow key={r.ticker} item={r} onSelect={onSelectStock} />)
                  }
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      {/* News & IPOs */}
      <section className="bottom-section">
        <div className="bottom-grid">
          {/* News */}
          <MarketNewsPanel limit={6} onMoreNews={() => onNavigate('news')} />

          {/* Recent IPOs */}
          <div className="ipo-card">
            <h3 className="card-section-title">Recent IPOs</h3>
            <table className="ipo-table">
              <thead><tr>
                <th>Date</th><th>Symbol</th><th>Name</th><th>Price</th><th>Return</th>
              </tr></thead>
              <tbody>
                {ipoLoad
                  ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} style={{ opacity: 0.4, pointerEvents: 'none' }}>
                      {[80, 50, 140, 60, 60].map((w, j) => (
                        <td key={j}>
                          <div style={{ height: 12, width: w, borderRadius: 4,
                            background: 'var(--border2)',
                            animation: 'prof-pulse 1.4s ease-in-out infinite' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                  : ipos.map(ipo => {
                    const isPos = ipo.change >= 0
                    return (
                      <tr key={ipo.ticker} className="ipo-row" onClick={() => onSelectStock(ipo.ticker)}>
                        <td className="ipo-date">{ipo.date}</td>
                        <td><span className="ticker-link">{ipo.ticker}</span></td>
                        <td className="ipo-name">{ipo.name}</td>
                        <td>${ipo.price.toFixed(2)}</td>
                        <td style={{ color: isPos ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                          {isPos ? '+' : ''}{ipo.change.toFixed(1)}%
                        </td>
                      </tr>
                    )
                  })
                }
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
