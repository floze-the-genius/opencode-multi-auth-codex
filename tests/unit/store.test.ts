import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
// @ts-ignore - ESM Jest globals are available at runtime in the test environment.
import { jest } from '@jest/globals'
import { 
  loadStore, 
  saveStore, 
  getStoreDiagnostics,
  withWriteLock,
  addAccount,
  updateAccount,
  removeAccount
} from '../../src/store.js'
import { getMetrics } from '../../src/metrics-store.js'

const tmpDir = path.join(os.tmpdir(), 'oma-test-' + Date.now())
const originalEnv = process.env

function setupEnv() {
  process.env = { ...originalEnv }
  process.env.OPENCODE_MULTI_AUTH_STORE_DIR = tmpDir
}

function cleanupEnv() {
  process.env = originalEnv
}

function cleanup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

describe('Store Operations', () => {
  beforeEach(() => setupEnv())
  afterEach(() => cleanupEnv())
  afterAll(() => cleanup())

  it('should create empty store when no file exists', () => {
    const store = loadStore()
    expect(store.accounts).toEqual({})
    expect(store.activeAlias).toBeNull()
  })

  it('should add an account', () => {
    const store = addAccount('test-alias', {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
      email: 'test@example.com'
    })
    expect(store.accounts['test-alias']).toBeDefined()
    expect(store.accounts['test-alias'].usageCount).toBe(0)
    expect(store.activeAlias).toBe('test-alias')
  })

  it('should update an account', () => {
    addAccount('test-alias', {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000
    })
    const updated = updateAccount('test-alias', { email: 'updated@example.com' })
    expect(updated.accounts['test-alias'].email).toBe('updated@example.com')
  })

  it('should preserve existing account metadata on addAccount overwrite', () => {
    const now = Date.now()
    addAccount('test-alias', {
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: now + 1000,
      email: 'old@example.com'
    })

    updateAccount('test-alias', {
      usageCount: 42,
      tags: ['vip', 'warm'],
      notes: 'keep-me',
      enabled: false,
      disabledAt: now - 10_000,
      disabledBy: 'operator',
      disableReason: 'maintenance',
      limitStatus: 'error',
      limitError: 'temporary',
      lastLimitProbeAt: now - 5_000,
      lastLimitErrorAt: now - 4_000,
      lastUsed: now - 3_000,
      lastActiveUntil: now - 2_000,
      rateLimitedUntil: now + 15_000,
      modelUnsupportedUntil: now + 20_000,
      workspaceDeactivatedUntil: now + 25_000,
      authInvalid: true,
      rateLimitHistory: [{ at: now - 60_000, fiveHour: { remaining: 10, limit: 100, resetAt: now + 1_000 } }]
    })

    addAccount('test-alias', {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: now + 3600_000,
      email: 'new@example.com'
    })

    const reloaded = loadStore()
    const updated = reloaded.accounts['test-alias']
    expect(updated.accessToken).toBe('new-access-token')
    expect(updated.refreshToken).toBe('new-refresh-token')
    expect(updated.expiresAt).toBe(now + 3600_000)
    expect(updated.email).toBe('new@example.com')
    expect(updated.tags).toEqual(['vip', 'warm'])
    expect(updated.notes).toBe('keep-me')
    expect(updated.enabled).toBe(false)
    expect(updated.disabledAt).toBe(now - 10_000)
    expect(updated.disabledBy).toBe('operator')
    expect(updated.disableReason).toBe('maintenance')
    expect(updated.rateLimitedUntil).toBe(now + 15_000)
    expect(updated.modelUnsupportedUntil).toBe(now + 20_000)
    expect(updated.workspaceDeactivatedUntil).toBe(now + 25_000)
    expect(updated.authInvalid).toBe(true)
    expect(getMetrics('test-alias')).toEqual(expect.objectContaining({
      usageCount: 42,
      limitStatus: 'error',
      limitError: 'temporary',
      lastLimitProbeAt: now - 5_000,
      lastLimitErrorAt: now - 4_000,
      lastUsed: now - 3_000,
      lastActiveUntil: now - 2_000,
      rateLimitHistory: [{ at: now - 60_000, fiveHour: { remaining: 10, limit: 100, resetAt: now + 1_000 } }]
    }))
  })

  it('should persist accountUserId and userId across reload', () => {
    addAccount('test-alias', {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000
    })

    updateAccount('test-alias', {
      accountUserId: 'account-user-123',
      userId: 'user-456'
    })

    const reloaded = loadStore()
    expect(reloaded.accounts['test-alias'].accountUserId).toBe('account-user-123')
    expect(reloaded.accounts['test-alias'].userId).toBe('user-456')
  })

  it('should remove an account', () => {
    addAccount('alias1', {
      accessToken: 'token1',
      refreshToken: 'refresh1',
      expiresAt: Date.now() + 3600000
    })
    addAccount('alias2', {
      accessToken: 'token2',
      refreshToken: 'refresh2',
      expiresAt: Date.now() + 3600000
    })
    const store = removeAccount('alias1')
    expect(store.accounts['alias1']).toBeUndefined()
    expect(store.accounts['alias2']).toBeDefined()
  })

  it('should return store diagnostics', () => {
    loadStore()
    const diag = getStoreDiagnostics()
    expect(diag.storeDir).toBe(tmpDir)
    expect(diag.locked).toBe(false)
    expect(diag.error).toBeNull()
  })

  it('should not write plaintext LKG when encryption is enabled', () => {
    process.env.CODEX_SOFT_STORE_PASSPHRASE = 'test-passphrase'
    const lkgPath = path.join(tmpDir, 'accounts.json.lkg')
    if (fs.existsSync(lkgPath)) {
      fs.unlinkSync(lkgPath)
    }

    addAccount('encrypted-alias', {
      accessToken: 'enc-access-token',
      refreshToken: 'enc-refresh-token',
      expiresAt: Date.now() + 3600000
    })

    expect(fs.existsSync(lkgPath)).toBe(false)
    delete process.env.CODEX_SOFT_STORE_PASSPHRASE
  })
})

describe('Write Lock', () => {
  it('should execute function with write lock', async () => {
    let executed = false
    const result = await withWriteLock(() => {
      executed = true
      return true
    })
    expect(executed).toBe(true)
    expect(result).toBe(true)
  })

  it('should release lock after execution', async () => {
    await withWriteLock(() => 'result1')
    const result = await withWriteLock(() => 'result2')
    expect(result).toBe('result2')
  })

  it('should release lock on error', async () => {
    try {
      await withWriteLock(() => {
        throw new Error('test error')
      })
    } catch (e) {
      // expected
    }
    
    const result = await withWriteLock(() => 'after error')
    expect(result).toBe('after error')
  })
})

const METRIC_FIELDS = [
  'lastRefresh',
  'lastSeenAt',
  'lastActiveUntil',
  'lastUsed',
  'usageCount',
  'rateLimits',
  'rateLimitHistory',
  'limitStatus',
  'limitError',
  'lastLimitProbeAt',
  'lastLimitErrorAt',
  'limitsConfidence'
]

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

async function importFreshStoreModules() {
  jest.resetModules()
  return {
    store: await import('../../src/store.js'),
    metricsStore: await import('../../src/metrics-store.js')
  }
}

describe('Store v2 to v3 metrics migration', () => {
  let migrationDir: string
  let accountsPath: string
  let metricsPath: string

  beforeEach(() => {
    migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-store-migration-'))
    accountsPath = path.join(migrationDir, 'accounts.json')
    metricsPath = path.join(migrationDir, 'account-metrics.json')
    process.env = {
      ...originalEnv,
      OPENCODE_MULTI_AUTH_STORE_DIR: migrationDir,
      OPENCODE_MULTI_AUTH_STORE_FILE: accountsPath
    }
  })

  afterEach(() => {
    process.env = originalEnv
    fs.rmSync(migrationDir, { recursive: true, force: true })
    jest.resetModules()
  })

  it('moves inline v2 metrics into the sidecar, strips accounts.json, and bumps to v3', async () => {
    const now = 1_800_000_000_000
    writeJson(accountsPath, {
      version: 2,
      activeAlias: 'alpha',
      rotationIndex: 0,
      lastRotation: now,
      accounts: {
        alpha: {
          accessToken: 'access-alpha',
          refreshToken: 'refresh-alpha',
          expiresAt: now + 60_000,
          email: 'alpha@example.com',
          rateLimitedUntil: now + 5_000,
          tags: ['keep-state'],
          lastRefresh: '2026-01-01T00:00:00.000Z',
          lastSeenAt: now - 9_000,
          lastActiveUntil: now - 8_000,
          lastUsed: now - 7_000,
          usageCount: 12,
          rateLimits: {
            fiveHour: { remaining: 44, limit: 100, resetAt: now + 10_000, updatedAt: now - 6_000 }
          },
          rateLimitHistory: [
            { at: now - 6_000, fiveHour: { remaining: 44, limit: 100, resetAt: now + 10_000 } }
          ],
          limitStatus: 'success',
          limitError: 'previous soft limit',
          lastLimitProbeAt: now - 5_000,
          lastLimitErrorAt: now - 4_000,
          limitsConfidence: 'fresh'
        }
      }
    })

    const { store } = await importFreshStoreModules()
    const migrated = store.loadStore()

    expect(migrated.version).toBe(3)
    expect(migrated.accounts.alpha.accessToken).toBe('access-alpha')
    expect(migrated.accounts.alpha.refreshToken).toBe('refresh-alpha')
    expect(migrated.accounts.alpha.expiresAt).toBe(now + 60_000)
    expect(migrated.accounts.alpha.rateLimitedUntil).toBe(now + 5_000)

    const persistedAccounts = readJson(accountsPath)
    expect(persistedAccounts.version).toBe(3)
    for (const field of METRIC_FIELDS) {
      expect(persistedAccounts.accounts.alpha).not.toHaveProperty(field)
    }
    expect(persistedAccounts.accounts.alpha).toMatchObject({
      accessToken: 'access-alpha',
      refreshToken: 'refresh-alpha',
      expiresAt: now + 60_000,
      rateLimitedUntil: now + 5_000,
      tags: ['keep-state']
    })

    const persistedMetrics = readJson(metricsPath)
    expect(persistedMetrics.version).toBe(1)
    expect(persistedMetrics.metrics.alpha).toMatchObject({
      lastRefresh: '2026-01-01T00:00:00.000Z',
      lastSeenAt: now - 9_000,
      lastActiveUntil: now - 8_000,
      lastUsed: now - 7_000,
      usageCount: 12,
      rateLimits: {
        fiveHour: { remaining: 44, limit: 100, resetAt: now + 10_000, updatedAt: now - 6_000 }
      },
      limitStatus: 'success',
      limitError: 'previous soft limit',
      lastLimitProbeAt: now - 5_000,
      lastLimitErrorAt: now - 4_000,
      limitsConfidence: 'fresh'
    })
    expect(persistedMetrics.metrics.alpha.rateLimitHistory).toHaveLength(1)
  })

  it('converges when sidecar metrics already exist but accounts.json is still v2', async () => {
    const now = 1_800_000_100_000
    const snapshot = { at: now - 4_000, fiveHour: { remaining: 20, limit: 100, resetAt: now + 60_000 } }
    writeJson(metricsPath, {
      version: 1,
      updatedAt: now - 1_000,
      metrics: {
        alpha: {
          usageCount: 9,
          lastUsed: now - 1_000,
          rateLimits: { fiveHour: { remaining: 20, limit: 100, resetAt: now + 60_000, updatedAt: now - 4_000 } },
          rateLimitHistory: [snapshot]
        }
      }
    })
    writeJson(accountsPath, {
      version: 2,
      activeAlias: 'alpha',
      rotationIndex: 0,
      lastRotation: now,
      accounts: {
        alpha: {
          accessToken: 'access-alpha',
          refreshToken: 'refresh-alpha',
          expiresAt: now + 60_000,
          notes: 'state survives',
          usageCount: 5,
          lastUsed: now - 2_000,
          rateLimits: { fiveHour: { remaining: 20, limit: 100, resetAt: now + 60_000, updatedAt: now - 4_000 } },
          rateLimitHistory: [snapshot]
        }
      }
    })

    const { store } = await importFreshStoreModules()
    store.loadStore()

    const persistedMetrics = readJson(metricsPath)
    expect(persistedMetrics.metrics.alpha.usageCount).toBe(9)
    expect(persistedMetrics.metrics.alpha.lastUsed).toBe(now - 1_000)
    expect(persistedMetrics.metrics.alpha.rateLimitHistory).toEqual([snapshot])
    expect(readJson(accountsPath).accounts.alpha.notes).toBe('state survives')
    for (const field of METRIC_FIELDS) {
      expect(readJson(accountsPath).accounts.alpha).not.toHaveProperty(field)
    }

    await importFreshStoreModules().then(({ store: rerunStore }) => rerunStore.loadStore())
    expect(readJson(metricsPath).metrics.alpha.rateLimitHistory).toEqual([snapshot])
    expect(readJson(metricsPath).metrics.alpha.usageCount).toBe(9)
  })

  it('recovers state-only v3 accounts when the sidecar is missing', async () => {
    const now = 1_800_000_200_000
    writeJson(accountsPath, {
      version: 3,
      activeAlias: 'alpha',
      rotationIndex: 0,
      lastRotation: now,
      accounts: {
        alpha: {
          accessToken: 'access-alpha',
          refreshToken: 'refresh-alpha',
          expiresAt: now + 60_000,
          email: 'alpha@example.com',
          enabled: false,
          disabledBy: 'operator'
        }
      }
    })

    const { store } = await importFreshStoreModules()
    const loaded = store.loadStore()

    expect(loaded.version).toBe(3)
    expect(loaded.accounts.alpha.accessToken).toBe('access-alpha')
    expect(loaded.accounts.alpha.refreshToken).toBe('refresh-alpha')
    expect(loaded.accounts.alpha.expiresAt).toBe(now + 60_000)
    expect(loaded.accounts.alpha.enabled).toBe(false)
    expect(loaded.accounts.alpha.disabledBy).toBe('operator')

    expect(fs.existsSync(metricsPath)).toBe(true)
    expect(readJson(metricsPath).metrics).toEqual({})
    const persistedAccounts = readJson(accountsPath)
    expect(persistedAccounts.accounts.alpha).toMatchObject({
      accessToken: 'access-alpha',
      refreshToken: 'refresh-alpha',
      expiresAt: now + 60_000,
      email: 'alpha@example.com',
      enabled: false,
      disabledBy: 'operator'
    })
  })
})

describe('Store metrics write-path split', () => {
  let splitDir: string
  let accountsPath: string
  let metricsPath: string

  beforeEach(() => {
    splitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-store-split-'))
    accountsPath = path.join(splitDir, 'accounts.json')
    metricsPath = path.join(splitDir, 'account-metrics.json')
    process.env = {
      ...originalEnv,
      OPENCODE_MULTI_AUTH_STORE_DIR: splitDir,
      OPENCODE_MULTI_AUTH_STORE_FILE: accountsPath
    }
  })

  afterEach(() => {
    process.env = originalEnv
    fs.rmSync(splitDir, { recursive: true, force: true })
    jest.resetModules()
  })

  function writeStateOnlyStore(now: number): void {
    writeJson(accountsPath, {
      version: 3,
      activeAlias: 'alpha',
      rotationIndex: 0,
      lastRotation: now,
      accounts: {
        alpha: {
          accessToken: 'access-alpha',
          refreshToken: 'refresh-alpha',
          expiresAt: now + 60_000,
          email: 'alpha@example.com'
        },
        beta: {
          accessToken: 'access-beta',
          refreshToken: 'refresh-beta',
          expiresAt: now + 60_000,
          email: 'beta@example.com'
        }
      }
    })
  }

  it('routes telemetry-only updateAccount writes to metrics without rewriting accounts.json', async () => {
    const now = 1_800_000_300_000
    writeStateOnlyStore(now)
    const before = fs.readFileSync(accountsPath, 'utf8')

    const { store, metricsStore } = await importFreshStoreModules()
    store.updateAccount('alpha', {
      lastSeenAt: now + 1,
      limitStatus: 'success',
      rateLimits: {
        fiveHour: { remaining: 9, limit: 100, resetAt: now + 30_000, updatedAt: now + 1 }
      }
    })

    expect(fs.readFileSync(accountsPath, 'utf8')).toBe(before)
    expect(metricsStore.getMetrics('alpha')).toEqual(expect.objectContaining({
      lastSeenAt: now + 1,
      limitStatus: 'success',
      rateLimits: {
        fiveHour: { remaining: 9, limit: 100, resetAt: now + 30_000, updatedAt: now + 1 }
      }
    }))
    expect(metricsStore.getMetrics('alpha')?.rateLimitHistory).toHaveLength(1)
  })

  it('keeps setActiveAlias activity telemetry out of accounts.json', async () => {
    const now = 1_800_000_400_000
    writeStateOnlyStore(now)
    const { store, metricsStore } = await importFreshStoreModules()

    store.setActiveAlias('beta')

    const persisted = readJson(accountsPath)
    expect(persisted.activeAlias).toBe('beta')
    expect(persisted.accounts.alpha).not.toHaveProperty('lastActiveUntil')
    expect(persisted.accounts.beta).not.toHaveProperty('lastSeenAt')
    expect(metricsStore.getMetrics('alpha')?.lastActiveUntil).toEqual(expect.any(Number))
    expect(metricsStore.getMetrics('beta')?.lastSeenAt).toEqual(expect.any(Number))
  })

  it('removes metrics when removeAccount deletes the account', async () => {
    const now = 1_800_000_500_000
    writeStateOnlyStore(now)
    writeJson(metricsPath, {
      version: 1,
      updatedAt: now,
      metrics: {
        alpha: { usageCount: 4, lastSeenAt: now - 1_000 },
        beta: { usageCount: 2 }
      }
    })

    const { store, metricsStore } = await importFreshStoreModules()
    expect(metricsStore.getMetrics('alpha')).toBeDefined()

    store.removeAccount('alpha')
    metricsStore.flushSync(true)

    expect(store.loadStore().accounts.alpha).toBeUndefined()
    expect(metricsStore.getMetrics('alpha')).toBeUndefined()
    expect(readJson(metricsPath).metrics.alpha).toBeUndefined()
    expect(readJson(metricsPath).metrics.beta).toEqual(expect.objectContaining({ usageCount: 2 }))
  })
})
