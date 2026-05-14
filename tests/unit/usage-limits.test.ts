import { jest } from '@jest/globals'
import {
  classifyUsageApiFailure,
  fetchUsageRateLimitsForAccount
} from '../../src/usage-limits.js'
import type { AccountCredentials } from '../../src/types.js'

describe('usage API failure classification', () => {
  it('treats 401 auth failures as terminal and skips probe fallback', () => {
    const result = classifyUsageApiFailure(
      401,
      JSON.stringify({
        error: {
          message: 'Provided authentication token is expired. Please try signing in again.',
          code: 'token_expired'
        },
        status: 401
      })
    )

    expect(result).toEqual({
      shouldProbeFallback: false,
      authInvalid: true
    })
  })

  it('falls back on 403 usage failures without invalidating auth', () => {
    const result = classifyUsageApiFailure(403, '<html>cf challenge</html>')

    expect(result).toEqual({
      shouldProbeFallback: true,
      authInvalid: false
    })
  })

  it('treats deactivated workspace failures as terminal and skips probe fallback', () => {
    const result = classifyUsageApiFailure(
      402,
      JSON.stringify({
        detail: {
          code: 'deactivated_workspace',
          message: 'Workspace is deactivated'
        }
      })
    )

    expect(result).toEqual({
      shouldProbeFallback: false,
      workspaceDeactivated: true,
      workspaceDeactivatedReason: 'Workspace is deactivated'
    })
  })
})

describe('usage API fetch', () => {
  const account: AccountCredentials = {
    alias: 'pro',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accountId: 'account-id',
    expiresAt: Date.now() + 60_000,
    usageCount: 0
  }

  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.OPENCODE_MULTI_AUTH_USAGE_BASE_URL = 'https://example.test/backend-api'
  })

  afterEach(() => {
    global.fetch = originalFetch
    delete process.env.OPENCODE_MULTI_AUTH_USAGE_BASE_URL
    jest.restoreAllMocks()
  })

  it('calls the Codex usage endpoint with Codex originator headers', async () => {
    const mockFetch = jest.fn(async () => new Response(JSON.stringify({
      plan_type: 'pro',
      rate_limit: {
        primary_window: { used_percent: 25, reset_after_seconds: 60 },
        secondary_window: { used_percent: 10, reset_after_seconds: 120 }
      }
    }), { status: 200 }))
    global.fetch = mockFetch as typeof fetch

    const result = await fetchUsageRateLimitsForAccount(account)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.test/backend-api/codex/usage',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'ChatGPT-Account-Id': 'account-id',
          originator: 'codex_cli_rs'
        })
      })
    )
    expect(result.planType).toBe('pro')
    expect(result.rateLimits?.fiveHour?.remaining).toBe(75)
    expect(result.rateLimits?.weekly?.remaining).toBe(90)
  })

  it('does not block an account when included limits are exhausted but credits are available', async () => {
    const mockFetch = jest.fn(async () => new Response(JSON.stringify({
      plan_type: 'pro',
      credits: {
        has_credits: true,
        unlimited: false,
        balance: '10.00'
      },
      rate_limit: {
        allowed: false,
        limit_reached: true,
        primary_window: { used_percent: 100, reset_after_seconds: 60 },
        secondary_window: { used_percent: 100, reset_after_seconds: 120 }
      }
    }), { status: 200 }))
    global.fetch = mockFetch as typeof fetch

    const result = await fetchUsageRateLimitsForAccount(account)

    expect(result.credits).toEqual(expect.objectContaining({
      hasCredits: true,
      unlimited: false,
      balance: '10.00',
      updatedAt: expect.any(Number)
    }))
    expect(result.rateLimits?.fiveHour?.remaining).toBe(0)
    expect(result.rateLimits?.weekly?.remaining).toBe(0)
    expect(result.rateLimitedUntil).toBeUndefined()
  })

  it('blocks an account with credits when credit fallback is disabled for that account', async () => {
    const mockFetch = jest.fn(async () => new Response(JSON.stringify({
      plan_type: 'pro',
      credits: {
        has_credits: true,
        unlimited: false,
        balance: '10.00'
      },
      rate_limit: {
        allowed: false,
        limit_reached: true,
        primary_window: { used_percent: 100, reset_after_seconds: 60 },
        secondary_window: { used_percent: 100, reset_after_seconds: 120 }
      }
    }), { status: 200 }))
    global.fetch = mockFetch as typeof fetch

    const result = await fetchUsageRateLimitsForAccount(account, { creditsAllowed: false })

    expect(result.credits).toEqual(expect.objectContaining({
      hasCredits: true,
      balance: '10.00'
    }))
    expect(result.rateLimitedUntil).toEqual(expect.any(Number))
    expect(result.rateLimitedUntil).toBeGreaterThan(Date.now())
  })

  it('blocks an account when included limits are exhausted and no credits are available', async () => {
    const mockFetch = jest.fn(async () => new Response(JSON.stringify({
      plan_type: 'pro',
      credits: {
        has_credits: false,
        unlimited: false,
        balance: '0.00'
      },
      rate_limit: {
        allowed: false,
        limit_reached: true,
        primary_window: { used_percent: 100, reset_after_seconds: 60 },
        secondary_window: { used_percent: 100, reset_after_seconds: 120 }
      }
    }), { status: 200 }))
    global.fetch = mockFetch as typeof fetch

    const result = await fetchUsageRateLimitsForAccount(account)

    expect(result.credits).toEqual(expect.objectContaining({
      hasCredits: false,
      unlimited: false,
      balance: '0.00'
    }))
    expect(result.rateLimitedUntil).toEqual(expect.any(Number))
    expect(result.rateLimitedUntil).toBeGreaterThan(Date.now())
  })
})
