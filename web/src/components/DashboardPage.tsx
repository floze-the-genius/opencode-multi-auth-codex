import { useState, useCallback } from 'react'
import { useDashboardState } from '../hooks/useDashboardState'
import {
  useSyncMutation,
  useRefreshTokensMutation,
  useRefreshLimitsMutation,
  useStopRefreshQueueMutation,
  useEnableAccountMutation,
  useRemoveAccountMutation,
  useUpdateAccountMetaMutation,
  useReauthAccountMutation,
  useSwitchAccountMutation,
  useImportCodexAuthMutation,
  useUseInCodexMutation,
  useLogsQuery
} from '../api/queries'
import { useNotification } from '../hooks/useNotification'
import { ApiError } from '../api/client'
import type { CodexActiveState } from '../types/api'
import { normalizeLogLine } from './OperationsPage'
import { AccountDrawer } from './AccountDrawer'
import { isAccountEnabled } from '../lib/account-status'
import { formatResetTime, formatResetTimeCompact } from '../lib/reset-time'
import { quotaPercent, quotaSeverity, formatQuotaLabel } from '../lib/quota-helpers'
import {
  normalizeHistory,
  calculateVelocity,
  estimateExhaustion,
  formatVelocity,
  formatTimeToExhaustion
} from '../lib/account-history'
import { AccountHistoryChart } from './AccountHistoryChart'
import { deriveOverviewInsights } from '../lib/overview-insights'
import type { AccountView } from '../types/api'
import './DashboardPage.css'

function codexActiveLabel(codexActive: CodexActiveState | undefined): string {
  if (!codexActive) return 'Unknown'
  switch (codexActive.status) {
    case 'matched':
      return codexActive.email
        ? `${codexActive.alias} (${codexActive.email})`
        : (codexActive.alias ?? 'Unknown')
    case 'unknown':
      return 'Codex account not in store'
    case 'missing':
      return 'No Codex account set'
    case 'error':
      return 'Codex auth.json unreadable'
    default:
      return 'Unknown'
  }
}

function codexActiveSeverity(codexActive: CodexActiveState | undefined): 'ok' | 'warn' | 'error' | 'muted' {
  if (!codexActive) return 'muted'
  switch (codexActive.status) {
    case 'matched': return 'ok'
    case 'unknown': return 'warn'
    case 'missing': return 'muted'
    case 'error': return 'error'
    default: return 'muted'
  }
}

function importCodexErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'CODEX_AUTH_INVALID') {
      return 'Codex auth.json is malformed or missing required fields. Check ~/.codex/auth.json.'
    }
    return err.message || 'Import failed'
  }
  if (err instanceof Error) return err.message
  return 'Import failed'
}

function useInCodexErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'ALIAS_NOT_FOUND':
      case 'ACCOUNT_NOT_FOUND':
        return 'Account not found in the store.'
      case 'ACCOUNT_UNUSABLE':
        return 'Account cannot be used in Codex (missing tokens or invalid).'
      default:
        return err.message || 'Failed to set Codex account.'
    }
  }
  if (err instanceof Error) return err.message
  return 'Failed to set Codex account.'
}

function formatDate(value: number | string | undefined): string {
  if (!value) return 'never'
  return new Date(value).toLocaleString()
}

function formatStoreStatus(encrypted: boolean, locked: boolean): string {
  if (encrypted) {
    return locked ? 'Encrypted (locked)' : 'Encrypted'
  }
  return 'Plain'
}

function queueSeverity(queue: import('../types/api').RefreshQueueState): 'error' | 'warning' | 'ok' {
  if (queue.errors > 0) return 'error'
  if (queue.running && queue.completed < queue.total) return 'ok'
  if (!queue.running && queue.completed === queue.total && queue.total > 0) return 'ok'
  return 'warning'
}



function AccountPrediction({
  account,
  type
}: {
  account: AccountView
  type: 'fiveHour' | 'weekly'
}) {
  const history = normalizeHistory(account.rateLimitHistory)
  const velocity = calculateVelocity(history, type)
  const window = type === 'fiveHour' ? account.rateLimits?.fiveHour : account.rateLimits?.weekly
  const exhaustion = estimateExhaustion(
    velocity,
    window?.remaining,
    window?.limit,
    window?.resetAt
  )
  const velocityText = formatVelocity(velocity)
  const timeText = formatTimeToExhaustion(exhaustion?.timeToExhaustionMs ?? null)

  if (!velocity && !exhaustion) {
    return (
      <span className="account-prediction account-prediction--muted">
        {type === 'fiveHour' ? '5h' : '7d'}: {velocityText}
      </span>
    )
  }

  const isCritical = exhaustion && exhaustion.exhaustsBeforeReset && exhaustion.timeToExhaustionMs < 3600_000
  const isWarning = exhaustion && exhaustion.exhaustsBeforeReset && exhaustion.timeToExhaustionMs < 7200_000

  return (
    <span
      className={`account-prediction${isCritical ? ' account-prediction--critical' : isWarning ? ' account-prediction--warning' : ''}`}
      title={exhaustion ? `Reset: ${window?.resetAt ? formatResetTimeCompact(window.resetAt) : 'unknown'}` : undefined}
    >
      {type === 'fiveHour' ? '5h' : '7d'}: {velocityText}
      {exhaustion && timeText && (
        <span className="account-prediction__exhaustion">
          {' · '}exhaust {timeText}
          {!exhaustion.exhaustsBeforeReset && ' (before reset)'}
        </span>
      )}
    </span>
  )
}

export function DashboardPage(): JSX.Element {
  const { data: state, isLoading, error, refetch } = useDashboardState()
  const { data: logsData, isLoading: logsLoading } = useLogsQuery(50)

  const syncMutation = useSyncMutation()
  const refreshTokensMutation = useRefreshTokensMutation()
  const refreshLimitsMutation = useRefreshLimitsMutation()
  const stopQueueMutation = useStopRefreshQueueMutation()
  const enableMutation = useEnableAccountMutation()
  const removeMutation = useRemoveAccountMutation()
  const updateMetaMutation = useUpdateAccountMetaMutation()
  const reauthMutation = useReauthAccountMutation()
  const switchMutation = useSwitchAccountMutation()
  const importCodexMutation = useImportCodexAuthMutation()
  const useInCodexMutation = useUseInCodexMutation()

  const { addNotification } = useNotification()

  const [drawerAccount, setDrawerAccount] = useState<AccountView | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleOpenAccount = useCallback((account: AccountView) => {
    setDrawerAccount(account)
    setDrawerOpen(true)
  }, [])

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false)
    setDrawerAccount(null)
  }, [])

  const handleSync = useCallback(() => {
    syncMutation.mutate()
  }, [syncMutation])

  const handleRefreshTokens = useCallback(() => {
    refreshTokensMutation.mutate(undefined)
  }, [refreshTokensMutation])

  const handleRefreshLimits = useCallback(() => {
    refreshLimitsMutation.mutate(undefined)
  }, [refreshLimitsMutation])

  const handleRefreshUI = useCallback(() => {
    refetch()
  }, [refetch])

  const handleStopQueue = useCallback(() => {
    stopQueueMutation.mutate()
  }, [stopQueueMutation])

  const handleImportCodex = useCallback(() => {
    importCodexMutation.mutate(undefined, {
      onSuccess: (data) => {
        if (data.added) {
          addNotification({ message: `Imported Codex account: ${data.alias ?? 'unknown'}`, type: 'success' })
        } else if (data.updated) {
          addNotification({ message: `Updated Codex account: ${data.alias ?? 'unknown'}`, type: 'success' })
        } else {
          addNotification({ message: 'Codex auth.json imported (no changes)', type: 'info' })
        }
      },
      onError: (err) => {
        addNotification({ message: importCodexErrorMessage(err), type: 'error' })
      }
    })
  }, [importCodexMutation, addNotification])

  if (isLoading) {
    return (
      <div className="dashboard-page" data-testid="dashboard-loading">
        <div className="dashboard-loading">Loading dashboard...</div>
      </div>
    )
  }

  if (error || !state) {
    return (
      <div className="dashboard-page" data-testid="dashboard-error">
        <div className="dashboard-error">
          Failed to load dashboard state: {error?.message || 'Unknown error'}
        </div>
      </div>
    )
  }

  const insights = deriveOverviewInsights(state)
  const soonest5h = insights.upcomingResets.find((r) => r.type === '5h')
  const soonestWeekly = insights.upcomingResets.find((r) => r.type === 'weekly')

  return (
    <div className="dashboard-page" data-testid="dashboard-shell" data-dashboard-surface="dashboard">
      {/* Health Summary */}
      <section className="dashboard-health" aria-label="Dashboard health">
        <div className="meta-grid">
          <div className="meta-card">
            <span className="meta-label">Accounts</span>
            <strong className="meta-value">{state.accounts.length}</strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">On device</span>
            <strong className="meta-value">{state.deviceAlias || 'none'}</strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Active</span>
            <strong className="meta-value">{state.rotationAlias || 'none'}</strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Recommended</span>
            <strong className="meta-value">{state.recommendedAlias || 'n/a'}</strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Store</span>
            <strong className="meta-value">
              {formatStoreStatus(state.storeStatus.encrypted, state.storeStatus.locked)}
            </strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Last sync</span>
            <strong className="meta-value">
              {state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString() : 'never'}
            </strong>
          </div>
          <div className="meta-card meta-card--codex" aria-label="Codex active account">
            <span className="meta-label">Codex active</span>
            <strong className={`meta-value codex-active-value codex-active-value--${codexActiveSeverity(state.codexActive)}`}>
              {codexActiveLabel(state.codexActive)}
            </strong>
          </div>
        </div>
      </section>

      {/* System Notices */}
      {(state.lastSyncError || state.storeStatus.error) && (
        <div className="dashboard-notice dashboard-notice--error" role="alert">
          {state.lastSyncError || state.storeStatus.error}
        </div>
      )}

      {state.login && (
        <div className="dashboard-notice dashboard-notice--info" data-testid="login-progress">
          <div>
            {state.login.mode === 'auto' ? 'Auto-login' : 'Login'} in progress for{' '}
            <strong>{state.login.alias}</strong>
            {state.login.url && (
              <>
                {' — '}
                <a href={state.login.url} target="_blank" rel="noreferrer">
                  Open login manually
                </a>
              </>
            )}
          </div>
          {state.login.email && <div>Email: {state.login.email}</div>}
          {state.login.step && <div>Status: {state.login.step}</div>}
        </div>
      )}

      {!state.login && state.lastLoginError && (
        <div className="dashboard-notice dashboard-notice--error" role="alert">
          Login error: {state.lastLoginError}
        </div>
      )}

      {/* Quick Actions */}
      <section className="dashboard-actions" aria-label="Dashboard quick actions">
        <div className="actions-row">
          <button
            type="button"
            onClick={handleImportCodex}
            disabled={importCodexMutation.isPending}
            aria-busy={importCodexMutation.isPending}
            title="Read ~/.codex/auth.json and import the account into the store"
          >
            {importCodexMutation.isPending ? 'Importing...' : 'Import from Codex auth.json'}
          </button>
          <button type="button" className="secondary" onClick={handleSync} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? 'Syncing...' : 'Sync auth.json'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={handleRefreshTokens}
            disabled={refreshTokensMutation.isPending}
          >
            {refreshTokensMutation.isPending ? 'Refreshing...' : 'Refresh tokens (all)'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={handleRefreshLimits}
            disabled={refreshLimitsMutation.isPending || state.queue?.running}
          >
            {refreshLimitsMutation.isPending ? 'Refreshing...' : 'Refresh limits (all)'}
          </button>
          <button type="button" className="secondary" onClick={handleRefreshUI}>
            Refresh UI
          </button>
        </div>
        {importCodexMutation.isSuccess && (
          <div className="codex-import-feedback codex-import-feedback--success" role="status" aria-live="polite">
            ✓ {importCodexMutation.data?.added
              ? `Account "${importCodexMutation.data.alias}" added from Codex`
              : importCodexMutation.data?.updated
              ? `Account "${importCodexMutation.data.alias}" updated from Codex`
              : 'Codex auth.json imported (no changes)'}
          </div>
        )}
        {importCodexMutation.isError && (
          <div className="codex-import-feedback codex-import-feedback--error" role="alert">
            {importCodexErrorMessage(importCodexMutation.error)}
          </div>
        )}
      </section>

      {/* Queue Status */}
      <section className="dashboard-queue" aria-label="Dashboard queue">
        {state.queue ? (
          <div className={`queue-status queue-status--${queueSeverity(state.queue)}`}>
            <div className="queue-header">
              <span className={`queue-dot queue-dot--${queueSeverity(state.queue)}`} aria-hidden="true" />
              <div className="queue-info">
                <strong>{state.queue.running ? 'Running' : 'Idle'}</strong>
                <span className="queue-detail">
                  {state.queue.completed} / {state.queue.total} completed
                  {state.queue.errors > 0 && (
                    <span className="queue-error-count"> · {state.queue.errors} error{state.queue.errors === 1 ? '' : 's'}</span>
                  )}
                </span>
              </div>
            </div>
            <div className="progress-bar">
              <div
                className={`progress-fill progress-fill--${queueSeverity(state.queue)}`}
                style={{
                  width: `${state.queue.total ? Math.round((state.queue.completed / state.queue.total) * 100) : 0}%`
                }}
              />
            </div>
            {state.queue.running && (
              <button
                type="button"
                className="danger small"
                onClick={handleStopQueue}
                disabled={stopQueueMutation.isPending}
              >
                {stopQueueMutation.isPending ? 'Stopping...' : 'Stop refresh'}
              </button>
            )}
          </div>
        ) : (
          <div className="dashboard-notice">No refresh activity.</div>
        )}
      </section>

      {/* Insights — adopted from Overview */}
      <section className="dashboard-insights" aria-label="Dashboard insights">
        {/* Quota Health */}
        <div className="insights-section">
          <h2 className="section-title">Quota Health</h2>
          <div className="quota-health-grid">
            <div className="quota-health-card">
              <h3 className="quota-health-title">5-Hour Window</h3>
              <div className="quota-health-bars">
                <div className="quota-health-bar">
                  <span className="quota-health-dot quota-health-dot--safe" />
                  <span className="quota-health-label">Safe</span>
                  <strong className="quota-health-count">{insights.quotaHealth.fiveHour.safe}</strong>
                </div>
                <div className="quota-health-bar">
                  <span className="quota-health-dot quota-health-dot--warning" />
                  <span className="quota-health-label">Warning</span>
                  <strong className="quota-health-count">{insights.quotaHealth.fiveHour.warning}</strong>
                </div>
                <div className="quota-health-bar">
                  <span className="quota-health-dot quota-health-dot--critical" />
                  <span className="quota-health-label">Critical</span>
                  <strong className="quota-health-count">{insights.quotaHealth.fiveHour.critical}</strong>
                </div>
                <div className="quota-health-bar">
                  <span className="quota-health-dot quota-health-dot--unknown" />
                  <span className="quota-health-label">Unknown</span>
                  <strong className="quota-health-count">{insights.quotaHealth.fiveHour.unknown}</strong>
                </div>
              </div>
            </div>
            <div className="quota-health-card">
              <h3 className="quota-health-title">Weekly Window</h3>
              <div className="quota-health-bars">
                <div className="quota-health-bar">
                  <span className="quota-health-dot quota-health-dot--safe" />
                  <span className="quota-health-label">Safe</span>
                  <strong className="quota-health-count">{insights.quotaHealth.weekly.safe}</strong>
                </div>
                <div className="quota-health-bar">
                  <span className="quota-health-dot quota-health-dot--warning" />
                  <span className="quota-health-label">Warning</span>
                  <strong className="quota-health-count">{insights.quotaHealth.weekly.warning}</strong>
                </div>
                <div className="quota-health-bar">
                  <span className="quota-health-dot quota-health-dot--critical" />
                  <span className="quota-health-label">Critical</span>
                  <strong className="quota-health-count">{insights.quotaHealth.weekly.critical}</strong>
                </div>
                <div className="quota-health-bar">
                  <span className="quota-health-dot quota-health-dot--unknown" />
                  <span className="quota-health-label">Unknown</span>
                  <strong className="quota-health-count">{insights.quotaHealth.weekly.unknown}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Upcoming Resets */}
        <div className="insights-section">
          <h2 className="section-title">Upcoming Resets</h2>
          {soonest5h || soonestWeekly ? (
            <div className="resets-grid">
              {soonest5h && (
                <div className="reset-card">
                  <span className="reset-type">5-Hour</span>
                  <strong className="reset-alias">{soonest5h.alias}</strong>
                  <span className="reset-relative">{soonest5h.relative}</span>
                  <span className="reset-exact">{formatResetTimeCompact(soonest5h.resetAt)}</span>
                </div>
              )}
              {soonestWeekly && (
                <div className="reset-card">
                  <span className="reset-type">Weekly</span>
                  <strong className="reset-alias">{soonestWeekly.alias}</strong>
                  <span className="reset-relative">{soonestWeekly.relative}</span>
                  <span className="reset-exact">{formatResetTimeCompact(soonestWeekly.resetAt)}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="overview-notice">No reset data available.</div>
          )}
        </div>

        {/* Anomalies */}
        <div className="insights-section">
          <h2 className="section-title">Anomalies</h2>
          {insights.anomalies.length > 0 ? (
            <div className="anomalies-list">
              {insights.anomalies.map((anomaly, index) => (
                <div key={index} className={`anomaly-item anomaly-item--${anomaly.severity}`}>
                  <span className={`anomaly-dot anomaly-dot--${anomaly.severity}`} aria-hidden="true" />
                  <span className="anomaly-message">{anomaly.message}</span>
                  {anomaly.alias && <span className="anomaly-alias">{anomaly.alias}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="overview-notice overview-notice--info">No anomalies detected.</div>
          )}
        </div>

        {/* Recommendations */}
        <div className="insights-section">
          <h2 className="section-title">Recommendations</h2>
          {insights.recommendations.length > 0 ? (
            <div className="recommendations-list">
              {insights.recommendations.map((rec, index) => (
                <div key={index} className={`recommendation-item recommendation-item--${rec.priority}`}>
                  <div className="recommendation-header">
                    <span className={`recommendation-priority recommendation-priority--${rec.priority}`}>
                      {rec.priority}
                    </span>
                  </div>
                  <p className="recommendation-message">{rec.message}</p>
                  {rec.action && <span className="recommendation-action">{rec.action}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="overview-notice">No recommendations at this time.</div>
          )}
        </div>
      </section>

      {/* Account Status Cards */}
      <section className="dashboard-account-cards" aria-label="Account status">
        <div className="account-cards-grid">
          {state.accounts.map((account) => {
            const isActive = state.rotationAlias === account.alias
            const isRecommended = state.recommendedAlias === account.alias
            const isCodexActive = state.codexActive?.status === 'matched' && state.codexActive.alias === account.alias
            const accountEnabled = isAccountEnabled(account)
            const fiveHourPct = quotaPercent(
              account.rateLimits?.fiveHour?.remaining,
              account.rateLimits?.fiveHour?.limit
            )
            const weeklyPct = quotaPercent(
              account.rateLimits?.weekly?.remaining,
              account.rateLimits?.weekly?.limit
            )
            const fiveHourSev = quotaSeverity(fiveHourPct)
            const weeklySev = quotaSeverity(weeklyPct)
            const history = normalizeHistory(account.rateLimitHistory)
            const fiveHourVelocity = calculateVelocity(history, 'fiveHour')
            const weeklyVelocity = calculateVelocity(history, 'weekly')

            return (
              <div
                key={account.alias}
                className={`account-card${!accountEnabled ? ' account-card--disabled' : ''}${isActive ? ' account-card--active' : ''}`}
                data-testid={`account-card-${account.alias}`}
              >
                <div className="account-card-header">
                  <div className="account-card-name">
                    <strong className="account-alias">{account.alias}</strong>
                    {account.email && <span className="account-email">{account.email}</span>}
                  </div>
                  <div className="account-card-badges">
                    {!accountEnabled ? (
                      <span className="badge badge--disabled">disabled</span>
                    ) : (
                      <>
                        {isActive && <span className="badge badge--active">active</span>}
                        {isRecommended && <span className="badge badge--recommended">recommended</span>}
                      </>
                    )}
                    {isCodexActive && (
                      <span
                        className="badge badge--codex-active"
                        title="This account is currently written to ~/.codex/auth.json"
                        aria-label="Active in Codex"
                      >
                        Codex ✓
                      </span>
                    )}
                  </div>
                </div>

                {(account.rateLimits?.fiveHour || account.rateLimits?.weekly) && (
                  <div className="account-card-quotas">
                    {account.rateLimits?.fiveHour && (
                      <div className="quota-row" aria-label="5-hour quota">
                        <span className="quota-label">5h</span>
                        <div className="quota-bar-container">
                          <div
                            className={`quota-bar quota-bar--${fiveHourSev}`}
                            style={{ width: `${fiveHourPct}%` }}
                            role="progressbar"
                            aria-valuenow={fiveHourPct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          />
                        </div>
                        <span className={`quota-value quota-value--${fiveHourSev}`}>
                          {formatQuotaLabel(
                            account.rateLimits.fiveHour.remaining,
                            account.rateLimits.fiveHour.limit
                          )}
                        </span>
                      </div>
                    )}
                    {account.rateLimits?.weekly && (
                      <div className="quota-row" aria-label="Weekly quota">
                        <span className="quota-label">7d</span>
                        <div className="quota-bar-container">
                          <div
                            className={`quota-bar quota-bar--${weeklySev}`}
                            style={{ width: `${weeklyPct}%` }}
                            role="progressbar"
                            aria-valuenow={weeklyPct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          />
                        </div>
                        <span className={`quota-value quota-value--${weeklySev}`}>
                          {formatQuotaLabel(
                            account.rateLimits.weekly.remaining,
                            account.rateLimits.weekly.limit
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* History charts */}
                <div className="account-card-charts">
                  {account.rateLimits?.fiveHour && (
                    <AccountHistoryChart
                      history={history}
                      type="fiveHour"
                      currentWindow={account.rateLimits.fiveHour}
                      velocity={fiveHourVelocity}
                      resetAt={account.rateLimits.fiveHour.resetAt}
                    />
                  )}
                  {account.rateLimits?.weekly && (
                    <AccountHistoryChart
                      history={history}
                      type="weekly"
                      currentWindow={account.rateLimits.weekly}
                      velocity={weeklyVelocity}
                      resetAt={account.rateLimits.weekly.resetAt}
                    />
                  )}
                </div>

                {/* Predictions */}
                {(account.rateLimits?.fiveHour || account.rateLimits?.weekly) && (
                  <div className="account-card-predictions">
                    {account.rateLimits?.fiveHour && (
                      <AccountPrediction account={account} type="fiveHour" />
                    )}
                    {account.rateLimits?.weekly && (
                      <AccountPrediction account={account} type="weekly" />
                    )}
                  </div>
                )}

                <div className="account-card-meta">
                  {account.limitsConfidence && (
                    <span
                      className={`confidence confidence--${account.limitsConfidence}`}
                      aria-label={`Limits confidence: ${account.limitsConfidence}`}
                    >
                      {account.limitsConfidence}
                    </span>
                  )}
                  {account.source && <span className="account-source">{account.source}</span>}
                  {account.usageCount > 0 && (
                    <span className="account-usage">{account.usageCount} uses</span>
                  )}
                  {account.tags && account.tags.length > 0 && (
                    <span className="account-tags">
                      {account.tags.map((t) => (
                        <span key={t} className="tag">{t}</span>
                      ))}
                    </span>
                  )}
                </div>

                {/* Reset timing */}
                {(account.rateLimits?.fiveHour?.resetAt || account.rateLimits?.weekly?.resetAt) && (
                  <div className="account-card-resets" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {account.rateLimits?.fiveHour?.resetAt && (
                      <span>5h reset: {formatResetTime(account.rateLimits.fiveHour.resetAt)}</span>
                    )}
                    {account.rateLimits?.weekly?.resetAt && (
                      <span>wk reset: {formatResetTime(account.rateLimits.weekly.resetAt)}</span>
                    )}
                  </div>
                )}

                <div className="account-card-actions">
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => handleOpenAccount(account)}
                    aria-label={`Manage ${account.alias}`}
                  >
                    Manage
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Logs & Observability Panel (in-page, not behind a tab) */}
      <section className="dashboard-logs-panel" aria-label="Logs and observability">
        {/* Observability */}
        <div className="operations-section" aria-label="Observability">
          <h2 className="section-title">Observability</h2>
          <div className="meta-grid">
            <div className="meta-card">
              <span className="meta-label">Store status</span>
              <strong className="meta-value">
                {formatStoreStatus(state.storeStatus.encrypted, state.storeStatus.locked)}
              </strong>
            </div>
            <div className="meta-card">
              <span className="meta-label">Last sync</span>
              <strong className="meta-value">
                {formatDate(state.lastSyncAt)}
              </strong>
            </div>
            <div className="meta-card">
              <span className="meta-label">Last synced alias</span>
              <strong className="meta-value">{state.lastSyncAlias || 'none'}</strong>
            </div>
            <div className="meta-card">
              <span className="meta-label">Log path</span>
              <strong className="meta-value meta-value-small">{state.logPath}</strong>
            </div>
          </div>
        </div>

        {/* Logs Viewer */}
        <div className="operations-section" aria-label="Logs">
          <h2 className="section-title">Logs</h2>
          {logsLoading ? (
            <div className="operations-notice">Loading logs...</div>
          ) : logsData?.lines && logsData.lines.length > 0 ? (
            <div className="logs-container">
              <div className="logs-path">{logsData.path}</div>
              <div className="logs-list" role="log" aria-live="polite">
                {logsData.lines.map((rawLine, index) => {
                  const line = normalizeLogLine(rawLine)
                  return (
                    <div key={index} className={`log-line log-line--${line.level}`}>
                      <span className="log-time">{line.time ? new Date(line.time).toLocaleTimeString() : ''}</span>
                      <span className={`log-level log-level--${line.level}`}>{line.level}</span>
                      <span className="log-message">{line.message}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="operations-notice">No logs available.</div>
          )}
        </div>
      </section>

      {drawerOpen && drawerAccount && (
        <AccountDrawer
          account={drawerAccount}
          isActive={state.rotationAlias === drawerAccount.alias}
          codexActive={state.codexActive}
          onClose={handleCloseDrawer}
          onToggleEnable={() => {
            const currentlyEnabled = isAccountEnabled(drawerAccount)
            enableMutation.mutate(
              { alias: drawerAccount.alias, enabled: !currentlyEnabled },
              {
                onSuccess: () => {
                  addNotification({
                    message: `Account ${drawerAccount.alias} ${currentlyEnabled ? 'disabled' : 'enabled'}`,
                    type: 'success'
                  })
                },
                onError: (err: Error) => {
                  addNotification({ message: err.message, type: 'error' })
                }
              }
            )
          }}
          onRemove={() => {
            removeMutation.mutate(drawerAccount.alias, {
              onSuccess: () => {
                addNotification({ message: `Account ${drawerAccount.alias} removed`, type: 'success' })
                handleCloseDrawer()
              },
              onError: (err: Error) => {
                addNotification({ message: err.message, type: 'error' })
              }
            })
          }}
          onUpdateMeta={(tags: string, notes: string) => {
            updateMetaMutation.mutate(
              { alias: drawerAccount.alias, tags, notes },
              {
                onSuccess: () => {
                  addNotification({ message: `Account ${drawerAccount.alias} updated`, type: 'success' })
                },
                onError: (err: Error) => {
                  addNotification({ message: err.message, type: 'error' })
                }
              }
            )
          }}
          onReauth={() => {
            reauthMutation.mutate(
              { alias: drawerAccount.alias },
              {
                onSuccess: (data) => {
                  addNotification({ message: `Re-auth started for ${drawerAccount.alias}`, type: 'info' })
                  if (data.url) {
                    window.open(data.url, '_blank')
                  }
                },
                onError: (err: Error) => {
                  addNotification({ message: err.message, type: 'error' })
                }
              }
            )
          }}
          onRefreshTokens={() => {
            refreshTokensMutation.mutate(drawerAccount.alias, {
              onSuccess: (data) => {
                const result = data.results.find((item) => item.alias === drawerAccount.alias)
                if (result?.error) {
                  addNotification({ message: result.error, type: 'error' })
                  return
                }
                if (result?.updated) {
                  addNotification({ message: `Tokens refreshed for ${drawerAccount.alias}`, type: 'success' })
                  return
                }
                addNotification({ message: `Failed to refresh tokens for ${drawerAccount.alias}`, type: 'error' })
              },
              onError: (err: Error) => {
                addNotification({ message: err.message, type: 'error' })
              }
            })
          }}
          onRefreshLimits={() => {
            refreshLimitsMutation.mutate(drawerAccount.alias, {
              onSuccess: (data) => {
                addNotification({
                  message: data.queue.running
                    ? `Limit refresh queued for ${drawerAccount.alias}`
                    : `Limit refresh started for ${drawerAccount.alias}`,
                  type: 'info'
                })
              },
              onError: (err: Error) => {
                addNotification({ message: err.message, type: 'error' })
              }
            })
          }}
          onSwitch={() => {
            switchMutation.mutate(drawerAccount.alias, {
              onSuccess: () => {
                addNotification({ message: `Switched to ${drawerAccount.alias}`, type: 'success' })
              },
              onError: (err: Error) => {
                addNotification({ message: err.message, type: 'error' })
              }
            })
          }}
          onUseInCodex={() => {
            useInCodexMutation.mutate(drawerAccount.alias, {
              onSuccess: () => {
                addNotification({ message: `Codex set to ${drawerAccount.alias}`, type: 'success' })
              },
              onError: (err: Error) => {
                addNotification({ message: useInCodexErrorMessage(err), type: 'error' })
              }
            })
          }}
          useInCodexPending={useInCodexMutation.isPending}
          useInCodexError={useInCodexMutation.isError ? useInCodexErrorMessage(useInCodexMutation.error) : null}
          useInCodexSuccess={useInCodexMutation.isSuccess}
          isBusy={
            enableMutation.isPending ||
            removeMutation.isPending ||
            updateMetaMutation.isPending ||
            reauthMutation.isPending ||
            refreshTokensMutation.isPending ||
            refreshLimitsMutation.isPending ||
            switchMutation.isPending
          }
        />
      )}
    </div>
  )
}
