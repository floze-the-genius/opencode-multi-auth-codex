// @ts-ignore - ESM Jest globals are available at runtime in the test environment.
import { jest } from '@jest/globals'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type * as http from 'node:http'

const esmJest = jest as typeof jest & {
  unstable_mockModule: (moduleName: string, factory: () => Record<string, unknown>) => void
}

const AUTH_PATH = path.join(os.tmpdir(), 'oma-web-reauth-auth.json')
const flow = {
  pkce: { verifier: 'verifier', challenge: 'challenge' },
  state: 'state',
  url: 'http://localhost/auth',
  redirectUri: 'http://localhost:1455/auth/callback',
  port: 1455
}

const createAuthorizationFlow = jest.fn()
const loginAccount = jest.fn()
const refreshToken = jest.fn()
const syncCodexAuthFile = jest.fn()
const writeCodexAuthForAlias = jest.fn()
const loadStore = jest.fn()
const updateAccount = jest.fn()
const logInfo = jest.fn()
const logError = jest.fn()

esmJest.unstable_mockModule('../../src/auth.js', () => ({
  createAuthorizationFlow,
  loginAccount,
  refreshToken
}))

esmJest.unstable_mockModule('../../src/codex-auth.js', () => ({
  getCodexAuthPath: () => AUTH_PATH,
  getCodexAuthStatus: () => ({ error: null }),
  getCodexAuthSummary: () => ({ hasAccessToken: false, hasRefreshToken: false, hasIdToken: false }),
  resolveAliasForCurrentAuth: () => null,
  syncCodexAuthFile,
  writeCodexAuthForAlias
}))

esmJest.unstable_mockModule('../../src/store.js', () => ({
  getStoreStatus: () => ({ locked: false, encrypted: false, error: null }),
  listAccounts: jest.fn(),
  loadStore,
  removeAccount: jest.fn(),
  updateAccount
}))

esmJest.unstable_mockModule('../../src/logger.js', () => ({
  getLogPath: () => path.join(os.tmpdir(), 'oma-web-reauth.log'),
  logError,
  logInfo,
  logWarn: jest.fn(),
  readLogTail: () => []
}))

esmJest.unstable_mockModule('../../src/refresh-queue.js', () => ({
  getRefreshQueueState: () => null,
  startRefreshQueue: jest.fn(),
  stopRefreshQueue: jest.fn()
}))

esmJest.unstable_mockModule('../../src/force-mode.js', () => ({
  getForceState: () => ({ forcedAlias: null, forcedUntil: null, forcedBy: null, previousRotationStrategy: null }),
  activateForce: jest.fn(),
  clearForce: jest.fn(),
  isForceActive: () => false,
  getRemainingForceTimeMs: () => 0,
  formatForceDuration: () => '0m'
}))

esmJest.unstable_mockModule('../../src/settings.js', () => ({
  getSettings: () => ({ settings: { featureFlags: { antigravityEnabled: false, stickySessionsEnabled: false } } }),
  getRuntimeSettings: () => ({ settings: { rotationStrategy: 'round-robin' } }),
  updateSettings: jest.fn(),
  isFeatureEnabled: () => false,
  getStickySessionConfig: () => ({}),
  getStickySessionRuntimeSettings: () => ({}),
  updateStickySessionConfig: jest.fn()
}))

esmJest.unstable_mockModule('../../src/sticky-sessions.js', () => ({
  cleanupStickySessions: jest.fn(),
  getStickySessionsStatus: () => ({})
}))

let startWebConsole: typeof import('../../src/web.js').startWebConsole

beforeAll(async () => {
  ;({ startWebConsole } = await import('../../src/web.js'))
})

beforeEach(() => {
  jest.clearAllMocks()
  fs.writeFileSync(AUTH_PATH, '{}')
  createAuthorizationFlow.mockResolvedValue(flow)
  syncCodexAuthFile.mockReturnValue({ alias: null, added: false, updated: false })
  loadStore.mockReturnValue({
    accounts: {
      alpha: {
        alias: 'alpha',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 60_000,
        enabled: true,
        usageCount: 0
      }
    },
    activeAlias: 'alpha',
    rotationIndex: 0,
    lastRotation: Date.now()
  })
})

afterEach(() => {
  fs.unwatchFile(AUTH_PATH)
  fs.rmSync(AUTH_PATH, { force: true })
})

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve free port'))
        return
      }
      server.close(() => resolve(address.port))
    })
    server.on('error', reject)
  })
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve())
  })
}

async function requestJson(port: number, pathname: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('dashboard reauth', () => {
  it('writes refreshed reauth credentials to codex auth and still updates lastRefresh', async () => {
    let resolveLogin!: (account: unknown) => void
    loginAccount.mockReturnValue(new Promise((resolve) => {
      resolveLogin = resolve
    }))
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))

    try {
      const response = await requestJson(port, '/api/accounts/alpha/reauth', {
        method: 'POST',
        body: JSON.stringify({ actor: 'test-suite' })
      })
      expect(response).toEqual({
        status: 200,
        body: expect.objectContaining({ ok: true, alias: 'alpha', url: flow.url })
      })

      resolveLogin({ alias: 'alpha' })
      await flushMicrotasks()

      expect(writeCodexAuthForAlias).toHaveBeenCalledWith('alpha')
      expect(updateAccount).toHaveBeenCalledWith('alpha', {
        lastRefresh: expect.any(String)
      })
      expect(logInfo).toHaveBeenCalledWith('Re-auth completed for alpha by test-suite')
    } finally {
      await closeServer(server)
    }
  })
})
