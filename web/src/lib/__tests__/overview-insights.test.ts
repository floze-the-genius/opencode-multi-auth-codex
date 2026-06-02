import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { deriveOverviewInsights } from '../overview-insights'
import type { DashboardState } from '../../types/api'

const baseState: DashboardState = {
  authPath: '/auth.json',
  deviceAlias: 'test-device',
  rotationAlias: 'alpha',
  accounts: [
    {
      alias: 'alpha',
      email: 'alpha@example.com',
      enabled: true,
      usageCount: 3,
      source: 'opencode',
      rateLimits: {
        fiveHour: { limit: 100, remaining: 80, resetAt: Date.now() + 60_000, updatedAt: Date.now() },
        weekly: { limit: 1000, remaining: 700, resetAt: Date.now() + 120_000, updatedAt: Date.now() }
      },
      limitsConfidence: 'fresh'
    },
    {
      alias: 'beta',
      email: 'beta@example.com',
      enabled: false,
      disabledAt: Date.now(),
      disabledBy: 'dashboard',
      disableReason: 'manual',
      usageCount: 7,
      source: 'codex',
      rateLimits: {
        fiveHour: { limit: 100, remaining: 5, resetAt: Date.now() + 30_000, updatedAt: Date.now() },
        weekly: { limit: 1000, remaining: 450, resetAt: Date.now() + 120_000, updatedAt: Date.now() }
      },
      limitsConfidence: 'stale'
    }
  ],
  lastSyncAt: Date.now(),
  lastSyncError: null,
  lastSyncAlias: 'alpha',
  authSummary: { hasAccessToken: true, hasIdToken: true, hasRefreshToken: true },
  storeStatus: { locked: false, encrypted: true, error: null },
  login: null,
  lastLoginError: null,
  antigravity: { accounts: [], path: '' },
  queue: null,
  recommendedAlias: 'alpha',
  logPath: '/logs',
  autoLogin: { path: '', scriptPath: '', pythonPath: '', configured: false, accounts: [] },
  rotationStrategy: 'round-robin',
  force: { active: false, alias: null, forcedAt: null, forcedUntil: null, forcedBy: null, remainingMs: 0, remainingTime: '0s', previousRotationStrategy: null },
  featureFlags: { antigravityEnabled: false }
}

describe('deriveOverviewInsights', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('counts quota health correctly', () => {
    const insights = deriveOverviewInsights(baseState)
    expect(insights.quotaHealth.fiveHour.safe).toBe(1)
    expect(insights.quotaHealth.fiveHour.critical).toBe(1)
    expect(insights.quotaHealth.weekly.safe).toBe(2)
  })

  test('lists disabled accounts as anomalies', () => {
    const insights = deriveOverviewInsights(baseState)
    const disabled = insights.anomalies.find((a) => a.type === 'disabled')
    expect(disabled).toBeDefined()
    expect(disabled?.alias).toBe('beta')
  })

  test('lists stale limits as anomalies', () => {
    const insights = deriveOverviewInsights(baseState)
    const stale = insights.anomalies.find((a) => a.type === 'stale-limits')
    expect(stale).toBeDefined()
    expect(stale?.alias).toBe('beta')
  })

  test('includes sync error anomaly when present', () => {
    const state = { ...baseState, lastSyncError: 'Network timeout' }
    const insights = deriveOverviewInsights(state)
    const syncError = insights.anomalies.find((a) => a.type === 'sync-error')
    expect(syncError).toBeDefined()
    expect(syncError?.severity).toBe('critical')
  })

  test('recommends switching when recommended differs from active', () => {
    const state = { ...baseState, recommendedAlias: 'beta' }
    const insights = deriveOverviewInsights(state)
    const rec = insights.recommendations.find((r) => r.message.includes('differs from current active'))
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('high')
  })

  test('recommends urgent action for critical 5h quota', () => {
    const insights = deriveOverviewInsights(baseState)
    const rec = insights.recommendations.find((r) => r.message.includes('critical 5-hour quota'))
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('urgent')
  })

  test('sorts upcoming resets by time', () => {
    const insights = deriveOverviewInsights(baseState)
    expect(insights.upcomingResets.length).toBeGreaterThan(0)
    // beta 5h reset is sooner (30s) than alpha 5h reset (60s)
    expect(insights.upcomingResets[0].alias).toBe('beta')
    expect(insights.upcomingResets[0].type).toBe('5h')
  })

  test('snapshot reflects current state', () => {
    const insights = deriveOverviewInsights(baseState)
    expect(insights.currentSnapshot.totalAccounts).toBe(2)
    expect(insights.currentSnapshot.enabledAccounts).toBe(1)
    expect(insights.currentSnapshot.disabledAccounts).toBe(1)
    expect(insights.currentSnapshot.activeAlias).toBe('alpha')
    expect(insights.currentSnapshot.recommendedAlias).toBe('alpha')
  })

  test('shows healthy message when no issues', () => {
    const healthyState: DashboardState = {
      ...baseState,
      accounts: [
        {
          alias: 'alpha',
          email: 'alpha@example.com',
          enabled: true,
          usageCount: 3,
          source: 'opencode',
          rateLimits: {
            fiveHour: { limit: 100, remaining: 80, resetAt: Date.now() + 60 * 60 * 1000 },
            weekly: { limit: 1000, remaining: 700, resetAt: Date.now() + 24 * 60 * 60 * 1000 }
          },
          limitsConfidence: 'fresh'
        }
      ],
      lastSyncError: null,
      recommendedAlias: 'alpha',
      rotationAlias: 'alpha'
    }
    const insights = deriveOverviewInsights(healthyState)
    expect(insights.recommendations.some((r) => r.message.includes('All systems look healthy'))).toBe(true)
  })
})
