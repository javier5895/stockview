import { useState, useEffect } from 'react'
import SearchBar from './components/SearchBar'
import UserMenu from './components/UserMenu'
import HomePage from './pages/HomePage'
import StockPage from './pages/StockPage'
import NewsPage from './pages/NewsPage'
import AuthPage from './pages/AuthPage'
import ProfilePage from './pages/ProfilePage'
import WatchlistPage from './pages/WatchlistPage'
import EconomicsPage from './pages/EconomicsPage'
import SectorPage from './pages/SectorPage'
import IndicesPage from './pages/IndicesPage'
import { onAuthChange, completeMagicLink, logOut } from './lib/firebase'
import { subscribeFavorites } from './lib/favorites'
import { subscribeSubscription } from './lib/subscription'
import PricingModal from './components/PricingModal'
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
  { id: 'home',       label: 'Home',       icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  { id: 'news',       label: 'News',       icon: 'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2 M18 14h-8 M15 18h-5 M10 6h8v4h-8z' },
  { id: 'economics',  label: 'Calendars',  icon: 'M2 20h20M6 20V10M12 20V4M18 20v-6' },
  { id: 'sectors',    label: 'Sectors',    icon: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z' },
  { id: 'indices',    label: 'Markets',    icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z' },
  { id: 'watchlist',  label: 'Watchlist',  icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' },
]

function SunIcon()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> }
function MoonIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg> }

/* ─── App ────────────────────────────────────────────────────── */
export default function App() {
  const [theme,       setTheme]       = useState('ssga')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Restore page/ticker from URL hash on first load
  function parseHash() {
    const hash = window.location.hash.slice(1) // e.g. "stock/AAPL" or "news"
    if (!hash || hash === 'billing-success' || hash === 'billing-cancel') return { page: 'home', ticker: null }
    const [p, t] = hash.split('/')
    return { page: p || 'home', ticker: t || null }
  }
  const initial = parseHash()
  const [page,   setPage]   = useState(initial.page)
  const [ticker, setTicker] = useState(initial.ticker)

  // Auth state
  const [user,         setUser]         = useState(undefined)  // undefined = loading
  const [favorites,    setFavorites]    = useState(new Set())
  const [favMap,       setFavMap]       = useState({})
  const [subscription, setSubscription] = useState({ status: 'free', planId: null, customerId: null })
  const [showPricing,  setShowPricing]  = useState(false)

  // Handle billing redirect hash
  useEffect(() => {
    const hash = window.location.hash
    if (hash === '#billing-success') {
      window.location.hash = ''
      setShowPricing(false)
    } else if (hash === '#billing-cancel') {
      window.location.hash = ''
    }
  }, [])

  // 1. Listen for auth changes
  useEffect(() => {
    // Complete magic link sign-in if URL contains it
    completeMagicLink().catch(() => {})

    const unsub = onAuthChange(u => {
      setUser(u ?? null)
    })
    return unsub
  }, [])

  // 2. Subscribe to favorites + subscription when user logs in
  useEffect(() => {
    if (!user) {
      setFavorites(new Set()); setFavMap({})
      setSubscription({ status: 'free', planId: null, customerId: null })
      return
    }
    const unsubSub = subscribeSubscription(user.uid, s => setSubscription(s))
    return unsubSub
  }, [user])

  useEffect(() => {
    if (!user) { setFavorites(new Set()); setFavMap({}); return }
    const unsub = subscribeFavorites(user.uid, ({ map, set }) => {
      setFavMap(map)
      setFavorites(set)
    })
    return unsub
  }, [user])

  const PAGES = ['news', 'economics', 'sectors', 'indices', 'watchlist']

  function navigate(t) {
    if (PAGES.includes(t)) {
      setPage(t)
      window.location.hash = t
      setSidebarOpen(false)
      return
    }
    setTicker(t)
    setPage('stock')
    window.location.hash = `stock/${t}`
    setSidebarOpen(false)
  }

  function goHome() {
    setPage('home')
    window.location.hash = ''
  }

  const [showAuth,    setShowAuth]    = useState(false)
  const [showProfile, setShowProfile] = useState(false)

  // Close auth modal after successful login
  useEffect(() => {
    if (user) setShowAuth(false)
  }, [user])

  const dark = theme === 'dark'

  function cycleTheme() {
    setTheme(t => t === 'dark' ? 'ssga' : 'dark')
  }

  return (
    <div className={`app ${theme}`}>

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
          <button className="theme-toggle" onClick={cycleTheme}>
            {theme === 'dark' ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg> : <MoonIcon />}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          {/* UserMenu only visible on desktop; login moved into sidebar */}
          {user && <UserMenu user={user} onOpenProfile={() => setShowProfile(true)} />}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="app-body">
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

        <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-inner">
            {NAV_ITEMS.map((item, i) => {
              const active = (item.id === 'home' && page === 'home') || (item.id === page)
              const isWatchlist = item.id === 'watchlist'
              return (
                <div key={item.id}>
                  <button
                    className={`sidebar-item ${active ? 'active' : ''} ${item.disabled ? 'si-disabled' : ''}`}
                    onClick={() => {
                      if (item.disabled) return
                      if (item.id === 'home') goHome()
                      else navigate(item.id)
                      setSidebarOpen(false)
                    }}
                    title={item.disabled ? 'Coming soon' : item.label}
                  >
                    <span className="si-icon"><Icon path={item.icon} /></span>
                    <span className="si-label">{item.label}</span>
                    {item.disabled && <span className="si-tag">Soon</span>}
                    {isWatchlist && favorites.size > 0 && (
                      <span className="si-badge">{favorites.size}</span>
                    )}
                  </button>
                </div>
              )
            })}

            {/* ── Auth section at bottom of sidebar ── */}
            <div className="sidebar-auth">
            <div className="sidebar-divider" />
            {user ? (
              <div className="sidebar-user" style={{ cursor: 'pointer' }}
                onClick={() => { setShowProfile(true); setSidebarOpen(false) }}>
                {user.photoURL
                  ? <img src={user.photoURL} alt="" className="sidebar-avatar-img" />
                  : <div className="sidebar-avatar-initials">
                      {(user.displayName || user.email || '?')[0].toUpperCase()}
                    </div>
                }
                <div className="sidebar-user-info">
                  <span className="sidebar-user-name">{user.displayName || 'Account'}</span>
                  <span className="sidebar-user-email">{user.email}</span>
                </div>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0 }}>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </div>
            ) : (
              <button
                className="sidebar-login-btn"
                onClick={() => { setShowAuth(true); setSidebarOpen(false) }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                  <polyline points="10 17 15 12 10 7"/>
                  <line x1="15" y1="12" x2="3" y2="12"/>
                </svg>
                <span>Log In</span>
              </button>
            )}
            </div>
          </div>
        </nav>

        <main className="content">
          {page === 'home'
            ? <HomePage onSelectStock={navigate} onNavigate={navigate} dark={dark} />
            : page === 'news'
            ? <NewsPage />
            : page === 'economics'
            ? <EconomicsPage dark={dark} />
            : page === 'sectors'
            ? <SectorPage dark={dark} />
            : page === 'indices'
            ? <IndicesPage dark={dark} />
            : page === 'watchlist'
            ? <WatchlistPage favMap={favMap} user={user} onSelect={navigate} />
            : <StockPage
                ticker={ticker}
                dark={dark}
                onBack={goHome}
                onNavigate={navigate}
                user={user}
                favorites={favorites}
                subscription={subscription}
                onUpgrade={() => setShowPricing(true)}
              />
          }
        </main>
      </div>

      {/* Auth modal */}
      {showAuth && (
        <div className="auth-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowAuth(false) }}>
          <div className="auth-modal-box">
            <button className="auth-modal-close" onClick={() => setShowAuth(false)}>✕</button>
            <AuthPage dark={dark} />
          </div>
        </div>
      )}

      {showProfile && user && (
        <ProfilePage
          user={user}
          theme={theme}
          cycleTheme={cycleTheme}
          onClose={() => setShowProfile(false)}
          subscription={subscription}
          onUpgrade={() => { setShowProfile(false); setShowPricing(true) }}
        />
      )}

      {showPricing && (
        <PricingModal
          user={user}
          subscription={subscription}
          onClose={() => setShowPricing(false)}
        />
      )}
    </div>
  )
}

