import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type * as http from 'node:http'

const SANDBOX_ROOT = path.join(os.tmpdir(), 'oma-dashboard-contract-sandbox')
const STORE_FILE = path.join(SANDBOX_ROOT, 'accounts.json')
const AUTH_FILE = path.join(SANDBOX_ROOT, 'auth.json')
const originalEnv = process.env

let startWebConsole: typeof import('../../src/web.js').startWebConsole
let getCodexAuthPath: typeof import('../../src/codex-auth.js').getCodexAuthPath

type JsonRecord = Record<string, any>

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve free port'))
        return
      }
      const port = address.port
      server.close((err) => {
        if (err) {
          reject(err)
          return
        }
        resolve(port)
      })
    })
    server.on('error', reject)
  })
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })
}

function seedSandbox(): void {
  fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true })
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true })
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ OPENAI_API_KEY: null, tokens: {} }, null, 2))
  fs.writeFileSync(
    STORE_FILE,
    JSON.stringify(
      {
        version: 2,
        activeAlias: 'alpha',
        rotationIndex: 0,
        lastRotation: 1_700_000_000_000,
        rotationStrategy: 'round-robin',
        settings: {
          rotationStrategy: 'round-robin',
          criticalThreshold: 10,
          lowThreshold: 30,
          accountWeights: {},
          featureFlags: {
            antigravityEnabled: false,
            stickySessionsEnabled: false
          }
        },
        accounts: {
          alpha: {
            alias: 'alpha',
            accessToken: 'token-alpha',
            refreshToken: 'refresh-alpha',
            expiresAt: Date.now() + 60_000,
            email: 'alpha@example.com',
            usageCount: 3,
            enabled: true,
            tags: ['core'],
            notes: 'primary account',
            source: 'opencode',
            rateLimits: {
              fiveHour: { limit: 100, remaining: 80, resetAt: Date.now() + 60_000, updatedAt: Date.now() },
              weekly: { limit: 1000, remaining: 700, resetAt: Date.now() + 120_000, updatedAt: Date.now() }
            },
            limitsConfidence: 'fresh'
          },
          beta: {
            alias: 'beta',
            accessToken: 'token-beta',
            refreshToken: 'refresh-beta',
            expiresAt: Date.now() + 120_000,
            email: 'beta@example.com',
            usageCount: 7,
            enabled: true,
            tags: ['backup'],
            notes: 'secondary account',
            source: 'codex',
            rateLimits: {
              fiveHour: { limit: 100, remaining: 50, resetAt: Date.now() + 60_000, updatedAt: Date.now() },
              weekly: { limit: 1000, remaining: 450, resetAt: Date.now() + 120_000, updatedAt: Date.now() }
            },
            limitsConfidence: 'stale'
          }
        }
      },
      null,
      2
    )
  )
}

function readStore(): JsonRecord {
  return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as JsonRecord
}

async function startServer(): Promise<{ server: http.Server; port: number }> {
  const port = await getFreePort()
  const server = startWebConsole({ host: '127.0.0.1', port })
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  return { server, port }
}

async function requestJson(port: number, pathname: string, init?: RequestInit): Promise<{ status: number; body: JsonRecord }> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init
  })
  return {
    status: response.status,
    body: (await response.json()) as JsonRecord
  }
}

beforeAll(async () => {
  seedSandbox()
  process.env = {
    ...originalEnv,
    OPENCODE_MULTI_AUTH_STORE_DIR: SANDBOX_ROOT,
    OPENCODE_MULTI_AUTH_STORE_FILE: STORE_FILE,
    OPENCODE_MULTI_AUTH_CODEX_AUTH_FILE: AUTH_FILE
  }

  ;({ startWebConsole } = await import('../../src/web.js'))
  ;({ getCodexAuthPath } = await import('../../src/codex-auth.js'))
})

beforeEach(() => {
  seedSandbox()
})

afterEach(() => {
  fs.unwatchFile(getCodexAuthPath())
})

afterAll(() => {
  fs.unwatchFile(getCodexAuthPath())
  process.env = originalEnv
  fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true })
})

describe('dashboard API contract parity', () => {
  it('preserves state and logs response shapes without leaking secrets', async () => {
    const { server, port } = await startServer()

    try {
      const state = await requestJson(port, '/api/state')
      expect(state.status).toBe(200)
      expect(state.body.authPath).toBe(AUTH_FILE)
      expect(state.body.deviceAlias).toBeNull()
      expect(state.body.rotationAlias).toBe('alpha')
      expect(state.body.authSummary).toEqual({
        hasAccessToken: false,
        hasIdToken: false,
        hasRefreshToken: false
      })
      expect(state.body.storeStatus).toEqual({ locked: false, encrypted: false, error: null })
      expect(state.body.login).toBeNull()
      expect(state.body.lastSyncAt).toEqual(expect.any(Number))
      expect(state.body.lastSyncError).toBe('Missing access_token/refresh_token in auth.json')
      expect(state.body.lastSyncAlias).toBeNull()
      expect(state.body.antigravity).toEqual({
        accounts: [],
        path: expect.any(String),
        quota: {
          status: 'disabled',
          scope: 'active'
        }
      })
      expect(state.body.queue).toBeNull()
      expect(state.body.recommendedAlias).toBe('alpha')
      expect(state.body.logPath).toEqual(expect.any(String))
      expect(state.body.autoLogin).toEqual(
        expect.objectContaining({
          configured: false,
          accounts: [],
          error: 'credentials.json not found'
        })
      )
      expect(state.body.rotationStrategy).toBe('round-robin')
      expect(state.body.force).toEqual({
        active: false,
        alias: null,
        forcedUntil: null,
        forcedBy: null,
        remainingMs: 0,
        remainingTime: '0m'
      })
      expect(state.body.featureFlags).toEqual({ antigravityEnabled: false, stickySessionsEnabled: false })
      expect(state.body.accounts).toHaveLength(2)
      expect(state.body.accounts[0]).toEqual(
        expect.objectContaining({
          alias: 'alpha',
          email: 'alpha@example.com',
          enabled: true,
          usageCount: 3,
          tags: ['core'],
          notes: 'primary account'
        })
      )
      expect(state.body.accounts[0]).not.toHaveProperty('accessToken')
      expect(state.body.accounts[0]).not.toHaveProperty('refreshToken')
      expect(state.body.accounts[0]).not.toHaveProperty('idToken')

      const logs = await requestJson(port, '/api/logs?limit=5')
      expect(logs.status).toBe(200)
      expect(typeof logs.body.path).toBe('string')
      expect(Array.isArray(logs.body.lines)).toBe(true)
    } finally {
      await closeServer(server)
    }
  })

  it('preserves account and login action validation and mutation payloads', async () => {
    const { server, port } = await startServer()

    try {
      const accounts = await requestJson(port, '/api/accounts')
      expect(accounts.status).toBe(200)
      expect(accounts.body).toEqual({
        accounts: [
          expect.objectContaining({
            alias: 'alpha',
            email: 'alpha@example.com',
            enabled: true,
            usageCount: 3,
            tags: ['core'],
            notes: 'primary account'
          }),
          expect.objectContaining({
            alias: 'beta',
            email: 'beta@example.com',
            enabled: true,
            usageCount: 7,
            tags: ['backup'],
            notes: 'secondary account'
          })
        ]
      })

      const disableAlpha = await requestJson(port, '/api/accounts/alpha/enabled', {
        method: 'PUT',
        body: JSON.stringify({ enabled: false })
      })
      expect(disableAlpha.status).toBe(200)
      expect(disableAlpha.body).toEqual(
        expect.objectContaining({
          ok: true,
          alias: 'alpha',
          enabled: false,
          disabledAt: expect.any(Number),
          disabledBy: 'dashboard'
        })
      )

      const disableAlphaAgain = await requestJson(port, '/api/accounts/alpha/enabled', {
        method: 'PUT',
        body: JSON.stringify({ enabled: false })
      })
      expect(disableAlphaAgain.status).toBe(409)
      expect(disableAlphaAgain.body).toEqual({
        error: 'Account is already disabled',
        code: 'ALREADY_IN_STATE'
      })

      const disableLastEnabled = await requestJson(port, '/api/accounts/beta/enabled', {
        method: 'PUT',
        body: JSON.stringify({ enabled: false })
      })
      expect(disableLastEnabled.status).toBe(409)
      expect(disableLastEnabled.body).toEqual({
        error: 'Cannot disable the last enabled account',
        code: 'LAST_ACCOUNT'
      })

      const missingAuth = await requestJson(port, '/api/auth/start', {
        method: 'POST',
        body: JSON.stringify({})
      })
      expect(missingAuth).toEqual({ status: 400, body: { error: 'Missing alias' } })

      const missingAutoLoginSelector = await requestJson(port, '/api/auto-login/start', {
        method: 'POST',
        body: JSON.stringify({})
      })
      expect(missingAutoLoginSelector).toEqual({ status: 400, body: { error: 'Missing selector' } })

      const missingAutoLoginEmail = await requestJson(port, '/api/auto-login/add', {
        method: 'POST',
        body: JSON.stringify({ password: 'secret' })
      })
      expect(missingAutoLoginEmail).toEqual({ status: 400, body: { error: 'Missing login/email' } })

      const missingAutoLoginPassword = await requestJson(port, '/api/auto-login/add', {
        method: 'POST',
        body: JSON.stringify({ email: 'bot@example.com', password: '   ' })
      })
      expect(missingAutoLoginPassword).toEqual({ status: 400, body: { error: 'Missing password' } })

      const missingSwitchAlias = await requestJson(port, '/api/switch', {
        method: 'POST',
        body: JSON.stringify({})
      })
      expect(missingSwitchAlias).toEqual({ status: 400, body: { error: 'Missing alias' } })

      const missingReauthAlias = await requestJson(port, '/api/accounts/ghost/reauth', {
        method: 'POST',
        body: JSON.stringify({ actor: 'test-suite' })
      })
      expect(missingReauthAlias.status).toBe(404)
      expect(missingReauthAlias.body).toEqual({ error: 'Unknown alias', code: 'ACCOUNT_NOT_FOUND' })

      const updateMeta = await requestJson(port, '/api/account/meta', {
        method: 'POST',
        body: JSON.stringify({ alias: 'beta', tags: ' Ops,ops, Team ', notes: ' updated note ' })
      })
      expect(updateMeta).toEqual({ status: 200, body: { ok: true } })
      expect(readStore().accounts.beta.tags).toEqual(['ops', 'team'])
      expect(readStore().accounts.beta.notes).toBe('updated note')

      const removeBeta = await requestJson(port, '/api/remove', {
        method: 'POST',
        body: JSON.stringify({ alias: 'beta' })
      })
      expect(removeBeta).toEqual({ status: 200, body: { ok: true } })
      expect(readStore().accounts.beta).toBeUndefined()
    } finally {
      await closeServer(server)
    }
  })

  it('preserves settings, force-mode, sync, refresh, and antigravity contracts', async () => {
    const { server, port } = await startServer()

    try {
      const sync = await requestJson(port, '/api/sync', {
        method: 'POST',
        body: JSON.stringify({})
      })
      expect(sync).toEqual({ status: 200, body: { ok: true } })

      const tokenRefreshUnknown = await requestJson(port, '/api/token/refresh', {
        method: 'POST',
        body: JSON.stringify({ alias: 'ghost' })
      })
      expect(tokenRefreshUnknown).toEqual({ status: 400, body: { error: 'Unknown alias' } })

      const logsAfterUnknownRefresh = await requestJson(port, '/api/logs?limit=50')
      expect(logsAfterUnknownRefresh.status).toBe(200)
      expect(logsAfterUnknownRefresh.body.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'warn',
            message: expect.stringContaining('[multi-auth] Refresh requested for unknown alias: ghost')
          })
        ])
      )

      const limitsRefreshUnknown = await requestJson(port, '/api/limits/refresh', {
        method: 'POST',
        body: JSON.stringify({ alias: 'ghost' })
      })
      expect(limitsRefreshUnknown).toEqual({ status: 400, body: { error: 'Unknown alias' } })

      const stopRefresh = await requestJson(port, '/api/limits/stop', {
        method: 'POST',
        body: JSON.stringify({})
      })
      expect(stopRefresh).toEqual({ status: 200, body: { ok: true } })

      const forceState = await requestJson(port, '/api/force')
      expect(forceState.status).toBe(200)
      expect(forceState.body).toEqual(
        expect.objectContaining({
          active: false,
          alias: null,
          forcedAt: null,
          forcedUntil: null,
          forcedBy: null,
          remainingMs: 0,
          remainingTime: '0m',
          previousRotationStrategy: null
        })
      )

      const missingForceAlias = await requestJson(port, '/api/force', {
        method: 'POST',
        body: JSON.stringify({})
      })
      expect(missingForceAlias).toEqual({
        status: 400,
        body: { error: 'Missing alias', code: 'MISSING_ALIAS' }
      })

      const activateForce = await requestJson(port, '/api/force', {
        method: 'POST',
        body: JSON.stringify({ alias: 'alpha', actor: 'test-suite' })
      })
      expect(activateForce.status).toBe(200)
      expect(activateForce.body).toEqual(
        expect.objectContaining({
          ok: true,
          alias: 'alpha',
          forcedUntil: expect.any(Number),
          remainingMs: expect.any(Number),
          remainingTime: expect.any(String),
          previousRotationStrategy: 'round-robin'
        })
      )

      const forceAfterActivation = await requestJson(port, '/api/force')
      expect(forceAfterActivation.status).toBe(200)
      expect(forceAfterActivation.body).toEqual(
        expect.objectContaining({
          active: true,
          alias: 'alpha',
          forcedBy: 'test-suite',
          previousRotationStrategy: 'round-robin'
        })
      )

      const clearForce = await requestJson(port, '/api/force/clear', {
        method: 'POST',
        body: JSON.stringify({})
      })
      expect(clearForce).toEqual({ status: 200, body: { ok: true, restoredStrategy: 'round-robin' } })

      const settings = await requestJson(port, '/api/settings')
      expect(settings.status).toBe(200)
      expect(settings.body).toEqual(
        expect.objectContaining({
          settings: expect.objectContaining({
            rotationStrategy: 'round-robin',
            criticalThreshold: 10,
            lowThreshold: 30,
            accountWeights: {},
            featureFlags: expect.objectContaining({ antigravityEnabled: false, stickySessionsEnabled: false })
          }),
          source: 'persisted',
          canReset: true
        })
      )

      const updateSettings = await requestJson(port, '/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          actor: 'test-suite',
          rotationStrategy: 'least-used',
          criticalThreshold: 15,
          lowThreshold: 45,
          featureFlags: { antigravityEnabled: true }
        })
      })
      expect(updateSettings.status).toBe(200)
      expect(updateSettings.body).toEqual(
        expect.objectContaining({
          ok: true,
          settings: expect.objectContaining({
            rotationStrategy: 'least-used',
            criticalThreshold: 15,
            lowThreshold: 45,
            featureFlags: expect.objectContaining({ antigravityEnabled: true, stickySessionsEnabled: false }),
            updatedBy: 'test-suite'
          })
        })
      )

      const invalidFeatureFlags = await requestJson(port, '/api/settings/feature-flags', {
        method: 'PUT',
        body: JSON.stringify({})
      })
      expect(invalidFeatureFlags).toEqual({
        status: 400,
        body: { error: 'Invalid feature flags', code: 'INVALID_FEATURE_FLAGS' }
      })

      const featureFlags = await requestJson(port, '/api/settings/feature-flags')
      expect(featureFlags).toEqual({
        status: 200,
        body: {
          featureFlags: {
            antigravityEnabled: true,
            stickySessionsEnabled: false
          }
        }
      })

      const resetSettings = await requestJson(port, '/api/settings/reset', {
        method: 'POST',
        body: JSON.stringify({ actor: 'test-suite' })
      })
      expect(resetSettings.status).toBe(200)
      expect(resetSettings.body).toEqual(
        expect.objectContaining({
          ok: true,
          settings: expect.objectContaining({
            rotationStrategy: 'round-robin',
            criticalThreshold: 10,
            lowThreshold: 30,
            accountWeights: {},
            featureFlags: expect.objectContaining({ antigravityEnabled: false, stickySessionsEnabled: false })
          })
        })
      )

      const applyPreset = await requestJson(port, '/api/settings/preset', {
        method: 'POST',
        body: JSON.stringify({ preset: 'balanced', actor: 'test-suite' })
      })
      expect(applyPreset.status).toBe(200)
      expect(applyPreset.body).toEqual(
        expect.objectContaining({
          ok: true,
          preset: 'balanced',
          settings: expect.objectContaining({
            rotationStrategy: 'weighted-round-robin',
            criticalThreshold: 10,
            lowThreshold: 30,
            accountWeights: expect.objectContaining({ alpha: 0.5, beta: 0.5 })
          })
        })
      )

      const invalidPreset = await requestJson(port, '/api/settings/preset', {
        method: 'POST',
        body: JSON.stringify({ preset: 'nope' })
      })
      expect(invalidPreset).toEqual({
        status: 400,
        body: {
          error: 'Invalid preset',
          code: 'INVALID_PRESET',
          validPresets: ['balanced', 'conservative', 'aggressive', 'custom']
        }
      })

      const antigravityRefresh = await requestJson(port, '/api/antigravity/refresh', {
        method: 'POST',
        body: JSON.stringify({})
      })
      expect(antigravityRefresh).toEqual({
        status: 403,
        body: {
          error: 'Antigravity feature is disabled',
          code: 'FEATURE_DISABLED',
          feature: 'antigravity'
        }
      })

      const antigravityRefreshAll = await requestJson(port, '/api/antigravity/refresh-all', {
        method: 'POST',
        body: JSON.stringify({})
      })
      expect(antigravityRefreshAll).toEqual({
        status: 403,
        body: {
          error: 'Antigravity feature is disabled',
          code: 'FEATURE_DISABLED',
          feature: 'antigravity'
        }
      })
    } finally {
      await closeServer(server)
    }
  })
})
