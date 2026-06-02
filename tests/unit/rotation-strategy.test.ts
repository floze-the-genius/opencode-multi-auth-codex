import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createHash } from 'node:crypto'
import { getNextAccount } from '../../src/rotation.js'
import { loadStore, saveStore } from '../../src/store.js'
import { updateSettings } from '../../src/settings.js'
import { activateForce } from '../../src/force-mode.js'
import { flushSync as flushMetricsSync } from '../../src/metrics-store.js'
import { DEFAULT_CONFIG, type AccountCredentials } from '../../src/types.js'

let TEST_DIR = path.join(os.tmpdir(), `oma-rotation-test-${Date.now()}`)
let TEST_STORE_FILE = path.join(TEST_DIR, 'accounts.json')
let TEST_STICKY_FILE = path.join(TEST_DIR, 'sticky-sessions.json')
let TEST_METRICS_FILE = path.join(TEST_DIR, 'account-metrics.json')
const originalEnv = process.env
const originalFetch = global.fetch
const coldStartRedIt = process.argv.some((arg) => arg.includes('rotation-strategy.test.ts')) ? it : it.skip

type StickySelection = {
  source: 'header:session_id'
  canonical: string
  hash: string
}

function createAccount(alias: string, usageCount: number): AccountCredentials {
  return {
    alias,
    accessToken: `token-${alias}`,
    refreshToken: `refresh-${alias}`,
    expiresAt: Date.now() + 60 * 60 * 1000,
    usageCount,
    enabled: true
  }
}

function createPlanAccount(alias: string, usageCount: number, planType: string): AccountCredentials {
  return {
    ...createAccount(alias, usageCount),
    planType
  }
}

function createStickySelection(rawIdentity: string): StickySelection {
  const canonical = rawIdentity.trim().toLowerCase()
  return {
    source: 'header:session_id',
    canonical,
    hash: createHash('sha256').update(canonical).digest('hex')
  }
}

function writeStickyMappings(entries: Record<string, { alias: string; createdAt: number; lastUsedAt: number }>): void {
  fs.writeFileSync(
    TEST_STICKY_FILE,
    JSON.stringify(
      {
        version: 1,
        updatedAt: 1_700_000_000_000,
        entries
      },
      null,
      2
    ),
    'utf8'
  )
}

function writeMetrics(metrics: Record<string, Record<string, unknown>>): void {
  fs.writeFileSync(
    TEST_METRICS_FILE,
    JSON.stringify(
      {
        version: 1,
        updatedAt: 1_700_000_000_000,
        metrics
      },
      null,
      2
    ),
    'utf8'
  )
}

function writeStateStore(accounts: Record<string, Record<string, unknown>>, extra: Record<string, unknown> = {}): void {
  fs.mkdirSync(TEST_DIR, { recursive: true })
  fs.writeFileSync(
    TEST_STORE_FILE,
    JSON.stringify(
      {
        version: 3,
        accounts,
        activeAlias: null,
        rotationIndex: 0,
        lastRotation: 0,
        rotationStrategy: 'least-used',
        ...extra
      },
      null,
      2
    ),
    'utf8'
  )
}

function stateAccount(alias: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    alias,
    accessToken: `token-${alias}`,
    refreshToken: `refresh-${alias}`,
    expiresAt: Date.now() + 60 * 60 * 1000,
    enabled: true,
    ...extra
  }
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readStickyMappings(): {
  version: number
  updatedAt: number
  entries: Record<string, { alias: string; createdAt: number; lastUsedAt: number }>
} {
  return JSON.parse(fs.readFileSync(TEST_STICKY_FILE, 'utf8')) as {
    version: number
    updatedAt: number
    entries: Record<string, { alias: string; createdAt: number; lastUsedAt: number }>
  }
}

function enableStickySessions(rotationStrategy: 'round-robin' | 'least-used' = 'round-robin'): void {
  const update = updateSettings(
    {
      rotationStrategy,
      featureFlags: {
        antigravityEnabled: false,
        stickySessionsEnabled: true
      } as any
    },
    'test'
  )

  expect(update.success).toBe(true)
}

describe('Rotation Strategy Runtime Behavior', () => {
  beforeEach(() => {
    TEST_DIR = path.join(os.tmpdir(), `oma-rotation-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    TEST_STORE_FILE = path.join(TEST_DIR, 'accounts.json')
    TEST_STICKY_FILE = path.join(TEST_DIR, 'sticky-sessions.json')
    TEST_METRICS_FILE = path.join(TEST_DIR, 'account-metrics.json')
    process.env = {
      ...originalEnv,
      OPENCODE_MULTI_AUTH_STORE_DIR: TEST_DIR,
      OPENCODE_MULTI_AUTH_STORE_FILE: TEST_STORE_FILE
    }
    delete process.env.OPENCODE_MULTI_AUTH_ROTATION_STRATEGY
    delete process.env.OPENCODE_MULTI_AUTH_CRITICAL_THRESHOLD
    delete process.env.OPENCODE_MULTI_AUTH_LOW_THRESHOLD

    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true })
    }
    fs.mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  it('uses persisted least-used strategy even if config still says round-robin', async () => {
    const store = loadStore()
    store.accounts.alpha = createAccount('alpha', 10)
    store.accounts.beta = createAccount('beta', 1)
    saveStore(store)

    const update = updateSettings({ rotationStrategy: 'least-used' }, 'test')
    expect(update.success).toBe(true)

    const rotation = await getNextAccount({
      ...DEFAULT_CONFIG,
      rotationStrategy: 'round-robin'
    })

    expect(rotation?.account.alias).toBe('beta')
  })

  it('applies weighted strategy change immediately', async () => {
    const store = loadStore()
    store.accounts.alpha = createAccount('alpha', 0)
    store.accounts.beta = createAccount('beta', 0)
    saveStore(store)

    const update = updateSettings(
      {
        rotationStrategy: 'weighted-round-robin',
        accountWeights: { beta: 1 }
      },
      'test'
    )
    expect(update.success).toBe(true)

    const rotation = await getNextAccount({
      ...DEFAULT_CONFIG,
      rotationStrategy: 'round-robin'
    })

    expect(rotation?.account.alias).toBe('beta')
  })

  describe('allocator metrics cache reads and writes (RED)', () => {
    it('orders least-used candidates by usageCount and lastUsed from account-metrics.json', async () => {
      writeStateStore({
        alpha: stateAccount('alpha', { usageCount: 0, lastUsed: 1 }),
        beta: stateAccount('beta', { usageCount: 99, lastUsed: 9_999 })
      })
      writeMetrics({
        alpha: { usageCount: 25, lastUsed: 1_700_000_200_000 },
        beta: { usageCount: 1, lastUsed: 1_700_000_100_000 }
      })
      expect(updateSettings({ rotationStrategy: 'least-used' }, 'test').success).toBe(true)

      const rotation = await getNextAccount({ ...DEFAULT_CONFIG, rotationStrategy: 'least-used' })

      expect(rotation?.account.alias).toBe('beta')
    })

    it('uses cache usageCount for the zero-usage priority adjustment', async () => {
      writeStateStore({
        alpha: stateAccount('alpha', { usageCount: 7 }),
        beta: stateAccount('beta', { usageCount: 0 })
      })
      writeMetrics({
        alpha: { usageCount: 0 },
        beta: { usageCount: 3 }
      })
      expect(updateSettings({ rotationStrategy: 'round-robin' }, 'test').success).toBe(true)

      const rotation = await getNextAccount({ ...DEFAULT_CONFIG, rotationStrategy: 'round-robin' })

      expect(rotation?.account.alias).toBe('beta')
    })

    it('scores recent limit errors from the cache lastLimitErrorAt value', async () => {
      const now = Date.now()
      writeStateStore({
        alpha: stateAccount('alpha'),
        beta: stateAccount('beta')
      }, { rotationStrategy: 'round-robin' })
      writeMetrics({
        alpha: { lastLimitErrorAt: now - 5_000, limitError: 'recent probe failure' },
        beta: {}
      })
      expect(updateSettings({ rotationStrategy: 'round-robin' }, 'test').success).toBe(true)

      const rotation = await getNextAccount({ ...DEFAULT_CONFIG, rotationStrategy: 'round-robin' })

      expect(rotation?.account.alias).toBe('beta')
    })

    it('writes allocator usage telemetry only to the metrics sidecar, not per-account fields in accounts.json', async () => {
      writeStateStore({
        alpha: stateAccount('alpha'),
        beta: stateAccount('beta')
      })
      writeMetrics({
        alpha: { usageCount: 1, lastUsed: 1_700_000_000_000 },
        beta: { usageCount: 5, lastUsed: 1_700_000_100_000 }
      })
      expect(updateSettings({ rotationStrategy: 'least-used' }, 'test').success).toBe(true)

      const rotation = await getNextAccount({ ...DEFAULT_CONFIG, rotationStrategy: 'least-used' })
      flushMetricsSync(true)

      const persistedState = readJson(TEST_STORE_FILE)
      const persistedMetrics = readJson(TEST_METRICS_FILE)
      expect(rotation?.account.alias).toBe('alpha')
      expect(persistedState.accounts.alpha).not.toHaveProperty('usageCount')
      expect(persistedState.accounts.alpha).not.toHaveProperty('lastUsed')
      expect(persistedState.accounts.alpha).not.toHaveProperty('limitError')
      expect(persistedMetrics.metrics.alpha.usageCount).toBe(2)
      expect(typeof persistedMetrics.metrics.alpha.lastUsed).toBe('number')
      expect(persistedMetrics.metrics.alpha.limitError).toBeUndefined()
    })

    it('returns selected accounts with sidecar rate limits and history for runtime consumers', async () => {
      const history = [
        {
          at: 1_700_000_010_000,
          fiveHour: { remaining: 80, limit: 100, resetAt: 1_700_000_100_000 },
          weekly: { remaining: 700, limit: 1000, resetAt: 1_700_000_200_000 }
        },
        {
          at: 1_700_000_020_000,
          fiveHour: { remaining: 70, limit: 100, resetAt: 1_700_000_100_000 },
          weekly: { remaining: 650, limit: 1000, resetAt: 1_700_000_200_000 }
        }
      ]
      const rateLimits = {
        fiveHour: { remaining: 70, limit: 100, resetAt: 1_700_000_100_000, updatedAt: 1_700_000_020_000 },
        weekly: { remaining: 650, limit: 1000, resetAt: 1_700_000_200_000, updatedAt: 1_700_000_020_000 }
      }
      writeStateStore({
        alpha: stateAccount('alpha'),
        beta: stateAccount('beta')
      })
      writeMetrics({
        alpha: { usageCount: 1, rateLimits, rateLimitHistory: history, limitsConfidence: 'fresh', limitStatus: 'success' },
        beta: { usageCount: 9 }
      })
      expect(updateSettings({ rotationStrategy: 'least-used' }, 'test').success).toBe(true)

      const rotation = await getNextAccount({ ...DEFAULT_CONFIG, rotationStrategy: 'least-used' })

      expect(rotation?.account.alias).toBe('alpha')
      expect(rotation?.account.rateLimits).toEqual(rateLimits)
      expect(rotation?.account.rateLimitHistory).toEqual(history)
      expect(rotation?.account.limitsConfidence).toBe('fresh')
      expect(rotation?.account.limitStatus).toBe('success')
    })
  })

  coldStartRedIt('RED: cold-start least-used selection reads usageCount and lastUsed from account-metrics.json cache', async () => {
    const store = loadStore()
    store.accounts.alpha = createAccount('alpha', 0)
    store.accounts.beta = createAccount('beta', 0)
    saveStore(store)
    writeMetrics({
      alpha: { usageCount: 25, lastUsed: 1_700_000_200_000 },
      beta: { usageCount: 1, lastUsed: 1_700_000_100_000 }
    })

    const update = updateSettings({ rotationStrategy: 'least-used' }, 'test')
    expect(update.success).toBe(true)

    const rotation = await getNextAccount({
      ...DEFAULT_CONFIG,
      rotationStrategy: 'least-used'
    })

    expect(rotation?.account.alias).toBe('beta')
  })

  it('prefers pro accounts first for non-spark models', async () => {
    const store = loadStore()
    store.accounts.plus = createPlanAccount('plus', 0, 'plus')
    store.accounts.pro = createPlanAccount('pro', 10, 'pro')
    saveStore(store)

    const rotation = await getNextAccount(
      {
        ...DEFAULT_CONFIG,
        rotationStrategy: 'least-used'
      },
      { model: 'gpt-5.4' }
    )

    expect(rotation?.account.alias).toBe('pro')
  })

  it('restricts spark models to pro accounts only', async () => {
    const store = loadStore()
    store.accounts.plus = createPlanAccount('plus', 0, 'plus')
    store.accounts.pro = createPlanAccount('pro', 10, 'pro')
    saveStore(store)

    const rotation = await getNextAccount(
      {
        ...DEFAULT_CONFIG,
        rotationStrategy: 'least-used'
      },
      { model: 'gpt-5.3-codex-spark' }
    )

    expect(rotation?.account.alias).toBe('pro')
  })

  it('returns null for spark models when no pro accounts are available', async () => {
    const store = loadStore()
    store.accounts.plus = createPlanAccount('plus', 0, 'plus')
    saveStore(store)

    const rotation = await getNextAccount(
      {
        ...DEFAULT_CONFIG,
        rotationStrategy: 'least-used'
      },
      { model: 'gpt-5.3-codex-spark-xhigh' }
    )

    expect(rotation).toBeNull()
  })

  describe('sticky session routing (RED)', () => {
    it('uses the active strategy for the initial sticky assignment and persists the selected alias mapping', async () => {
      const sticky = createStickySelection(' Session-001 ')
      const store = loadStore()
      store.accounts.alpha = createAccount('alpha', 10)
      store.accounts.beta = createAccount('beta', 1)
      saveStore(store)
      enableStickySessions('least-used')

      const rotation = await getNextAccount(DEFAULT_CONFIG, { sticky } as any)

      expect(rotation?.account.alias).toBe('beta')
      expect(fs.existsSync(TEST_STICKY_FILE)).toBe(true)
      expect(readStickyMappings().entries[sticky.hash]).toEqual({
        alias: 'beta',
        createdAt: expect.any(Number),
        lastUsedAt: expect.any(Number)
      })
    })

    it('reuses a healthy sticky account without advancing rotationIndex', async () => {
      const sticky = createStickySelection('session-healthy')
      const stickyNow = Date.now()
      const store = loadStore()
      store.accounts.alpha = createAccount('alpha', 0)
      store.accounts.beta = createAccount('beta', 0)
      store.rotationIndex = 0
      saveStore(store)
      writeStickyMappings({
        [sticky.hash]: {
          alias: 'beta',
          createdAt: stickyNow,
          lastUsedAt: stickyNow
        }
      })
      enableStickySessions('round-robin')

      const rotation = await getNextAccount(DEFAULT_CONFIG, { sticky } as any)
      const updatedStore = loadStore()

      expect(rotation?.account.alias).toBe('beta')
      expect(updatedStore.rotationIndex).toBe(0)
    })

    it('writes sticky reuse telemetry to metrics without reintroducing per-account metric fields in accounts.json', async () => {
      const sticky = createStickySelection('session-metrics-cache')
      const stickyNow = Date.now()
      writeStateStore({
        alpha: stateAccount('alpha'),
        beta: stateAccount('beta')
      }, { rotationStrategy: 'round-robin', rotationIndex: 0 })
      writeMetrics({
        alpha: { usageCount: 4, lastUsed: stickyNow - 2_000 },
        beta: { usageCount: 2, lastUsed: stickyNow - 1_000 }
      })
      writeStickyMappings({
        [sticky.hash]: {
          alias: 'beta',
          createdAt: stickyNow,
          lastUsedAt: stickyNow
        }
      })
      expect(updateSettings({
        rotationStrategy: 'round-robin',
        featureFlags: { stickySessionsEnabled: true } as any
      }, 'test').success).toBe(true)

      const rotation = await getNextAccount(DEFAULT_CONFIG, { sticky } as any)
      flushMetricsSync(true)

      const persistedState = readJson(TEST_STORE_FILE)
      const persistedMetrics = readJson(TEST_METRICS_FILE)
      expect(rotation?.account.alias).toBe('beta')
      expect(persistedState.accounts.beta).not.toHaveProperty('usageCount')
      expect(persistedState.accounts.beta).not.toHaveProperty('lastUsed')
      expect(persistedState.accounts.beta).not.toHaveProperty('limitError')
      expect(persistedMetrics.metrics.beta.usageCount).toBe(3)
      expect(typeof persistedMetrics.metrics.beta.lastUsed).toBe('number')
    })

    it('falls back to another valid account and rewrites the sticky mapping when the mapped alias is exhausted', async () => {
      const sticky = createStickySelection('session-fallback')
      const now = Date.now()
      const store = loadStore()
      store.accounts.alpha = {
        ...createAccount('alpha', 0),
        rateLimitedUntil: now + 60_000
      }
      store.accounts.beta = createAccount('beta', 0)
      saveStore(store)
      writeStickyMappings({
        [sticky.hash]: {
          alias: 'alpha',
          createdAt: now,
          lastUsedAt: now
        }
      })
      enableStickySessions('round-robin')

      const rotation = await getNextAccount(DEFAULT_CONFIG, { sticky } as any)

      expect(rotation?.account.alias).toBe('beta')
      expect(readStickyMappings().entries[sticky.hash]?.alias).toBe('beta')
    })

    it('ignores an expired sticky mapping at runtime and falls back to normal selection', async () => {
      const sticky = createStickySelection('session-expired-runtime')
      const now = Date.now()
      const store = loadStore()
      store.accounts.alpha = createAccount('alpha', 5)
      store.accounts.beta = createAccount('beta', 0)
      store.rotationIndex = 0
      saveStore(store)
      writeStickyMappings({
        [sticky.hash]: {
          alias: 'beta',
          createdAt: now - (25 * 60 * 60 * 1000),
          lastUsedAt: now - (25 * 60 * 60 * 1000)
        }
      })
      enableStickySessions('round-robin')

      const rotation = await getNextAccount(DEFAULT_CONFIG, { sticky } as any)

      expect(rotation?.account.alias).toBe('alpha')
      expect(readStickyMappings().entries[sticky.hash]?.alias).toBe('alpha')
    })

    it('keeps the sticky mapping when the mapped alias fails temporarily and no replacement is available', async () => {
      const sticky = createStickySelection('session-temp-failure')
      const now = Date.now()
      const store = loadStore()
      store.accounts.alpha = {
        ...createAccount('alpha', 0),
        rateLimitedUntil: now + 60_000
      }
      saveStore(store)
      writeStickyMappings({
        [sticky.hash]: {
          alias: 'alpha',
          createdAt: now,
          lastUsedAt: now
        }
      })
      enableStickySessions('round-robin')

      const rotation = await getNextAccount(DEFAULT_CONFIG, { sticky } as any)

      expect(rotation).toBeNull()
      expect(readStickyMappings().entries[sticky.hash]?.alias).toBe('alpha')
    })

    it('removes the sticky mapping when the mapped alias has failed permanently and no replacement is available', async () => {
      const sticky = createStickySelection('session-permanent-failure')
      const store = loadStore()
      store.accounts.alpha = {
        ...createAccount('alpha', 0),
        enabled: false
      }
      saveStore(store)
      writeStickyMappings({
        [sticky.hash]: {
          alias: 'alpha',
          createdAt: Date.now(),
          lastUsedAt: Date.now()
        }
      })
      enableStickySessions('round-robin')

      const rotation = await getNextAccount(DEFAULT_CONFIG, { sticky } as any)

      expect(rotation).toBeNull()
      expect(readStickyMappings().entries[sticky.hash]).toBeUndefined()
    })

    it('removes the sticky mapping when the mapped alias has failed permanently and fallback candidates are unusable', async () => {
      const sticky = createStickySelection('session-permanent-failure-with-bad-fallback')
      const now = Date.now()
      const store = loadStore()
      store.accounts.alpha = {
        ...createAccount('alpha', 0),
        enabled: false
      }
      store.accounts.beta = {
        ...createAccount('beta', 0),
        expiresAt: now - 1_000
      }
      saveStore(store)
      writeStickyMappings({
        [sticky.hash]: {
          alias: 'alpha',
          createdAt: now,
          lastUsedAt: now
        }
      })
      enableStickySessions('round-robin')
      global.fetch = (async () => new Response('refresh failed', { status: 500 })) as typeof fetch

      const rotation = await getNextAccount(DEFAULT_CONFIG, { sticky } as any)

      expect(rotation).toBeNull()
      expect(readStickyMappings().entries[sticky.hash]).toBeUndefined()
    })

    it('ignores an existing sticky sidecar when the sticky flag is disabled', async () => {
      const sticky = createStickySelection('session-flag-disabled')
      const store = loadStore()
      store.accounts.alpha = createAccount('alpha', 5)
      store.accounts.beta = createAccount('beta', 0)
      store.rotationIndex = 0
      saveStore(store)
      writeStickyMappings({
        [sticky.hash]: {
          alias: 'beta',
          createdAt: Date.now(),
          lastUsedAt: Date.now()
        }
      })

      const rotation = await getNextAccount(DEFAULT_CONFIG, { sticky } as any)

      expect(rotation?.account.alias).toBe('alpha')
      expect(readStickyMappings().entries[sticky.hash]?.alias).toBe('beta')
    })

    it('bypasses sticky routing while force mode is active', async () => {
      const sticky = createStickySelection('session-force')
      const stickyNow = Date.now()
      const store = loadStore()
      store.accounts.alpha = createAccount('alpha', 0)
      store.accounts.beta = createAccount('beta', 0)
      saveStore(store)
      writeStickyMappings({
        [sticky.hash]: {
          alias: 'beta',
          createdAt: stickyNow,
          lastUsedAt: stickyNow
        }
      })
      enableStickySessions('round-robin')

      const force = activateForce('alpha', 'test')
      expect(force.success).toBe(true)

      const rotation = await getNextAccount(DEFAULT_CONFIG, { sticky } as any)

      expect(rotation?.account.alias).toBe('alpha')
      expect(readStickyMappings().entries[sticky.hash]?.alias).toBe('beta')
    })
  })
})
