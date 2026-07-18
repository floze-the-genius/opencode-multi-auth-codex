import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  clearSession,
  clearSessionsForAlias,
  getSessionAlias,
  getSessionStorePath,
  listSessions,
  pruneExpired,
  sessionCount,
  sessionCountByAlias,
  setSessionAlias,
  touchSession
} from '../../src/session-store.js'

const TEST_DIR = path.join(os.tmpdir(), 'oma-session-store-test-' + Date.now())
const originalEnv = process.env

describe('session store persistence', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      OPENCODE_MULTI_AUTH_STORE_DIR: TEST_DIR
    }
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true })
    }
    fs.mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    process.env = originalEnv
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  it('persists session aliases to disk', () => {
    setSessionAlias('session-1', 'alpha', 60_000)

    expect(getSessionAlias('session-1')).toBe('alpha')
    expect(sessionCount()).toBe(1)

    const raw = JSON.parse(fs.readFileSync(getSessionStorePath(), 'utf-8'))
    expect(raw.sessions['session-1'].alias).toBe('alpha')
  })

  it('touches, clears, and counts persisted sessions', async () => {
    setSessionAlias('session-1', 'alpha', 60_000)
    setSessionAlias('session-2', 'alpha', 60_000)
    setSessionAlias('session-3', 'beta', 60_000)
    const before = listSessions().find((entry) => entry.sessionId === 'session-1')!.lastUsedAt

    await new Promise((resolve) => setTimeout(resolve, 5))
    touchSession('session-1')
    const after = listSessions().find((entry) => entry.sessionId === 'session-1')!.lastUsedAt

    expect(after).toBeGreaterThan(before)
    expect(sessionCountByAlias()).toEqual({ alpha: 2, beta: 1 })

    clearSession('session-3')
    expect(getSessionAlias('session-3')).toBeUndefined()

    clearSessionsForAlias('alpha')
    expect(sessionCount()).toBe(0)
  })

  it('persists pruning of expired sessions', () => {
    setSessionAlias('old-session', 'alpha', 60_000)
    const raw = JSON.parse(fs.readFileSync(getSessionStorePath(), 'utf-8'))
    raw.sessions['old-session'].lastUsedAt = Date.now() - 10_000
    fs.writeFileSync(getSessionStorePath(), JSON.stringify(raw, null, 2), { mode: 0o600 })

    pruneExpired(1_000)

    expect(getSessionAlias('old-session')).toBeUndefined()
    const persisted = JSON.parse(fs.readFileSync(getSessionStorePath(), 'utf-8'))
    expect(persisted.sessions['old-session']).toBeUndefined()
  })

  it('keeps valid JSON across concurrent child processes', async () => {
    const repoRoot = process.cwd()
    const moduleUrl = pathToFileURL(path.join(repoRoot, 'dist', 'session-store.js')).href
    const workerPath = path.join(TEST_DIR, 'session-worker.mjs')
    const workerSource = [
      `import { setSessionAlias } from ${JSON.stringify(moduleUrl)}`,
      `const prefix = process.argv[2]`,
      `const alias = process.argv[3]`,
      `const count = Number(process.argv[4] ?? '0')`,
      `for (let i = 0; i < count; i += 1) {`,
      `  setSessionAlias(prefix + '-' + i, alias, 60000)`,
      `}`
    ].join('\n')

    fs.writeFileSync(workerPath, workerSource, { mode: 0o600 })

    const processes = 4
    const perProcess = 25
    const children = Array.from({ length: processes }, (_, idx) => {
      return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [workerPath, `session-${idx}`, `alias-${idx}`, String(perProcess)], {
          env: {
            ...process.env,
            OPENCODE_MULTI_AUTH_STORE_DIR: TEST_DIR
          }
        })
        let stderr = ''
        child.stderr.setEncoding('utf-8')
        child.stderr.on('data', (chunk) => {
          stderr += chunk
        })
        child.on('error', reject)
        child.on('close', (code) => resolve({ code, stderr }))
      })
    })

    const results = await Promise.all(children)
    for (const child of results) {
      expect(child.code).toBe(0)
      expect(child.stderr).toBe('')
    }

    expect(sessionCount()).toBe(processes * perProcess)
    expect(() => JSON.parse(fs.readFileSync(getSessionStorePath(), 'utf-8'))).not.toThrow()
  })
})
