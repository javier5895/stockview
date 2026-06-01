import { useState, useEffect, useRef } from 'react'
import { searchCompanies, COMPANIES } from '../mockData'

// Local lookup for enriching EDGAR results with exchange + sector metadata
const LOCAL_META = {}
COMPANIES.forEach(c => { LOCAL_META[c.ticker] = c })

const SECTOR_COLORS = {
  'Technology': '#2563eb',
  'Financial Services': '#7c3aed',
  'Healthcare': '#059669',
  'Energy': '#d97706',
  'Consumer Cyclical': '#db2777',
  'Consumer Defensive': '#0891b2',
  'Communication Services': '#7c3aed',
  'Industrials': '#4b5563',
  'Real Estate': '#92400e',
  'Basic Materials': '#065f46',
  'Utilities': '#0369a1',
  'ETF': '#1d4ed8',
}

export default function SearchBar({ onSelect, placeholder = 'Search companies and tickers...', size = 'sm', dark }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 1) { setResults([]); setOpen(false); return }

    // 200 ms debounce — avoids a fetch on every keystroke
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`
        )
        if (!res.ok) throw new Error('search failed')
        const raw = await res.json()
        // Enrich EDGAR results with exchange / sector from local metadata where available
        const enriched = raw.map(c => ({
          ...c,
          exchange: LOCAL_META[c.ticker]?.exchange ?? null,
          sector:   LOCAL_META[c.ticker]?.sector   ?? null,
        }))
        setResults(enriched)
        setOpen(enriched.length > 0)
      } catch {
        // Backend unreachable — fall back to local curated list
        const found = searchCompanies(trimmed)
        setResults(found)
        setOpen(found.length > 0)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleSelect(ticker) {
    setQuery('')
    setOpen(false)
    onSelect(ticker)
  }

  const isLg = size === 'lg'

  return (
    <div ref={ref} className={`search-bar ${size} ${focused ? 'focused' : ''}`}>
      <div className="search-input-row">
        <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className="search-input"
          autoComplete="off"
          spellCheck="false"
        />
        {query && (
          <button className="search-clear" onClick={() => { setQuery(''); setOpen(false) }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
        {isLg && !query && (
          <kbd className="search-kbd">/</kbd>
        )}
      </div>

      {open && (
        <div className="search-dropdown">
          {results.map((c, i) => (
            <button
              key={c.ticker}
              className="search-result"
              onMouseDown={e => { e.preventDefault(); handleSelect(c.ticker) }}
            >
              <span
                className="res-ticker"
                style={{ background: `${SECTOR_COLORS[c.sector] ?? '#2563eb'}18`, color: SECTOR_COLORS[c.sector] ?? '#2563eb' }}
              >
                {c.ticker}
              </span>
              <span className="res-name">{c.name}</span>
              {c.exchange && <span className="res-exchange">{c.exchange}</span>}
              {c.sector   && <span className="res-sector">{c.sector}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
