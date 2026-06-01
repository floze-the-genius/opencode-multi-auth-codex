// @ts-ignore - ESM Jest globals are available at runtime in the test environment.
import { jest } from '@jest/globals'

const esmJest = jest as typeof jest & {
  unstable_mockModule: (moduleName: string, factory: () => Record<string, unknown>) => void
}

const loadStore = jest.fn()
const updateAccount = jest.fn()
const clearAuthInvalid = jest.fn()
const logError = jest.fn()
const logInfo = jest.fn()

esmJest.unstable_mockModule('../../src/store.js', () => ({
  loadStore,
  updateAccount,
  addAccount: jest.fn()
}))

esmJest.unstable_mockModule('../../src/rotation.js', () => ({
  clearAuthInvalid
}))

esmJest.unstable_mockModule('../../src/logger.js', () => ({
  logError,
  logInfo
}))

let refreshToken: typeof import('../../src/auth.js').refreshToken

beforeAll(async () => {
  ;({ refreshToken } = await import('../../src/auth.js'))
})

beforeEach(() => {
  jest.clearAllMocks()
  loadStore.mockReturnValue({
    accounts: {
      alpha: {
        alias: 'alpha',
        accessToken: 'old-access',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 60_000,
        usageCount: 0
      }
    },
    activeAlias: 'alpha',
    rotationIndex: 0,
    lastRotation: Date.now()
  })
})

describe('refreshToken logging', () => {
  it('writes dashboard-visible error log when refresh token is missing', async () => {
    loadStore.mockReturnValue({
      accounts: {
        alpha: {
          alias: 'alpha',
          accessToken: 'old-access',
          expiresAt: Date.now() + 60_000,
          usageCount: 0
        }
      },
      activeAlias: 'alpha',
      rotationIndex: 0,
      lastRotation: Date.now()
    })

    const result = await refreshToken('alpha')

    expect(result).toBeNull()
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('No refresh token for alpha'))
  })

  it('writes dashboard-visible error log when token endpoint returns non-OK', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))

    const result = await refreshToken('alpha')

    expect(result).toBeNull()
    expect(updateAccount).toHaveBeenCalledWith(
      'alpha',
      expect.objectContaining({
        authInvalid: true,
        authInvalidatedAt: expect.any(Number)
      })
    )
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('Refresh failed for alpha: 401'))
    fetchMock.mockRestore()
  })

  it('writes dashboard-visible error log when refresh throws', async () => {
    const thrown = new Error('network down')
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(thrown)

    const result = await refreshToken('alpha')

    expect(result).toBeNull()
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('Refresh error for alpha: network down'))
    fetchMock.mockRestore()
  })

  it('writes dashboard-visible info log when refresh succeeds', async () => {
    const expiresInSeconds = 3600
    const payload = {
      access_token: 'next-access-token',
      refresh_token: 'next-refresh-token',
      id_token: 'next-id-token',
      expires_in: expiresInSeconds,
      token_type: 'Bearer'
    }
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    updateAccount.mockReturnValue({
      accounts: {
        alpha: {
          alias: 'alpha',
          accessToken: 'next-access-token',
          refreshToken: 'next-refresh-token',
          expiresAt: Date.now() + expiresInSeconds * 1000,
          usageCount: 0
        }
      }
    })

    const result = await refreshToken('alpha')

    expect(result).toEqual(expect.objectContaining({ alias: 'alpha' }))
    expect(clearAuthInvalid).toHaveBeenCalledWith('alpha')
    expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('Token refreshed for alpha'))
    fetchMock.mockRestore()
  })

  it('deduplicates concurrent refreshes for the same alias', async () => {
    const refreshedAccount = {
      alias: 'alpha',
      accessToken: 'shared-next-access-token',
      refreshToken: 'shared-next-refresh-token',
      expiresAt: Date.now() + 3600_000,
      usageCount: 0
    }
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        access_token: 'shared-next-access-token',
        refresh_token: 'shared-next-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    updateAccount.mockReturnValue({ accounts: { alpha: refreshedAccount } })

    const [first, second] = await Promise.all([refreshToken('alpha'), refreshToken('alpha')])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first).toBe(refreshedAccount)
    expect(second).toBe(refreshedAccount)
    fetchMock.mockRestore()
  })

  it('keeps concurrent refreshes for distinct aliases independent', async () => {
    loadStore.mockReturnValue({
      accounts: {
        alpha: {
          alias: 'alpha',
          accessToken: 'old-access-alpha',
          refreshToken: 'refresh-token-alpha',
          expiresAt: Date.now() + 60_000,
          usageCount: 0
        },
        beta: {
          alias: 'beta',
          accessToken: 'old-access-beta',
          refreshToken: 'refresh-token-beta',
          expiresAt: Date.now() + 60_000,
          usageCount: 0
        }
      },
      activeAlias: 'alpha',
      rotationIndex: 0,
      lastRotation: Date.now()
    })
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        access_token: 'next-access-token',
        refresh_token: 'next-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    updateAccount.mockImplementation((alias: string) => ({
      accounts: {
        [alias as string]: {
          alias,
          accessToken: `next-access-${alias}`,
          refreshToken: `next-refresh-${alias}`,
          expiresAt: Date.now() + 3600_000,
          usageCount: 0
        }
      }
    }))

    await Promise.all([refreshToken('alpha'), refreshToken('beta')])

    const refreshTokens = fetchMock.mock.calls.map((call: Parameters<typeof fetch>) => {
      const body = (call[1] as RequestInit).body as URLSearchParams
      return body.get('refresh_token')
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(refreshTokens).toEqual(expect.arrayContaining(['refresh-token-alpha', 'refresh-token-beta']))
    fetchMock.mockRestore()
  })
})
