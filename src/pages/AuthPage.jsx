import { useState } from 'react'
import {
  signInEmail, signUpEmail, signInGoogle,
  resetPassword, sendMagicLink,
} from '../lib/firebase'

/* ─── Icons ─────────────────────────────────────────────────── */
function EyeOff() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}
function Eye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}
function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48">
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v8.51h12.84c-.57 2.91-2.24 5.38-4.72 7.02v5.81h7.64c4.46-4.1 7.22-10.15 7.22-16.79z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.64-5.81c-2.16 1.45-4.93 2.3-8.25 2.3-6.34 0-11.71-4.28-13.63-10.03H2.46v6.01C6.41 42.65 14.59 48 24 48z"/>
      <path fill="#FBBC05" d="M10.37 28.65A14.98 14.98 0 0 1 9.6 24c0-1.62.28-3.19.77-4.65v-6.01H2.46A24.01 24.01 0 0 0 0 24c0 3.88.93 7.56 2.46 10.66l7.91-6.01z"/>
      <path fill="#EA4335" d="M24 9.52c3.56 0 6.76 1.22 9.28 3.63l6.93-6.93C35.9 2.38 30.46 0 24 0 14.59 0 6.41 5.35 2.46 13.34l7.91 6.01C12.29 13.8 17.66 9.52 24 9.52z"/>
    </svg>
  )
}
function MailIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
    </svg>
  )
}
function LogoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  )
}

/* ─── Auth Page ──────────────────────────────────────────────── */
export default function AuthPage({ dark }) {
  const [mode,      setMode]      = useState('login')   // 'login' | 'signup'
  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [showPw,    setShowPw]    = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [info,      setInfo]      = useState('')

  function reset() { setError(''); setInfo('') }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); reset()
    try {
      if (mode === 'login') {
        await signInEmail(email, password)
      } else {
        await signUpEmail(email, password)
        setInfo('Account created! You are now logged in.')
      }
    } catch (err) {
      setError(friendlyError(err.code))
    }
    setLoading(false)
  }

  async function handleGoogle() {
    setLoading(true); reset()
    try { await signInGoogle() }
    catch (err) { if (err.code !== 'auth/popup-closed-by-user') setError(friendlyError(err.code)) }
    setLoading(false)
  }

  async function handleMagicLink() {
    if (!email) { setError('Enter your email above first.'); return }
    setLoading(true); reset()
    try {
      await sendMagicLink(email)
      setInfo(`Magic link sent to ${email}. Check your inbox!`)
    } catch (err) { setError(friendlyError(err.code)) }
    setLoading(false)
  }

  async function handleForgot() {
    if (!email) { setError('Enter your email above first.'); return }
    setLoading(true); reset()
    try {
      await resetPassword(email)
      setInfo(`Password reset email sent to ${email}.`)
    } catch (err) { setError(friendlyError(err.code)) }
    setLoading(false)
  }

  return (
    <div>
      <div className="auth-card" style={{ boxShadow: 'none', border: 'none', padding: '8px 0 0' }}>

        {/* Logo */}
        <div className="auth-logo">
          <span className="auth-logo-icon"><LogoIcon /></span>
          <span className="auth-logo-text">StockView</span>
        </div>

        {/* Tabs */}
        <div className="auth-tabs">
          <button className={`auth-tab ${mode === 'login'  ? 'active' : ''}`}
            onClick={() => { setMode('login');  reset() }}>Log In</button>
          <button className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => { setMode('signup'); reset() }}>Sign Up</button>
        </div>

        {/* Email + Password form */}
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label">Email address</label>
            <input
              className="auth-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-field">
            <label className="auth-label">Password</label>
            <div className="auth-pw-wrap">
              <input
                className="auth-input"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              <button type="button" className="auth-pw-eye" onClick={() => setShowPw(v => !v)}>
                {showPw ? <Eye /> : <EyeOff />}
              </button>
            </div>
          </div>

          {error && <p className="auth-error">{error}</p>}
          {info  && <p className="auth-info">{info}</p>}

          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading ? 'Please wait…' : (mode === 'login' ? 'Log In' : 'Create Account')}
          </button>
        </form>

        {mode === 'login' && (
          <button className="auth-forgot" onClick={handleForgot}>Forgot password?</button>
        )}

        <div className="auth-divider"><span>or</span></div>

        {/* Social buttons */}
        <button className="auth-social-btn" onClick={handleGoogle} disabled={loading}>
          <GoogleIcon />
          <span>Continue with Google</span>
        </button>

        <button className="auth-social-btn auth-social-btn--disabled" disabled title="Coming soon — requires Apple Developer account">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
          </svg>
          <span>Sign in with Apple</span>
          <span className="auth-social-soon">Soon</span>
        </button>

        <button className="auth-social-btn" onClick={handleMagicLink} disabled={loading}>
          <MailIcon />
          <span>Sign in with email code</span>
        </button>

        {/* Switch mode link */}
        <p className="auth-switch">
          {mode === 'login'
            ? <>Don't have an account? <button onClick={() => { setMode('signup'); reset() }}>Sign up</button></>
            : <>Already have an account? <button onClick={() => { setMode('login'); reset() }}>Log in</button></>
          }
        </p>
      </div>
    </div>
  )
}

function friendlyError(code) {
  const map = {
    'auth/invalid-email':            'Invalid email address.',
    'auth/user-not-found':           'No account found with this email.',
    'auth/wrong-password':           'Incorrect password.',
    'auth/invalid-credential':       'Incorrect email or password.',
    'auth/email-already-in-use':     'An account with this email already exists.',
    'auth/weak-password':            'Password must be at least 6 characters.',
    'auth/too-many-requests':        'Too many attempts. Please try again later.',
    'auth/network-request-failed':   'Network error. Check your connection.',
  }
  return map[code] ?? 'Something went wrong. Please try again.'
}
