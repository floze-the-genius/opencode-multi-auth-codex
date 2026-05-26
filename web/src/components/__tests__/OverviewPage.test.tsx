import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { OverviewPage } from '../OverviewPage'
import type { DashboardState } from '../../types/api'

const mockState: DashboardState = {
  authPath: '/auth.json',
  deviceAlias: 'test-device',
  rotationAlias: 'account-1',
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
      enabled: true,
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
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
  }
}

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('renders snapshot cards with dashboard state', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OverviewPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getByText('test-device')).toBeInTheDocument())

    expect(screen.getByText('Accounts')).toBeInTheDocument()
    expect(screen.getByText('test-device')).toBeInTheDocument()
    expect(screen.getByText('account-1')).toBeInTheDocument()
    expect(screen.getAllByText('alpha').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/encrypted/i)).toBeInTheDocument()
  })

  test('renders quota health section', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OverviewPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getByText('Quota Health')).toBeInTheDocument())

    expect(screen.getByText('5-Hour Window')).toBeInTheDocument()
    expect(screen.getByText('Weekly Window')).toBeInTheDocument()
    expect(screen.getAllByText('Safe').length).toBeGreaterThanOrEqual(2)
  })

  test('renders upcoming resets section', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OverviewPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getByText('Upcoming Resets')).toBeInTheDocument())

    expect(screen.getByText('5-Hour')).toBeInTheDocument()
    expect(screen.getByText('Weekly')).toBeInTheDocument()
  })

  test('renders anomalies section', async () => {
    const stateWithAnomaly = {
      ...mockState,
      accounts: [
        ...mockState.accounts,
        {
          alias: 'gamma',
          email: 'gamma@example.com',
          enabled: false,
          disabledAt: Date.now(),
          disabledBy: 'dashboard',
          disableReason: 'manual',
          usageCount: 0,
          source: 'opencode'
        }
      ]
    }

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(stateWithAnomaly), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OverviewPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getByText('Anomalies')).toBeInTheDocument())

    expect(screen.getByText(/gamma.*disabled/i)).toBeInTheDocument()
  })

  test('renders recommendations section', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OverviewPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getByText('Recommendations')).toBeInTheDocument())

    expect(screen.getByText(/differs from current active/i)).toBeInTheDocument()
  })

  test('renders trajectory snapshot section', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OverviewPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getByText('Trajectory Snapshot')).toBeInTheDocument())

    expect(screen.getByText(/current-state snapshot/i)).toBeInTheDocument()
    expect(screen.getByText(/not a historical trend/i)).toBeInTheDocument()
  })

  test('shows login error in anomalies', async () => {
    const stateWithError: DashboardState = {
      ...mockState,
      lastLoginError: 'Authentication failed'
    }

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(stateWithError), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OverviewPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getByText('Anomalies')).toBeInTheDocument())

    expect(screen.getByText(/authentication failed/i)).toBeInTheDocument()
  })

  test('shows queue status in trajectory snapshot', async () => {
    const stateWithQueue: DashboardState = {
      ...mockState,
      queue: {
        running: true,
        total: 10,
        completed: 4,
        errors: 1,
        pending: 5
      }
    }

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(stateWithQueue), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OverviewPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getByText('Trajectory Snapshot')).toBeInTheDocument())

    expect(screen.getByText(/running/i)).toBeInTheDocument()
    expect(screen.getByText(/4\/10/i)).toBeInTheDocument()
  })

  test('shows sync error in anomalies', async () => {
    const stateWithSyncError: DashboardState = {
      ...mockState,
      lastSyncError: 'Sync failed: network timeout'
    }

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(stateWithSyncError), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OverviewPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getByText('Anomalies')).toBeInTheDocument())

    expect(screen.getByText(/sync failed:/i)).toBeInTheDocument()
  })

  test('does NOT render quick action buttons (owned by DashboardPage top-level)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OverviewPage />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByText('Accounts')).toBeInTheDocument()
    )

    expect(screen.queryByRole('button', { name: /sync auth\.json/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /refresh tokens/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /refresh limits/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /refresh ui/i })).not.toBeInTheDocument()
  })

  test('does NOT render add account input and button', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OverviewPage />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByText('Accounts')).toBeInTheDocument()
    )

    expect(screen.queryByPlaceholderText(/new account alias/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add account/i })).not.toBeInTheDocument()
  })

  test('does NOT render auto-login select when configured', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OverviewPage />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByText('Accounts')).toBeInTheDocument()
    )

    expect(screen.queryByRole('combobox', { name: /auto-login account/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /auto add/i })).not.toBeInTheDocument()
  })
})
