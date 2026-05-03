import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  addAccount,
  getStorePath,
  listAccounts,
  loadStore,
  updateAccount
} from '../../src/store.js'

const STRESS_DIR = path.join(os.tmpdir(), 'oma-stress-tests-sandbox')
const originalEnv = process.env

describe('stress: store consistency', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      OPENCODE_MULTI_AUTH_STORE_DIR: STRESS_DIR,
      OPENCODE_MULTI_AUTH_STORE_FILE: path.join(STRESS_DIR, 'accounts.json')
    }

    if (fs.existsSync(STRESS_DIR)) {
      fs.rmSync(STRESS_DIR, { recursive: true, force: true })
    }
    fs.mkdirSync(STRESS_DIR, { recursive: true })

    for (let i = 0; i < 5; i += 1) {
      addAccount(`stress-${i}`, {
        accessToken: `token-${i}`,
        refreshToken: `refresh-${i}`,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      })
    }
  })

  afterEach(() => {
    process.env = originalEnv
    if (fs.existsSync(STRESS_DIR)) {
      fs.rmSync(STRESS_DIR, { recursive: true, force: true })
    }
  })

  it('handles burst updates without store corruption', async () => {
    const operations = Array.from({ length: 200 }, (_, idx) => {
      return new Promise<void>((resolve) => {
        setImmediate(() => {
          const alias = `stress-${idx % 5}`
          updateAccount(alias, {
            usageCount: idx,
            lastUsed: Date.now(),
            notes: `burst-${idx}`
          })
          resolve()
        })
      })
    })

    await Promise.all(operations)

    const storePath = getStorePath()
    const raw = fs.readFileSync(storePath, 'utf-8')
    expect(() => JSON.parse(raw)).not.toThrow()

    const store = loadStore()
    expect(Object.keys(store.accounts)).toHaveLength(5)
    expect(listAccounts()).toHaveLength(5)
  })

  it('keeps counts consistent across concurrent child processes', async () => {
    const repoRoot = process.cwd()
    const storeModuleUrl = pathToFileURL(path.join(repoRoot, 'dist', 'store.js')).href
    const workerPath = path.join(STRESS_DIR, 'store-worker.mjs')
    const workerSource = [
      `import { mutateStore } from ${JSON.stringify(storeModuleUrl)}`,
      `const iterations = Number(process.argv[2] ?? '0')`,
      `const aliases = (process.argv[3] ?? '').split(',').filter(Boolean)`,
      `for (let i = 0; i < iterations; i += 1) {`,
      `  const alias = aliases[i % aliases.length]`,
      `  mutateStore((store) => {`,
      `    const current = store.accounts[alias]`,
      `    if (!current) throw new Error('missing account: ' + alias)`,
      `    current.usageCount = (current.usageCount || 0) + 1`,
      `    current.lastUsed = Date.now()`,
      `    return store`,
      `  })`,
      `}`
    ].join('\n')

    fs.writeFileSync(workerPath, workerSource, { mode: 0o600 })

    const aliases = Array.from({ length: 5 }, (_, idx) => `stress-${idx}`)
    const iterationsPerProcess = 75
    const processes = 4

    const children = Array.from({ length: processes }, () => {
      return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [workerPath, String(iterationsPerProcess), aliases.join(',')], {
          env: {
            ...process.env,
            OPENCODE_MULTI_AUTH_STORE_DIR: STRESS_DIR,
            OPENCODE_MULTI_AUTH_STORE_FILE: path.join(STRESS_DIR, 'accounts.json')
          }
        })

        let stderr = ''
        child.stderr.setEncoding('utf-8')
        child.stderr.on('data', (chunk) => {
          stderr += chunk
        })
        child.on('error', reject)
        child.on('close', (code) => {
          resolve({ code, stderr })
        })
      })
    })

    const results = await Promise.all(children)

    for (const child of results) {
      expect(child.code).toBe(0)
      expect(child.stderr).toBe('')
    }

    const store = loadStore()
    const expectedTotal = iterationsPerProcess * processes
    const actualTotal = Object.values(store.accounts).reduce((sum, account) => sum + (account.usageCount || 0), 0)

    expect(Object.keys(store.accounts)).toHaveLength(5)
    expect(actualTotal).toBe(expectedTotal)
  })
})
