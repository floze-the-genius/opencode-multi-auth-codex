import { useState, useEffect, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import type { FeatureFlags } from '../types/api'
import './AppShell.css'

export interface AppShellProps {
  children: ReactNode
  featureFlags: FeatureFlags
  statusMessage?: string
}

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/settings', label: 'Settings' }
]

export function AppShell({ children, statusMessage }: AppShellProps): JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && mobileOpen) {
        setMobileOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [mobileOpen])

  const handleLinkClick = () => {
    if (mobileOpen) {
      setMobileOpen(false)
    }
  }

  return (
    <div className="app-shell" style={{ colorScheme: 'dark' }}>
      <nav className="app-nav" aria-label="Main navigation">
        <div className="app-nav-brand">Codex Token Dashboard</div>
        <button
          type="button"
          className="app-nav-toggle"
          aria-label="Toggle navigation"
          aria-expanded={mobileOpen}
          aria-controls="app-nav-menu"
          onClick={() => setMobileOpen(prev => !prev)}
        >
          <span className="app-nav-toggle-bar" aria-hidden="true" />
          <span className="app-nav-toggle-bar" aria-hidden="true" />
          <span className="app-nav-toggle-bar" aria-hidden="true" />
        </button>
        <ul
          id="app-nav-menu"
          className={`app-nav-list${mobileOpen ? ' open' : ''}`}
        >
          {navItems.map(item => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  isActive ? 'app-nav-link active' : 'app-nav-link'
                }
                end={item.to === '/'}
                onClick={handleLinkClick}
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {mobileOpen && (
        <div
          className="app-nav-backdrop"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <main className="app-main">{children}</main>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="app-status-region"
      >
        {statusMessage}
      </div>
    </div>
  )
}
