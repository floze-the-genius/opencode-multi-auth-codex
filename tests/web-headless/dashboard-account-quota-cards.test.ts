import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type * as http from 'node:http'
import { once } from 'node:events'

const SANDBOX_ROOT = path.join(os.tmpdir(), 'oma-dashboard-quota-cards-sandbox')
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
            enabled: false,
            tags: ['backup'],
            notes: 'secondary account',
            source: 'codex',
            rateLimits: {
              fiveHour: { limit: 100, remaining: 15, resetAt: Date.now() + 60_000, updatedAt: Date.now() },
              weekly: { limit: 1000, remaining: 50, resetAt: Date.now() + 120_000, updatedAt: Date.now() }
            },
            limitsConfidence: 'stale',
            disabledAt: Date.now(),
            disabledBy: 'operator'
          },
          gamma: {
            alias: 'gamma',
            accessToken: 'token-gamma',
            refreshToken: 'refresh-gamma',
            expiresAt: Date.now() + 90_000,
            email: 'gamma@example.com',
            usageCount: 1,
            enabled: true,
            tags: [],
            notes: '',
            source: 'opencode',
            limitsConfidence: 'unknown'
          }
        },
        login: null,
        queue: null
      },
      null,
      2
    )
  )
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

describe('dashboard account quota cards', () => {
  it('serves the SPA at / with dashboard data surface', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
      const response = await fetch(`http://127.0.0.1:${port}/`)
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

  it('returns dashboard state with accounts containing rateLimits', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
      const response = await fetch(`http://127.0.0.1:${port}/api/state`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')

      const body = await response.json() as { accounts: Record<string, unknown>[] }
      expect(body.accounts).toHaveLength(3)

      // alpha has full rate limits
      const alpha = body.accounts[0]
      expect(alpha).toEqual(
        expect.objectContaining({
          alias: 'alpha',
          enabled: true,
          limitsConfidence: 'fresh'
        })
      )
      expect(alpha.rateLimits).toEqual(
        expect.objectContaining({
          fiveHour: expect.objectContaining({ limit: 100, remaining: 80 }),
          weekly: expect.objectContaining({ limit: 1000, remaining: 700 })
        })
      )
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('returns accounts with limitsConfidence field for all accounts', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
      const response = await fetch(`http://127.0.0.1:${port}/api/state`)
      expect(response.status).toBe(200)

      const body = await response.json() as { accounts: Array<{ alias: string; limitsConfidence?: string }> }

      // Every account should have limitsConfidence
      for (const account of body.accounts) {
        expect(account.limitsConfidence).toBeDefined()
        expect(['fresh', 'stale', 'error', 'unknown']).toContain(account.limitsConfidence)
      }

      // Specific checks
      const alpha = body.accounts.find(a => a.alias === 'alpha')
      expect(alpha?.limitsConfidence).toBe('fresh')

      const beta = body.accounts.find(a => a.alias === 'beta')
      expect(beta?.limitsConfidence).toBe('stale')
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('returns the full account quota surface needed for cards', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
      const response = await fetch(`http://127.0.0.1:${port}/api/state`)
      expect(response.status).toBe(200)

      const body = await response.json() as {
        accounts: Array<{
          alias: string
          enabled: boolean
          rateLimits?: { fiveHour?: { limit?: number; remaining?: number }; weekly?: { limit?: number; remaining?: number } }
          limitsConfidence?: string
          tags?: string[]
          notes?: string
          source?: string
          usageCount: number
        }>
        rotationAlias?: string | null
        recommendedAlias?: string | null
        deviceAlias?: string | null
      }

      // rotationAlias and recommendedAlias must be present for card indicators
      expect(body.rotationAlias).toBeDefined()
      expect(body.recommendedAlias).toBeDefined()

      // All three accounts should be present
      expect(body.accounts).toHaveLength(3)

      // Each account must have the key fields for quota cards
      for (const account of body.accounts) {
        expect(account.alias).toBeTruthy()
        expect(typeof account.enabled).toBe('boolean')
        expect(typeof account.usageCount).toBe('number')
        // rateLimits may be undefined for some accounts, but limitsConfidence must exist
        expect(account.limitsConfidence).toBeDefined()
      }
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('shows disabled account with disabled reason in data surface', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
      const response = await fetch(`http://127.0.0.1:${port}/api/state`)
      expect(response.status).toBe(200)

      const body = await response.json() as { accounts: Array<{ alias: string; enabled: boolean; disabledAt?: number; disabledBy?: string }> }
      const beta = body.accounts.find(a => a.alias === 'beta')
      expect(beta).toBeDefined()
      expect(beta!.enabled).toBe(false)
      // disabledAt should exist for disabled accounts
      expect(beta!.disabledAt).toBeDefined()
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })
})
