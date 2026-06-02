// @ts-ignore - ESM Jest globals are available at runtime in the test environment.
import { jest } from '@jest/globals'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const esmJest = jest as typeof jest & {
  unstable_mockModule: (moduleName: string, factory: () => Record<string, unknown>) => void
}

const mockGetNextAccount = jest.fn()
const mockClearAuthInvalid = jest.fn()
const mockMarkAuthInvalid = jest.fn()
const mockMarkModelUnsupported = jest.fn()
const mockMarkRateLimited = jest.fn()
const mockMarkWorkspaceDeactivated = jest.fn()

const defaultStickyConfig = {
  identitySources: [
    'header:x-session-affinity',
    'header:session-id',
    'header:session_id',
    'header:conversation_id',
    'body:metadata.session_id',
    'body:metadata.conversation_id'
  ] as Array<
    'header:x-session-affinity' |
    'header:session-id' |
    'header:session_id' |
    'header:conversation_id' |
    'body:metadata.session_id' |
    'body:metadata.conversation_id' |
    'body:prompt_cache_key'
  >,
  allowPromptCacheKey: false,
  ttlMs: 86_400_000,
  maxEntries: 1000,
  maxFileBytes: 1_048_576
}

let stickyEnabledState = false
let stickyConfigState = { ...defaultStickyConfig }
let rotationStrategyState: 'round-robin' | 'least-used' = 'round-robin'
let originalFetch: typeof globalThis.fetch | undefined
let mockFetch: jest.Mock | undefined
const coldStartRedIt = process.argv.some((arg) => arg.includes('index-sticky.test.ts')) ? it : it.skip

let MultiAuthPlugin: typeof import('../../src/index.js').default

beforeAll(async () => {
  await Promise.all([
    esmJest.unstable_mockModule('../../src/rotation', () => ({
      getNextAccount: mockGetNextAccount,
      clearAuthInvalid: mockClearAuthInvalid,
      markAuthInvalid: mockMarkAuthInvalid,
      markModelUnsupported: mockMarkModelUnsupported,
      markRateLimited: mockMarkRateLimited,
      markWorkspaceDeactivated: mockMarkWorkspaceDeactivated
    })),
    esmJest.unstable_mockModule('../../src/settings', () => ({
      getRuntimeSettings: () => ({
        settings: {
          rotationStrategy: rotationStrategyState,
          criticalThreshold: 10,
          lowThreshold: 30,
          accountWeights: {},
          featureFlags: {
            antigravityEnabled: false,
            stickySessionsEnabled: stickyEnabledState
          }
        },
        source: 'persisted'
      }),
      getStickySessionRuntimeSettings: () => ({
        ...stickyConfigState
      })
    }))
  ])
  ;({ default: MultiAuthPlugin } = await import('../../src/index.js'))
})

describe('Sticky identity request plumbing', () => {
  it('resolves the canonical sticky identity when an allowlisted identity is explicitly allowed', async () => {
    const { resolveStickyIdentity } = await import('../../src/sticky-identity.js')

    const sticky = resolveStickyIdentity({
      headers: new Headers({
        session_id: '  Session-123  ',
        conversation_id: 'ignored-conversation'
      }),
      body: {
        metadata: {
          session_id: 'body-session-should-not-win'
        },
        prompt_cache_key: 'cache-123'
      },
      allowPromptCacheKey: false,
      identitySources: [
        'header:session_id',
        'header:conversation_id',
        'body:metadata.session_id',
        'body:metadata.conversation_id'
      ]
    })

    expect(sticky).toEqual({
      source: 'header:session_id',
      canonical: 'session-123',
      hash: expect.any(String)
    })
  })

  it('returns null when no canonical sticky identity can be derived', async () => {
    const { resolveStickyIdentity } = await import('../../src/sticky-identity.js')

    const sticky = resolveStickyIdentity({
      headers: new Headers(),
      body: {
        metadata: {},
        prompt_cache_key: undefined
      },
      allowPromptCacheKey: false,
      identitySources: ['header:session_id']
    })

    expect(sticky).toBeNull()
  })

  it('does not derive sticky identity from prompt_cache_key without explicit authorization', async () => {
    const { resolveStickyIdentity } = await import('../../src/sticky-identity.js')

    const sticky = resolveStickyIdentity({
      headers: new Headers(),
      body: {
        prompt_cache_key: 'cache-only-123'
      },
      allowPromptCacheKey: false,
      identitySources: ['body:prompt_cache_key']
    })

    expect(sticky).toBeNull()
  })
})

describe('Sticky account-selection context plumbing', () => {
  const originalEnv = process.env
  const testDir = path.join(os.tmpdir(), `oma-index-sticky-${Date.now()}`)
  const testStoreFile = path.join(testDir, 'accounts.json')

  function createAccessToken(accountId: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': {
        chatgpt_account_id: accountId
      }
    })).toString('base64url')

    return `${header}.${payload}.signature`
  }

  function seedStore(): void {
    fs.mkdirSync(testDir, { recursive: true })
    fs.writeFileSync(
      testStoreFile,
      JSON.stringify({
        version: 2,
        accounts: {
          alpha: {
            alias: 'alpha',
            accessToken: 'access-alpha',
            refreshToken: 'refresh-alpha',
            expiresAt: Date.now() + 60_000,
            usageCount: 0,
            enabled: true
          }
        },
        activeAlias: null,
        rotationIndex: 0,
        lastRotation: 0,
        forcedAlias: null,
        forcedUntil: null,
        previousRotationStrategy: null,
        forcedBy: null,
        rotationStrategy: 'round-robin'
      }, null, 2),
      { mode: 0o600 }
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
    stickyEnabledState = false
    stickyConfigState = { ...defaultStickyConfig }
    rotationStrategyState = 'round-robin'
    process.env = {
      ...originalEnv,
      OPENCODE_MULTI_AUTH_STORE_DIR: testDir,
      OPENCODE_MULTI_AUTH_STORE_FILE: testStoreFile
    }
    seedStore()
    originalFetch = globalThis.fetch
    mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch
  })

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch
      originalFetch = undefined
    }
    mockFetch = undefined
    process.env = originalEnv
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  async function invokePluginFetch(options: {
    stickyEnabled: boolean
    headers?: Record<string, string>
    body?: Record<string, unknown>
    stickyConfig?: {
      identitySources: Array<
        'header:session_id' |
        'header:conversation_id' |
        'body:metadata.session_id' |
        'body:metadata.conversation_id' |
        'body:prompt_cache_key'
      >
      allowPromptCacheKey: boolean
      ttlMs?: number
      maxEntries?: number
      maxFileBytes?: number
    }
  }): Promise<{ getNextAccount: jest.Mock; fetchSpy: jest.Mock }> {
    mockGetNextAccount.mockClear()
    mockFetch?.mockClear()
    stickyEnabledState = options.stickyEnabled
    stickyConfigState = {
      ...defaultStickyConfig,
      ...options.stickyConfig,
      identitySources: options.stickyConfig?.identitySources || defaultStickyConfig.identitySources
    }

    mockGetNextAccount.mockResolvedValue({
      account: {
        alias: 'alpha',
        accessToken: 'access-alpha',
        refreshToken: 'refresh-alpha',
        expiresAt: Date.now() + 60_000,
        usageCount: 1,
        enabled: true
      },
      token: createAccessToken('acct-123')
    } as any)

    const hooks = await MultiAuthPlugin({
      client: {},
      $: (() => ({ nothrow: () => ({ catch: () => undefined }) })) as any,
      serverUrl: new URL('http://localhost:3000'),
      project: { id: 'test' },
      directory: testDir
    } as any)

    const auth = await (hooks as any).auth.loader(async () => null as any, {} as any)
    if (typeof auth?.fetch === 'function') {
      await auth.fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: options.headers,
        body: JSON.stringify({
          model: 'gpt-5.4',
          stream: false,
          ...options.body
        })
      })
    }

    return { getNextAccount: mockGetNextAccount, fetchSpy: mockFetch as jest.Mock }
  }

  function headersToRecord(headers: unknown): Record<string, string> {
    if (!headers) {
      return {}
    }

    if (headers instanceof Headers) {
      return Object.fromEntries(headers.entries())
    }

    if (Array.isArray(headers)) {
      return Object.fromEntries(headers as Array<[string, string]>)
    }

    if (typeof headers === 'object') {
      return Object.fromEntries(
        Object.entries(headers as Record<string, unknown>).map(([key, value]) => [key.toLowerCase(), String(value)])
      )
    }

    return {}
  }

  function callHeaders(call: unknown[]): Record<string, string> {
    const first = call[0]
    const second = call[1]

    if (second && typeof second === 'object' && 'headers' in (second as Record<string, unknown>)) {
      return headersToRecord((second as Record<string, unknown>).headers)
    }

    if (first instanceof Request) {
      return headersToRecord(first.headers)
    }

    return {}
  }

  it('passes sticky context into getNextAccount only when the sticky flag is enabled and a canonical identity exists', async () => {
    const { getNextAccount, fetchSpy } = await invokePluginFetch({
      stickyEnabled: true,
      headers: {
        session_id: ' Session-123 '
      },
      body: {
        prompt_cache_key: 'cache-123'
      }
    })

    expect(getNextAccount).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        model: 'gpt-5.4',
        sticky: {
          source: 'header:session_id',
          canonical: 'session-123',
          hash: expect.any(String)
        }
      })
    )

    const headers = callHeaders(fetchSpy.mock.calls[0] ?? [])
    expect(headers.conversation_id).toBe('cache-123')
    expect(headers.session_id).toBe('cache-123')
  })

  it('keeps non-sticky selection unchanged when the sticky flag is disabled or no canonical identity exists', async () => {
    const disabled = await invokePluginFetch({
      stickyEnabled: false,
      headers: {
        session_id: 'Session-Disabled'
      },
      body: {
        prompt_cache_key: 'cache-disabled'
      }
    })

    expect(disabled.getNextAccount).toHaveBeenCalledWith(expect.any(Object), { model: 'gpt-5.4' })
    expect(disabled.fetchSpy).toBeDefined()

    const noIdentity = await invokePluginFetch({
      stickyEnabled: true,
      headers: {},
      body: {}
    })

    expect(noIdentity.getNextAccount).toHaveBeenCalledWith(expect.any(Object), { model: 'gpt-5.4' })
    expect(noIdentity.fetchSpy).toBeDefined()
  })

  it('uses persisted sticky identity source ordering and prompt-cache authorization at runtime', async () => {
    const { getNextAccount, fetchSpy } = await invokePluginFetch({
      stickyEnabled: true,
      headers: {
        session_id: 'session-should-be-ignored'
      },
      body: {
        prompt_cache_key: 'cache-123'
      },
      stickyConfig: {
        identitySources: ['body:prompt_cache_key'],
        allowPromptCacheKey: true
      }
    })

    expect(getNextAccount).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        model: 'gpt-5.4',
        sticky: {
          source: 'body:prompt_cache_key',
          canonical: 'cache-123',
          hash: expect.any(String)
        }
      })
    )

    const headers = callHeaders(fetchSpy.mock.calls[0] ?? [])
    expect(headers.conversation_id).toBe('cache-123')
    expect(headers.session_id).toBe('cache-123')
  })

  coldStartRedIt('RED: plugin cold start routes through metrics-cache least-used telemetry without startWebConsole', async () => {
    const accessAlpha = createAccessToken('acct-alpha')
    const accessBeta = createAccessToken('acct-beta')
    rotationStrategyState = 'least-used'
    fs.writeFileSync(
      testStoreFile,
      JSON.stringify({
        version: 2,
        accounts: {
          alpha: {
            alias: 'alpha',
            accessToken: accessAlpha,
            refreshToken: 'refresh-alpha',
            expiresAt: Date.now() + 60_000,
            usageCount: 0,
            enabled: true
          },
          beta: {
            alias: 'beta',
            accessToken: accessBeta,
            refreshToken: 'refresh-beta',
            expiresAt: Date.now() + 60_000,
            usageCount: 0,
            enabled: true
          }
        },
        activeAlias: null,
        rotationIndex: 0,
        lastRotation: 0,
        forcedAlias: null,
        forcedUntil: null,
        previousRotationStrategy: null,
        forcedBy: null,
        rotationStrategy: 'least-used'
      }, null, 2),
      { mode: 0o600 }
    )
    fs.writeFileSync(
      path.join(testDir, 'account-metrics.json'),
      JSON.stringify({
        version: 1,
        updatedAt: 1_700_000_000_000,
        metrics: {
          alpha: { usageCount: 42, lastUsed: 1_700_000_200_000 },
          beta: { usageCount: 1, lastUsed: 1_700_000_100_000 }
        }
      }, null, 2),
      { mode: 0o600 }
    )

    mockGetNextAccount.mockResolvedValue({
      account: {
        alias: 'alpha',
        accessToken: accessAlpha,
        refreshToken: 'refresh-alpha',
        expiresAt: Date.now() + 60_000,
        usageCount: 1,
        enabled: true
      },
      token: accessAlpha
    } as any)

    const hooks = await MultiAuthPlugin({
      client: {},
      $: (() => ({ nothrow: () => ({ catch: () => undefined }) })) as any,
      serverUrl: new URL('http://localhost:3000'),
      project: { id: 'test' },
      directory: testDir
    } as any)
    const auth = await (hooks as any).auth.loader(async () => null as any, {} as any)
    await auth.fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-5.4', stream: false })
    })

    const headers = callHeaders(mockFetch?.mock.calls[0] ?? [])
    expect(headers['chatgpt-account-id']).toBe('acct-beta')
  })
})
