import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type * as http from 'node:http'
import { once } from 'node:events'
import { writeDashboardSandbox } from '../helpers/dashboard-seed.js'

const SANDBOX_ROOT = path.join(os.tmpdir(), 'oma-dashboard-sticky-session-admin-sandbox')
const STORE_FILE = path.join(SANDBOX_ROOT, 'accounts.json')
const AUTH_FILE = path.join(SANDBOX_ROOT, 'auth.json')
const STICKY_FILE = path.join(SANDBOX_ROOT, 'sticky-sessions.json')
const WEB_DIST_DIR = path.resolve(process.cwd(), 'tests/fixtures/web-dist')
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
  writeDashboardSandbox({
    root: SANDBOX_ROOT,
    storeFile: STORE_FILE,
    authFile: AUTH_FILE,
    stickyEnabled: options?.stickyEnabled ?? true,
    accountSet: 'alpha'
  })
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
    OPENCODE_MULTI_AUTH_CODEX_AUTH_FILE: AUTH_FILE,
    OPENCODE_MULTI_AUTH_WEB_DIST_DIR: WEB_DIST_DIR
  }

  ;({ startWebConsole } = await import('../../src/web.js'))
  ;({ getCodexAuthPath } = await import('../../src/codex-auth.js'))
  ;({ hashStickyIdentity } = await import('../../src/sticky-sessions.js'))
})

afterAll(() => {
  try {
    if (getCodexAuthPath) {
      fs.unwatchFile(getCodexAuthPath())
    }
  } catch {
    // ignore
  }
  process.env = originalEnv
  if (fs.existsSync(SANDBOX_ROOT)) {
    fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true })
  }
})

describe('dashboard sticky-session administration', () => {
  it('serves the SPA at the Configuration route via SPA fallback', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
      const response = await fetch(`http://127.0.0.1:${port}/configuration`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')

      const body = await response.text()
      // SPA fixture markers
      expect(body).toContain('fixture-spa-shell')
      expect(body).toContain('<script type="module"')
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('exposes sticky-session config with correct default semantics', async () => {
    seedSandbox({ stickyEnabled: true })
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
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

      // Semantic guardrail: allowPromptCacheKey is NOT a default identity source
      expect(config.body.identitySources).not.toContain('body:prompt_cache_key')
      expect(config.body.allowPromptCacheKey).toBe(false)
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('returns current sticky-session status for direct refresh', async () => {
    const now = Date.now()
    seedSandbox({ stickyEnabled: true })
    seedStickySidecar(now)
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
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
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('performs synchronous cleanup and returns immediate feedback without polling', async () => {
    const now = Date.now()
    seedSandbox({ stickyEnabled: true })

    // Seed sidecar with one stale entry (older than TTL) and one fresh entry
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

    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      // First set a short TTL so the stale entry gets pruned
      const updateTtl = await requestJson(port, '/api/sticky-sessions/config', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          identitySources: ['header:session_id'],
          allowPromptCacheKey: false,
          ttlMs: 60_000, // 1 minute TTL — stale-session at 120s ago will be pruned
          maxEntries: 1000,
          maxFileBytes: 1_048_576,
          actor: 'test-suite'
        })
      })
      expect(updateTtl.status).toBe(200)

      // Trigger synchronous cleanup directly (status endpoint also prunes, so we skip it here)
      const cleanup = await requestJson(port, '/api/sticky-sessions/cleanup', {
        method: 'POST',
        body: JSON.stringify({})
      })

      // Cleanup MUST return 200 OK with complete result immediately (no polling needed)
      expect(cleanup.status).toBe(200)
      expect(cleanup.body).toEqual({
        ok: true,
        before: 2,
        after: 1,
        removed: 1,
        prunedAt: expect.any(Number)
      })

      // Status can be refreshed directly after cleanup
      const afterStatus = await requestJson(port, '/api/sticky-sessions/status')
      expect(afterStatus.status).toBe(200)
      expect(afterStatus.body.entries).toBe(1)
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('gates sticky-session endpoints when feature flag is disabled', async () => {
    seedSandbox({ stickyEnabled: false })
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      const config = await requestJson(port, '/api/sticky-sessions/config')
      expect(config.status).toBe(403)
      expect(config.body).toEqual({
        error: 'Sticky sessions feature is disabled',
        code: 'FEATURE_DISABLED',
        feature: 'sticky-sessions'
      })

      const status = await requestJson(port, '/api/sticky-sessions/status')
      expect(status.status).toBe(403)
      expect(status.body.code).toBe('FEATURE_DISABLED')

      const cleanup = await requestJson(port, '/api/sticky-sessions/cleanup', {
        method: 'POST',
        body: JSON.stringify({})
      })
      expect(cleanup.status).toBe(403)
      expect(cleanup.body.code).toBe('FEATURE_DISABLED')
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('validates sticky-session config updates and preserves backend constraints', async () => {
    seedSandbox({ stickyEnabled: true })
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      // Invalid config should be rejected
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

      // Valid update with advanced allowPromptCacheKey enabled
      const update = await requestJson(port, '/api/sticky-sessions/config', {
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
      expect(update.status).toBe(200)
      expect(update.body).toEqual(
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

      // Verify the updated config is persisted
      const persisted = await requestJson(port, '/api/sticky-sessions/config')
      expect(persisted.status).toBe(200)
      expect(persisted.body.allowPromptCacheKey).toBe(true)
      expect(persisted.body.identitySources).toContain('body:prompt_cache_key')
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('disables sticky sessions and gates endpoints after disable', async () => {
    seedSandbox({ stickyEnabled: true })
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      // Disable sticky sessions
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
      expect(disable.body.enabled).toBe(false)

      // Verify endpoints are gated after disable
      const gatedConfig = await requestJson(port, '/api/sticky-sessions/config')
      expect(gatedConfig.status).toBe(403)

      const gatedStatus = await requestJson(port, '/api/sticky-sessions/status')
      expect(gatedStatus.status).toBe(403)

      const gatedCleanup = await requestJson(port, '/api/sticky-sessions/cleanup', {
        method: 'POST',
        body: JSON.stringify({})
      })
      expect(gatedCleanup.status).toBe(403)
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })
})
