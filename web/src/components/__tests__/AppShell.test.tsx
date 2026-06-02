import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from '../AppShell'

// Hoisted mock for useDashboardState used by the full App redirect tests
vi.mock('../../hooks/useDashboardState', () => ({
  useDashboardState: vi.fn()
}))

describe('AppShell', () => {
  test('renders navigation areas for Dashboard and Settings only', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    // Only Dashboard and Settings are primary destinations
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument()

    // Legacy routes must NOT appear as primary top-level destinations
    expect(screen.queryByRole('link', { name: /^overview$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^accounts$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^configuration$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^operations$/i })).not.toBeInTheDocument()
  })

  test('does not render Antigravity as a top-level navigation item when feature flag is enabled', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: true }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    // Antigravity belongs under Settings; it must NOT appear as a primary nav destination
    expect(screen.queryByRole('link', { name: /antigravity/i })).not.toBeInTheDocument()
  })

  test('hides Antigravity navigation when feature flag is disabled', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    expect(screen.queryByRole('link', { name: /antigravity/i })).not.toBeInTheDocument()
  })

  test('highlights the active navigation route', () => {
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

  test('renders children content', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div data-testid="child-content">Child Content</div>
        </AppShell>
      </MemoryRouter>
    )

    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  test('does not render command search trigger in header', () => {
    render(
      <MemoryRouter>
        <AppShell featureFlags={{ antigravityEnabled: false }}>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    )

    // Explicit navigation shows Dashboard and Settings
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument()

    // Command search trigger removed from header
    expect(screen.queryByRole('button', { name: /open command search/i })).not.toBeInTheDocument()
  })
})

describe('App legacy route redirects', () => {
  // Build a minimal DashboardState for the mock
  function buildUseDashboardStateResult(overrides: Partial<{ antigravityEnabled: boolean }> = {}) {
    return {
      data: {
        authPath: '/fake/path',
        deviceAlias: null,
        rotationAlias: null,
        accounts: [],
        lastSyncAt: 0,
        lastSyncError: null,
        lastSyncAlias: null,
        authSummary: { hasAccessToken: false, hasIdToken: false, hasRefreshToken: false },
        storeStatus: { locked: false, encrypted: false },
        login: null,
        lastLoginError: null,
        antigravity: { accounts: [], path: '/fake/antigravity.json' },
        queue: null,
        recommendedAlias: null,
        logPath: '/fake/log',
        autoLogin: { path: '', scriptPath: '', pythonPath: '', configured: false, accounts: [] },
        rotationStrategy: 'round-robin',
        force: { active: false, alias: null, forcedUntil: null, forcedBy: null, remainingMs: 0, remainingTime: '', previousRotationStrategy: null },
        featureFlags: { antigravityEnabled: overrides.antigravityEnabled ?? false }
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      error: null
    }
  }

  async function renderAppAt(initialRoute: string, antigravityEnabled = false) {
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { App } = await import('../../App')

    // Set up the mock return value for this test
    const { useDashboardState } = await import('../../hooks/useDashboardState')
    const mockFn = vi.mocked(useDashboardState) as ReturnType<typeof vi.fn>
    mockFn.mockReturnValue(buildUseDashboardStateResult({ antigravityEnabled }))

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialRoute]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  test('legacy /accounts redirects to / (canonical Dashboard)', async () => {
    await renderAppAt('/accounts')

    // After redirect to /, the Dashboard nav link must be the active page
    const dashboardLink = screen.getByRole('link', { name: /dashboard/i })
    expect(dashboardLink).toHaveAttribute('aria-current', 'page')
  })

  test('legacy /operations redirects to / (canonical Dashboard)', async () => {
    await renderAppAt('/operations')

    const dashboardLink = screen.getByRole('link', { name: /dashboard/i })
    expect(dashboardLink).toHaveAttribute('aria-current', 'page')
  })

  test('legacy /configuration redirects to /settings', async () => {
    await renderAppAt('/configuration')

    const settingsLink = screen.getByRole('link', { name: /settings/i })
    expect(settingsLink).toHaveAttribute('aria-current', 'page')
  })

  test('legacy /antigravity redirects to /settings when feature is disabled', async () => {
    await renderAppAt('/antigravity', false)

    // With antigravity disabled, it should redirect to /settings
    const settingsLink = screen.getByRole('link', { name: /settings/i })
    expect(settingsLink).toHaveAttribute('aria-current', 'page')
  })

  test('legacy /antigravity redirects to /settings/antigravity when feature is enabled', async () => {
    await renderAppAt('/antigravity', true)

    // With antigravity enabled, redirect targets /settings/antigravity.
    // Settings NavLink matches as prefix (no "end" prop), so it should be active.
    const settingsLink = screen.getByRole('link', { name: /^settings$/i })
    expect(settingsLink).toHaveAttribute('aria-current', 'page')

    // Antigravity must NOT appear as a top-level nav destination;
    // it is only discoverable through the Settings page and command palette
    expect(screen.queryByRole('link', { name: /^antigravity$/i })).not.toBeInTheDocument()
  })

  test('canonical / route renders content without redirect', async () => {
    await renderAppAt('/')

    const dashboardLink = screen.getByRole('link', { name: /^dashboard$/i })
    expect(dashboardLink).toHaveAttribute('aria-current', 'page')

    // The brand element "Codex Token Dashboard" and the nav link are both present
    expect(screen.getByText(/codex token dashboard/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^dashboard$/i })).toBeInTheDocument()
  })
})
