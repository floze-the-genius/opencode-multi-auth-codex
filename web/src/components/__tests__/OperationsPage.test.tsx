import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { OperationsPage } from '../OperationsPage'
import type { DashboardState, LogsResponse } from '../../types/api'

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
      notes: 'primary account'
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
    configured: false,
    accounts: []
  },
  rotationStrategy: 'round-robin',
  force: {
    active: false,
    alias: null,
    forcedAt: null,
    forcedUntil: null,
    forcedBy: null,
    remainingMs: 0,
    remainingTime: '0m',
    previousRotationStrategy: null
  },
  featureFlags: { antigravityEnabled: false }
}

const mockLogs: LogsResponse = {
  path: '/logs/app.log',
  lines: [
    { time: '2024-01-01T00:00:00.000Z', level: 'INFO', message: 'Server started' },
    { time: '2024-01-01T00:01:00.000Z', level: 'WARN', message: 'Rate limit approaching' },
    { time: '2024-01-01T00:02:00.000Z', level: 'ERROR', message: 'Token refresh failed' }
  ]
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

describe('OperationsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('renders logs viewer with log lines', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/logs')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockLogs), { status: 200, headers: { 'Content-Type': 'application/json' } })
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    })

    render(<OperationsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getByText('Server started')).toBeInTheDocument())

    expect(screen.getByRole('heading', { name: /logs/i })).toBeInTheDocument()
    expect(screen.getByText('Rate limit approaching')).toBeInTheDocument()
    expect(screen.getByText('Token refresh failed')).toBeInTheDocument()
  })

  test('does not expose force mode controls', async () => {
    // Force mode is owned by Settings, not embedded in OperationsPage/Dashboard
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OperationsPage />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /logs/i })).toBeInTheDocument()
    )

    // Force mode controls should NOT be present
    expect(screen.queryByRole('heading', { name: /force mode/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /activate force/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clear force/i })).not.toBeInTheDocument()
  })

  test('does not render duplicate global action buttons', async () => {
    // Global actions are on the parent DashboardPage, not duplicated here
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OperationsPage />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /logs/i })).toBeInTheDocument()
    )

    // Global actions (sync, refresh) should NOT be in the embedded panel
    expect(screen.queryByRole('button', { name: /sync auth\.json/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /refresh tokens/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /refresh limits/i })).not.toBeInTheDocument()
  })

  test('does not render queue status (owned by parent Dashboard)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OperationsPage />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /logs/i })).toBeInTheDocument()
    )

    // Queue status is rendered by the parent DashboardPage, not duplicated here
    expect(screen.queryByRole('heading', { name: /refresh queue/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/no refresh activity/i)).not.toBeInTheDocument()
  })

  test('shows observability status cards', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OperationsPage />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByText(/observability/i)).toBeInTheDocument()
    )

    expect(screen.getByText('Store status')).toBeInTheDocument()
    expect(screen.getByText('Last sync')).toBeInTheDocument()
  })

  test('handles raw string log lines from real API without crashing', async () => {
    // Regression: backend returns raw string lines, not structured LogLine objects.
    // The component must either parse them or guard against missing .level property.
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/logs')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              path: '/logs/app.log',
              lines: [
                '2024-01-01T00:00:00.000Z [INFO] Server started',
                '2024-01-01T00:01:00.000Z [WARN] Rate limit approaching',
                '2024-01-01T00:02:00.000Z [ERROR] Token refresh failed'
              ]
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      }
      if (typeof url === 'string' && url.includes('/api/force')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockState.force), { status: 200, headers: { 'Content-Type': 'application/json' } })
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    })

    render(<OperationsPage />, { wrapper: createWrapper() })

    // Must not crash — should still render the logs section header
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /logs/i })).toBeInTheDocument()
    )

    // Raw strings should be parsed and rendered as messages
    expect(screen.getByText('Server started')).toBeInTheDocument()
    expect(screen.getByText('Rate limit approaching')).toBeInTheDocument()
    expect(screen.getByText('Token refresh failed')).toBeInTheDocument()
  })

  test('handles undefined level field gracefully', async () => {
    // Regression: log lines with undefined/null level must not crash
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/logs')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              path: '/logs/app.log',
              lines: [
                { time: '2024-01-01T00:00:00.000Z', level: undefined, message: 'No level field' },
                { time: '2024-01-01T00:01:00.000Z', level: null, message: 'Null level field' }
              ]
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      }
      if (typeof url === 'string' && url.includes('/api/force')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockState.force), { status: 200, headers: { 'Content-Type': 'application/json' } })
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    })

    render(<OperationsPage />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByText('No level field')).toBeInTheDocument()
    )
    expect(screen.getByText('Null level field')).toBeInTheDocument()
  })

  test('shows sync error notice when present', async () => {
    const stateWithSyncError: DashboardState = {
      ...mockState,
      lastSyncError: 'Sync failed: network timeout'
    }

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(stateWithSyncError), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<OperationsPage />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByText(/sync failed:/i)).toBeInTheDocument()
    )
  })
})
