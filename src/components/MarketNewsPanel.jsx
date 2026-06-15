import { useState, useEffect } from 'react'

const CATEGORY_COLORS = {
  Economy:     '#3b82f6',
  Technology:  '#3b82f6',
  Markets:     '#3b82f6',
  Commodities: '#3b82f6',
  Crypto:      '#3b82f6',
  Autos:       '#3b82f6',
  Finance:     '#3b82f6',
}

export function NewsItem({ item, isLast }) {
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="news-item"
      style={{ borderBottom: isLast ? 'none' : undefined }}
    >
      <span className="news-age">{item.age}</span>
      <div className="news-body">
        <div className="news-item-inner">
          <div className="news-text">
            <p className="news-title">{item.title}</p>
            <p className="news-meta">
              <span className="news-source">{item.source}</span>
              <span className="news-dot"> · </span>
              <span className="news-category" style={{ color: CATEGORY_COLORS[item.category] ?? '#3b82f6' }}>
                {item.category}
              </span>
              {item.tickers?.length > 0 && (
                <>
                  <span className="news-dot"> · </span>
                  {item.tickers.map(t => (
                    <span key={t} className="news-ticker">{t}</span>
                  ))}
                </>
              )}
            </p>
          </div>
          {item.image && (
            <img
              src={item.image}
              alt=""
              className="news-thumb"
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
          )}
        </div>
      </div>
    </a>
  )
}

function SkeletonItem({ isLast }) {
  return (
    <div className="news-item" style={{ borderBottom: isLast ? 'none' : undefined, pointerEvents: 'none' }}>
      <span className="news-age" style={{ background: 'var(--border2)', color: 'transparent', borderRadius: 4,
        animation: 'prof-pulse 1.4s ease-in-out infinite' }}>00m</span>
      <div className="news-body" style={{ gap: 6 }}>
        <div style={{ height: 14, borderRadius: 4, background: 'var(--border2)', width: '85%',
          animation: 'prof-pulse 1.4s ease-in-out infinite' }} />
        <div style={{ height: 11, borderRadius: 4, background: 'var(--border2)', width: '40%',
          animation: 'prof-pulse 1.4s ease-in-out infinite' }} />
      </div>
    </div>
  )
}

// Shared fetch hook — exported so NewsPage can reuse it
export function useMarketNews() {
  const [news,    setNews]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)

    fetch('/api/news/market')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (!cancelled) {
          setNews(Array.isArray(data) ? data : [])
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) { setError(true); setLoading(false) }
      })

    return () => { cancelled = true }
  }, [])

  return { news, loading, error }
}

// limit = how many to show (default all); onMoreNews = callback for "More News" button
export default function MarketNewsPanel({ limit, onMoreNews }) {
  const { news, loading, error } = useMarketNews()
  const displayed = limit ? news.slice(0, limit) : news
  const skeletonCount = limit ?? 6

  return (
    <div className="card news-panel">
      <h3 className="news-panel-title">Market News</h3>

      {loading && Array.from({ length: skeletonCount }).map((_, i) => (
        <SkeletonItem key={i} isLast={i === skeletonCount - 1} />
      ))}

      {error && (
        <p style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 14 }}>
          Unable to load news. Check your connection.
        </p>
      )}

      {!loading && !error && displayed.length === 0 && (
        <p style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 14 }}>
          No news available right now.
        </p>
      )}

      {!loading && !error && displayed.map((item, i) => (
        <NewsItem key={i} item={item} isLast={i === displayed.length - 1 && !onMoreNews} />
      ))}

      {!loading && !error && onMoreNews && (
        <button className="news-more-btn" onClick={onMoreNews}>
          More News →
        </button>
      )}
    </div>
  )
}
