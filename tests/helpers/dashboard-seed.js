import * as fs from 'node:fs'
import * as path from 'node:path'

export const DASHBOARD_SEED_TIME = 1_700_000_000_000

export const dashboardAlphaMetrics = {
  usageCount: 3,
  lastRefresh: '2023-11-14T22:13:20.000Z',
  lastSeenAt: DASHBOARD_SEED_TIME + 10_000,
  lastActiveUntil: DASHBOARD_SEED_TIME + 20_000,
  lastUsed: DASHBOARD_SEED_TIME + 30_000,
  rateLimits: {
    fiveHour: { limit: 100, remaining: 80, resetAt: DASHBOARD_SEED_TIME + 60_000, updatedAt: DASHBOARD_SEED_TIME + 1_000 },
    weekly: { limit: 1000, remaining: 700, resetAt: DASHBOARD_SEED_TIME + 120_000, updatedAt: DASHBOARD_SEED_TIME + 2_000 }
  },
  rateLimitHistory: [
    {
      at: DASHBOARD_SEED_TIME + 2_000,
      fiveHour: { limit: 100, remaining: 80, resetAt: DASHBOARD_SEED_TIME + 60_000 },
      weekly: { limit: 1000, remaining: 700, resetAt: DASHBOARD_SEED_TIME + 120_000 }
    }
  ],
  limitStatus: 'success',
  limitError: 'alpha previous soft limit',
  lastLimitProbeAt: DASHBOARD_SEED_TIME + 40_000,
  lastLimitErrorAt: DASHBOARD_SEED_TIME + 35_000,
  limitsConfidence: 'fresh'
}

export const dashboardBetaMetrics = {
  usageCount: 7,
  lastRefresh: '2023-11-14T22:15:20.000Z',
  lastSeenAt: DASHBOARD_SEED_TIME + 11_000,
  lastActiveUntil: DASHBOARD_SEED_TIME + 21_000,
  lastUsed: DASHBOARD_SEED_TIME + 31_000,
  rateLimits: {
    fiveHour: { limit: 100, remaining: 50, resetAt: DASHBOARD_SEED_TIME + 60_000, updatedAt: DASHBOARD_SEED_TIME + 3_000 },
    weekly: { limit: 1000, remaining: 450, resetAt: DASHBOARD_SEED_TIME + 120_000, updatedAt: DASHBOARD_SEED_TIME + 4_000 }
  },
  rateLimitHistory: [
    {
      at: DASHBOARD_SEED_TIME + 4_000,
      fiveHour: { limit: 100, remaining: 50, resetAt: DASHBOARD_SEED_TIME + 60_000 },
      weekly: { limit: 1000, remaining: 450, resetAt: DASHBOARD_SEED_TIME + 120_000 }
    }
  ],
  limitStatus: 'error',
  limitError: 'beta probe failed',
  lastLimitProbeAt: DASHBOARD_SEED_TIME + 41_000,
  lastLimitErrorAt: DASHBOARD_SEED_TIME + 42_000,
  limitsConfidence: 'stale'
}

function stateAccount(alias) {
  const expiresAt = Date.now() + (alias === 'beta' ? 120_000 : alias === 'gamma' ? 90_000 : 60_000)
  const shared = {
    alias,
    accessToken: `token-${alias}`,
    refreshToken: `refresh-${alias}`,
    expiresAt,
    email: `${alias}@example.com`,
    enabled: true,
    source: alias === 'beta' ? 'codex' : 'opencode'
  }

  if (alias === 'alpha') {
    return { ...shared, tags: ['core'], notes: 'primary account' }
  }
  if (alias === 'beta') {
    return { ...shared, tags: ['backup'], notes: 'secondary account' }
  }
  return { ...shared, tags: [], notes: '' }
}

function pickAccounts(accountSet) {
  const accounts = { alpha: stateAccount('alpha') }
  if (accountSet === 'alpha-beta' || accountSet === 'alpha-beta-gamma') {
    accounts.beta = stateAccount('beta')
  }
  if (accountSet === 'alpha-beta-gamma') {
    accounts.gamma = stateAccount('gamma')
  }
  return accounts
}

function pickMetrics(accountSet) {
  const metrics = { alpha: dashboardAlphaMetrics }
  if (accountSet === 'alpha-beta' || accountSet === 'alpha-beta-gamma') {
    metrics.beta = dashboardBetaMetrics
  }
  // gamma intentionally has no metrics entry: it exercises brand-new account defaults.
  return metrics
}

export function writeDashboardSandbox(options) {
  const accountSet = options.accountSet ?? 'alpha-beta'
  fs.rmSync(options.root, { recursive: true, force: true })
  fs.mkdirSync(options.root, { recursive: true })
  fs.writeFileSync(options.authFile, JSON.stringify({ OPENAI_API_KEY: null, tokens: {} }, null, 2))
  fs.writeFileSync(
    options.storeFile,
    JSON.stringify(
      {
        version: 3,
        activeAlias: 'alpha',
        rotationIndex: 0,
        lastRotation: DASHBOARD_SEED_TIME,
        rotationStrategy: 'round-robin',
        settings: {
          rotationStrategy: 'round-robin',
          criticalThreshold: 10,
          lowThreshold: 30,
          accountWeights: {},
          featureFlags: {
            antigravityEnabled: false,
            stickySessionsEnabled: options.stickyEnabled ?? false
          }
        },
        accounts: pickAccounts(accountSet)
      },
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(path.dirname(options.storeFile), 'account-metrics.json'),
    JSON.stringify(
      {
        version: 1,
        updatedAt: DASHBOARD_SEED_TIME,
        metrics: pickMetrics(accountSet)
      },
      null,
      2
    )
  )
}
