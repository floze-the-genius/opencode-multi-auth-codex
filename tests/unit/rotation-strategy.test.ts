import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { getNextAccount } from '../../src/rotation.js'
import {
  clearPendingFirstTurnAliases,
  clearSession,
  recordPendingFirstTurnAlias,
  type PendingFirstTurnFingerprint
} from '../../src/session-store.js'
import { loadStore, saveStore } from '../../src/store.js'
import { updateSettings } from '../../src/settings.js'
import { DEFAULT_CONFIG, type AccountCredentials } from '../../src/types.js'

const TEST_DIR = path.join(os.tmpdir(), `oma-rotation-test-${Date.now()}`)
const TEST_STORE_FILE = path.join(TEST_DIR, 'accounts.json')
const originalEnv = process.env

function clearPendingFirstTurns(): void {
  clearPendingFirstTurnAliases()
}

const fingerprintA: PendingFirstTurnFingerprint = {
  model: 'gpt-5.4',
  project: 'project-1',
  directory: '/repo',
  inputHash: 'hash-a'
}

const fingerprintB: PendingFirstTurnFingerprint = {
  ...fingerprintA,
  inputHash: 'hash-b'
}

const fingerprintC: PendingFirstTurnFingerprint = {
  ...fingerprintA,
  inputHash: 'hash-c'
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

describe('use-up strategy', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      OPENCODE_MULTI_AUTH_STORE_DIR: TEST_DIR,
      OPENCODE_MULTI_AUTH_STORE_FILE: TEST_STORE_FILE
    }
    delete process.env.OPENCODE_MULTI_AUTH_ROTATION_STRATEGY

    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true })
    }
    fs.mkdirSync(TEST_DIR, { recursive: true })
    clearPendingFirstTurns()
  })

  afterEach(() => {
    clearPendingFirstTurns()
    process.env = originalEnv
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  it('picks the first account by store insertion order when both are healthy', async () => {
    const store = loadStore()
    store.accounts.alpha = createAccount('alpha', 0)
    store.accounts.beta = createAccount('beta', 0)
    saveStore(store)

    updateSettings({ rotationStrategy: 'use-up' }, 'test')

    const result = await getNextAccount(DEFAULT_CONFIG)
    expect(result?.account.alias).toBe('alpha')
  })

  it('always returns the same first account across multiple requests (no advancement)', async () => {
    const store = loadStore()
    store.accounts.alpha = createAccount('alpha', 0)
    store.accounts.beta = createAccount('beta', 0)
    saveStore(store)

    updateSettings({ rotationStrategy: 'use-up' }, 'test')

    const r1 = await getNextAccount(DEFAULT_CONFIG)
    const r2 = await getNextAccount(DEFAULT_CONFIG)
    const r3 = await getNextAccount(DEFAULT_CONFIG)
    expect(r1?.account.alias).toBe('alpha')
    expect(r2?.account.alias).toBe('alpha')
    expect(r3?.account.alias).toBe('alpha')
  })

  it('switches to the next account when the first is rate-limited', async () => {
    const store = loadStore()
    store.accounts.alpha = {
      ...createAccount('alpha', 5),
      rateLimitedUntil: Date.now() + 60_000
    }
    store.accounts.beta = createAccount('beta', 0)
    saveStore(store)

    updateSettings({ rotationStrategy: 'use-up' }, 'test')

    const result = await getNextAccount(DEFAULT_CONFIG)
    expect(result?.account.alias).toBe('beta')
  })

  it('respects explicit useUpOrder over store insertion order', async () => {
    const store = loadStore()
    store.accounts.alpha = createAccount('alpha', 0)
    store.accounts.beta = createAccount('beta', 0)
    saveStore(store)

    updateSettings({ rotationStrategy: 'use-up', useUpOrder: ['beta', 'alpha'] }, 'test')

    const result = await getNextAccount(DEFAULT_CONFIG)
    expect(result?.account.alias).toBe('beta')
  })

  it('skips aliases in useUpOrder that no longer exist and continues with the rest', async () => {
    const store = loadStore()
    store.accounts.alpha = createAccount('alpha', 0)
    store.accounts.beta = createAccount('beta', 0)
    saveStore(store)

    // 'ghost' does not exist in the store
    updateSettings({ rotationStrategy: 'use-up', useUpOrder: ['ghost', 'beta', 'alpha'] }, 'test')

    const result = await getNextAccount(DEFAULT_CONFIG)
    expect(result?.account.alias).toBe('beta')
  })

  it('appends accounts not in useUpOrder after explicit entries in insertion order', async () => {
    const store = loadStore()
    store.accounts.alpha = createAccount('alpha', 0)
    store.accounts.beta = createAccount('beta', 0)
    store.accounts.gamma = createAccount('gamma', 0)
    saveStore(store)

    // Only beta is in the explicit order; alpha and gamma come after in insertion order
    updateSettings({ rotationStrategy: 'use-up', useUpOrder: ['beta'] }, 'test')

    // First call: beta (explicit first)
    const r1 = await getNextAccount(DEFAULT_CONFIG)
    expect(r1?.account.alias).toBe('beta')
  })

  it('moves to the second explicit account when the first is rate-limited', async () => {
    const store = loadStore()
    store.accounts.alpha = createAccount('alpha', 0)
    store.accounts.beta = {
      ...createAccount('beta', 0),
      rateLimitedUntil: Date.now() + 60_000
    }
    store.accounts.gamma = createAccount('gamma', 0)
    saveStore(store)

    updateSettings({ rotationStrategy: 'use-up', useUpOrder: ['beta', 'alpha', 'gamma'] }, 'test')

    const result = await getNextAccount(DEFAULT_CONFIG)
    expect(result?.account.alias).toBe('alpha')
  })
})

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

    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true })
    }
    fs.mkdirSync(TEST_DIR, { recursive: true })
    clearPendingFirstTurns()
  })

  afterEach(() => {
    clearSession('session-1')
    clearSession('session-2')
    clearPendingFirstTurns()
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

  it('pins the first keyed session request to the account used before prompt_cache_key exists', async () => {
    const store = loadStore()
    store.accounts.alpha = createAccount('alpha', 0)
    store.accounts.beta = createAccount('beta', 0)
    saveStore(store)

    updateSettings({ rotationStrategy: 'round-robin', stickySessionRouting: true }, 'test')

    const firstTurn = await getNextAccount(DEFAULT_CONFIG)
    expect(firstTurn?.account.alias).toBe('alpha')

    recordPendingFirstTurnAlias(firstTurn!.account.alias, fingerprintA)

    const firstKeyedTurn = await getNextAccount(DEFAULT_CONFIG, {
      sessionId: 'session-1',
      firstTurnFingerprint: fingerprintA
    })
    expect(firstKeyedTurn?.account.alias).toBe('alpha')

    const followUpTurn = await getNextAccount(DEFAULT_CONFIG, { sessionId: 'session-1' })
    expect(followUpTurn?.account.alias).toBe('alpha')

    const unrelatedTurn = await getNextAccount(DEFAULT_CONFIG)
    expect(unrelatedTurn?.account.alias).toBe('beta')
  })

  it('matches pending first-turn aliases by fingerprint when multiple starts are pending', async () => {
    const store = loadStore()
    store.accounts.alpha = createAccount('alpha', 0)
    store.accounts.beta = createAccount('beta', 0)
    saveStore(store)

    updateSettings({ rotationStrategy: 'round-robin', stickySessionRouting: true }, 'test')
    recordPendingFirstTurnAlias('alpha', fingerprintA)
    recordPendingFirstTurnAlias('beta', fingerprintB)

    const firstKeyedTurn = await getNextAccount(DEFAULT_CONFIG, {
      sessionId: 'session-1',
      firstTurnFingerprint: fingerprintB
    })

    expect(firstKeyedTurn?.account.alias).toBe('beta')
  })

  it('keeps the latest alias for the same first-turn fingerprint', async () => {
    const store = loadStore()
    store.accounts.alpha = createAccount('alpha', 0)
    store.accounts.beta = createAccount('beta', 0)
    saveStore(store)

    updateSettings({ rotationStrategy: 'round-robin', stickySessionRouting: true }, 'test')
    recordPendingFirstTurnAlias('alpha', fingerprintA)
    recordPendingFirstTurnAlias('beta', fingerprintA)

    const firstKeyedTurn = await getNextAccount(DEFAULT_CONFIG, {
      sessionId: 'session-1',
      firstTurnFingerprint: fingerprintA
    })

    expect(firstKeyedTurn?.account.alias).toBe('beta')
  })

  it('does not guess from multiple pending aliases when no fingerprint matches', async () => {
    const store = loadStore()
    store.accounts.alpha = createAccount('alpha', 0)
    store.accounts.beta = createAccount('beta', 0)
    store.accounts.gamma = createAccount('gamma', 0)
    store.rotationIndex = 2
    saveStore(store)

    updateSettings({ rotationStrategy: 'round-robin', stickySessionRouting: true }, 'test')
    recordPendingFirstTurnAlias('alpha', fingerprintA)
    recordPendingFirstTurnAlias('beta', fingerprintB)

    const firstKeyedTurn = await getNextAccount(DEFAULT_CONFIG, {
      sessionId: 'session-2',
      firstTurnFingerprint: fingerprintC
    })

    expect(firstKeyedTurn?.account.alias).toBe('gamma')
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
})
