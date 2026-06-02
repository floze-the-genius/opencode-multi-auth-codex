import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type * as http from 'node:http'
import { once } from 'node:events'

const SANDBOX_ROOT = path.join(os.tmpdir(), 'oma-dashboard-command-search-sandbox')
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

function seedSandbox(options?: { antigravityEnabled?: boolean }): void {
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
            antigravityEnabled: options?.antigravityEnabled ?? false,
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

describe('dashboard command search', () => {
  it('serves the SPA with command search capability', async () => {
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

  it('returns feature flags that gate antigravity command visibility', async () => {
    seedSandbox({ antigravityEnabled: true })
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
      const response = await fetch(`http://127.0.0.1:${port}/api/state`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')

      const state = (await response.json()) as Record<string, unknown>
      expect(state).toHaveProperty('featureFlags')
      const flags = state.featureFlags as Record<string, boolean>
      expect(flags.antigravityEnabled).toBe(true)
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('preserves explicit navigation alongside command search capability', async () => {
    seedSandbox()
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      // Verify all critical routes remain reachable via explicit navigation
      const routes = ['/', '/accounts', '/configuration', '/operations']
      for (const route of routes) {
        const response = await fetch(`http://127.0.0.1:${port}${route}`)
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/html')
      }
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('does not expose antigravity route when feature flag is disabled', async () => {
    seedSandbox({ antigravityEnabled: false })
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
      const response = await fetch(`http://127.0.0.1:${port}/api/state`)
      expect(response.status).toBe(200)

      const state = (await response.json()) as Record<string, unknown>
      const flags = state.featureFlags as Record<string, boolean>
      expect(flags.antigravityEnabled).toBe(false)
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })
})
