import { describe, test, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { queryKeys, useRemoveAccountMutation } from '../../api/queries'
import type { DashboardState } from '../../types/api'

const dashboardState: DashboardState = {
  authPath: '/auth.json',
  deviceAlias: 'beta',
  codexActive: { status: 'matched', alias: 'beta', hasAccessToken: true, hasRefreshToken: true, hasIdToken: true },
  rotationAlias: 'alpha',
  accounts: [
    { alias: 'alpha', email: 'alpha@example.com', enabled: true, usageCount: 1, source: 'opencode' },
    { alias: 'beta', email: 'beta@example.com', enabled: true, usageCount: 2, source: 'codex' }
  ],
  lastSyncAt: 0,
  lastSyncError: null,
  lastSyncAlias: null,
  authSummary: { hasAccessToken: true, hasIdToken: true, hasRefreshToken: true },
  storeStatus: { locked: false, encrypted: false, error: null },
  login: null,
  lastLoginError: null,
  antigravity: { accounts: [], path: '' },
  queue: null,
  recommendedAlias: 'alpha',
  logPath: '/logs',
  autoLogin: { path: '', scriptPath: '', pythonPath: '', configured: false, accounts: [] },
  rotationStrategy: 'round-robin',
  force: { active: false, alias: null, forcedAt: null, forcedUntil: null, forcedBy: null, remainingMs: 0, remainingTime: '0s', previousRotationStrategy: null },
  featureFlags: { antigravityEnabled: false, stickySessionsEnabled: false }
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
      mutations: { retry: false }
    }
  })
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function cachedAliases(queryClient: QueryClient): string[] {
  return (queryClient.getQueryData<DashboardState>(queryKeys.dashboardState)?.accounts ?? []).map((account) => account.alias)
}

describe('dashboard query mutations', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('optimistic delete removes account from dashboard cache immediately', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(queryKeys.dashboardState, dashboardState)
    let resolveRemove!: (response: Response) => void
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise<Response>((resolve) => {
      resolveRemove = resolve
    }))

    const { result } = renderHook(() => useRemoveAccountMutation(), { wrapper: createWrapper(queryClient) })

    act(() => {
      result.current.mutate('beta')
    })

    await waitFor(() => expect(cachedAliases(queryClient)).toEqual(['alpha']))
    expect(queryClient.getQueryData<DashboardState>(queryKeys.dashboardState)?.deviceAlias).toBeNull()
    expect(queryClient.getQueryData<DashboardState>(queryKeys.dashboardState)?.codexActive).toEqual(expect.objectContaining({
      status: 'unknown',
      alias: null
    }))

    resolveRemove(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  test('optimistic delete rolls dashboard cache back when mutation fails', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(queryKeys.dashboardState, dashboardState)
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Remove failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    )
    const { result } = renderHook(() => useRemoveAccountMutation(), { wrapper: createWrapper(queryClient) })
    let mutationError: unknown

    await act(async () => {
      try {
        await result.current.mutateAsync('beta')
      } catch (err) {
        mutationError = err
      }
    })

    expect(mutationError).toBeInstanceOf(Error)
    expect(cachedAliases(queryClient)).toEqual(['alpha', 'beta'])
    expect(queryClient.getQueryData<DashboardState>(queryKeys.dashboardState)?.deviceAlias).toBe('beta')
    expect(queryClient.getQueryData<DashboardState>(queryKeys.dashboardState)?.codexActive).toEqual(expect.objectContaining({
      status: 'matched',
      alias: 'beta'
    }))
  })
})
