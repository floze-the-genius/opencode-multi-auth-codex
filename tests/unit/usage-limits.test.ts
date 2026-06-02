// @ts-ignore - ESM Jest globals are available at runtime in the test environment.
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

  it('calls the wham usage endpoint with bearer authorization', async () => {
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
      'https://example.test/backend-api/wham/usage',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token'
        })
      })
    )
    expect(mockFetch.mock.calls[0][1]?.headers).not.toEqual(expect.objectContaining({
      originator: expect.any(String),
      'ChatGPT-Account-Id': expect.any(String)
    }))
    expect(result.planType).toBe('pro')
    expect(result.rateLimits?.fiveHour?.remaining).toBe(75)
    expect(result.rateLimits?.weekly?.remaining).toBe(90)
  })

  it('prefers Codex-specific additional rate limits from wham usage payloads', async () => {
    const mockFetch = jest.fn(async () => new Response(JSON.stringify({
      plan_type: 'prolite',
      rate_limit: {
        primary_window: { used_percent: 25, reset_after_seconds: 60 },
        secondary_window: { used_percent: 10, reset_after_seconds: 120 }
      },
      additional_rate_limits: [
        {
          limit_name: 'GPT-5.3-Codex-Spark',
          metered_feature: 'codex_bengalfox',
          rate_limit: {
            primary_window: { used_percent: 2, reset_after_seconds: 300 },
            secondary_window: { used_percent: 3, reset_after_seconds: 600 }
          }
        }
      ]
    }), { status: 200 }))
    global.fetch = mockFetch as typeof fetch

    const result = await fetchUsageRateLimitsForAccount(account)

    expect(result.planType).toBe('prolite')
    expect(result.rateLimits?.fiveHour?.remaining).toBe(98)
    expect(result.rateLimits?.weekly?.remaining).toBe(97)
  })
})
