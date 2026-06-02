import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type * as http from 'node:http'

const SANDBOX_ROOT = path.join(os.tmpdir(), 'oma-sticky-admin-sandbox')
const STORE_FILE = path.join(SANDBOX_ROOT, 'accounts.json')
const AUTH_FILE = path.join(SANDBOX_ROOT, 'auth.json')
const STICKY_FILE = path.join(SANDBOX_ROOT, 'sticky-sessions.json')
const originalEnv = process.env

let startWebConsole: typeof import('../../src/web.js').startWebConsole
let getCodexAuthPath: typeof import('../../src/codex-auth.js').getCodexAuthPath
let hashStickyIdentity: typeof import('../../src/sticky-sessions.js').hashStickyIdentity

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

function seedSandbox(options?: { stickyEnabled?: boolean }): void {
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
            stickySessionsEnabled: options?.stickyEnabled ?? true
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
            enabled: true
          }
        }
      },
      null,
      2
    )
  )
}

function seedStickySidecar(now: number): void {
  fs.writeFileSync(
    STICKY_FILE,
    JSON.stringify(
      {
        version: 1,
        updatedAt: now,
        entries: {
          [hashStickyIdentity('stale-session')]: {
            alias: 'alpha',
            createdAt: now - 120_000,
            lastUsedAt: now - 120_000
          },
          [hashStickyIdentity('fresh-session')]: {
            alias: 'alpha',
            createdAt: now - 1000,
            lastUsedAt: now - 1000
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
  ;({ hashStickyIdentity } = await import('../../src/sticky-sessions.js'))
})

beforeEach(() => {
  seedSandbox({ stickyEnabled: true })
})

afterEach(() => {
  fs.unwatchFile(getCodexAuthPath())
})

afterAll(() => {
  fs.unwatchFile(getCodexAuthPath())
  process.env = originalEnv
  fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true })
})

describe('sticky-session admin API', () => {
  it('exposes additive config, status, and synchronous cleanup endpoints without mutating /api/settings semantics', async () => {
    const now = Date.now()
    seedStickySidecar(now)
    const { server, port } = await startServer()

    try {
      const initialSettings = await requestJson(port, '/api/settings')
      expect(initialSettings.status).toBe(200)
      expect(initialSettings.body.settings.featureFlags).toEqual({
        antigravityEnabled: false,
        stickySessionsEnabled: true
      })
      expect(initialSettings.body.settings.stickySessions).toBeUndefined()

      const config = await requestJson(port, '/api/sticky-sessions/config')
      expect(config.status).toBe(200)
      expect(config.body).toEqual(
        expect.objectContaining({
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
          maxFileBytes: 1_048_576
        })
      )

      const status = await requestJson(port, '/api/sticky-sessions/status')
      expect(status.status).toBe(200)
      expect(status.body).toEqual(
        expect.objectContaining({
          ok: true,
          entries: 2,
          path: STICKY_FILE,
          exists: true,
          ttlMs: 86_400_000,
          maxEntries: 1000,
          maxFileBytes: 1_048_576,
          sizeBytes: expect.any(Number),
          updatedAt: expect.any(Number)
        })
      )

      const invalid = await requestJson(port, '/api/sticky-sessions/config', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          identitySources: ['header:session_id', 'body:prompt_cache_key'],
          allowPromptCacheKey: false,
          ttlMs: 0,
          maxEntries: -1,
          maxFileBytes: 0
        })
      })
      expect(invalid.status).toBe(400)
      expect(invalid.body.code).toBe('VALIDATION_ERROR')

      const updateConfig = await requestJson(port, '/api/sticky-sessions/config', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          identitySources: ['header:conversation_id', 'body:prompt_cache_key'],
          allowPromptCacheKey: true,
          ttlMs: 60_000,
          maxEntries: 50,
          maxFileBytes: 4096,
          actor: 'test-suite'
        })
      })
      expect(updateConfig.status).toBe(200)
      expect(updateConfig.body).toEqual(
        expect.objectContaining({
          enabled: true,
          identitySources: ['header:conversation_id', 'body:prompt_cache_key'],
          allowPromptCacheKey: true,
          ttlMs: 60_000,
          maxEntries: 50,
          maxFileBytes: 4096,
          updatedAt: expect.any(Number),
          updatedBy: 'test-suite'
        })
      )

      const cleanup = await requestJson(port, '/api/sticky-sessions/cleanup', {
        method: 'POST',
        body: JSON.stringify({})
      })
      expect(cleanup.status).toBe(200)
      expect(cleanup.body).toEqual({
        ok: true,
        before: 2,
        after: 1,
        removed: 1,
        prunedAt: expect.any(Number)
      })

      const disable = await requestJson(port, '/api/sticky-sessions/config', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: false,
          identitySources: ['header:conversation_id'],
          allowPromptCacheKey: false,
          ttlMs: 60_000,
          maxEntries: 50,
          maxFileBytes: 4096,
          actor: 'test-suite'
        })
      })
      expect(disable.status).toBe(200)
      expect(disable.body).toEqual(
        expect.objectContaining({
          enabled: false,
          identitySources: ['header:conversation_id'],
          allowPromptCacheKey: false,
          ttlMs: 60_000,
          maxEntries: 50,
          maxFileBytes: 4096,
          updatedAt: expect.any(Number),
          updatedBy: 'test-suite'
        })
      )
      expect(readStore().settings.featureFlags.stickySessionsEnabled).toBe(false)

      const gatedConfig = await requestJson(port, '/api/sticky-sessions/config')
      expect(gatedConfig).toEqual({
        status: 403,
        body: {
          error: 'Sticky sessions feature is disabled',
          code: 'FEATURE_DISABLED',
          feature: 'sticky-sessions'
        }
      })

      const gatedStatus = await requestJson(port, '/api/sticky-sessions/status')
      expect(gatedStatus).toEqual({
        status: 403,
        body: {
          error: 'Sticky sessions feature is disabled',
          code: 'FEATURE_DISABLED',
          feature: 'sticky-sessions'
        }
      })

      const afterSettings = await requestJson(port, '/api/settings')
      expect(afterSettings.status).toBe(200)
      expect(afterSettings.body.settings.featureFlags).toEqual({
        antigravityEnabled: false,
        stickySessionsEnabled: false
      })
      expect(afterSettings.body.settings.stickySessions).toBeUndefined()
    } finally {
      await closeServer(server)
    }
  })
})
