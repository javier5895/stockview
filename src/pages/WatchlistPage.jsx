import { useState, useEffect } from 'react'
import { removeFavorite } from '../lib/favorites'

/* ─── Icons ──────────────────────────────────────────────────── */
function StarFilled() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  )
}

/* ─── Skeleton ───────────────────────────────────────────────── */
function SkeletonCell({ w = 60 }) {
  return (
    <div style={{ width: w, height: 13, borderRadius: 4, background: 'var(--border2)', animation: 'prof-pulse 1.4s ease-in-out infinite' }} />
  )
}

/* ─── Stock Row ──────────────────────────────────────────────── */
function StockRow({ ticker, name, onSelect, onRemove }) {
  const [quote, setQuote] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/stock/${ticker}/quote`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setQuote(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [ticker])

  const isPos = (quote?.changePct ?? 0) >= 0
  const changeColor = isPos ? '#16a34a' : '#dc2626'

  return (
    <div className="wl-row">
      {/* Stock name – clickable */}
      <button className="wl-cell wl-cell-name" onClick={() => onSelect(ticker)}>
        <span className="wl-ticker">{ticker}</span>
        <span className="wl-name">{name}</span>
      </button>

      {/* Price */}
      <div className="wl-cell wl-cell-num">
        {loading ? <SkeletonCell w={70} /> : (
          <span className="wl-price">
            {quote ? `$${quote.currentPrice?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
          </span>
        )}
      </div>

      {/* Change % */}
      <div className="wl-cell wl-cell-num">
        {loading ? <SkeletonCell w={52} /> : (
          <span className="wl-change" style={{ color: changeColor }}>
            {quote ? `${isPos ? '+' : ''}${quote.changePct?.toFixed(2)}%` : '—'}
          </span>
        )}
      </div>

      {/* P/E */}
      <div className="wl-cell wl-cell-num wl-hide-sm">
        {loading ? <SkeletonCell w={44} /> : (
          <span className="wl-stat">{quote?.pe ?? '—'}</span>
        )}
      </div>

      {/* Market Cap */}
      <div className="wl-cell wl-cell-num wl-hide-md">
        {loading ? <SkeletonCell w={58} /> : (
          <span className="wl-stat">{quote?.marketCap ?? '—'}</span>
        )}
      </div>

      {/* Volume */}
      <div className="wl-cell wl-cell-num wl-hide-md">
        {loading ? <SkeletonCell w={54} /> : (
          <span className="wl-stat">{quote?.volume ?? '—'}</span>
        )}
      </div>

      {/* Earnings Date */}
      <div className="wl-cell wl-cell-num wl-hide-sm">
        {loading ? <SkeletonCell w={56} /> : (
          <span className="wl-stat">{quote?.earningsDate ?? '—'}</span>
        )}
      </div>

      {/* Remove */}
      <button
        className="wl-remove-btn"
        title="Remove from watchlist"
        onClick={() => onRemove(ticker)}
      >
        <StarFilled />
      </button>
    </div>
  )
}

/* ─── Watchlist Page ─────────────────────────────────────────── */
export default function WatchlistPage({ favMap, user, onSelect }) {
  const entries = Object.values(favMap).sort((a, b) =>
    (a.addedAt?.seconds ?? 0) - (b.addedAt?.seconds ?? 0)
  )

  function handleRemove(ticker) {
    if (user) removeFavorite(user.uid, ticker)
  }

  return (
    <div className="wl-page">
      <div className="wl-container">

        <div className="wl-page-header">
          <h2 className="wl-page-title">My Watchlist</h2>
          {entries.length > 0 && (
            <span className="wl-page-count">{entries.length} stock{entries.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {!user ? (
          <div className="card wl-empty">
            <p className="wl-empty-icon">☆</p>
            <p className="wl-empty-title">Sign in to use your watchlist</p>
            <p className="wl-empty-sub">Log in to save and track your favorite stocks.</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="card wl-empty">
            <p className="wl-empty-icon">☆</p>
            <p className="wl-empty-title">No favorites yet</p>
            <p className="wl-empty-sub">Open any stock and click the ☆ star to add it here.</p>
          </div>
        ) : (
          <div className="card wl-list">
            {/* Table header */}
            <div className="wl-thead">
              <div className="wl-cell wl-cell-name">Stock</div>
              <div className="wl-cell wl-cell-num">Price</div>
              <div className="wl-cell wl-cell-num">Change</div>
              <div className="wl-cell wl-cell-num wl-hide-sm">P/E</div>
              <div className="wl-cell wl-cell-num wl-hide-md">Mkt Cap</div>
              <div className="wl-cell wl-cell-num wl-hide-md">Volume</div>
              <div className="wl-cell wl-cell-num wl-hide-sm">Earnings</div>
              <div style={{ width: 40 }} />
            </div>

            {entries.map(({ ticker, name }) => (
              <StockRow
                key={ticker}
                ticker={ticker}
                name={name}
                onSelect={onSelect}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
