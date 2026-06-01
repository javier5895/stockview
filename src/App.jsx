import { useState } from 'react'
import SearchBar from './components/SearchBar'
import HomePage from './pages/HomePage'
import StockPage from './pages/StockPage'
import './App.css'

/* ─── Icons ─────────────────────────────────────────────────── */
function Icon({ path, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  )
}

const NAV_ITEMS = [
  { id: 'home',     label: 'Home',          icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  { id: 'trending', label: 'Trending',      icon: 'M23 6 13.5 15.5 8.5 10.5 1 18 M17 6h6v6', disabled: true },
  { id: 'news',     label: 'News',          icon: 'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2 M18 14h-8 M15 18h-5 M10 6h8v4h-8z', disabled: true },
  { id: 'movers',   label: 'Market Movers', icon: 'M22 12h-4l-3 9L9 3l-3 9H2', disabled: true },
  { id: 'screener', label: 'Screener',      icon: 'M4 6h16M8 12h8m-6 6h4', disabled: true },
  { id: 'watchlist',label: 'Watchlist',     icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z', disabled: true },
  { id: 'ipo',      label: 'IPO Calendar',  icon: 'M8 2v4 M16 2v4 M3 10h18 M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', disabled: true },
]

function SunIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
}
function MoonIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
}

/* ─── App ────────────────────────────────────────────────────── */
export default function App() {
  const [dark, setDark] = useState(false)
  const [page, setPage] = useState('home')
  const [ticker, setTicker] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  function navigate(t) {
    setTicker(t)
    setPage('stock')
    setSidebarOpen(false)
  }

  function goHome() { setPage('home') }

  return (
    <div className={`app ${dark ? 'dark' : 'light'}`}>

      {/* ── Top Nav ── */}
      <header className="topnav">
        <div className="topnav-left">
          <button className="hamburger" onClick={() => setSidebarOpen(o => !o)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <button className="nav-brand" onClick={goHome}>
            <div className="nav-logo">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
            <span className="nav-title">StockView</span>
          </button>
        </div>

        <div className="topnav-search">
          <SearchBar onSelect={navigate} dark={dark} size="sm" />
        </div>

        <div className="topnav-right">
          <button className="theme-toggle" onClick={() => setDark(d => !d)}>
            {dark ? <SunIcon /> : <MoonIcon />}
            <span>{dark ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="app-body">

        {/* Sidebar overlay (mobile) */}
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

        {/* Sidebar */}
        <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-inner">
            {NAV_ITEMS.map((item, i) => {
              const active = (item.id === 'home' && page === 'home') || (item.id === page)
              return (
                <button
                  key={item.id}
                  className={`sidebar-item ${active ? 'active' : ''} ${item.disabled ? 'si-disabled' : ''}`}
                  onClick={() => {
                    if (item.disabled) return
                    if (item.id === 'home') goHome()
                    setSidebarOpen(false)
                  }}
                  title={item.disabled ? 'Coming soon' : item.label}
                >
                  {i === 5 && <div className="sidebar-divider" />}
                  <span className="si-icon"><Icon path={item.icon} /></span>
                  <span className="si-label">{item.label}</span>
                  {item.disabled && <span className="si-tag">Soon</span>}
                </button>
              )
            })}
          </div>
        </nav>

        {/* Main Content */}
        <main className="content">
          {page === 'home'
            ? <HomePage onSelectStock={navigate} dark={dark} />
            : <StockPage ticker={ticker} dark={dark} onBack={goHome} onNavigate={navigate} />
          }
        </main>
      </div>
    </div>
  )
}
