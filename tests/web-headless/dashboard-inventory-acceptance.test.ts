import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type * as http from 'node:http'

const SANDBOX_ROOT = path.join(os.tmpdir(), 'oma-dashboard-inventory-sandbox')
const STORE_FILE = path.join(SANDBOX_ROOT, 'accounts.json')
const AUTH_FILE = path.join(SANDBOX_ROOT, 'auth.json')
const WEB_DIST_DIR = path.resolve(process.cwd(), 'tests/fixtures/web-dist')
const ANTIGRAVITY_DIR = path.join(os.homedir(), '.config', 'opencode')
const ANTIGRAVITY_FILE = path.join(ANTIGRAVITY_DIR, 'antigravity-accounts.json')
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

function seedSandbox(options?: { antigravityEnabled?: boolean; antigravityAccounts?: Array<Record<string, unknown>> }): void {
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
            antigravityEnabled: options?.antigravityEnabled === true,
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

  if (options?.antigravityEnabled && options.antigravityAccounts) {
    fs.mkdirSync(ANTIGRAVITY_DIR, { recursive: true })
    fs.writeFileSync(
      ANTIGRAVITY_FILE,
      JSON.stringify({ activeIndex: 0, accounts: options.antigravityAccounts }, null, 2)
    )
    return
  }

  fs.rmSync(ANTIGRAVITY_FILE, { force: true })
}

async function startServer(): Promise<{ server: http.Server; port: number }> {
  const port = await getFreePort()
  const server = startWebConsole({ host: '127.0.0.1', port })
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  return { server, port }
}

async function requestText(port: number, pathname: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`)
  return { status: response.status, body: await response.text() }
}

async function requestJson(port: number, pathname: string): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`)
  return { status: response.status, body: (await response.json()) as Record<string, any> }
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
  fs.rmSync(ANTIGRAVITY_FILE, { force: true })
})

describe('dashboard inventory acceptance', () => {
  it('serves the fixture-backed dashboard shell instead of the removed inline markup', async () => {
    const { server, port } = await startServer()

    try {
      const response = await requestText(port, '/')
      expect(response.status).toBe(200)

      expect(response.body).toContain('fixture-spa-shell')
      expect(response.body).toContain('<script type="module" src="/assets/app.js"></script>')
      expect(response.body).not.toContain('data-dashboard-surface="overview"')
      expect(response.body).not.toContain('id="openAccountModalBtn"')
    } finally {
      await closeServer(server)
    }
  })

  it('serves the fixture asset bundle and no longer exposes inline dashboard scripting', async () => {
    const { server, port } = await startServer()

    try {
      const response = await requestText(port, '/')
      expect(response.status).toBe(200)

      expect(response.body).not.toMatch(/<script>([\s\S]*?)<\/script>/)

      const assetResponse = await requestText(port, '/assets/app.js')
      expect(assetResponse.status).toBe(200)
      expect(assetResponse.body).toContain('fixture-asset')
    } finally {
      await closeServer(server)
    }
  })

  it('preserves state fields that back overview, configuration, operations, and Antigravity visibility', async () => {
    seedSandbox({
      antigravityEnabled: true,
      antigravityAccounts: [
        {
          projectId: 'ag-project',
          managedProjectId: 'ag-managed',
          refreshToken: 'ag-refresh',
          addedAt: Date.now(),
          lastUsed: Date.now(),
          rateLimitResetTimes: { gpt5: Date.now() + 60_000 }
        }
      ]
    })

    const { server, port } = await startServer()

    try {
      const state = await requestJson(port, '/api/state')
      expect(state.status).toBe(200)
      expect(state.body).toEqual(
        expect.objectContaining({
          login: null,
          queue: null,
          logPath: expect.any(String),
          rotationStrategy: 'round-robin',
          force: expect.objectContaining({
            active: false,
            alias: null,
            remainingTime: '0m'
          }),
          featureFlags: expect.objectContaining({
            antigravityEnabled: true,
            stickySessionsEnabled: false
          }),
          antigravity: expect.objectContaining({
            path: expect.any(String),
            accounts: [
              expect.objectContaining({
                alias: 'ag-project',
                projectId: 'ag-project',
                managedProjectId: 'ag-managed',
                hasRefreshToken: true
              })
            ],
            quota: expect.objectContaining({
              status: 'idle',
              scope: 'active'
            })
          })
        })
      )

      const logs = await requestJson(port, '/api/logs?limit=5')
      expect(logs.status).toBe(200)
      expect(typeof logs.body.path).toBe('string')
      expect(Array.isArray(logs.body.lines)).toBe(true)
    } finally {
      await closeServer(server)
    }
  })
})
