export default function UpgradeBanner({ onUpgrade }) {
  return (
    <div className="upgrade-banner">
      <div className="upgrade-banner-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <div className="upgrade-banner-text">
        <p className="upgrade-banner-title">Pro feature</p>
        <p className="upgrade-banner-desc">Upgrade to StockView Pro to unlock this tab and all advanced analysis.</p>
      </div>
      <button className="upgrade-banner-btn" onClick={onUpgrade}>
        Upgrade to Pro →
      </button>
    </div>
  )
}
