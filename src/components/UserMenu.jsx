import { useState, useRef, useEffect } from 'react'
import { logOut } from '../lib/firebase'

export default function UserMenu({ user, onOpenProfile }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const initials = user.displayName
    ? user.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : (user.email?.[0] ?? '?').toUpperCase()

  const displayName = user.displayName || user.email?.split('@')[0] || 'User'

  return (
    <div className="user-menu-wrap" ref={ref}>
      <button className="user-avatar-btn" onClick={() => { onOpenProfile?.(); setOpen(false) }}>
        {user.photoURL
          ? <img src={user.photoURL} alt={displayName} className="user-avatar-img" />
          : <span className="user-avatar-initials">{initials}</span>
        }
      </button>

      {open && (
        <div className="user-menu-dropdown">
          <div className="user-menu-header">
            <p className="user-menu-name">{displayName}</p>
            <p className="user-menu-email">{user.email}</p>
          </div>
          <div className="user-menu-divider" />
          <button className="user-menu-item" onClick={() => { setOpen(false); logOut() }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
