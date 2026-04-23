import { jest } from '@jest/globals'
import type { AccountCredentials } from '../../src/types.js'

const updateAccount = jest.fn()
const loadStore = jest.fn()
const probeRateLimitsForAccount = jest.fn<() => Promise<any>>()
const fetchUsageRateLimitsForAccount = jest.fn<() => Promise<any>>()
const logError = jest.fn()
const logInfo = jest.fn()
const markAuthInvalid = jest.fn()
const markWorkspaceDeactivated = jest.fn()

jest.unstable_mockModule('../../src/store.js', () => ({
  loadStore,
  updateAccount
}))

jest.unstable_mockModule('../../src/probe-limits.js', () => ({
  probeRateLimitsForAccount
}))

jest.unstable_mockModule('../../src/usage-limits.js', () => ({
  fetchUsageRateLimitsForAccount
}))

jest.unstable_mockModule('../../src/logger.js', () => ({
  logError,
  logInfo
}))

jest.unstable_mockModule('../../src/rotation.js', () => ({
  markAuthInvalid,
  markWorkspaceDeactivated
}))

let refreshRateLimitsForAccount: typeof import('../../src/limits-refresh.js').refreshRateLimitsForAccount

const baseAccount: AccountCredentials = {
  alias: 'dead-token',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 60_000,
  usageCount: 0
}

beforeAll(async () => {
  ;({ refreshRateLimitsForAccount } = await import('../../src/limits-refresh.js'))
})

beforeEach(() => {
  jest.clearAllMocks()
  loadStore.mockReturnValue({
    accounts: {},
    activeAlias: null,
    rotationIndex: 0,
    lastRotation: Date.now()
  })
})

describe('refreshRateLimitsForAccount', () => {
  it('does not launch probe fallback for auth-invalid usage errors', async () => {
    fetchUsageRateLimitsForAccount.mockResolvedValue({
      source: 'usage-api',
      error: 'Usage API returned 401: {"error":{"code":"token_expired"}}',
      shouldProbeFallback: false,
      authInvalid: true
    })

    const result = await refreshRateLimitsForAccount({ ...baseAccount })

    expect(probeRateLimitsForAccount).not.toHaveBeenCalled()
    expect(markAuthInvalid).toHaveBeenCalledWith('dead-token')
    expect(markWorkspaceDeactivated).not.toHaveBeenCalled()
    expect(updateAccount).toHaveBeenLastCalledWith(
      'dead-token',
      expect.objectContaining({
        limitStatus: 'error',
        limitError: expect.stringContaining('Usage API returned 401'),
        lastLimitErrorAt: expect.any(Number),
        limitsConfidence: expect.any(String)
      })
    )
    expect(result).toEqual({
      alias: 'dead-token',
      updated: false,
      error: 'Usage API returned 401: {"error":{"code":"token_expired"}}'
    })
  })

  it('does not launch probe fallback for deactivated workspaces', async () => {
    fetchUsageRateLimitsForAccount.mockResolvedValue({
      source: 'usage-api',
      error: 'Usage API returned 402: {"detail":{"code":"deactivated_workspace"}}',
      shouldProbeFallback: false,
      workspaceDeactivated: true,
      workspaceDeactivatedReason: 'deactivated_workspace'
    })

    const result = await refreshRateLimitsForAccount({ ...baseAccount, alias: 'workspace-dead' })

    expect(probeRateLimitsForAccount).not.toHaveBeenCalled()
    expect(markAuthInvalid).not.toHaveBeenCalled()
    expect(markWorkspaceDeactivated).toHaveBeenCalledWith(
      'workspace-dead',
      30 * 60 * 1000,
      { error: 'deactivated_workspace' }
    )
    expect(result).toEqual({
      alias: 'workspace-dead',
      updated: false,
      error: 'Usage API returned 402: {"detail":{"code":"deactivated_workspace"}}'
    })
  })

  it('clears stale auth invalid state after successful usage refresh', async () => {
    fetchUsageRateLimitsForAccount.mockResolvedValue({
      source: 'usage-api',
      rateLimits: {
        fiveHour: { remaining: 50, resetAt: Date.now() + 60_000 },
        weekly: { remaining: 80, resetAt: Date.now() + 120_000 }
      },
      planType: 'pro'
    })

    const result = await refreshRateLimitsForAccount({
      ...baseAccount,
      authInvalid: true,
      authInvalidatedAt: Date.now() - 10_000
    })

    expect(probeRateLimitsForAccount).not.toHaveBeenCalled()
    expect(updateAccount).toHaveBeenLastCalledWith(
      'dead-token',
      expect.objectContaining({
        limitStatus: 'success',
        authInvalid: false,
        authInvalidatedAt: undefined,
        planType: 'pro'
      })
    )
    expect(result).toEqual({ alias: 'dead-token', updated: true })
  })
})
