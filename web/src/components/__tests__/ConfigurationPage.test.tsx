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
    { alias: 'beta', email: 'beta@example.com', enabled: true, usageCount: 7, source: 'codex' }
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
  featureFlags: { antigravityEnabled: false, stickySessionsEnabled: true }
}

const mockSettings: SettingsInfo = {
  settings: {
    rotationStrategy: 'round-robin',
    criticalThreshold: 10,
    lowThreshold: 30,
    accountWeights: {},
    featureFlags: { antigravityEnabled: false, stickySessionsEnabled: true }
  },
  source: 'test',
  preset: 'balanced',
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
  featureFlags: { antigravityEnabled: false, stickySessionsEnabled: true }
}

const mockStickyConfig = {
  enabled: true,
  identitySources: [
    'header:x-session-affinity',
    'header:session-id',
    'header:session_id',
    'header:conversation_id',
    'body:metadata.session_id',
    'body:metadata.conversation_id'
  ],
  allowPromptCacheKey: false,
  ttlMs: 86_400_000,
  maxEntries: 1000,
  maxFileBytes: 1_048_576,
  updatedAt: Date.now(),
  updatedBy: 'test-suite'
}

const mockStickyStatus = {
  ok: true,
  entries: 2,
  path: '/tmp/sticky-sessions.json',
  exists: true,
  ttlMs: 86_400_000,
  maxEntries: 1000,
  maxFileBytes: 1_048_576,
  sizeBytes: 2048,
  updatedAt: Date.now()
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

describe('ConfigurationPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function createMockFetch(state = mockState, settings = mockSettings, force = mockForceState, featureFlags = mockFeatureFlags) {
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
      if (url === '/api/sticky-sessions/config') {
        return new Response(JSON.stringify(mockStickyConfig), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/sticky-sessions/status') {
        return new Response(JSON.stringify(mockStickyStatus), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/settings' && method === 'PUT') {
        return new Response(JSON.stringify({ ok: true, settings: { ...settings.settings, rotationStrategy: 'least-used' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/force/clear' && method === 'POST') {
        return new Response(JSON.stringify({ ok: true, restoredStrategy: 'round-robin' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/settings/reset' && method === 'POST') {
        return new Response(JSON.stringify({ ok: true, settings: settings.settings }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/settings/preset' && method === 'POST') {
        return new Response(JSON.stringify({ ok: true, preset: 'balanced', settings: settings.settings }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === '/api/force' && method === 'POST') {
        return new Response(JSON.stringify({ ok: true, alias: 'alpha', remainingMs: 86_340_000, remainingTime: '23h 59m' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      return new Response(JSON.stringify({ error: 'Not mocked' }), { status: 404 })
    })
  }

  test('renders configuration page heading', async () => {
    createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /configuration/i })).toBeInTheDocument()
    )
  })

  test('embeds StickySessionPanel when sticky sessions feature flag is enabled', async () => {
    createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /sticky sessions/i })).toBeInTheDocument()
    )
  })

  test('hides StickySessionPanel when sticky sessions feature flag is disabled', async () => {
    const stateWithoutSticky: DashboardState = {
      ...mockState,
      featureFlags: { antigravityEnabled: false, stickySessionsEnabled: false }
    }
    const settingsWithoutSticky: SettingsInfo = {
      ...mockSettings,
      settings: { ...mockSettings.settings, featureFlags: { antigravityEnabled: false, stickySessionsEnabled: false } }
    }
    const featureFlagsWithoutSticky: FeatureFlagsResponse = {
      featureFlags: { antigravityEnabled: false, stickySessionsEnabled: false }
    }

    createMockFetch(stateWithoutSticky, settingsWithoutSticky, mockForceState, featureFlagsWithoutSticky)

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /configuration/i })).toBeInTheDocument()
    )

    expect(screen.queryByRole('heading', { name: /sticky sessions/i })).not.toBeInTheDocument()
  })

  test('renders rotation strategy selector with current value', async () => {
    createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /rotation strategy/i })).toBeInTheDocument()
    )

    const select = screen.getByRole('combobox', { name: /rotation strategy/i }) as HTMLSelectElement
    expect(select.value).toBe('round-robin')
  })

  test('renders threshold inputs with current values', async () => {
    createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: /critical threshold/i })).toBeInTheDocument()
    )

    const criticalInput = screen.getByRole('spinbutton', { name: /critical threshold/i }) as HTMLInputElement
    const lowInput = screen.getByRole('spinbutton', { name: /low threshold/i }) as HTMLInputElement

    expect(criticalInput.value).toBe('10')
    expect(lowInput.value).toBe('30')
  })

  test('renders feature flag toggles', async () => {
    createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /enable antigravity/i })).toBeInTheDocument()
    )

    const antigravityToggle = screen.getByRole('checkbox', { name: /enable antigravity/i }) as HTMLInputElement
    // Use getAllByRole because both Feature Flags and StickySessionPanel have "Enable sticky sessions" checkboxes
    const stickyToggles = screen.getAllByRole('checkbox', { name: /enable sticky sessions/i })

    expect(antigravityToggle.checked).toBe(false)
    expect(stickyToggles.length).toBeGreaterThanOrEqual(1)
    expect((stickyToggles[0] as HTMLInputElement).checked).toBe(true)
  })

  test('renders force mode controls when force mode is inactive', async () => {
    createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /force mode/i })).toBeInTheDocument()
    )

    const forceToggle = screen.getByRole('checkbox', { name: /force mode/i }) as HTMLInputElement
    expect(forceToggle.checked).toBe(false)

    // Force alias select is hidden until user checks the toggle
    expect(screen.queryByRole('combobox', { name: /force alias/i })).not.toBeInTheDocument()
  })

  test('renders force mode status when active', async () => {
    const activeForce: ForceState = {
      ...mockForceState,
      active: true,
      alias: 'alpha',
      remainingTime: '23h 59m',
      remainingMs: 86_340_000
    }

    createMockFetch(mockState, mockSettings, activeForce, mockFeatureFlags)

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByText(/force mode active for/i)).toBeInTheDocument()
    )

    const forceToggle = screen.getByRole('checkbox', { name: /force mode/i }) as HTMLInputElement
    expect(forceToggle.checked).toBe(true)
  })

  test('renders reset settings button', async () => {
    createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /reset to defaults/i })).toBeInTheDocument()
    )
  })

  test('renders preset buttons', async () => {
    createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /balanced/i })).toBeInTheDocument()
    )

    expect(screen.getByRole('button', { name: /conservative/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /aggressive/i })).toBeInTheDocument()
  })

  test('calls API when rotation strategy is changed', async () => {
    const fetchSpy = createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /rotation strategy/i })).toBeInTheDocument()
    )

    const select = screen.getByRole('combobox', { name: /rotation strategy/i })
    fireEvent.change(select, { target: { value: 'least-used' } })

    await waitFor(() => {
      const calls = fetchSpy.mock.calls
      const putCall = calls.find(call => call[0] === '/api/settings' && (call[1] as RequestInit)?.method === 'PUT')
      expect(putCall).toBeDefined()
    })
  })

  test('calls API when force mode is toggled off', async () => {
    const activeForce: ForceState = {
      ...mockForceState,
      active: true,
      alias: 'alpha',
      remainingTime: '23h 59m',
      remainingMs: 86_340_000
    }

    const fetchSpy = createMockFetch(mockState, mockSettings, activeForce, mockFeatureFlags)

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /force mode/i })).toBeInTheDocument()
    )

    const forceToggle = screen.getByRole('checkbox', { name: /force mode/i })
    fireEvent.click(forceToggle)

    await waitFor(() => {
      const calls = fetchSpy.mock.calls
      const clearCall = calls.find(call => call[0] === '/api/force/clear' && (call[1] as RequestInit)?.method === 'POST')
      expect(clearCall).toBeDefined()
    })
  })

  test('calls API when reset settings is clicked', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchSpy = createMockFetch()

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /reset to defaults/i })).toBeInTheDocument()
    )

    const resetButton = screen.getByRole('button', { name: /reset to defaults/i })
    fireEvent.click(resetButton)

    await waitFor(() => {
      const calls = fetchSpy.mock.calls
      const resetCall = calls.find(call => call[0] === '/api/settings/reset' && (call[1] as RequestInit)?.method === 'POST')
      expect(resetCall).toBeDefined()
    })

    confirmSpy.mockRestore()
  })

  test('renders antigravity subsection with navigation link when feature flag is enabled', async () => {
    const stateWithAG: DashboardState = {
      ...mockState,
      featureFlags: { antigravityEnabled: true, stickySessionsEnabled: true }
    }
    const featureFlagsWithAG: FeatureFlagsResponse = {
      featureFlags: { antigravityEnabled: true, stickySessionsEnabled: true }
    }

    createMockFetch(stateWithAG, mockSettings, mockForceState, featureFlagsWithAG)

    render(
      <Routes>
        <Route path="/" element={<ConfigurationPage />} />
      </Routes>,
      { wrapper: createWrapper() }
    )

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /antigravity controls/i })).toBeInTheDocument()
    )

    const manageLink = screen.getByRole('link', { name: /manage antigravity/i })
    expect(manageLink).toBeInTheDocument()
  })
})
