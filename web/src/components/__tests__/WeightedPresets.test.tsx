import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ConfigurationPage } from '../ConfigurationPage'
import type { DashboardState, SettingsInfo, ForceState, FeatureFlagsResponse } from '../../types/api'

const mockState: DashboardState = {
  authPath: '/auth.json',
  deviceAlias: 'test-device',
  rotationAlias: 'account-1',
  accounts: [
    { alias: 'alpha', email: 'alpha@example.com', enabled: true, usageCount: 3, source: 'opencode' },
    { alias: 'beta', email: 'beta@example.com', enabled: true, usageCount: 7, source: 'codex' },
    { alias: 'gamma', email: 'gamma@example.com', enabled: false, usageCount: 1, source: 'opencode' }
  ],
  lastSyncAt: Date.now(),
  lastSyncError: null,
  lastSyncAlias: null,
  authSummary: { hasAccessToken: true, hasIdToken: true, hasRefreshToken: true },
  storeStatus: { locked: false, encrypted: true, error: null },
  login: null,
  lastLoginError: null,
  antigravity: { accounts: [], path: '' },
  queue: null,
  recommendedAlias: null,
  logPath: '/logs',
  autoLogin: {
    path: '/auto-login.json',
    scriptPath: '/script.py',
    pythonPath: '/python',
    configured: false,
    accounts: []
  },
  rotationStrategy: 'weighted-round-robin',
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
  featureFlags: { antigravityEnabled: false, stickySessionsEnabled: false }
}

const mockSettingsWeighted: SettingsInfo = {
  settings: {
    rotationStrategy: 'weighted-round-robin',
    criticalThreshold: 10,
    lowThreshold: 30,
    accountWeights: {
      alpha: 0.5,
      beta: 0.3,
      gamma: 0.2
    },
    featureFlags: { antigravityEnabled: false, stickySessionsEnabled: false }
  },
  source: 'test',
  preset: 'custom',
  canReset: true
}

const mockSettingsRoundRobin: SettingsInfo = {
  settings: {
    rotationStrategy: 'round-robin',
    criticalThreshold: 10,
    lowThreshold: 30,
    accountWeights: {},
    featureFlags: { antigravityEnabled: false, stickySessionsEnabled: false }
  },
  source: 'test',
  canReset: true
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

const mockFeatureFlags: FeatureFlagsResponse = {
  featureFlags: { antigravityEnabled: false, stickySessionsEnabled: false }
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

describe('WeightedPresets', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function createMockFetch(
    state = mockState,
    settings = mockSettingsWeighted,
    force = mockForceState,
    featureFlags = mockFeatureFlags
  ) {
    return vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'

      if (url === '/api/state') {
        return new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/settings') {
        return new Response(JSON.stringify(settings), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/force') {
        return new Response(JSON.stringify(force), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/settings/feature-flags') {
        return new Response(JSON.stringify(featureFlags), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/settings' && method === 'PUT') {
        const body = init?.body ? JSON.parse(init.body as string) : {}
        return new Response(
          JSON.stringify({
            ok: true,
            settings: { ...settings.settings, ...body }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (url === '/api/settings/preset' && method === 'POST') {
        const body = init?.body ? JSON.parse(init.body as string) : {}
        return new Response(
          JSON.stringify({
            ok: true,
            preset: body.preset,
            settings: settings.settings
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (url === '/api/force/clear' && method === 'POST') {
        return new Response(JSON.stringify({ ok: true, restoredStrategy: 'weighted-round-robin' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/settings/reset' && method === 'POST') {
        return new Response(JSON.stringify({ ok: true, settings: settings.settings }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/force' && method === 'POST') {
        return new Response(JSON.stringify({ ok: true, alias: 'alpha', remainingMs: 86_340_000, remainingTime: '23h 59m' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      return new Response(JSON.stringify({ error: 'Not mocked' }), { status: 404 })
    })
  }

  test('renders account weight editor when rotation strategy is weighted-round-robin', async () => {
    createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /account weights/i })).toBeInTheDocument()
    )

    // Should show weight inputs for each account
    expect(screen.getByRole('spinbutton', { name: /alpha weight/i })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /beta weight/i })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /gamma weight/i })).toBeInTheDocument()
  })

  test('displays current account weights from settings', async () => {
    createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: /alpha weight/i })).toBeInTheDocument()
    )

    const alphaInput = screen.getByRole('spinbutton', { name: /alpha weight/i }) as HTMLInputElement
    const betaInput = screen.getByRole('spinbutton', { name: /beta weight/i }) as HTMLInputElement
    const gammaInput = screen.getByRole('spinbutton', { name: /gamma weight/i }) as HTMLInputElement

    expect(alphaInput.value).toBe('0.5')
    expect(betaInput.value).toBe('0.3')
    expect(gammaInput.value).toBe('0.2')
  })

  test('hides account weight editor when rotation strategy is not weighted-round-robin', async () => {
    createMockFetch(mockState, mockSettingsRoundRobin)

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /configuration/i })).toBeInTheDocument()
    )

    expect(screen.queryByRole('heading', { name: /account weights/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /alpha weight/i })).not.toBeInTheDocument()
  })

  test('calls API when an account weight is changed to a valid value', async () => {
    const fetchSpy = createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: /alpha weight/i })).toBeInTheDocument()
    )

    const alphaInput = screen.getByRole('spinbutton', { name: /alpha weight/i })
    // Change alpha from 0.5 to 0.6, and beta from 0.3 to 0.2 so sum stays 1.0
    const betaInput = screen.getByRole('spinbutton', { name: /beta weight/i })
    fireEvent.change(alphaInput, { target: { value: '0.6' } })
    fireEvent.change(betaInput, { target: { value: '0.2' } })
    fireEvent.blur(alphaInput)

    await waitFor(() => {
      const calls = fetchSpy.mock.calls
      const putCall = calls.find(call => call[0] === '/api/settings' && (call[1] as RequestInit)?.method === 'PUT')
      expect(putCall).toBeDefined()
      const body = putCall ? JSON.parse((putCall[1] as RequestInit).body as string) : {}
      expect(body.accountWeights).toBeDefined()
      expect(body.accountWeights.alpha).toBe(0.6)
    })
  })

  test('renders preset buttons and calls API when clicked', async () => {
    const fetchSpy = createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /balanced/i })).toBeInTheDocument()
    )

    const balancedButton = screen.getByRole('button', { name: /balanced/i })
    fireEvent.click(balancedButton)

    await waitFor(() => {
      const calls = fetchSpy.mock.calls
      const presetCall = calls.find(call => call[0] === '/api/settings/preset' && (call[1] as RequestInit)?.method === 'POST')
      expect(presetCall).toBeDefined()
      const body = presetCall ? JSON.parse((presetCall[1] as RequestInit).body as string) : {}
      expect(body.preset).toBe('balanced')
    })
  })

  test('shows weight validation error when weights do not sum to 1', async () => {
    createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: /alpha weight/i })).toBeInTheDocument()
    )

    // Change alpha to 0.9 without adjusting others - sum will be 1.4
    const alphaInput = screen.getByRole('spinbutton', { name: /alpha weight/i })
    fireEvent.change(alphaInput, { target: { value: '0.9' } })
    fireEvent.blur(alphaInput)

    // The UI should show a validation message in the alert
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert')
      expect(alerts.length).toBeGreaterThan(0)
      expect(alerts[0].textContent).toMatch(/weights must sum to 1\.0/i)
    })
  })

  test('shows disabled state for disabled accounts in weight editor', async () => {
    createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: /gamma weight/i })).toBeInTheDocument()
    )

    const gammaRow = screen.getByText(/gamma/i).closest('div')
    expect(gammaRow).toHaveClass('account-weight-disabled')
  })
})
