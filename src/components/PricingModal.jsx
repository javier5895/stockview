import { useState } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

const PLANS = [
  {
    id: 'monthly',
    label: 'Monthly',
    price: '$9',
    period: '/mo',
    priceEnv: import.meta.env.VITE_STRIPE_PRICE_MONTHLY,
    desc: 'Billed monthly. Cancel anytime.',
  },
  {
    id: 'annual',
    label: 'Annual',
    price: '$79',
    period: '/yr',
    priceEnv: import.meta.env.VITE_STRIPE_PRICE_ANNUAL,
    desc: 'Save 27% vs monthly. Billed once a year.',
    badge: 'Best value',
  },
]

const FEATURES = [
  { label: 'All analysis tabs',         free: false, pro: true },
  { label: 'Revenue segments',          free: false, pro: true },
  { label: 'Profitability & ROIC gauges', free: false, pro: true },
  { label: 'Growth & Efficiency panels', free: false, pro: true },
  { label: 'Debt / Equity history',     free: false, pro: true },
  { label: 'Summary & Financials',      free: true,  pro: true },
  { label: 'Stock chart',               free: true,  pro: true },
  { label: 'Watchlist',                 free: true,  pro: true },
  { label: 'Markets & Sectors pages',   free: true,  pro: true },
]

function Check({ yes }) {
  if (yes) return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

export default function PricingModal({ user, subscription, onClose }) {
  const [selected, setSelected] = useState('annual')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  const isActive = subscription?.status === 'active'
  const plan = PLANS.find(p => p.id === selected)

  async function handleSubscribe() {
    if (!user) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/billing/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid:        user.uid,
          email:      user.email,
          priceId:    plan.priceEnv,
          customerId: subscription?.customerId ?? null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).detail ?? 'Error')
      const { url } = await res.json()
      window.location.href = url
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  async function handlePortal() {
    if (!subscription?.customerId) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/billing/customer-portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: subscription.customerId }),
      })
      if (!res.ok) throw new Error((await res.json()).detail ?? 'Error')
      const { url } = await res.json()
      window.location.href = url
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="pricing-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pricing-modal">
        <button className="pricing-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div className="pricing-badge">StockView Pro</div>
        <h2 className="pricing-title">Unlock full analysis</h2>
        <p className="pricing-sub">Get access to all tabs, metrics, and historical data.</p>

        {/* Feature comparison */}
        <div className="pricing-features">
          <div className="pricing-feat-head">
            <span />
            <span className="pricing-col-label">Free</span>
            <span className="pricing-col-label pro">Pro</span>
          </div>
          {FEATURES.map(f => (
            <div key={f.label} className="pricing-feat-row">
              <span className="pricing-feat-label">{f.label}</span>
              <span className="pricing-feat-check"><Check yes={f.free} /></span>
              <span className="pricing-feat-check"><Check yes={f.pro} /></span>
            </div>
          ))}
        </div>

        {isActive ? (
          <div className="pricing-active-section">
            <div className="pricing-active-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Pro plan active
            </div>
            <button className="pricing-portal-btn" onClick={handlePortal} disabled={loading}>
              {loading ? 'Loading…' : 'Manage subscription →'}
            </button>
          </div>
        ) : (
          <>
            {/* Plan toggle */}
            <div className="pricing-plan-toggle">
              {PLANS.map(p => (
                <button key={p.id}
                  className={`pricing-plan-btn ${selected === p.id ? 'active' : ''}`}
                  onClick={() => setSelected(p.id)}>
                  {p.badge && <span className="pricing-plan-badge">{p.badge}</span>}
                  <span className="pricing-plan-label">{p.label}</span>
                  <span className="pricing-plan-price">{p.price}<span className="pricing-plan-period">{p.period}</span></span>
                </button>
              ))}
            </div>
            <p className="pricing-plan-desc">{plan.desc}</p>

            {!user ? (
              <p className="pricing-login-note">Sign in first to subscribe.</p>
            ) : (
              <button className="pricing-cta" onClick={handleSubscribe} disabled={loading || !plan.priceEnv}>
                {loading ? 'Redirecting…' : `Start Pro — ${plan.price}${plan.period}`}
              </button>
            )}
            {!plan.priceEnv && (
              <p className="pricing-login-note" style={{ color: '#f59e0b' }}>Stripe price IDs not configured yet.</p>
            )}
          </>
        )}

        {error && <p className="pricing-error">{error}</p>}
        <p className="pricing-terms">Payments powered by Stripe. Cancel anytime.</p>
      </div>
    </div>
  )
}
