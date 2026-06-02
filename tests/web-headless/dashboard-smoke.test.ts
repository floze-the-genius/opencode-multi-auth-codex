import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type * as http from 'node:http'
import { once } from 'node:events'

const SANDBOX_ROOT = path.join(os.tmpdir(), 'oma-web-headless-sandbox')
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

describe('dashboard headless smoke', () => {
  it('serves the fixture-backed SPA entry while preserving backend JSON routes', async () => {
    const port = await getFreePort()
    const server = startWebConsole({ host: '127.0.0.1', port })

    try {
      await once(server, 'listening')
      const homeResponse = await fetch(`http://127.0.0.1:${port}/`)
      expect(homeResponse.status).toBe(200)
      expect(homeResponse.headers.get('content-type')).toContain('text/html')
      expect(await homeResponse.text()).toContain('fixture-spa-shell')

      const stateResponse = await fetch(`http://127.0.0.1:${port}/api/state`)
      expect(stateResponse.status).toBe(200)
      expect(stateResponse.headers.get('content-type')).toContain('application/json')
      expect((await stateResponse.json()) as { authPath?: string }).toEqual(
        expect.objectContaining({ authPath: AUTH_FILE })
      )
    } finally {
      await closeServer(server)
      fs.unwatchFile(getCodexAuthPath())
    }
  })

  it('fails closed when SPA dist assets are unavailable instead of serving the legacy inline dashboard', async () => {
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

      const stateResponse = await fetch(`http://127.0.0.1:${port}/api/state`)
      expect(stateResponse.status).toBe(200)
      expect(stateResponse.headers.get('content-type')).toContain('application/json')
    } finally {
      await closeServer(server)
      process.env.OPENCODE_MULTI_AUTH_WEB_DIST_DIR = WEB_DIST_DIR
      fs.unwatchFile(getCodexAuthPath())
    }
  })
})
