import { describe, test, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from '../AppShell'

describe('AccessibilityShell', () => {
  test('exposes navigation as a landmark region', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    const nav = screen.getByRole('navigation')
    expect(nav).toBeInTheDocument()
    expect(nav).toHaveAttribute('aria-label', 'Main navigation')
  })

  test('exposes main content as a landmark region', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    const main = screen.getByRole('main')
    expect(main).toBeInTheDocument()
  })

  test('provides a live status region for keyboard-accessible announcements', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    const statusRegion = screen.getByRole('status')
    expect(statusRegion).toBeInTheDocument()
    expect(statusRegion).toHaveAttribute('aria-live', 'polite')
    expect(statusRegion).toHaveAttribute('aria-atomic', 'true')
  })

  test('all critical navigation items are keyboard accessible via tab order — Dashboard and Settings only', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    const links = screen.getAllByRole('link')
    const criticalLabels = ['Dashboard', 'Settings']

    criticalLabels.forEach(label => {
      const link = links.find(l => l.textContent === label)
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href')
      expect(link).not.toHaveAttribute('tabindex', '-1')
    })

    // Legacy labels must not appear
    const legacyLabels = ['Overview', 'Accounts', 'Configuration', 'Operations']
    legacyLabels.forEach(label => {
      const legacyLink = links.find(l => l.textContent === label)
      expect(legacyLink).toBeUndefined()
    })
  })

  test('active route is communicated to assistive technology', () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    const settingsLink = screen.getByRole('link', { name: /settings/i })
    expect(settingsLink).toHaveAttribute('aria-current', 'page')
  })

  test('navigation links have visible focus indicators', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    const links = screen.getAllByRole('link')
    links.forEach(link => {
      // Focus-visible outline is applied via CSS; verify the element can receive focus
      expect(link).not.toHaveAttribute('tabindex', '-1')
      expect(link).toBeVisible()
    })
  })

  test('includes a mobile-responsive navigation toggle', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    const toggle = screen.getByRole('button', { name: /toggle navigation/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded')
    expect(toggle).toHaveAttribute('aria-controls')
  })

  test('critical actions remain discoverable with feature flags enabled — Dashboard and Settings only', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: true }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument()

    // Antigravity belongs under Settings; must NOT appear as a top-level nav destination
    expect(screen.queryByRole('link', { name: /antigravity/i })).not.toBeInTheDocument()

    // Legacy routes must not appear
    expect(screen.queryByRole('link', { name: /^overview$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^accounts$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^configuration$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^operations$/i })).not.toBeInTheDocument()
  })

  test('enforces dark color scheme for consistent theming', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    const shell = document.querySelector('.app-shell')
    expect(shell).toHaveStyle('color-scheme: dark')
  })

  test('mobile menu opens with toggle click and closes with Escape key', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    const toggle = screen.getByRole('button', { name: /toggle navigation/i })
    const navList = document.getElementById('app-nav-menu')

    // Menu starts closed
    expect(navList).not.toHaveClass('open')

    // Click toggle to open
    fireEvent.click(toggle)
    expect(navList).toHaveClass('open')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // Press Escape to close
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
    expect(navList).not.toHaveClass('open')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('mobile menu closes when a navigation link is activated', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    const toggle = screen.getByRole('button', { name: /toggle navigation/i })
    const navList = document.getElementById('app-nav-menu')
    const settingsLink = screen.getByRole('link', { name: /settings/i })

    // Open menu
    fireEvent.click(toggle)
    expect(navList).toHaveClass('open')

    // Click a nav link
    fireEvent.click(settingsLink)
    expect(navList).not.toHaveClass('open')
  })

  test('status region announces messages for assistive technology', () => {
    const { rerender } = render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    const statusRegion = screen.getByRole('status')
    expect(statusRegion).toBeInTheDocument()

    // Re-render with a status message
    rerender(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }} statusMessage="Sync completed">
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    expect(statusRegion).toHaveTextContent('Sync completed')
  })
})
