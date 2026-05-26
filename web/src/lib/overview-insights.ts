import type { DashboardState } from '../types/api'
import { isAccountEnabled } from './account-status'
import { quotaPercent, quotaSeverity } from './quota-helpers'

export interface QuotaHealthSummary {
  fiveHour: { critical: number; warning: number; safe: number; unknown: number }
  weekly: { critical: number; warning: number; safe: number; unknown: number }
}

export interface UpcomingReset {
  alias: string
  type: '5h' | 'weekly'
  resetAt: number
  relative: string
}

export interface Anomaly {
  type: string
  severity: 'critical' | 'warning' | 'info'
  message: string
  alias?: string
}

export interface Recommendation {
  priority: 'urgent' | 'high' | 'normal' | 'low'
  message: string
  action?: string
}

export interface OverviewInsights {
  quotaHealth: QuotaHealthSummary
  upcomingResets: UpcomingReset[]
  anomalies: Anomaly[]
  recommendations: Recommendation[]
  currentSnapshot: {
    totalAccounts: number
    enabledAccounts: number
    disabledAccounts: number
    activeAlias: string | null
    recommendedAlias: string | null
    deviceAlias: string | null
    hasSyncError: boolean
    hasLoginError: boolean
    queueRunning: boolean
  }
}

function formatRelativeTime(resetAt: number): string {
  const diff = resetAt - Date.now()
  if (diff <= 0) return 'now'
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  const remainingMins = mins % 60
  const remainingHours = hours % 24
  if (days > 0) return `${days}d ${remainingHours}h`
  if (hours > 0) return `${hours}h ${remainingMins}m`
  return `${mins}m`
}

export function deriveOverviewInsights(state: DashboardState): OverviewInsights {
  const enabledAccounts = state.accounts.filter(isAccountEnabled)
  const disabledAccounts = state.accounts.filter((a) => !isAccountEnabled(a))

  const quotaHealth: QuotaHealthSummary = {
    fiveHour: { critical: 0, warning: 0, safe: 0, unknown: 0 },
    weekly: { critical: 0, warning: 0, safe: 0, unknown: 0 }
  }

  const upcomingResets: UpcomingReset[] = []
  const anomalies: Anomaly[] = []
  const recommendations: Recommendation[] = []

  for (const account of state.accounts) {
    // Quota health
    if (account.rateLimits?.fiveHour) {
      const pct = quotaPercent(account.rateLimits.fiveHour.remaining, account.rateLimits.fiveHour.limit)
      const sev = quotaSeverity(pct)
      if (sev === 'critical') quotaHealth.fiveHour.critical++
      else if (sev === 'low') quotaHealth.fiveHour.warning++
      else quotaHealth.fiveHour.safe++
    } else {
      quotaHealth.fiveHour.unknown++
    }

    if (account.rateLimits?.weekly) {
      const pct = quotaPercent(account.rateLimits.weekly.remaining, account.rateLimits.weekly.limit)
      const sev = quotaSeverity(pct)
      if (sev === 'critical') quotaHealth.weekly.critical++
      else if (sev === 'low') quotaHealth.weekly.warning++
      else quotaHealth.weekly.safe++
    } else {
      quotaHealth.weekly.unknown++
    }

    // Upcoming resets
    if (account.rateLimits?.fiveHour?.resetAt) {
      upcomingResets.push({
        alias: account.alias,
        type: '5h',
        resetAt: account.rateLimits.fiveHour.resetAt,
        relative: formatRelativeTime(account.rateLimits.fiveHour.resetAt)
      })
    }
    if (account.rateLimits?.weekly?.resetAt) {
      upcomingResets.push({
        alias: account.alias,
        type: 'weekly',
        resetAt: account.rateLimits.weekly.resetAt,
        relative: formatRelativeTime(account.rateLimits.weekly.resetAt)
      })
    }

    // Anomalies per account
    if (!isAccountEnabled(account)) {
      anomalies.push({
        type: 'disabled',
        severity: 'warning',
        message: `Account "${account.alias}" is disabled${account.disableReason ? ` (${account.disableReason})` : ''}`,
        alias: account.alias
      })
    }

    if (account.authInvalid) {
      anomalies.push({
        type: 'auth-invalid',
        severity: 'critical',
        message: `Account "${account.alias}" has invalid auth / missing tokens`,
        alias: account.alias
      })
    }

    if (account.limitsConfidence === 'stale') {
      anomalies.push({
        type: 'stale-limits',
        severity: 'warning',
        message: `Limits for "${account.alias}" are stale`,
        alias: account.alias
      })
    }

    if (account.limitsConfidence === 'error') {
      anomalies.push({
        type: 'limits-error',
        severity: 'critical',
        message: `Failed to fetch limits for "${account.alias}"`,
        alias: account.alias
      })
    }

    if (account.rateLimitedUntil && account.rateLimitedUntil > Date.now()) {
      anomalies.push({
        type: 'rate-limited',
        severity: 'warning',
        message: `Account "${account.alias}" is rate-limited until ${new Date(account.rateLimitedUntil).toLocaleTimeString()}`,
        alias: account.alias
      })
    }

    if ((account.usageCount ?? 0) > 20) {
      anomalies.push({
        type: 'high-usage',
        severity: 'info',
        message: `Account "${account.alias}" has high usage (${account.usageCount} uses)`,
        alias: account.alias
      })
    }
  }

  // Global anomalies
  if (state.lastSyncError) {
    anomalies.push({
      type: 'sync-error',
      severity: 'critical',
      message: `Sync error: ${state.lastSyncError}`
    })
  }

  if (state.lastLoginError) {
    anomalies.push({
      type: 'login-error',
      severity: 'critical',
      message: `Login error: ${state.lastLoginError}`
    })
  }

  if (state.storeStatus.error) {
    anomalies.push({
      type: 'store-error',
      severity: 'critical',
      message: `Store error: ${state.storeStatus.error}`
    })
  }

  if (state.queue && state.queue.errors > 0) {
    anomalies.push({
      type: 'queue-errors',
      severity: 'warning',
      message: `Refresh queue has ${state.queue.errors} failed job(s)`
    })
  }

  // Sort upcoming resets by time
  upcomingResets.sort((a, b) => a.resetAt - b.resetAt)

  // Recommendations
  if (state.recommendedAlias && state.recommendedAlias !== state.rotationAlias) {
    recommendations.push({
      priority: 'high',
      message: `Recommended account "${state.recommendedAlias}" differs from current active "${state.rotationAlias || 'none'}"`,
      action: 'Switch to recommended account'
    })
  }

  const critical5h = quotaHealth.fiveHour.critical
  const criticalWeekly = quotaHealth.weekly.critical

  if (critical5h > 0) {
    recommendations.push({
      priority: 'urgent',
      message: `${critical5h} account(s) have critical 5-hour quota`,
      action: 'Wait for reset or switch to a healthier account'
    })
  }

  if (criticalWeekly > 0) {
    recommendations.push({
      priority: 'urgent',
      message: `${criticalWeekly} account(s) have critical weekly quota`,
      action: 'Consider reducing usage or waiting for weekly reset'
    })
  }

  const soonest5h = upcomingResets.find((r) => r.type === '5h')

  if (soonest5h && soonest5h.resetAt - Date.now() < 30 * 60 * 1000) {
    recommendations.push({
      priority: 'normal',
      message: `5-hour reset for "${soonest5h.alias}" is coming soon (${soonest5h.relative})`,
      action: 'Wait for reset if quota is low'
    })
  }

  if (disabledAccounts.length > 0) {
    recommendations.push({
      priority: 'normal',
      message: `${disabledAccounts.length} account(s) are disabled`,
      action: 'Review disabled accounts in Accounts tab'
    })
  }

  if (state.lastSyncError) {
    recommendations.push({
      priority: 'urgent',
      message: 'Auth sync failed — accounts may be out of date',
      action: 'Sync auth.json and check credentials'
    })
  }

  if (state.accounts.some((a) => a.authInvalid)) {
    recommendations.push({
      priority: 'high',
      message: 'One or more accounts have invalid auth tokens',
      action: 'Re-authenticate affected accounts'
    })
  }

  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'low',
      message: 'All systems look healthy',
      action: 'No action needed'
    })
  }

  // Sort recommendations by priority
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 }
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  return {
    quotaHealth,
    upcomingResets: upcomingResets.slice(0, 6),
    anomalies,
    recommendations,
    currentSnapshot: {
      totalAccounts: state.accounts.length,
      enabledAccounts: enabledAccounts.length,
      disabledAccounts: disabledAccounts.length,
      activeAlias: state.rotationAlias,
      recommendedAlias: state.recommendedAlias,
      deviceAlias: state.deviceAlias,
      hasSyncError: !!state.lastSyncError,
      hasLoginError: !!state.lastLoginError,
      queueRunning: state.queue?.running ?? false
    }
  }
}
