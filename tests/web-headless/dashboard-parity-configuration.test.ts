import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type * as http from 'node:http'
import { once } from 'node:events'
import { writeDashboardSandbox } from '../helpers/dashboard-seed.js'

const SANDBOX_ROOT = path.join(os.tmpdir(), 'oma-dashboard-parity-configuration-sandbox')
const STORE_FILE = path.join(SANDBOX_ROOT, 'accounts.json')
const AUTH_FILE = path.join(SANDBOX_ROOT, 'auth.json')
const WEB_DIST_DIR = path.resolve(process.cwd(), 'tests/fixtures/web-dist')
const originalEnv = process.env

let startWebConsole: typeof import('../../src/web.js').startWebConsole
let getCodexAuthPath: typeof import('../../src/codex-auth.js').getCodexAuthPath

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
  writeDashboardSandbox({ root: SANDBOX_ROOT, storeFile: STORE_FILE, authFile: AUTH_FILE, stickyEnabled: true })
}

beforeAll(async () => {
  if (fs.existsSync(SANDBOX_ROOT)) {
    fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true })
  }
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true })
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ OPENAI_API_KEY: null, tokens: {} }, null, 2))

  process.env = {
    ...originalEnv,
    OPENCODE_MULTI_AUTH_STORE_DIR: SANDBOX_ROOT,
    OPENCODE_MULTI_AUTH_STORE_FILE: STORE_FILE,
    OPENCODE_MULTI_AUTH_CODEX_AUTH_FILE: AUTH_FILE,
    OPENCODE_MULTI_AUTH_WEB_DIST_DIR: WEB_DIST_DIR
  }

  ;({ startWebConsole } = await import('../../src/web.js'))
  ;({ getCodexAuthPath } = await import('../../src/codex-auth.js'))
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

describe('dashboard parity configuration', () => {
  it('serves the SPA with configuration surface markers', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
      const response = await fetch(`http://127.0.0.1:${port}/`)
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

  it('preserves settings GET/PUT contracts and rotation strategy updates', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      // GET /api/settings
      const settingsResponse = await fetch(`http://127.0.0.1:${port}/api/settings`)
      expect(settingsResponse.status).toBe(200)
      const settingsBody = (await settingsResponse.json()) as Record<string, unknown>
      expect(settingsBody).toEqual(
        expect.objectContaining({
          settings: expect.objectContaining({
            rotationStrategy: 'round-robin',
            criticalThreshold: 10,
            lowThreshold: 30
          }),
          source: expect.any(String),
          canReset: expect.any(Boolean)
        })
      )

      // PUT /api/settings - update rotation strategy
      const updateResponse = await fetch(`http://127.0.0.1:${port}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotationStrategy: 'least-used', actor: 'test-suite' })
      })
      expect(updateResponse.status).toBe(200)
      const updateBody = (await updateResponse.json()) as Record<string, unknown>
      expect(updateBody).toEqual(
        expect.objectContaining({
          ok: true,
          settings: expect.objectContaining({
            rotationStrategy: 'least-used'
          })
        })
      )

      // Verify settings persisted
      const settingsAfter = await fetch(`http://127.0.0.1:${port}/api/settings`)
      expect(settingsAfter.status).toBe(200)
      const settingsAfterBody = (await settingsAfter.json()) as Record<string, unknown>
      expect((settingsAfterBody.settings as Record<string, unknown>).rotationStrategy).toBe('least-used')
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves threshold update contracts', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      // Update thresholds
      const updateResponse = await fetch(`http://127.0.0.1:${port}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criticalThreshold: 5, lowThreshold: 20, actor: 'test-suite' })
      })
      expect(updateResponse.status).toBe(200)
      const updateBody = (await updateResponse.json()) as Record<string, unknown>
      expect(updateBody).toEqual(
        expect.objectContaining({
          ok: true,
          settings: expect.objectContaining({
            criticalThreshold: 5,
            lowThreshold: 20
          })
        })
      )
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves feature flags GET/PUT contracts', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      // GET /api/settings/feature-flags
      const flagsResponse = await fetch(`http://127.0.0.1:${port}/api/settings/feature-flags`)
      expect(flagsResponse.status).toBe(200)
      const flagsBody = (await flagsResponse.json()) as Record<string, unknown>
      expect(flagsBody).toEqual(
        expect.objectContaining({
          featureFlags: expect.objectContaining({
            antigravityEnabled: false,
            stickySessionsEnabled: true
          })
        })
      )

      // PUT /api/settings/feature-flags - enable antigravity
      const updateResponse = await fetch(`http://127.0.0.1:${port}/api/settings/feature-flags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureFlags: { antigravityEnabled: true, stickySessionsEnabled: true }, actor: 'test-suite' })
      })
      expect(updateResponse.status).toBe(200)
      const updateBody = (await updateResponse.json()) as Record<string, unknown>
      expect(updateBody).toEqual(
        expect.objectContaining({
          ok: true,
          featureFlags: expect.objectContaining({
            antigravityEnabled: true,
            stickySessionsEnabled: true
          })
        })
      )

      // Verify feature flags persisted
      const flagsAfter = await fetch(`http://127.0.0.1:${port}/api/settings/feature-flags`)
      expect(flagsAfter.status).toBe(200)
      const flagsAfterBody = (await flagsAfter.json()) as Record<string, unknown>
      expect((flagsAfterBody.featureFlags as Record<string, unknown>).antigravityEnabled).toBe(true)
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves reset settings contract', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      // First change a setting
      const updateResponse = await fetch(`http://127.0.0.1:${port}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotationStrategy: 'random', actor: 'test-suite' })
      })
      expect(updateResponse.status).toBe(200)

      // Reset settings
      const resetResponse = await fetch(`http://127.0.0.1:${port}/api/settings/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: 'test-suite' })
      })
      expect(resetResponse.status).toBe(200)
      const resetBody = (await resetResponse.json()) as Record<string, unknown>
      expect(resetBody).toEqual(
        expect.objectContaining({
          ok: true,
          settings: expect.objectContaining({
            rotationStrategy: 'round-robin'
          })
        })
      )

      // Verify settings were reset
      const settingsAfter = await fetch(`http://127.0.0.1:${port}/api/settings`)
      expect(settingsAfter.status).toBe(200)
      const settingsAfterBody = (await settingsAfter.json()) as Record<string, unknown>
      expect((settingsAfterBody.settings as Record<string, unknown>).rotationStrategy).toBe('round-robin')
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves preset application contract', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      // Apply balanced preset
      const presetResponse = await fetch(`http://127.0.0.1:${port}/api/settings/preset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: 'balanced', actor: 'test-suite' })
      })
      expect(presetResponse.status).toBe(200)
      const presetBody = (await presetResponse.json()) as Record<string, unknown>
      expect(presetBody).toEqual(
        expect.objectContaining({
          ok: true,
          preset: 'balanced',
          settings: expect.any(Object)
        })
      )

      // Apply conservative preset
      const conservativeResponse = await fetch(`http://127.0.0.1:${port}/api/settings/preset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: 'conservative', actor: 'test-suite' })
      })
      expect(conservativeResponse.status).toBe(200)

      // Apply aggressive preset (may succeed or fail depending on backend constraints)
      const aggressiveResponse = await fetch(`http://127.0.0.1:${port}/api/settings/preset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: 'aggressive', actor: 'test-suite' })
      })
      expect([200, 400]).toContain(aggressiveResponse.status)
      if (aggressiveResponse.status === 200) {
        const aggressiveBody = (await aggressiveResponse.json()) as Record<string, unknown>
        expect(aggressiveBody).toHaveProperty('ok', true)
        expect(aggressiveBody).toHaveProperty('preset', 'aggressive')
      }

      // Invalid preset should fail
      const invalidResponse = await fetch(`http://127.0.0.1:${port}/api/settings/preset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: 'invalid', actor: 'test-suite' })
      })
      expect(invalidResponse.status).toBe(400)
      const invalidBody = (await invalidResponse.json()) as Record<string, unknown>
      expect(invalidBody).toEqual(
        expect.objectContaining({
          error: 'Invalid preset',
          code: 'INVALID_PRESET'
        })
      )
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves force mode activation/clear from configuration context', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      // Activate force mode
      const activateResponse = await fetch(`http://127.0.0.1:${port}/api/force`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: 'alpha', actor: 'test-suite' })
      })
      expect(activateResponse.status).toBe(200)
      const activateBody = (await activateResponse.json()) as Record<string, unknown>
      expect(activateBody).toEqual(
        expect.objectContaining({
          ok: true,
          alias: 'alpha',
          remainingMs: expect.any(Number),
          remainingTime: expect.any(String)
        })
      )

      // Verify force state
      const forceState = await fetch(`http://127.0.0.1:${port}/api/force`)
      expect(forceState.status).toBe(200)
      const forceBody = (await forceState.json()) as Record<string, unknown>
      expect(forceBody).toEqual(
        expect.objectContaining({
          active: true,
          alias: 'alpha',
          forcedBy: 'test-suite'
        })
      )

      // Clear force mode
      const clearResponse = await fetch(`http://127.0.0.1:${port}/api/force/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      expect(clearResponse.status).toBe(200)
      const clearBody = (await clearResponse.json()) as Record<string, unknown>
      expect(clearBody).toEqual(
        expect.objectContaining({
          ok: true,
          restoredStrategy: 'round-robin'
        })
      )
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves sticky-session config/status/cleanup when feature is enabled', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      // GET /api/sticky-sessions/config
      const configResponse = await fetch(`http://127.0.0.1:${port}/api/sticky-sessions/config`)
      expect(configResponse.status).toBe(200)
      const configBody = (await configResponse.json()) as Record<string, unknown>
      expect(typeof configBody.enabled).toBe('boolean')
      expect(Array.isArray(configBody.identitySources)).toBe(true)
      expect(typeof configBody.allowPromptCacheKey).toBe('boolean')
      expect(typeof configBody.ttlMs).toBe('number')
      expect(typeof configBody.maxEntries).toBe('number')
      expect(typeof configBody.maxFileBytes).toBe('number')

      // GET /api/sticky-sessions/status
      const statusResponse = await fetch(`http://127.0.0.1:${port}/api/sticky-sessions/status`)
      expect(statusResponse.status).toBe(200)
      const statusBody = (await statusResponse.json()) as Record<string, unknown>
      expect(statusBody).toEqual(
        expect.objectContaining({
          ok: true,
          entries: expect.any(Number),
          path: expect.any(String),
          exists: expect.any(Boolean)
        })
      )

      // POST /api/sticky-sessions/cleanup
      const cleanupResponse = await fetch(`http://127.0.0.1:${port}/api/sticky-sessions/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      expect(cleanupResponse.status).toBe(200)
      const cleanupBody = (await cleanupResponse.json()) as Record<string, unknown>
      expect(cleanupBody).toEqual(
        expect.objectContaining({
          ok: true,
          before: expect.any(Number),
          after: expect.any(Number),
          removed: expect.any(Number),
          prunedAt: expect.any(Number)
        })
      )

      // PUT /api/sticky-sessions/config - update config
      const updateResponse = await fetch(`http://127.0.0.1:${port}/api/sticky-sessions/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          identitySources: ['header:session_id'],
          allowPromptCacheKey: false,
          ttlMs: 86_400_000,
          maxEntries: 500,
          maxFileBytes: 1_048_576,
          actor: 'test-suite'
        })
      })
      expect(updateResponse.status).toBe(200)
      const updateBody = (await updateResponse.json()) as Record<string, unknown>
      expect(updateBody).toEqual(
        expect.objectContaining({
          enabled: true,
          maxEntries: 500
        })
      )
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('gates sticky-session endpoints when feature is disabled', async () => {
    // Seed with sticky sessions disabled
    seedSandbox()
    const store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'))
    store.settings.featureFlags.stickySessionsEnabled = false
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2))

    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      // GET /api/sticky-sessions/config should be 403
      const configResponse = await fetch(`http://127.0.0.1:${port}/api/sticky-sessions/config`)
      expect(configResponse.status).toBe(403)
      const configBody = (await configResponse.json()) as Record<string, unknown>
      expect(configBody).toEqual(
        expect.objectContaining({
          error: 'Sticky sessions feature is disabled',
          code: 'FEATURE_DISABLED',
          feature: 'sticky-sessions'
        })
      )

      // GET /api/sticky-sessions/status should be 403
      const statusResponse = await fetch(`http://127.0.0.1:${port}/api/sticky-sessions/status`)
      expect(statusResponse.status).toBe(403)

      // POST /api/sticky-sessions/cleanup should be 403
      const cleanupResponse = await fetch(`http://127.0.0.1:${port}/api/sticky-sessions/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      expect(cleanupResponse.status).toBe(403)
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })
})
