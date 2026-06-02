// @ts-ignore - ESM Jest globals are available at runtime in the test environment.
import { jest } from '@jest/globals'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type * as http from 'node:http'
import { once } from 'node:events'

const SANDBOX_ROOT = path.join(os.tmpdir(), 'oma-web-integration-sandbox')
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

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
}

function authClaims(alias: string): Record<string, unknown> {
  return {
    iat: 200,
    exp: 1_200,
    email: `${alias}@example.com`,
    'https://api.openai.com/auth': {
      chatgpt_account_id: `acct-${alias}`,
      chatgpt_account_user_id: `acct-user-${alias}`,
      user_id: `user-${alias}`,
      chatgpt_plan_type: 'plus'
    }
  }
}

function writeCodexAuth(alias: string): void {
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify(
      {
        OPENAI_API_KEY: null,
        tokens: {
          access_token: jwt(authClaims(alias)),
          refresh_token: `refresh-${alias}`,
          id_token: jwt(authClaims(alias)),
          account_id: `acct-${alias}`
        },
        last_refresh: '2026-01-01T00:00:00.000Z'
      },
      null,
      2
    )
  )
}

function writeStoreWithAlphaOnly(): void {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true })
  fs.writeFileSync(
    STORE_FILE,
    JSON.stringify(
      {
        version: 3,
        activeAlias: 'alpha',
        rotationIndex: 0,
        lastRotation: 1_700_000_000_000,
        rotationStrategy: 'round-robin',
        accounts: {
          alpha: {
            alias: 'alpha',
            accessToken: 'token-alpha',
            refreshToken: 'refresh-alpha',
            expiresAt: Date.now() + 60_000,
            email: 'alpha@example.com',
            enabled: true,
            source: 'opencode'
          }
        }
      },
      null,
      2
    )
  )
}

async function requestJson(port: number, pathname: string): Promise<Record<string, any>> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`)
  expect(response.status).toBe(200)
  return (await response.json()) as Record<string, any>
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
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

describe('web server hardening', () => {
  it('registers metrics shutdown flush hooks once when the web console starts', async () => {
    const port = await getFreePort()
    const secondPort = await getFreePort()
    const processOnSpy = jest.spyOn(process, 'on')
    jest.resetModules()
    const { startWebConsole: isolatedStartWebConsole } = await import('../../src/web.js')
    const server = isolatedStartWebConsole({ host: '127.0.0.1', port })
    const serverListening = once(server, 'listening')
    const secondServer = isolatedStartWebConsole({ host: '127.0.0.1', port: secondPort })
    const secondServerListening = once(secondServer, 'listening')

    try {
      await Promise.all([serverListening, secondServerListening])
      const hookCalls = processOnSpy.mock.calls.filter((call: any[]) => ['beforeExit', 'SIGINT', 'SIGTERM', 'exit'].includes(call[0]))
      expect(hookCalls.map((call: any[]) => call[0])).toEqual(['beforeExit', 'SIGINT', 'SIGTERM', 'exit'])
      for (const [event, listener] of hookCalls as Array<[NodeJS.Signals | 'beforeExit' | 'exit', (...args: any[]) => void]>) {
        process.removeListener(event, listener)
      }
    } finally {
      await closeServer(server)
      await closeServer(secondServer)
      processOnSpy.mockRestore()
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('rejects non-loopback host binding', () => {
    expect(() => startWebConsole({ host: '0.0.0.0', port: 4120 })).toThrow(/LOCALHOST_ONLY|localhost/i)
  })

  it('returns 400 for invalid JSON and keeps server alive', async () => {
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      const invalidResponse = await fetch(`http://127.0.0.1:${port}/api/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad json'
      })

      expect(invalidResponse.status).toBe(400)
      const invalidPayload = (await invalidResponse.json()) as { code?: string }
      expect(invalidPayload.code).toBe('INVALID_JSON')

      const healthyResponse = await fetch(`http://127.0.0.1:${port}/api/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      })

      expect(healthyResponse.status).toBe(400)
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('serves static dist assets with SPA fallback and never lets /api routes hit the SPA', async () => {
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      const homeResponse = await fetch(`http://127.0.0.1:${port}/`)
      expect(homeResponse.status).toBe(200)
      expect(homeResponse.headers.get('content-type')).toContain('text/html')
      expect(await homeResponse.text()).toContain('fixture-spa-shell')

      const assetResponse = await fetch(`http://127.0.0.1:${port}/assets/app.js`)
      expect(assetResponse.status).toBe(200)
      expect(assetResponse.headers.get('content-type')).toContain('javascript')
      expect(await assetResponse.text()).toContain('fixture-asset')

      const routeResponse = await fetch(`http://127.0.0.1:${port}/dashboard/accounts`)
      expect(routeResponse.status).toBe(200)
      expect(routeResponse.headers.get('content-type')).toContain('text/html')
      expect(await routeResponse.text()).toContain('fixture-spa-shell')

      const apiResponse = await fetch(`http://127.0.0.1:${port}/api/state`)
      expect(apiResponse.status).toBe(200)
      expect(apiResponse.headers.get('content-type')).toContain('application/json')
      expect((await apiResponse.json()) as { authPath?: string }).toEqual(expect.objectContaining({ authPath: AUTH_FILE }))

      const missingApiResponse = await fetch(`http://127.0.0.1:${port}/api/does-not-exist`)
      expect(missingApiResponse.status).toBe(404)
      expect(missingApiResponse.headers.get('content-type')).toContain('application/json')
      expect((await missingApiResponse.json()) as { error?: string }).toEqual({ error: 'Not found' })

      const missingAssetResponse = await fetch(`http://127.0.0.1:${port}/assets/missing.js`)
      expect(missingAssetResponse.status).toBe(404)
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('returns 404 when SPA dist is missing and never falls back to inline dashboard HTML', async () => {
    const port = await getFreePort()
    const missingDistDir = path.join(SANDBOX_ROOT, 'missing-dist')
    process.env.OPENCODE_MULTI_AUTH_WEB_DIST_DIR = missingDistDir

    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      const homeResponse = await fetch(`http://127.0.0.1:${port}/`)
      expect(homeResponse.status).toBe(404)
      expect(homeResponse.headers.get('content-type')).toContain('application/json')
      expect((await homeResponse.json()) as { error?: string }).toEqual({ error: 'Not found' })

      const routeResponse = await fetch(`http://127.0.0.1:${port}/dashboard/accounts`)
      expect(routeResponse.status).toBe(404)
      expect(routeResponse.headers.get('content-type')).toContain('application/json')
      expect((await routeResponse.json()) as { error?: string }).toEqual({ error: 'Not found' })

      const apiResponse = await fetch(`http://127.0.0.1:${port}/api/state`)
      expect(apiResponse.status).toBe(200)
      expect(apiResponse.headers.get('content-type')).toContain('application/json')
    } finally {
      await closeServer(server)
      process.env.OPENCODE_MULTI_AUTH_WEB_DIST_DIR = WEB_DIST_DIR
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('does not auto-import Codex auth on startup or auth-file changes', async () => {
    writeStoreWithAlphaOnly()
    writeCodexAuth('gamma')
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')

      const startupState = await requestJson(port, '/api/state')
      expect(startupState.accounts.map((account: Record<string, any>) => account.alias)).toEqual(['alpha'])
      expect(JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')).accounts.gamma).toBeUndefined()

      writeCodexAuth('delta')
      await delay(3_300)

      const afterAuthChangeState = await requestJson(port, '/api/state')
      expect(afterAuthChangeState.accounts.map((account: Record<string, any>) => account.alias)).toEqual(['alpha'])
      const store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))
      expect(store.accounts.gamma).toBeUndefined()
      expect(store.accounts.delta).toBeUndefined()
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })
})
