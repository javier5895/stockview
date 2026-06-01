import Sparkline from '../components/Sparkline'
import SearchBar from '../components/SearchBar'
import { INDICES, GAINERS, LOSERS, NEWS, RECENT_IPOS, TRENDING_TICKERS } from '../mockData'

function IndexCard({ idx, dark, onSelect }) {
  const isPos = idx.change >= 0
  const color = isPos ? '#16a34a' : '#dc2626'
  return (
    <button className="index-card" onClick={() => onSelect && onSelect(idx.ticker)}>
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

const QUICK_LINKS = [
  { label: 'Watchlist',     icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>, color:'#f59e0b', disabled:true },
  { label: 'Screener',      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>, color:'#2563eb', disabled:true },
  { label: 'Market Movers', icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>, color:'#16a34a', disabled:true },
  { label: 'Market Map',    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>, color:'#7c3aed', disabled:true },
  { label: 'IPO Calendar',  icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>, color:'#0891b2', disabled:true },
  { label: 'Portfolio',     icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>, color:'#db2777', disabled:true },
]

export default function HomePage({ onSelectStock, dark }) {
  const today = 'May 27, 2026'
  const marketNegative = INDICES.filter(i => i.change < 0).length >= 2

  return (
    <div className="home-page">
      {/* Market Indices */}
      <section className="indices-section">
        <p className="section-date">Stock Indexes — {today}</p>
        <div className="indices-grid">
          {INDICES.map(idx => (
            <IndexCard key={idx.ticker} idx={idx} dark={dark} />
          ))}
        </div>
      </section>

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

      {/* Quick Links */}
      <section className="quicklinks-section">
        <div className="quicklinks-grid">
          {QUICK_LINKS.map(ql => (
            <button key={ql.label} className={`quicklink-card ${ql.disabled ? 'ql-disabled' : ''}`} disabled={ql.disabled}>
              <span className="ql-icon" style={{ color: ql.color, background: `${ql.color}15` }}>{ql.icon}</span>
              <span className="ql-label">{ql.label}</span>
              {ql.disabled && <span className="ql-soon">Soon</span>}
            </button>
          ))}
        </div>
      </section>

      {/* Gainers & Losers */}
      <section className="movers-section">
        <div className="movers-grid">
          <div className="movers-card">
            <div className="movers-header">
              <h3 className="movers-title">
                <span className="movers-title-icon green">▲</span> Top Gainers
              </h3>
              <span className="movers-date">Updated {today}</span>
            </div>
            <table className="movers-table">
              <thead><tr>
                <th>Symbol</th><th>Name</th><th>Price</th><th>Change</th>
              </tr></thead>
              <tbody>
                {GAINERS.map(g => <MoverRow key={g.ticker} item={g} onSelect={onSelectStock} />)}
              </tbody>
            </table>
          </div>

          <div className="movers-card">
            <div className="movers-header">
              <h3 className="movers-title">
                <span className="movers-title-icon red">▼</span> Top Losers
              </h3>
              <span className="movers-date">Updated {today}</span>
            </div>
            <table className="movers-table">
              <thead><tr>
                <th>Symbol</th><th>Name</th><th>Price</th><th>Change</th>
              </tr></thead>
              <tbody>
                {LOSERS.map(l => <MoverRow key={l.ticker} item={l} onSelect={onSelectStock} />)}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* News & IPOs */}
      <section className="bottom-section">
        <div className="bottom-grid">
          {/* News */}
          <div className="news-card">
            <h3 className="card-section-title">Market News</h3>
            <div className="news-list">
              {NEWS.map(n => (
                <div key={n.id} className="news-item">
                  <span className="news-time">{n.time}</span>
                  <div className="news-body">
                    <p className="news-headline">{n.headline}</p>
                    <span className="news-meta">{n.source} · <span className="news-cat">{n.category}</span></span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent IPOs */}
          <div className="ipo-card">
            <h3 className="card-section-title">Recent IPOs</h3>
            <table className="ipo-table">
              <thead><tr>
                <th>Date</th><th>Symbol</th><th>Name</th><th>Price</th><th>Return</th>
              </tr></thead>
              <tbody>
                {RECENT_IPOS.map(ipo => {
                  const isPos = ipo.change >= 0
                  return (
                    <tr key={ipo.ticker} className="ipo-row" onClick={() => onSelectStock(ipo.ticker)}>
                      <td className="ipo-date">{ipo.date}</td>
                      <td><span className="ticker-link">{ipo.ticker}</span></td>
                      <td className="ipo-name">{ipo.name}</td>
                      <td>${ipo.price.toFixed(2)}</td>
                      <td style={{ color: isPos ? '#16a34a' : '#dc2626', fontWeight:600 }}>
                        {isPos ? '+' : ''}{ipo.change.toFixed(1)}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
