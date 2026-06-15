import { useState, useEffect, useMemo } from 'react'

/* ─── Sector colours ─────────────────────────────────────────── */
const SECTOR_COLORS = {
  'Technology':             '#2563eb',
  'Healthcare':             '#16a34a',
  'Financial Services':     '#d97706',
  'Consumer Cyclical':      '#ea580c',
  'Consumer Defensive':     '#0891b2',
  'Energy':                 '#92400e',
  'Industrials':            '#475569',
  'Basic Materials':        '#65a30d',
  'Real Estate':            '#7c3aed',
  'Utilities':              '#db2777',
  'Communication Services': '#0e7490',
  'Other':                  '#94a3b8',
}

/* ─── Column view tabs ───────────────────────────────────────── */
const VIEWS = {
  General: [
    { key: 'ticker',      label: 'Symbol',     align: 'left',  w: 90  },
    { key: 'name',        label: 'Company',    align: 'left',  w: 200 },
    { key: 'snowflake',   label: '⬡ Score',    align: 'right', w: 100 },
    { key: 'marketCapFmt',label: 'Mkt Cap',    align: 'right', w: 90  },
    { key: 'price',       label: 'Price',      align: 'right', w: 90  },
    { key: 'changePct',   label: '% Chg',      align: 'right', w: 80  },
    { key: 'industry',    label: 'Industry',   align: 'left',  w: 190 },
    { key: 'volume',      label: 'Volume',     align: 'right', w: 90  },
    { key: 'pe',          label: 'P/E',        align: 'right', w: 70  },
  ],
  Performance: [
    { key: 'ticker',      label: 'Symbol',     align: 'left',  w: 90  },
    { key: 'name',        label: 'Company',    align: 'left',  w: 200 },
    { key: 'price',       label: 'Price',      align: 'right', w: 90  },
    { key: 'changePct',   label: '1D %',       align: 'right', w: 80  },
    { key: 'w52Pct',      label: '52W Pos',    align: 'right', w: 120 },
    { key: 'beta',        label: 'Beta',       align: 'right', w: 70  },
    { key: 'avgVolume',   label: 'Avg Vol',    align: 'right', w: 90  },
  ],
  Valuation: [
    { key: 'ticker',      label: 'Symbol',     align: 'left',  w: 90  },
    { key: 'name',        label: 'Company',    align: 'left',  w: 200 },
    { key: 'price',       label: 'Price',      align: 'right', w: 90  },
    { key: 'pe',          label: 'P/E',        align: 'right', w: 70  },
    { key: 'fwdPE',       label: 'Fwd P/E',    align: 'right', w: 80  },
    { key: 'ps',          label: 'P/S',        align: 'right', w: 70  },
    { key: 'pb',          label: 'P/B',        align: 'right', w: 70  },
    { key: 'eps',         label: 'EPS',        align: 'right', w: 80  },
    { key: 'revenue',     label: 'Revenue',    align: 'right', w: 90  },
  ],
  Dividends: [
    { key: 'ticker',      label: 'Symbol',     align: 'left',  w: 90  },
    { key: 'name',        label: 'Company',    align: 'left',  w: 200 },
    { key: 'price',       label: 'Price',      align: 'right', w: 90  },
    { key: 'changePct',   label: '% Chg',      align: 'right', w: 80  },
    { key: 'divYield',    label: 'Div Yield',  align: 'right', w: 90  },
    { key: 'payout',      label: 'Payout %',   align: 'right', w: 90  },
    { key: 'sector',      label: 'Sector',     align: 'left',  w: 160 },
  ],
}

const SECTORS = [
  'Technology','Healthcare','Financial Services','Consumer Cyclical',
  'Consumer Defensive','Energy','Industrials','Basic Materials',
  'Real Estate','Utilities','Communication Services',
]

/* ─── Helpers ────────────────────────────────────────────────── */
function SortArrow({ active, dir }) {
  if (!active) return <span className="scr2-arrow inactive">⇅</span>
  return <span className="scr2-arrow">{dir === 'asc' ? '↑' : '↓'}</span>
}

function W52Bar({ pct }) {
  if (pct == null) return <span className="scr2-muted">—</span>
  const c = pct >= 75 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626'
  return (
    <div className="scr2-w52-wrap">
      <div className="scr2-w52-track">
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: c, borderRadius: 3 }} />
        <div className="scr2-w52-dot" style={{ left: `${Math.min(100, pct)}%`, background: c }} />
      </div>
      <span style={{ color: c, fontSize: 12, fontWeight: 600, minWidth: 34, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
    </div>
  )
}

function CellValue({ col, val, stock }) {
  if (col.key === 'ticker')     return <span className="scr2-ticker">{val}</span>
  if (col.key === 'name')       return <span className="scr2-name">{val}</span>
  if (col.key === 'snowflake')  return <SnowflakeMini sf={stock.snowflake} />

  if (col.key === 'changePct') {
    if (val == null) return <span className="scr2-muted">—</span>
    const pos = val >= 0
    return <span style={{ color: pos ? '#16a34a' : '#dc2626', fontWeight: 600 }}>{pos ? '+' : ''}{val.toFixed(2)}%</span>
  }
  if (col.key === 'price')    return <span className="scr2-num">${val?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</span>
  if (col.key === 'w52Pct')   return <W52Bar pct={val} />
  if (col.key === 'sector') {
    const c = SECTOR_COLORS[val] ?? '#94a3b8'
    return <span className="scr2-sector" style={{ color: c }}>●&nbsp;{val}</span>
  }
  if (col.key === 'industry') return <span className="scr2-industry">{val ?? '—'}</span>
  if (col.key === 'divYield') return val != null ? <span className="scr2-num">{val.toFixed(2)}%</span> : <span className="scr2-muted">—</span>
  if (col.key === 'eps')      return val != null ? <span className="scr2-num">${val}</span> : <span className="scr2-muted">—</span>
  if (val == null || val === '—') return <span className="scr2-muted">—</span>
  return <span className="scr2-num">{val}</span>
}

/* ─── Snowflake mini widget ──────────────────────────────────── */
function SnowflakeMini({ sf }) {
  if (!sf) return <span className="scr2-muted">—</span>
  const total = sf.total ?? 0
  // Color ramp: red → amber → green
  const color = total >= 18 ? '#16a34a' : total >= 12 ? '#d97706' : '#dc2626'
  const axes = [sf.value, sf.profitability, sf.growth, sf.health, sf.efficiency]
  // Tiny SVG pentagon
  const R = 12, cx = 14, cy = 14
  const angles = axes.map((_, i) => (i * 2 * Math.PI / 5) - Math.PI / 2)
  const pts = axes.map((v, i) => {
    const r = (v / 5) * R
    return `${(cx + r * Math.cos(angles[i])).toFixed(1)},${(cy + r * Math.sin(angles[i])).toFixed(1)}`
  }).join(' ')
  const rings = [0.2, 0.4, 0.6, 0.8, 1].map(f => {
    const r = f * R
    return angles.map((a) => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`).join(' ')
  })
  return (
    <div className="scr2-sf-mini">
      <svg width="28" height="28" viewBox="0 0 28 28">
        {rings.map((r, i) => <polygon key={i} points={r} fill="none" stroke="var(--border2)" strokeWidth={0.6} />)}
        <polygon points={pts} fill={`${color}40`} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
      <span className="scr2-sf-total" style={{ color }}>{total}<span style={{ opacity: 0.5, fontSize: 9 }}>/25</span></span>
    </div>
  )
}

/* ─── Screener Page ──────────────────────────────────────────── */
export default function ScreenerPage({ onSelectStock }) {
  const [stocks,      setStocks]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [view,        setView]        = useState('General')
  const [sortKey,     setSortKey]     = useState('marketCap')
  const [sortDir,     setSortDir]     = useState('desc')
  const [search,      setSearch]      = useState('')
  const [showF,       setShowF]       = useState(false)
  const [liveResult,  setLiveResult]  = useState(null)   // on-demand ticker lookup
  const [liveFetching,setLiveFetching]= useState(false)

  // Filters
  const [sector,     setSector]     = useState('')
  const [minPrice,   setMinPrice]   = useState('')
  const [maxPrice,   setMaxPrice]   = useState('')
  const [minCap,     setMinCap]     = useState('')
  const [maxCap,     setMaxCap]     = useState('')
  const [minPE,      setMinPE]      = useState('')
  const [maxPE,      setMaxPE]      = useState('')
  const [minDiv,     setMinDiv]     = useState('')
  const [minChange,  setMinChange]  = useState('')
  const [maxChange,  setMaxChange]  = useState('')
  // Snowflake filters (0–5 per axis, 0–25 total)
  const [sfTotal,    setSfTotal]    = useState('')
  const [sfVal,      setSfVal]      = useState('')
  const [sfProf,     setSfProf]     = useState('')
  const [sfGrow,     setSfGrow]     = useState('')
  const [sfHealth,   setSfHealth]   = useState('')
  const [sfEff,      setSfEff]      = useState('')

  useEffect(() => {
    let cancelled = false
    let timer = null

    function poll() {
      fetch('/api/screener')
        .then(r => r.ok ? r.json() : [])
        .then(d => {
          if (cancelled) return
          if (d && d.length > 0) {
            setStocks(d)
            setLoading(false)
          } else {
            // Still building on the backend — poll again in 10 s
            timer = setTimeout(poll, 10_000)
          }
        })
        .catch(() => {
          if (!cancelled) timer = setTimeout(poll, 10_000)
        })
    }

    poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  // On-demand lookup: when user types a clean ticker that's NOT already in
  // the cached list, fetch it live from /api/screener/ticker/:tk
  useEffect(() => {
    const q = search.trim().toUpperCase()
    // Only attempt if it looks like a ticker (1-5 uppercase letters)
    if (!q || q.length > 5 || !/^[A-Z]{1,5}$/.test(q)) {
      setLiveResult(null)
      return
    }
    // Already in cached list?
    if (stocks.some(s => s.ticker === q)) {
      setLiveResult(null)
      return
    }
    setLiveFetching(true)
    setLiveResult(null)
    const ctrl = new AbortController()
    fetch(`/api/screener/ticker/${q}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setLiveResult(d); setLiveFetching(false) })
      .catch(() => setLiveFetching(false))
    return () => ctrl.abort()
  }, [search, stocks])

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'ticker' || key === 'name' || key === 'industry' ? 'asc' : 'desc') }
  }

  function clearFilters() {
    setSector(''); setMinPrice(''); setMaxPrice('')
    setMinCap(''); setMaxCap(''); setMinPE(''); setMaxPE('')
    setMinDiv(''); setMinChange(''); setMaxChange('')
    setSfTotal(''); setSfVal(''); setSfProf(''); setSfGrow(''); setSfHealth(''); setSfEff('')
  }

  const activeFilterCount = [sector, minPrice, maxPrice, minCap, maxCap, minPE, maxPE, minDiv, minChange, maxChange, sfTotal, sfVal, sfProf, sfGrow, sfHealth, sfEff].filter(Boolean).length

  const filtered = useMemo(() => {
    // Start from cached stocks, optionally prepend on-demand live result
    let base = [...stocks]
    if (liveResult && !base.some(s => s.ticker === liveResult.ticker)) {
      base = [liveResult, ...base]
    }

    let list = base
    if (search)      list = list.filter(s => s.ticker.includes(search.toUpperCase()) || s.name.toLowerCase().includes(search.toLowerCase()))
    if (sector)      list = list.filter(s => s.sector === sector)
    if (minPrice)    list = list.filter(s => s.price  >= +minPrice)
    if (maxPrice)    list = list.filter(s => s.price  <= +maxPrice)
    if (minCap)      list = list.filter(s => s.marketCap && s.marketCap >= +minCap * 1e9)
    if (maxCap)      list = list.filter(s => s.marketCap && s.marketCap <= +maxCap * 1e9)
    if (minPE)       list = list.filter(s => s.pe != null && s.pe >= +minPE)
    if (maxPE)       list = list.filter(s => s.pe != null && s.pe <= +maxPE)
    if (minDiv)      list = list.filter(s => s.divYield != null && s.divYield >= +minDiv)
    if (minChange !== '') list = list.filter(s => s.changePct >= +minChange)
    if (maxChange !== '') list = list.filter(s => s.changePct <= +maxChange)
    // Snowflake filters
    if (sfTotal)  list = list.filter(s => s.snowflake && s.snowflake.total        >= +sfTotal)
    if (sfVal)    list = list.filter(s => s.snowflake && s.snowflake.value        >= +sfVal)
    if (sfProf)   list = list.filter(s => s.snowflake && s.snowflake.profitability>= +sfProf)
    if (sfGrow)   list = list.filter(s => s.snowflake && s.snowflake.growth       >= +sfGrow)
    if (sfHealth) list = list.filter(s => s.snowflake && s.snowflake.health       >= +sfHealth)
    if (sfEff)    list = list.filter(s => s.snowflake && s.snowflake.efficiency   >= +sfEff)

    list.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1; if (bv == null) return -1
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return list
  }, [stocks, liveResult, search, sector, minPrice, maxPrice, minCap, maxCap, minPE, maxPE, minDiv, minChange, maxChange, sfTotal, sfVal, sfProf, sfGrow, sfHealth, sfEff, sortKey, sortDir])

  const cols = VIEWS[view]

  return (
    <div className="scr2-page">

      {/* ── Top bar ── */}
      <div className="scr2-topbar">
        <div className="scr2-topbar-left">
          <h1 className="scr2-title">Stock Screener</h1>
          {!loading && <span className="scr2-count">{filtered.length.toLocaleString()} stocks</span>}
          {liveFetching && <span className="scr2-live-badge">Fetching…</span>}
        </div>
        <div className="scr2-topbar-right">
          <div className="scr2-search-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              className="scr2-search"
              placeholder="Find by symbol or name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && <button className="scr2-search-clear" onClick={() => setSearch('')}>✕</button>}
          </div>
          <button
            className={`scr2-filter-btn ${showF ? 'active' : ''}`}
            onClick={() => setShowF(v => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
            Filters
            {activeFilterCount > 0 && <span className="scr2-badge">{activeFilterCount}</span>}
          </button>
        </div>
      </div>

      {/* ── Filter panel ── */}
      {showF && (
        <div className="scr2-filter-panel">
          {/* Standard filters */}
          <div className="scr2-filter-grid">
            <label>Sector
              <select value={sector} onChange={e => setSector(e.target.value)}>
                <option value="">All</option>
                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>Price ($)
              <div className="scr2-range"><input type="number" placeholder="Min" value={minPrice} onChange={e => setMinPrice(e.target.value)} /><span>–</span><input type="number" placeholder="Max" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} /></div>
            </label>
            <label>Market Cap ($B)
              <div className="scr2-range"><input type="number" placeholder="Min" value={minCap} onChange={e => setMinCap(e.target.value)} /><span>–</span><input type="number" placeholder="Max" value={maxCap} onChange={e => setMaxCap(e.target.value)} /></div>
            </label>
            <label>P/E Ratio
              <div className="scr2-range"><input type="number" placeholder="Min" value={minPE} onChange={e => setMinPE(e.target.value)} /><span>–</span><input type="number" placeholder="Max" value={maxPE} onChange={e => setMaxPE(e.target.value)} /></div>
            </label>
            <label>Change % Today
              <div className="scr2-range"><input type="number" placeholder="Min" value={minChange} onChange={e => setMinChange(e.target.value)} /><span>–</span><input type="number" placeholder="Max" value={maxChange} onChange={e => setMaxChange(e.target.value)} /></div>
            </label>
            <label>Min Dividend %
              <input type="number" placeholder="e.g. 2" value={minDiv} onChange={e => setMinDiv(e.target.value)} />
            </label>
          </div>

          {/* Snowflake filters */}
          <div className="scr2-sf-section">
            <div className="scr2-sf-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              <span>Snowflake Score Filters <em>(min score out of 5 per axis, 25 total)</em></span>
            </div>
            <div className="scr2-sf-grid">
              <label>Total Score (/25)
                <select value={sfTotal} onChange={e => setSfTotal(e.target.value)}>
                  <option value="">Any</option>
                  {[5,10,12,15,17,20].map(n => <option key={n} value={n}>≥ {n}</option>)}
                </select>
              </label>
              <label>Valuation (/5)
                <select value={sfVal} onChange={e => setSfVal(e.target.value)}>
                  <option value="">Any</option>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>≥ {n}</option>)}
                </select>
              </label>
              <label>Profitability (/5)
                <select value={sfProf} onChange={e => setSfProf(e.target.value)}>
                  <option value="">Any</option>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>≥ {n}</option>)}
                </select>
              </label>
              <label>Growth (/5)
                <select value={sfGrow} onChange={e => setSfGrow(e.target.value)}>
                  <option value="">Any</option>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>≥ {n}</option>)}
                </select>
              </label>
              <label>Health (/5)
                <select value={sfHealth} onChange={e => setSfHealth(e.target.value)}>
                  <option value="">Any</option>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>≥ {n}</option>)}
                </select>
              </label>
              <label>Efficiency (/5)
                <select value={sfEff} onChange={e => setSfEff(e.target.value)}>
                  <option value="">Any</option>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>≥ {n}</option>)}
                </select>
              </label>
            </div>
          </div>

          {activeFilterCount > 0 && (
            <button className="scr2-clear-btn" onClick={clearFilters}>✕ Clear all filters</button>
          )}
        </div>
      )}

      {/* ── View tabs ── */}
      <div className="scr2-view-tabs">
        {Object.keys(VIEWS).map(v => (
          <button key={v} className={`scr2-view-tab ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>{v}</button>
        ))}
      </div>

      {/* ── Table ── */}
      <div className="scr2-table-wrap">
        {loading ? (
          <div className="scr2-loading">
            <div className="scr2-spinner" />
            <div className="scr2-loading-text">Loading stocks from FMP…</div>
            <div className="scr2-loading-sub">Fetching price, ratios &amp; fundamentals · First load takes ~90 s · cached 4 hours</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="scr2-empty">No stocks match your filters.</div>
        ) : (
          <table className="scr2-table">
            <thead>
              <tr className="scr2-thead-row">
                <th className="scr2-th scr2-th-num" style={{ width: 44 }}>#</th>
                {cols.map(col => (
                  <th
                    key={col.key}
                    className={`scr2-th ${col.align === 'right' ? 'scr2-th-num' : ''} ${sortKey === col.key ? 'sorted' : ''}`}
                    style={{ minWidth: col.w }}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label} <SortArrow active={sortKey === col.key} dir={sortDir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr key={s.ticker} className="scr2-row" onClick={() => onSelectStock(s.ticker)}>
                  <td className="scr2-td scr2-td-idx">{i + 1}</td>
                  {cols.map(col => (
                    <td key={col.key} className={`scr2-td ${col.align === 'right' ? 'scr2-td-r' : ''}`}>
                      <CellValue col={col} val={s[col.key]} stock={s} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
