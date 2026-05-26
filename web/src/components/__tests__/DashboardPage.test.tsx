import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from '../DashboardPage'
import { NotificationProvider, useNotification } from '../../hooks/useNotification'
import type { DashboardState, LogsResponse, ForceState } from '../../types/api'

const mockState: DashboardState = {
  authPath: '/auth.json',
  deviceAlias: 'test-device',
  rotationAlias: 'alpha',
  accounts: [
    {
      alias: 'alpha',
      email: 'alpha@example.com',
      enabled: true,
      usageCount: 3,
      source: 'opencode',
      tags: ['core'],
      notes: 'primary account',
      rateLimits: {
        fiveHour: { limit: 100, remaining: 80, resetAt: Date.now() + 60_000, updatedAt: Date.now() },
        weekly: { limit: 1000, remaining: 700, resetAt: Date.now() + 120_000, updatedAt: Date.now() }
      },
      limitsConfidence: 'fresh'
    },
    {
      alias: 'beta',
      email: 'beta@example.com',
      enabled: false,
      usageCount: 7,
      source: 'codex',
      tags: ['backup'],
      notes: 'secondary account',
      rateLimits: {
        fiveHour: { limit: 100, remaining: 50, resetAt: Date.now() + 60_000, updatedAt: Date.now() },
        weekly: { limit: 1000, remaining: 450, resetAt: Date.now() + 120_000, updatedAt: Date.now() }
      },
      limitsConfidence: 'stale'
    }
  ],
  lastSyncAt: Date.now(),
  lastSyncError: null,
  lastSyncAlias: 'alpha',
  authSummary: { hasAccessToken: true, hasIdToken: true, hasRefreshToken: true },
  storeStatus: { locked: false, encrypted: true, error: null },
  login: null,
  lastLoginError: null,
  antigravity: { accounts: [], path: '' },
  queue: null,
  recommendedAlias: 'alpha',
  logPath: '/logs',
  autoLogin: {
    path: '/auto-login.json',
    scriptPath: '/script.py',
    pythonPath: '/python',
    configured: true,
    accounts: [
      { alias: 'auto1', email: 'auto1@example.com', enabled: true }
    ]
  },
  rotationStrategy: 'round-robin',
  force: {
    active: false,
    alias: null,
    forcedAt: null,
    forcedUntil: null,
    forcedBy: null,
    remainingMs: 0,
    remainingTime: '0s',
    previousRotationStrategy: null
  },
  featureFlags: { antigravityEnabled: false }
}

const mockForceState: ForceState = {
  active: false,
  alias: null,
  forcedAt: null,
  forcedUntil: null,
  forcedBy: null,
  remainingMs: 0,
  remainingTime: '0s',
  previousRotationStrategy: null
}

const mockLogs: LogsResponse = {
  path: '/logs/app.log',
  lines: [
    { time: '2024-01-01T00:00:00.000Z', level: 'INFO', message: 'Server started' },
    { time: '2024-01-01T00:01:00.000Z', level: 'WARN', message: 'Rate limit approaching' }
  ]
}

function setupFetchMock(stateOverrides?: Partial<DashboardState>) {
  const state = { ...mockState, ...stateOverrides }

  vi.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/api/logs')) {
      return Promise.resolve(
        new Response(JSON.stringify(mockLogs), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    }
    if (url.includes('/api/force')) {
      return Promise.resolve(
        new Response(JSON.stringify(mockForceState), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify(state), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  })
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
      mutations: { retry: false }
    }
  })

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <NotificationProvider>{children}</NotificationProvider>
        </QueryClientProvider>
      </MemoryRouter>
    )
  }
}

function NotificationProbe() {
  const { notifications } = useNotification()
  return (
    <div data-testid="notification-probe">
      {notifications.map((notification) => (
        <div key={notification.id}>{notification.message}</div>
      ))}
    </div>
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // --- Shell and structure ---

  test('renders the dashboard shell with correct surface attribute', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      const container = screen.getByTestId('dashboard-shell')
      expect(container).toBeInTheDocument()
      expect(container).toHaveAttribute('data-dashboard-surface', 'dashboard')
    })
  })

  test('does not render region tabs', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-shell')).toBeInTheDocument()
    })

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /overview/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /accounts/i })).not.toBeInTheDocument()
  })

  // --- Health Summary ---

  test('renders health summary with account count', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    // "2" appears in both DashboardPage health and OverviewPage meta cards
    await waitFor(() => {
      const elements = screen.getAllByText('2')
      expect(elements.length).toBeGreaterThanOrEqual(1)
    })

    // "Accounts" appears in health summary and insights
    const accountsElements = screen.getAllByText(/accounts/i)
    expect(accountsElements.length).toBeGreaterThanOrEqual(1)
  })

  test('renders health summary with device alias', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      const elements = screen.getAllByText('test-device')
      expect(elements.length).toBeGreaterThanOrEqual(1)
    })
  })

  test('renders health summary with store status', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      const elements = screen.getAllByText(/encrypted/i)
      expect(elements.length).toBeGreaterThanOrEqual(1)
    })
  })

  // --- System Notices ---

  test('shows login progress when login is active', async () => {
    setupFetchMock({
      login: {
        alias: 'gamma',
        email: 'gamma@example.com',
        startedAt: Date.now(),
        mode: 'manual',
        status: 'running',
        step: 'Waiting for callback',
        output: ['Opening browser'],
        url: 'https://example.com/auth'
      }
    })

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // Login progress is shown at DashboardPage top-level (single source, not duplicate)
      const elements = screen.getAllByText(/login in progress for/i)
      expect(elements.length).toBe(1)
    })

    const gammaElements = screen.getAllByText('gamma')
    expect(gammaElements.length).toBe(1)
  })

  test('shows sync error notice when present', async () => {
    setupFetchMock({
      lastSyncError: 'Sync failed: network timeout'
    })

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // Sync error is shown at DashboardPage top-level and also in Overview anomalies
      const elements = screen.getAllByText(/sync failed:/i)
      expect(elements.length).toBeGreaterThanOrEqual(1)
    })
  })

  // --- Quick Actions ---

  test('renders consolidated quick action buttons', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    // DashboardPage renders quick actions at its top level (single canonical source)
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: /sync auth\.json/i })
      expect(buttons.length).toBe(1)
    })

    const refreshTokensButtons = screen.getAllByRole('button', { name: /refresh tokens/i })
    expect(refreshTokensButtons.length).toBe(1)

    const refreshLimitsButtons = screen.getAllByRole('button', { name: /refresh limits/i })
    expect(refreshLimitsButtons.length).toBe(1)
  })

  test('refresh tokens from drawer sends the selected alias', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/token/refresh')) {
        const body = init?.body ? JSON.parse(String(init.body)) : {}
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, results: [{ alias: body.alias, updated: true }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }
      if (url.includes('/api/logs')) {
        return Promise.resolve(new Response(JSON.stringify(mockLogs), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url.includes('/api/force')) {
        return Promise.resolve(new Response(JSON.stringify(mockForceState), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })

    render(
      <>
        <DashboardPage />
        <NotificationProbe />
      </>,
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())
    const manageButtons = screen.getAllByRole('button', { name: /manage/i })
    fireEvent.click(manageButtons[0])

    const dialog = await screen.findByRole('dialog', { name: /account details/i })
    fireEvent.click(within(dialog).getByRole('button', { name: /^refresh tokens$/i }))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/token/refresh',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ alias: 'alpha' })
        })
      )
    })
  })

  test('refresh limits from drawer sends alias and shows queued notification while queue is running', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/limits/refresh')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, queue: { running: true, total: 2, completed: 0, errors: 0, pending: 2 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }
      if (url.includes('/api/logs')) {
        return Promise.resolve(new Response(JSON.stringify(mockLogs), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url.includes('/api/force')) {
        return Promise.resolve(new Response(JSON.stringify(mockForceState), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })

    render(
      <>
        <DashboardPage />
        <NotificationProbe />
      </>,
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())
    fireEvent.click(screen.getAllByRole('button', { name: /manage/i })[0])

    const dialog = await screen.findByRole('dialog', { name: /account details/i })
    fireEvent.click(within(dialog).getByRole('button', { name: /^refresh limits$/i }))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/limits/refresh',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ alias: 'alpha' })
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('notification-probe').textContent).toContain('Limit refresh queued for alpha')
    })
    expect(screen.queryByText('Limits refreshed for alpha')).not.toBeInTheDocument()
  })

  test('refresh tokens from drawer shows error notification when API result has updated and error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/token/refresh')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, results: [{ alias: 'alpha', updated: true, error: 'Auth write failed' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }
      if (url.includes('/api/logs')) {
        return Promise.resolve(new Response(JSON.stringify(mockLogs), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url.includes('/api/force')) {
        return Promise.resolve(new Response(JSON.stringify(mockForceState), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })

    render(
      <>
        <DashboardPage />
        <NotificationProbe />
      </>,
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())
    fireEvent.click(screen.getAllByRole('button', { name: /manage/i })[0])

    const dialog = await screen.findByRole('dialog', { name: /account details/i })
    fireEvent.click(within(dialog).getByRole('button', { name: /^refresh tokens$/i }))

    await waitFor(() => {
      expect(screen.getByTestId('notification-probe').textContent).toMatch(/Auth write failed|Failed to refresh tokens for alpha/)
    })
    expect(screen.queryByText('Tokens refreshed for alpha')).not.toBeInTheDocument()
  })

  // --- Queue Status ---

  test('shows queue status when refresh is running', async () => {
    setupFetchMock({
      queue: {
        running: true,
        total: 10,
        completed: 4,
        errors: 1,
        pending: 5
      }
    })

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // Queue is shown at DashboardPage top-level and in Overview trajectory
      const runningElements = screen.getAllByText(/running/i)
      expect(runningElements.length).toBeGreaterThanOrEqual(1)
    })

    // Queue detail shows "4 / 10 completed" and error count
    expect(screen.getByText(/completed/i)).toBeInTheDocument()
    expect(screen.getByText(/1 error/i)).toBeInTheDocument()
    const progressBar = document.querySelector('.progress-fill')
    expect(progressBar).toHaveAttribute('style', expect.stringContaining('width: 40%'))
  })

  test('shows no refresh activity when queue is idle', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // Queue idle message shown at DashboardPage top-level (single source)
      const elements = screen.getAllByText(/no refresh activity/i)
      expect(elements.length).toBe(1)
    })
  })

  // --- Embedded Overview Content ---

  test('renders insights content directly on dashboard', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    // Insights render control-center dashboard sections inline
    await waitFor(() => {
      expect(screen.getByText('Quota Health')).toBeInTheDocument()
    })
    expect(screen.getByText('Anomalies')).toBeInTheDocument()
    expect(screen.getByText('Recommendations')).toBeInTheDocument()
    expect(screen.getByText('Upcoming Resets')).toBeInTheDocument()
  })

  test('add-account controls are not present on dashboard', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-shell')).toBeInTheDocument()
    })

    expect(screen.queryByPlaceholderText(/new account alias/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add account/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /auto-login account/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /auto add/i })).not.toBeInTheDocument()
  })

  // --- Logs & Observability Panel (in-page, not behind tab) ---

  test('renders logs viewer directly on dashboard as in-page section', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    // Logs should be visible directly on the Dashboard without clicking any tab
    await waitFor(() => {
      expect(screen.getByText('Server started')).toBeInTheDocument()
    })

    expect(screen.getByText('Rate limit approaching')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /logs/i })).toBeInTheDocument()
  })

  test('renders observability panel directly on dashboard', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    // Observability info should be directly visible on Dashboard
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /observability/i })).toBeInTheDocument()
    })

    expect(screen.getByText('Store status')).toBeInTheDocument()
  })

  test('dashboard does not render force mode controls', async () => {
    // Force mode is owned by Settings page, not Dashboard
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-shell')).toBeInTheDocument()
    })

    // Force mode heading and controls should NOT be on dashboard
    expect(screen.queryByRole('heading', { name: /force mode/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /activate force/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clear force/i })).not.toBeInTheDocument()
  })

  // --- Loading state ---

  test('shows loading state while fetching data', () => {
    vi.spyOn(global, 'fetch').mockImplementation(
      () => new Promise(() => {
        /* never resolves — keeps loading state */
      })
    )

    render(<DashboardPage />, { wrapper: createWrapper() })

    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument()
    expect(screen.getByText(/loading dashboard/i)).toBeInTheDocument()
  })

  // --- Error state ---

  test('shows error state when state fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'))

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-error')).toBeInTheDocument()
    })

    expect(screen.getByText(/failed to load dashboard/i)).toBeInTheDocument()
  })

  // --- Consolidated operational signals (Task 5.2) ---

  test('operational signals are always visible on dashboard', async () => {
    setupFetchMock({
      queue: { running: true, total: 10, completed: 4, errors: 1, pending: 5 }
    })

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-shell')).toBeInTheDocument()
    })

    // Queue section (top-level) should be visible
    await waitFor(() => {
      const runningElements = screen.getAllByText(/running/i)
      expect(runningElements.length).toBeGreaterThanOrEqual(1)
    })

    // Quick actions (top-level) should be visible
    const syncButtons = screen.getAllByRole('button', { name: /sync auth\.json/i })
    expect(syncButtons.length).toBeGreaterThanOrEqual(1)

    // Health summary (top-level) should be visible
    const storeElements = screen.getAllByText(/encrypted/i)
    expect(storeElements.length).toBeGreaterThanOrEqual(1)
  })

  test('insights section shows control-center dashboard', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-shell')).toBeInTheDocument()
    })

    // Insights now shows control-center sections inline
    expect(screen.getByText('Quota Health')).toBeInTheDocument()
    expect(screen.getByText('Upcoming Resets')).toBeInTheDocument()
    expect(screen.getByText('Anomalies')).toBeInTheDocument()
    expect(screen.getByText('Recommendations')).toBeInTheDocument()
  })

  // --- Accessibility ---

  test('dashboard health section has an accessible label', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /dashboard health/i })).toBeInTheDocument()
    })
  })

  test('dashboard quick actions section has an accessible label', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /dashboard quick actions/i })).toBeInTheDocument()
    })
  })

  // --- Insights ---

  test('renders insights section with quota health, anomalies, recommendations, and upcoming resets', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('Quota Health')).toBeInTheDocument()
    })

    expect(screen.getByText('Anomalies')).toBeInTheDocument()
    expect(screen.getByText('Recommendations')).toBeInTheDocument()
    expect(screen.getByText('Upcoming Resets')).toBeInTheDocument()
  })

  // --- Account Status/Quota Cards ---

  test('renders per-account status cards section with accessible label', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /account status/i })).toBeInTheDocument()
    })
  })

  test('renders a card for each account with its alias', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // The dashboard shell renders, then account cards appear below health summary
      const alphaElements = screen.getAllByText('alpha')
      expect(alphaElements.length).toBeGreaterThanOrEqual(1)
    })

    // beta appears in card and possibly in Accounts tab
    const betaElements = screen.getAllByText('beta')
    expect(betaElements.length).toBeGreaterThanOrEqual(1)
  })

  test('account cards show primary state badges without contradiction', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // alpha is enabled + active + recommended: should show active + recommended, NOT enabled
      const activeBadges = screen.getAllByText(/active/i)
      const recommendedBadges = screen.getAllByText(/recommended/i)
      const disabledBadges = screen.getAllByText(/disabled/i)
      // beta is disabled: should show disabled, NOT active/recommended
      expect(activeBadges.length).toBeGreaterThanOrEqual(1)
      expect(recommendedBadges.length).toBeGreaterThanOrEqual(1)
      expect(disabledBadges.length).toBeGreaterThanOrEqual(1)
      // Enabled badge should NOT appear (redundant with absence of disabled)
      const enabledBadges = screen.queryAllByText(/^enabled$/i)
      expect(enabledBadges.length).toBe(0)
    })
  })

  test('account cards show 5h quota progress bar with remaining/limit labels', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // alpha has 80/100 remaining for 5h — both card and Accounts tab may show this
      const remainingElements = screen.getAllByText(/80/)
      expect(remainingElements.length).toBeGreaterThanOrEqual(1)
    })

    // The card should have a progress bar with role or class for 5h quota
    const progressBars = document.querySelectorAll('[class*="quota-bar"], [role="progressbar"]')
    expect(progressBars.length).toBeGreaterThanOrEqual(1)
  })

  test('account cards show weekly quota progress bar', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // alpha has 700/1000 remaining for weekly
      const weeklyElements = screen.getAllByText(/700/)
      expect(weeklyElements.length).toBeGreaterThanOrEqual(1)
    })
  })

  test('account cards show limitsConfidence with severity-based color class', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // confidence badges use class like confidence--fresh, confidence--stale
      const confidenceElements = document.querySelectorAll('[class*="confidence"]')
      expect(confidenceElements.length).toBeGreaterThanOrEqual(1)
    })

    // fresh should be present for alpha
    const freshElements = screen.getAllByText(/fresh/i)
    expect(freshElements.length).toBeGreaterThanOrEqual(1)

    // stale should be present for beta
    const staleElements = screen.getAllByText(/stale/i)
    expect(staleElements.length).toBeGreaterThanOrEqual(1)
  })

  test('current/active account gets a visual indicator', async () => {
    setupFetchMock() // rotationAlias is 'alpha' by default

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // The "active" badge or text should appear near alpha's card
      const activeBadges = document.querySelectorAll('[class*="badge--active"], [class*="card--active"]')
      expect(activeBadges.length).toBeGreaterThanOrEqual(1)
    })
  })

  test('recommended account gets a visual indicator', async () => {
    setupFetchMock() // recommendedAlias is 'alpha' by default

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // recommended indicator for alpha
      const recommendedElements = screen.getAllByText(/recommended/i)
      expect(recommendedElements.length).toBeGreaterThanOrEqual(1)
    })
  })

  test('disabled accounts have distinct visual treatment', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // beta is disabled — its card should have reduced opacity or disabled styling
      const disabledCards = document.querySelectorAll('[class*="card--disabled"], [class*="disabled"]')
      expect(disabledCards.length).toBeGreaterThanOrEqual(1)
    })
  })

  test('account cards have an actionable element to open/manage the account', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // Each card should have some actionable control
      const actionButtons = screen.getAllByRole('button', { name: /manage|open|view/i })
      expect(actionButtons.length).toBeGreaterThanOrEqual(1)
    })
  })

  test('account cards are rendered in a responsive grid layout', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // The card grid container should exist
      const gridElements = document.querySelectorAll('[class*="account-cards"]')
      expect(gridElements.length).toBeGreaterThanOrEqual(1)
    })
  })

  test('account with enabled=undefined shows as enabled, not disabled', async () => {
    setupFetchMock({
      accounts: [
        {
          alias: 'gamma',
          email: 'gamma@example.com',
          // enabled is intentionally omitted (undefined)
          usageCount: 0,
          source: 'opencode',
          rateLimits: {
            fiveHour: { limit: 100, remaining: 80, resetAt: Date.now() + 60_000, updatedAt: Date.now() },
            weekly: { limit: 1000, remaining: 700, resetAt: Date.now() + 120_000, updatedAt: Date.now() }
          },
          limitsConfidence: 'fresh'
        } as any
      ]
    })

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      const gammaCard = screen.getByTestId('account-card-gamma')
      expect(gammaCard).toBeInTheDocument()
      // Must NOT have the disabled styling class
      expect(gammaCard.className).not.toContain('account-card--disabled')
    })

    // Must NOT show a disabled badge
    const gammaCard = screen.getByTestId('account-card-gamma')
    expect(gammaCard.textContent).not.toMatch(/disabled/i)
  })

  test('account cards show reset times when available', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // Reset labels should appear in cards (multiple accounts may have them)
      expect(screen.getAllByText(/5h reset:/i).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(/wk reset:/i).length).toBeGreaterThanOrEqual(1)
    })
  })

  test('account cards show prediction indicators when history is insufficient', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      // Both alpha and beta have rate limits but no history
      const predictions = screen.getAllByText(/Insufficient history/)
      expect(predictions.length).toBeGreaterThanOrEqual(1)
    })
  })

  test('account cards show prediction indicators with velocity and exhaustion when history exists', async () => {
    const now = Date.now()
    setupFetchMock({
      accounts: [
        {
          alias: 'alpha',
          email: 'alpha@example.com',
          enabled: true,
          usageCount: 3,
          source: 'opencode',
          rateLimits: {
            fiveHour: { limit: 100, remaining: 40, resetAt: now + 7200_000, updatedAt: now },
            weekly: { limit: 1000, remaining: 700, resetAt: now + 120_000, updatedAt: now }
          },
          rateLimitHistory: [
            { at: now - 3600_000, fiveHour: { remaining: 80, limit: 100 } },
            { at: now - 1800_000, fiveHour: { remaining: 60, limit: 100 } },
            { at: now, fiveHour: { remaining: 40, limit: 100 } }
          ],
          limitsConfidence: 'fresh'
        }
      ]
    })

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      const card = screen.getByTestId('account-card-alpha')
      expect(card).toBeInTheDocument()
    })

    const card = screen.getByTestId('account-card-alpha')
    const prediction = card.querySelector('.account-prediction')
    expect(prediction).not.toBeNull()
    // Should contain velocity and exhaustion text
    expect(prediction!.textContent).toMatch(/40%/)
    expect(prediction!.textContent).toMatch(/exhaust/)
  })

  test('account cards render history chart when history has valid points', async () => {
    const now = Date.now()
    setupFetchMock({
      accounts: [
        {
          alias: 'alpha',
          email: 'alpha@example.com',
          enabled: true,
          usageCount: 3,
          source: 'opencode',
          rateLimits: {
            fiveHour: { limit: 100, remaining: 40, resetAt: now + 7200_000, updatedAt: now },
            weekly: { limit: 1000, remaining: 700, resetAt: now + 120_000, updatedAt: now }
          },
          rateLimitHistory: [
            { at: now - 3600_000, fiveHour: { remaining: 80, limit: 100 } },
            { at: now - 1800_000, fiveHour: { remaining: 60, limit: 100 } },
            { at: now, fiveHour: { remaining: 40, limit: 100 } }
          ],
          limitsConfidence: 'fresh'
        }
      ]
    })

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      const charts = document.querySelectorAll('.account-history-chart')
      expect(charts.length).toBeGreaterThanOrEqual(1)
    })

    // Should have accessible chart labels
    const chartImgs = screen.getAllByRole('img', { name: /consumption history/i })
    expect(chartImgs.length).toBeGreaterThanOrEqual(1)
  })

  test('account cards show empty chart state when history is absent', async () => {
    setupFetchMock()

    render(<DashboardPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-shell')).toBeInTheDocument()
    })

    // Charts should still render but show empty state
    const charts = document.querySelectorAll('.account-history-chart')
    expect(charts.length).toBeGreaterThanOrEqual(1)

    // Should show insufficient history text
    const emptyTexts = screen.queryAllByText(/insufficient history/i)
    expect(emptyTexts.length).toBeGreaterThanOrEqual(1)
  })
})
