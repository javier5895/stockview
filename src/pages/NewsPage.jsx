import { useState } from 'react'
import { NewsItem, useMarketNews } from '../components/MarketNewsPanel'

const CATEGORIES = ['All', 'Economy', 'Markets', 'Technology', 'Finance', 'Commodities', 'Crypto', 'Autos']

const CATEGORY_COLOR = '#3b82f6'

function SkeletonRow({ isLast }) {
  return (
    <div className="news-item" style={{ borderBottom: isLast ? 'none' : undefined, pointerEvents: 'none' }}>
      <span className="news-age" style={{ background: 'var(--border2)', color: 'transparent',
        borderRadius: 4, animation: 'prof-pulse 1.4s ease-in-out infinite' }}>00m</span>
      <div className="news-body" style={{ gap: 6 }}>
        <div style={{ height: 14, borderRadius: 4, background: 'var(--border2)', width: '80%',
          animation: 'prof-pulse 1.4s ease-in-out infinite' }} />
        <div style={{ height: 11, borderRadius: 4, background: 'var(--border2)', width: '35%',
          animation: 'prof-pulse 1.4s ease-in-out infinite' }} />
      </div>
    </div>
  )
}

export default function NewsPage() {
  const { news, loading, error } = useMarketNews()
  const [activeCategory, setActiveCategory] = useState('All')

  const filtered = activeCategory === 'All'
    ? news
    : news.filter(n => n.category === activeCategory)

  // Only show categories that have at least one article
  const availableCategories = CATEGORIES.filter(c =>
    c === 'All' || news.some(n => n.category === c)
  )

  return (
    <div className="home-page">
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 24px 40px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          margin: '32px 0 20px' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>
            Market News
          </h2>
          {!loading && !error && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {filtered.length} article{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Category filter chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {availableCategories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '5px 14px',
                borderRadius: 20,
                border: `1.5px solid ${activeCategory === cat ? CATEGORY_COLOR : 'var(--border)'}`,
                background: activeCategory === cat ? CATEGORY_COLOR : 'transparent',
                color: activeCategory === cat ? '#fff' : 'var(--text-muted)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* News list */}
        <div className="card news-panel">
          {loading && Array.from({ length: 12 }).map((_, i) => (
            <SkeletonRow key={i} isLast={i === 11} />
          ))}

          {error && (
            <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 14 }}>
              Unable to load news. Check your connection.
            </p>
          )}

          {!loading && !error && filtered.length === 0 && (
            <p style={{ padding: 20, color: 'var(--text-muted)', fontSize: 14 }}>
              No {activeCategory !== 'All' ? activeCategory.toLowerCase() + ' ' : ''}news available right now.
            </p>
          )}

          {!loading && !error && filtered.map((item, i) => (
            <NewsItem key={i} item={item} isLast={i === filtered.length - 1} />
          ))}
        </div>

        {/* Footer */}
        {!loading && !error && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 16 }}>
            Powered by Financial Modeling Prep · Updated every 5 minutes
          </p>
        )}
      </div>
    </div>
  )
}
