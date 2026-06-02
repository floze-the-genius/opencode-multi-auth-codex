import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type * as http from 'node:http'

const SANDBOX_ROOT = path.join(os.tmpdir(), 'oma-weighted-presets-sandbox')
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
            source: 'codex',
            rateLimits: {
              fiveHour: { limit: 100, remaining: 40, resetAt: Date.now() + 60_000, updatedAt: Date.now() },
              weekly: { limit: 1000, remaining: 300, resetAt: Date.now() + 120_000, updatedAt: Date.now() }
            },
            limitsConfidence: 'fresh'
          },
          gamma: {
            alias: 'gamma',
            accessToken: 'token-gamma',
            refreshToken: 'refresh-gamma',
            expiresAt: Date.now() + 180_000,
            email: 'gamma@example.com',
            usageCount: 1,
            enabled: false,
            source: 'opencode',
            rateLimits: {
              fiveHour: { limit: 100, remaining: 100, resetAt: Date.now() + 60_000, updatedAt: Date.now() },
              weekly: { limit: 1000, remaining: 900, resetAt: Date.now() + 120_000, updatedAt: Date.now() }
            },
            limitsConfidence: 'fresh'
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

describe('Weighted Presets API', () => {
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

  describe('POST /api/settings/preset', () => {
    test('applies balanced preset with equal weights and weighted-round-robin strategy', async () => {
      const { server, port } = await startServer()

      try {
        const { status, body } = await requestJson(port, '/api/settings/preset', {
          method: 'POST',
          body: JSON.stringify({ preset: 'balanced', actor: 'test-suite' })
        })

        expect(status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.preset).toBe('balanced')
        expect(body.settings.rotationStrategy).toBe('weighted-round-robin')
        expect(body.settings.criticalThreshold).toBe(10)
        expect(body.settings.lowThreshold).toBe(30)
        expect(body.settings.accountWeights).toBeDefined()

        // Balanced preset: 3 accounts, each should get ~0.333 weight
        const weights = body.settings.accountWeights as Record<string, number>
        expect(Object.keys(weights)).toHaveLength(3)
        expect(weights.alpha).toBeCloseTo(1 / 3, 3)
        expect(weights.beta).toBeCloseTo(1 / 3, 3)
        expect(weights.gamma).toBeCloseTo(1 / 3, 3)

        // Verify weights sum to approximately 1
        const totalWeight = Object.values(weights).reduce((sum: number, w: number) => sum + w, 0)
        expect(totalWeight).toBeCloseTo(1, 3)
      } finally {
        await closeServer(server)
      }
    })

    test('applies conservative preset favoring healthy accounts', async () => {
      const { server, port } = await startServer()

      try {
        const { status, body } = await requestJson(port, '/api/settings/preset', {
          method: 'POST',
          body: JSON.stringify({ preset: 'conservative', actor: 'test-suite' })
        })

        expect(status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.preset).toBe('conservative')
        expect(body.settings.rotationStrategy).toBe('weighted-round-robin')
        expect(body.settings.criticalThreshold).toBe(20)
        expect(body.settings.lowThreshold).toBe(40)
        expect(body.settings.accountWeights).toBeDefined()

        // Conservative preset: alpha has better limits (80/700) than beta (40/300)
        // So alpha should get higher weight than beta
        const weights = body.settings.accountWeights as Record<string, number>
        expect(weights.alpha).toBeGreaterThan(weights.beta)

        // Verify weights sum to approximately 1
        const totalWeight = Object.values(weights).reduce((sum: number, w: number) => sum + w, 0)
        expect(totalWeight).toBeCloseTo(1, 3)
      } finally {
        await closeServer(server)
      }
    })

    test('applies aggressive preset favoring heavily-used accounts', async () => {
      const { server, port } = await startServer()

      try {
        const { status, body } = await requestJson(port, '/api/settings/preset', {
          method: 'POST',
          body: JSON.stringify({ preset: 'aggressive', actor: 'test-suite' })
        })

        expect(status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.preset).toBe('aggressive')
        expect(body.settings.rotationStrategy).toBe('weighted-round-robin')
        expect(body.settings.criticalThreshold).toBe(5)
        expect(body.settings.lowThreshold).toBe(20)
        expect(body.settings.accountWeights).toBeDefined()

        // Aggressive preset: beta has lower remaining limits (40/300) than alpha (80/700)
        // So beta should get higher weight than alpha (inverse of health)
        const weights = body.settings.accountWeights as Record<string, number>
        expect(weights.beta).toBeGreaterThan(weights.alpha)

        // Verify weights sum to approximately 1
        const totalWeight = Object.values(weights).reduce((sum: number, w: number) => sum + w, 0)
        expect(totalWeight).toBeCloseTo(1, 3)
      } finally {
        await closeServer(server)
      }
    })

    test('rejects invalid preset with 400 and validPresets list', async () => {
      const { server, port } = await startServer()

      try {
        const { status, body } = await requestJson(port, '/api/settings/preset', {
          method: 'POST',
          body: JSON.stringify({ preset: 'invalid-preset' })
        })

        expect(status).toBe(400)
        expect(body.error).toBe('Invalid preset')
        expect(body.code).toBe('INVALID_PRESET')
        expect(body.validPresets).toEqual(['balanced', 'conservative', 'aggressive', 'custom'])
      } finally {
        await closeServer(server)
      }
    })

    test('persists preset settings to store', async () => {
      const { server, port } = await startServer()

      try {
        await requestJson(port, '/api/settings/preset', {
          method: 'POST',
          body: JSON.stringify({ preset: 'balanced', actor: 'test-suite' })
        })

        const store = readStore()
        expect(store.settings.rotationStrategy).toBe('weighted-round-robin')
        expect(store.settings.accountWeights).toBeDefined()
        expect(Object.keys(store.settings.accountWeights)).toHaveLength(3)
      } finally {
        await closeServer(server)
      }
    })
  })

  describe('PUT /api/settings with accountWeights', () => {
    test('updates per-account weights directly', async () => {
      const { server, port } = await startServer()

      try {
        const { status, body } = await requestJson(port, '/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            accountWeights: {
              alpha: 0.5,
              beta: 0.3,
              gamma: 0.2
            },
            actor: 'test-suite'
          })
        })

        expect(status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.settings.accountWeights.alpha).toBe(0.5)
        expect(body.settings.accountWeights.beta).toBe(0.3)
        expect(body.settings.accountWeights.gamma).toBe(0.2)
      } finally {
        await closeServer(server)
      }
    })

    test('rejects weights that do not sum to approximately 1', async () => {
      const { server, port } = await startServer()

      try {
        const { status, body } = await requestJson(port, '/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            accountWeights: {
              alpha: 0.5,
              beta: 0.2
              // Missing gamma, sum = 0.7
            },
            actor: 'test-suite'
          })
        })

        expect(status).toBe(400)
        expect(body.error).toBe('Validation failed')
        expect(body.code).toBe('VALIDATION_ERROR')
        expect(body.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'accountWeights',
              message: 'Total weights must sum to 1.0',
              constraint: 'sum(weights) ≈ 1.0'
            })
          ])
        )
      } finally {
        await closeServer(server)
      }
    })

    test('rejects individual weights outside (0, 1] range', async () => {
      const { server, port } = await startServer()

      try {
        const { status, body } = await requestJson(port, '/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            accountWeights: {
              alpha: 1.5,
              beta: -0.3,
              gamma: -0.2
            },
            actor: 'test-suite'
          })
        })

        expect(status).toBe(400)
        expect(body.error).toBe('Validation failed')
        expect(body.code).toBe('VALIDATION_ERROR')
        expect(body.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'accountWeights.alpha',
              message: 'Weight for alpha must be between 0 and 1',
              constraint: '0 < weight <= 1'
            }),
            expect.objectContaining({
              field: 'accountWeights.beta',
              message: 'Weight for beta must be between 0 and 1',
              constraint: '0 < weight <= 1'
            }),
            expect.objectContaining({
              field: 'accountWeights.gamma',
              message: 'Weight for gamma must be between 0 and 1',
              constraint: '0 < weight <= 1'
            })
          ])
        )
      } finally {
        await closeServer(server)
      }
    })

    test('persists custom weights to store', async () => {
      const { server, port } = await startServer()

      try {
        await requestJson(port, '/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            accountWeights: {
              alpha: 0.6,
              beta: 0.3,
              gamma: 0.1
            },
            actor: 'test-suite'
          })
        })

        const store = readStore()
        expect(store.settings.accountWeights.alpha).toBe(0.6)
        expect(store.settings.accountWeights.beta).toBe(0.3)
        expect(store.settings.accountWeights.gamma).toBe(0.1)
      } finally {
        await closeServer(server)
      }
    })
  })

  describe('GET /api/settings reflects weighted state', () => {
    test('returns preset field when weighted-round-robin matches a preset', async () => {
      const { server, port } = await startServer()

      try {
        // Apply balanced preset first
        await requestJson(port, '/api/settings/preset', {
          method: 'POST',
          body: JSON.stringify({ preset: 'balanced', actor: 'test-suite' })
        })

        const { status, body } = await requestJson(port, '/api/settings')

        expect(status).toBe(200)
        expect(body.settings.rotationStrategy).toBe('weighted-round-robin')
        expect(body.preset).toBe('balanced')
        expect(body.settings.accountWeights).toBeDefined()
      } finally {
        await closeServer(server)
      }
    })

    test('returns custom weights without preset field', async () => {
      const { server, port } = await startServer()

      try {
        // Apply custom weights with non-matching thresholds
        await requestJson(port, '/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            rotationStrategy: 'weighted-round-robin',
            criticalThreshold: 15,
            lowThreshold: 35,
            accountWeights: {
              alpha: 0.7,
              beta: 0.2,
              gamma: 0.1
            },
            actor: 'test-suite'
          })
        })

        const { status, body } = await requestJson(port, '/api/settings')

        expect(status).toBe(200)
        expect(body.settings.rotationStrategy).toBe('weighted-round-robin')
        // Custom weights don't match any preset thresholds, so preset should be undefined
        expect(body.preset).toBeUndefined()
        expect(body.settings.accountWeights.alpha).toBe(0.7)
        expect(body.settings.accountWeights.beta).toBe(0.2)
        expect(body.settings.accountWeights.gamma).toBe(0.1)
      } finally {
        await closeServer(server)
      }
    })
  })
})
