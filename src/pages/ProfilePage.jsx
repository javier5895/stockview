import { useState } from 'react'
import { logOut, updateUserPassword } from '../lib/firebase'

function Avatar({ user, size = 64 }) {
  const initials = user.displayName
    ? user.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : (user.email?.[0] ?? '?').toUpperCase()

  if (user.photoURL) {
    return <img src={user.photoURL} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: '#3b82f6', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.35, fontWeight: 700, flexShrink: 0,
    }}>{initials}</div>
  )
}

function Section({ title, children }) {
  return (
    <div className="prof-page-section">
      <h2 className="prof-page-section-title">{title}</h2>
      <div className="prof-page-section-body">{children}</div>
    </div>
  )
}

export default function ProfilePage({ user, onClose, cycleTheme, theme }) {
  const [pwState, setPwState] = useState('idle') // idle | form | loading | success | error
  const [pw, setPw]     = useState('')
  const [pw2, setPw2]   = useState('')
  const [pwErr, setPwErr] = useState('')

  const displayName = user.displayName || user.email?.split('@')[0] || 'User'

  const registeredDate = user.metadata?.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—'

  async function handlePasswordUpdate(e) {
    e.preventDefault()
    setPwErr('')
    if (pw.length < 6) { setPwErr('Password must be at least 6 characters.'); return }
    if (pw !== pw2)    { setPwErr('Passwords do not match.'); return }
    setPwState('loading')
    try {
      await updateUserPassword(pw)
      setPwState('success')
      setPw(''); setPw2('')
    } catch (err) {
      setPwErr(err.message || 'Failed to update password.')
      setPwState('form')
    }
  }

  return (
    <div className="auth-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="prof-page-modal">
        <button className="auth-modal-close" onClick={onClose}>✕</button>

        {/* Header */}
        <div className="prof-page-header">
          <Avatar user={user} size={60} />
          <div>
            <div className="prof-page-name">{displayName}</div>
            <div className="prof-page-email">{user.email}</div>
          </div>
        </div>

        <div className="prof-page-divider" />

        {/* Preferences */}
        <Section title="Preferences">
          <div className="prof-page-row">
            <span className="prof-page-label">Site Theme</span>
            <div className="prof-page-theme-btns">
              <button
                className={`prof-page-theme-btn ${theme === 'ssga' ? 'active' : ''}`}
                onClick={() => { if (theme !== 'ssga') cycleTheme() }}
              >
                ☀ Light
              </button>
              <button
                className={`prof-page-theme-btn ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => { if (theme !== 'dark') cycleTheme() }}
              >
                ☽ Dark
              </button>
            </div>
          </div>
        </Section>

        {/* User Information */}
        <Section title="User Information">
          <div className="prof-page-info-row">
            <span className="prof-page-info-label">Email</span>
            <span className="prof-page-info-value">{user.email}</span>
          </div>
          <div className="prof-page-info-row">
            <span className="prof-page-info-label">Registered Date</span>
            <span className="prof-page-info-value">{registeredDate}</span>
          </div>

          {pwState === 'idle' && (
            <button className="prof-page-link-btn" onClick={() => setPwState('form')}>
              Update Password
            </button>
          )}

          {(pwState === 'form' || pwState === 'loading' || pwState === 'error') && (
            <form className="prof-page-pw-form" onSubmit={handlePasswordUpdate}>
              <input
                type="password" placeholder="New password"
                value={pw} onChange={e => setPw(e.target.value)}
                className="prof-page-pw-input"
              />
              <input
                type="password" placeholder="Confirm new password"
                value={pw2} onChange={e => setPw2(e.target.value)}
                className="prof-page-pw-input"
              />
              {pwErr && <div className="prof-page-pw-err">{pwErr}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="submit" className="prof-page-pw-save" disabled={pwState === 'loading'}>
                  {pwState === 'loading' ? 'Saving…' : 'Save Password'}
                </button>
                <button type="button" className="prof-page-pw-cancel" onClick={() => { setPwState('idle'); setPwErr(''); setPw(''); setPw2('') }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {pwState === 'success' && (
            <div className="prof-page-pw-success">
              ✓ Password updated successfully.
              <button className="prof-page-link-btn" style={{ marginLeft: 12 }} onClick={() => setPwState('idle')}>Done</button>
            </div>
          )}
        </Section>

        {/* Sign out */}
        <div style={{ padding: '0 0 4px' }}>
          <button className="prof-page-signout" onClick={() => { logOut(); onClose() }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}
