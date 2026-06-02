import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type * as http from 'node:http'
import { once } from 'node:events'
import { dashboardAlphaMetrics, writeDashboardSandbox } from '../helpers/dashboard-seed.js'

const SANDBOX_ROOT = path.join(os.tmpdir(), 'oma-dashboard-parity-accounts-sandbox')
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
  writeDashboardSandbox({ root: SANDBOX_ROOT, storeFile: STORE_FILE, authFile: AUTH_FILE, accountSet: 'alpha-beta-gamma' })
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

describe('dashboard parity accounts', () => {
  it('serves the SPA on /accounts', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
      const response = await fetch(`http://127.0.0.1:${port}/accounts`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')

      const body = await response.text()
      expect(body).toContain('fixture-spa-shell')
      expect(body).toContain('<script type="module"')
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('returns account list from /api/accounts', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
      const response = await fetch(`http://127.0.0.1:${port}/api/accounts`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')

      const body = (await response.json()) as { accounts: Record<string, unknown>[] }
      expect(body.accounts).toHaveLength(3)
      expect(body.accounts[0]).toEqual(
        expect.objectContaining({
          alias: 'alpha',
          email: 'alpha@example.com',
          enabled: true,
          usageCount: 3,
          rateLimits: dashboardAlphaMetrics.rateLimits,
          limitsConfidence: dashboardAlphaMetrics.limitsConfidence,
          limitStatus: dashboardAlphaMetrics.limitStatus,
          limitError: dashboardAlphaMetrics.limitError,
          lastLimitProbeAt: dashboardAlphaMetrics.lastLimitProbeAt,
          lastLimitErrorAt: dashboardAlphaMetrics.lastLimitErrorAt,
          tags: ['core'],
          notes: 'primary account'
        })
      )
      expect(body.accounts[2]).toEqual(
        expect.objectContaining({
          alias: 'gamma',
          email: 'gamma@example.com',
          enabled: true,
          usageCount: 0,
          tags: [],
          notes: ''
        })
      )
      expect(body.accounts[2]).not.toHaveProperty('rateLimits')
      expect(body.accounts[2]).not.toHaveProperty('rateLimitHistory')
      expect(body.accounts[2]).not.toHaveProperty('limitsConfidence')
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves enable/disable account contract', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      // Disable alpha
      const disable = await fetch(`http://127.0.0.1:${port}/api/accounts/alpha/enabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false })
      })
      expect(disable.status).toBe(200)
      const disableBody = (await disable.json()) as Record<string, unknown>
      expect(disableBody).toEqual(
        expect.objectContaining({
          ok: true,
          alias: 'alpha',
          enabled: false
        })
      )

      // Re-enable alpha
      const enable = await fetch(`http://127.0.0.1:${port}/api/accounts/alpha/enabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true })
      })
      expect(enable.status).toBe(200)
      const enableBody = (await enable.json()) as Record<string, unknown>
      expect(enableBody).toEqual(
        expect.objectContaining({
          ok: true,
          alias: 'alpha',
          enabled: true
        })
      )
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves switch account contract', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      const switchResponse = await fetch(`http://127.0.0.1:${port}/api/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: 'beta' })
      })
      expect(switchResponse.status).toBe(200)
      const switchBody = (await switchResponse.json()) as Record<string, unknown>
      expect(switchBody).toEqual({ ok: true })

      // Verify auth.json was updated to beta's tokens
      const authJson = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) as { tokens?: Record<string, unknown> }
      expect(authJson.tokens?.access_token).toBe('token-beta')
      expect(authJson.tokens?.refresh_token).toBe('refresh-beta')
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves remove account contract', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      const remove = await fetch(`http://127.0.0.1:${port}/api/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: 'gamma' })
      })
      expect(remove.status).toBe(200)
      const removeBody = (await remove.json()) as Record<string, unknown>
      expect(removeBody).toEqual({ ok: true })

      const accounts = await fetch(`http://127.0.0.1:${port}/api/accounts`)
      const accountsBody = (await accounts.json()) as { accounts: Record<string, unknown>[] }
      expect(accountsBody.accounts).toHaveLength(2)
      expect(accountsBody.accounts).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ alias: 'gamma' })])
      )
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves account meta update contract', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      const meta = await fetch(`http://127.0.0.1:${port}/api/account/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: 'alpha', tags: ' Ops,ops, Team ', notes: ' updated note ' })
      })
      expect(meta.status).toBe(200)
      const metaBody = (await meta.json()) as Record<string, unknown>
      expect(metaBody).toEqual({ ok: true })

      const accounts = await fetch(`http://127.0.0.1:${port}/api/accounts`)
      const accountsBody = (await accounts.json()) as { accounts: Record<string, unknown>[] }
      const alpha = accountsBody.accounts.find(
        (a) => a.alias === 'alpha'
      )
      expect(alpha).toEqual(
        expect.objectContaining({
          tags: ['ops', 'team'],
          notes: 'updated note'
        })
      )
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves token refresh contract', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      const refresh = await fetch(`http://127.0.0.1:${port}/api/token/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: 'alpha' })
      })
      expect(refresh.status).toBe(200)
      const refreshBody = (await refresh.json()) as Record<string, unknown>
      expect(refreshBody.ok).toBe(true)
      expect(Array.isArray(refreshBody.results)).toBe(true)
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves limits refresh contract', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      const refresh = await fetch(`http://127.0.0.1:${port}/api/limits/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: 'alpha' })
      })
      expect([200, 409]).toContain(refresh.status)
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves reauth contract', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      const reauth = await fetch(`http://127.0.0.1:${port}/api/accounts/alpha/reauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: 'test-suite' })
      })
      expect(reauth.status).toBe(200)
      const reauthBody = (await reauth.json()) as Record<string, unknown>
      expect(reauthBody).toEqual(
        expect.objectContaining({
          ok: true,
          alias: 'alpha',
          url: expect.any(String),
          message: expect.any(String)
        })
      )
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })
})
