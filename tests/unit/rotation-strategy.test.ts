import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { getNextAccount } from '../../src/rotation.js'
import { loadStore, saveStore } from '../../src/store.js'
import { updateSettings } from '../../src/settings.js'
import { DEFAULT_CONFIG, type AccountCredentials } from '../../src/types.js'

const TEST_DIR = path.join(os.tmpdir(), `oma-rotation-test-${Date.now()}`)
const TEST_STORE_FILE = path.join(TEST_DIR, 'accounts.json')
const originalEnv = process.env
const originalFetch = global.fetch

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

describe('Rotation Strategy Runtime Behavior', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      OPENCODE_MULTI_AUTH_STORE_DIR: TEST_DIR,
      OPENCODE_MULTI_AUTH_STORE_FILE: TEST_STORE_FILE
    }
    delete process.env.OPENCODE_MULTI_AUTH_ROTATION_STRATEGY
    delete process.env.OPENCODE_MULTI_AUTH_CRITICAL_THRESHOLD
    delete process.env.OPENCODE_MULTI_AUTH_LOW_THRESHOLD
    delete process.env.OPENCODE_MULTI_AUTH_CREDIT_ACCOUNT_ALIASES

    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true })
    }
    fs.mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = originalEnv
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

  it('keeps accounts with credits eligible after included limits are exhausted', async () => {
    const store = loadStore()
    store.accounts.noCredits = {
      ...createAccount('noCredits', 0),
      rateLimitedUntil: Date.now() + 60 * 60 * 1000
    }
    store.accounts.withCredits = {
      ...createAccount('withCredits', 10),
      rateLimitedUntil: Date.now() + 60 * 60 * 1000,
      credits: {
        hasCredits: true,
        unlimited: false,
        balance: '5.00',
        updatedAt: Date.now()
      }
    }
    saveStore(store)

    const rotation = await getNextAccount(
      {
        ...DEFAULT_CONFIG,
        rotationStrategy: 'least-used'
      },
      { model: 'gpt-5.4' }
    )

    expect(rotation?.account.alias).toBe('withCredits')
  })

  it('only keeps accounts with credits eligible when their alias is allowed', async () => {
    process.env.OPENCODE_MULTI_AUTH_CREDIT_ACCOUNT_ALIASES = 'personal'

    const store = loadStore()
    store.accounts.personal = {
      ...createAccount('personal', 10),
      rateLimitedUntil: Date.now() + 60 * 60 * 1000,
      credits: {
        hasCredits: true,
        balance: '5.00',
        updatedAt: Date.now()
      }
    }
    store.accounts.work = {
      ...createAccount('work', 0),
      rateLimitedUntil: Date.now() + 60 * 60 * 1000,
      credits: {
        hasCredits: true,
        balance: '5.00',
        updatedAt: Date.now()
      }
    }
    saveStore(store)

    const rotation = await getNextAccount(
      {
        ...DEFAULT_CONFIG,
        rotationStrategy: 'least-used'
      },
      { model: 'gpt-5.4' }
    )

    expect(rotation?.account.alias).toBe('personal')
  })

  it('does not use credits from disallowed accounts', async () => {
    process.env.OPENCODE_MULTI_AUTH_CREDIT_ACCOUNT_ALIASES = 'personal'

    const store = loadStore()
    store.accounts.work = {
      ...createAccount('work', 0),
      rateLimitedUntil: Date.now() + 60 * 60 * 1000,
      credits: {
        hasCredits: true,
        balance: '5.00',
        updatedAt: Date.now()
      }
    }
    saveStore(store)

    const rotation = await getNextAccount(
      {
        ...DEFAULT_CONFIG,
        rotationStrategy: 'least-used'
      },
      { model: 'gpt-5.4' }
    )

    expect(rotation).toBeNull()
  })

  it('refreshes usage once when all accounts are blocked and credits were added later', async () => {
    process.env.OPENCODE_MULTI_AUTH_USAGE_BASE_URL = 'https://example.test/backend-api'
    global.fetch = (async (_url, init) => {
      const auth = new Headers(init?.headers).get('Authorization') || ''
      const hasCredits = auth.includes('token-withCredits')
      return new Response(JSON.stringify({
        plan_type: 'pro',
        credits: {
          has_credits: hasCredits,
          unlimited: false,
          balance: hasCredits ? '5.00' : '0.00'
        },
        rate_limit: {
          allowed: false,
          limit_reached: true,
          primary_window: { used_percent: 100, reset_after_seconds: 60 },
          secondary_window: { used_percent: 100, reset_after_seconds: 120 }
        }
      }), { status: 200 })
    }) as typeof fetch

    const store = loadStore()
    store.accounts.noCredits = {
      ...createAccount('noCredits', 0),
      rateLimitedUntil: Date.now() + 60 * 60 * 1000
    }
    store.accounts.withCredits = {
      ...createAccount('withCredits', 10),
      rateLimitedUntil: Date.now() + 60 * 60 * 1000
    }
    saveStore(store)

    const rotation = await getNextAccount(
      {
        ...DEFAULT_CONFIG,
        rotationStrategy: 'least-used'
      },
      { model: 'gpt-5.4' }
    )

    const reloaded = loadStore()
    expect(rotation?.account.alias).toBe('withCredits')
    expect(reloaded.accounts.withCredits.credits).toEqual(expect.objectContaining({
      hasCredits: true,
      balance: '5.00'
    }))
    expect(reloaded.accounts.withCredits.rateLimitedUntil).toBeUndefined()
  })

  it('tries soft rate-limited accounts when usage refresh cannot confirm credits', async () => {
    process.env.OPENCODE_MULTI_AUTH_USAGE_BASE_URL = 'https://example.test/backend-api'
    global.fetch = (async () => new Response('{}', { status: 403 })) as typeof fetch

    const store = loadStore()
    store.accounts.alpha = {
      ...createAccount('alpha', 0),
      rateLimitedUntil: Date.now() + 60 * 60 * 1000
    }
    store.accounts.beta = {
      ...createAccount('beta', 10),
      rateLimitedUntil: Date.now() + 60 * 60 * 1000
    }
    saveStore(store)

    const rotation = await getNextAccount({
      ...DEFAULT_CONFIG,
      rotationStrategy: 'least-used'
    })

    expect(rotation?.account.alias).toBe('alpha')
  })
})
