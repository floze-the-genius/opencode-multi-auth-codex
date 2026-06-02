import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { AccountsPage } from '../AccountsPage'
import { NotificationProvider, useNotification } from '../../hooks/useNotification'
import type { DashboardState } from '../../types/api'

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
      disabledAt: Date.now(),
      disabledBy: 'dashboard',
      disableReason: 'manual',
      usageCount: 7,
      source: 'codex',
      tags: ['backup'],
      notes: 'secondary account',
      rateLimits: {
        fiveHour: { limit: 100, remaining: 50, resetAt: Date.now() + 60_000, updatedAt: Date.now() },
        weekly: { limit: 1000, remaining: 450, resetAt: Date.now() + 120_000, updatedAt: Date.now() }
      },
      limitsConfidence: 'stale'
    },
    {
      alias: 'gamma',
      email: 'gamma@example.com',
      enabled: true,
      usageCount: 1,
      source: 'opencode',
      tags: [],
      notes: ''
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

describe('AccountsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('renders account list with filters and sort controls', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    expect(screen.getByPlaceholderText(/search accounts/i)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /sort by/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add account/i })).toBeInTheDocument()
  })

  test('filters accounts by search text', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    const searchInput = screen.getByPlaceholderText(/search accounts/i)
    fireEvent.change(searchInput, { target: { value: 'beta' } })

    expect(screen.queryByText('alpha')).not.toBeInTheDocument()
    expect(screen.getAllByText('beta')[0]).toBeInTheDocument()
    expect(screen.queryByText('gamma')).not.toBeInTheDocument()
  })

  test('filters accounts by enabled status', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    const statusFilter = screen.getByRole('combobox', { name: /filter by status/i })
    fireEvent.change(statusFilter, { target: { value: 'enabled' } })

    expect(screen.getAllByText('alpha')[0]).toBeInTheDocument()
    expect(screen.queryByText('beta')).not.toBeInTheDocument()
    expect(screen.getAllByText('gamma')[0]).toBeInTheDocument()
  })

  test('sorts accounts by usage count descending', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    const sortSelect = screen.getByRole('combobox', { name: /sort by/i })
    fireEvent.change(sortSelect, { target: { value: 'usage-desc' } })

    const rows = screen.getAllByRole('row')
    // Header + 3 data rows; beta has highest usage (7)
    expect(rows[1]).toHaveTextContent('beta')
    expect(rows[2]).toHaveTextContent('alpha')
    expect(rows[3]).toHaveTextContent('gamma')
  })

  test('shows account details including tags and notes', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    expect(screen.getAllByText('core')[0]).toBeInTheDocument()
  })

  test('shows disabled account with disabled badge', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('beta')[0]).toBeInTheDocument())

    expect(screen.getAllByText('disabled')[0]).toBeInTheDocument()
  })

  test('opens account drawer when account row is clicked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    const alphaRow = screen.getAllByText('alpha')[0].closest('tr')
    if (!alphaRow) throw new Error('Row not found')
    fireEvent.click(alphaRow)

    expect(screen.getByRole('dialog', { name: /account details/i })).toBeInTheDocument()
    expect(screen.getAllByText('alpha@example.com').length).toBeGreaterThanOrEqual(1)
  })

  test('opens create account modal when add account button is clicked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getByRole('button', { name: /add account/i })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /add account/i }))

    expect(screen.getByRole('dialog', { name: /create account/i })).toBeInTheDocument()
  })

  test('shows rate limit info when available', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    expect(screen.getAllByText(/80\s*\/\s*100/i)[0]).toBeInTheDocument()
  })

  test('shows empty state when no accounts match filter', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    const searchInput = screen.getByPlaceholderText(/search accounts/i)
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } })

    expect(screen.getByText(/no accounts match/i)).toBeInTheDocument()
  })

  test('shows bulk action toolbar when accounts are selected', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    const checkboxes = screen.getAllByRole('checkbox')
    // First checkbox is "select all", followed by row checkboxes
    expect(checkboxes.length).toBeGreaterThan(1)

    fireEvent.click(checkboxes[1])

    expect(screen.getByText(/1 selected/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enable selected/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /disable selected/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove selected/i })).toBeInTheDocument()
  })

  test('selects all accounts via header checkbox', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    const selectAllCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(selectAllCheckbox)

    expect(screen.getByText(/3 selected/i)).toBeInTheDocument()
  })

  test('bulk disable clears selection and triggers mutation flow', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/state')) {
        return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      // Mock mutation responses
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1]) // select alpha

    expect(screen.getByText(/1 selected/i)).toBeInTheDocument()

    const disableButton = screen.getByRole('button', { name: /disable selected/i })
    fireEvent.click(disableButton)

    // Selection should clear after bulk action
    await waitFor(() => {
      expect(screen.queryByText(/1 selected/i)).not.toBeInTheDocument()
    })
  })

  test('account with enabled=undefined appears as enabled in table', async () => {
    const stateWithUndefined = {
      ...mockState,
      accounts: [
        {
          alias: 'delta',
          email: 'delta@example.com',
          // enabled omitted — should be treated as enabled
          usageCount: 0,
          source: 'opencode'
        } as any
      ]
    }

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(stateWithUndefined), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('delta')[0]).toBeInTheDocument())

    // Should show enabled badge, not disabled
    const enabledBadge = screen.getAllByText('enabled')[0]
    expect(enabledBadge).toBeInTheDocument()
    expect(enabledBadge.className).toContain('badge--enabled')

    // Row should NOT have disabled styling
    const deltaRow = screen.getAllByText('delta')[0].closest('tr')
    expect(deltaRow?.className).not.toContain('account-row--disabled')
  })

  test('shows compact reset times in accounts table', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    render(<AccountsPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    // Reset column should show compact labels (multiple rows may have them)
    expect(screen.getAllByText(/5h:/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/wk:/i).length).toBeGreaterThanOrEqual(1)
  })

  test('drawer refresh tokens sends that account alias', async () => {
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
      return Promise.resolve(
        new Response(JSON.stringify(mockState), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    render(
      <>
        <AccountsPage />
        <NotificationProbe />
      </>,
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    const alphaRow = screen.getAllByText('alpha')[0].closest('tr')
    if (!alphaRow) throw new Error('Row not found')
    fireEvent.click(alphaRow)

    await waitFor(() => expect(screen.getByRole('dialog', { name: /account details/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /refresh tokens/i }))

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

  test('drawer refresh tokens shows error notification when API result has updated and error', async () => {
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
      return Promise.resolve(
        new Response(JSON.stringify(mockState), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    render(
      <>
        <AccountsPage />
        <NotificationProbe />
      </>,
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    const alphaRow = screen.getAllByText('alpha')[0].closest('tr')
    if (!alphaRow) throw new Error('Row not found')
    fireEvent.click(alphaRow)

    await waitFor(() => expect(screen.getByRole('dialog', { name: /account details/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /refresh tokens/i }))

    await waitFor(() => {
      expect(screen.getByTestId('notification-probe').textContent).toMatch(/Auth write failed|Failed to refresh tokens for alpha/)
    })
    expect(screen.queryByText('Tokens refreshed for alpha')).not.toBeInTheDocument()
  })

  test('drawer refresh limits sends that account alias and shows queued notification while queue is running', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/limits/refresh')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, queue: { running: true, total: 3, completed: 0, errors: 0, pending: 3 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockState), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    render(
      <>
        <AccountsPage />
        <NotificationProbe />
      </>,
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())

    const alphaRow = screen.getAllByText('alpha')[0].closest('tr')
    if (!alphaRow) throw new Error('Row not found')
    fireEvent.click(alphaRow)

    await waitFor(() => expect(screen.getByRole('dialog', { name: /account details/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /refresh limits/i }))

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

  test('header import from Codex triggers mutation and success feedback', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/codex/import')) {
        return Promise.resolve(
          new Response(JSON.stringify({
            ok: true,
            imported: true,
            alias: 'gamma',
            added: true,
            updated: true,
            codexActive: { status: 'matched', alias: 'gamma', hasAccessToken: true, hasRefreshToken: true, hasIdToken: true }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        )
      }
      return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })

    render(
      <>
        <AccountsPage />
        <NotificationProbe />
      </>,
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /import from codex auth\.json/i }))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/codex/import', expect.objectContaining({ method: 'POST' }))
    })
    await waitFor(() => {
      expect(screen.getByTestId('notification-probe').textContent).toContain('Imported Codex account: gamma')
    })
  })

  test('header import from Codex surfaces malformed auth error feedback', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/codex/import')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: 'Failed to parse codex auth.json', code: 'CODEX_AUTH_INVALID' }), {
            status: 422,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }
      return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })

    render(
      <>
        <AccountsPage />
        <NotificationProbe />
      </>,
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /import from codex auth\.json/i }))

    await waitFor(() => {
      expect(screen.getByTestId('notification-probe').textContent).toContain('Codex auth.json is malformed')
    })
  })

  test('drawer use-in-Codex triggers mutation and success feedback', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/codex/use')) {
        return Promise.resolve(
          new Response(JSON.stringify({
            ok: true,
            alias: 'alpha',
            codexActive: { status: 'matched', alias: 'alpha', hasAccessToken: true, hasRefreshToken: true, hasIdToken: true }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        )
      }
      return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })

    render(
      <>
        <AccountsPage />
        <NotificationProbe />
      </>,
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())
    const alphaRow = screen.getAllByText('alpha')[0].closest('tr')
    if (!alphaRow) throw new Error('Row not found')
    fireEvent.click(alphaRow)
    await waitFor(() => expect(screen.getByRole('dialog', { name: /account details/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /use in codex/i }))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/codex/use',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ alias: 'alpha' }) })
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('notification-probe').textContent).toContain('Codex set to alpha')
    })
  })

  test('drawer use-in-Codex surfaces API error feedback', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/codex/use')) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Unknown alias', code: 'ACCOUNT_NOT_FOUND' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }
      return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })

    render(
      <>
        <AccountsPage />
        <NotificationProbe />
      </>,
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(screen.getAllByText('alpha')[0]).toBeInTheDocument())
    const alphaRow = screen.getAllByText('alpha')[0].closest('tr')
    if (!alphaRow) throw new Error('Row not found')
    fireEvent.click(alphaRow)
    await waitFor(() => expect(screen.getByRole('dialog', { name: /account details/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /use in codex/i }))

    await waitFor(() => {
      expect(screen.getByTestId('notification-probe').textContent).toContain('Account not found in the store')
    })
  })
})
