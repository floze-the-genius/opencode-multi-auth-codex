import { useDashboardState } from '../hooks/useDashboardState'
import { deriveOverviewInsights } from '../lib/overview-insights'
import { formatResetTimeCompact } from '../lib/reset-time'
import { isAccountEnabled } from '../lib/account-status'
import './OverviewPage.css'

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

export function OverviewPage(): JSX.Element {
  const { data: state, isLoading, error } = useDashboardState()

  if (isLoading) {
    return (
      <div className="overview-page" data-testid="overview-loading">
        <div className="overview-loading">Loading dashboard...</div>
      </div>
    )
  }

  if (error || !state) {
    return (
      <div className="overview-page" data-testid="overview-error">
        <div className="overview-error">
          Failed to load dashboard state: {error?.message || 'Unknown error'}
        </div>
      </div>
    )
  }

  const insights = deriveOverviewInsights(state)
  const snapshot = insights.currentSnapshot

  const soonest5h = insights.upcomingResets.find((r) => r.type === '5h')
  const soonestWeekly = insights.upcomingResets.find((r) => r.type === 'weekly')

  return (
    <div className="overview-page" data-dashboard-surface="overview">
      {/* Snapshot Header */}
      <section className="overview-section overview-snapshot" aria-label="System snapshot">
        <div className="snapshot-grid">
          <div className="snapshot-card">
            <span className="snapshot-label">Accounts</span>
            <strong className="snapshot-value">{snapshot.totalAccounts}</strong>
            <span className="snapshot-detail">{snapshot.enabledAccounts} enabled · {snapshot.disabledAccounts} disabled</span>
          </div>
          <div className="snapshot-card">
            <span className="snapshot-label">On device</span>
            <strong className="snapshot-value">{snapshot.deviceAlias || 'none'}</strong>
          </div>
          <div className="snapshot-card">
            <span className="snapshot-label">Active</span>
            <strong className="snapshot-value">{snapshot.activeAlias || 'none'}</strong>
          </div>
          <div className="snapshot-card">
            <span className="snapshot-label">Recommended</span>
            <strong className="snapshot-value">{snapshot.recommendedAlias || 'n/a'}</strong>
          </div>
          <div className="snapshot-card">
            <span className="snapshot-label">Store</span>
            <strong className="snapshot-value">
              {formatStoreStatus(state.storeStatus.encrypted, state.storeStatus.locked)}
            </strong>
          </div>
          <div className="snapshot-card">
            <span className="snapshot-label">Last sync</span>
            <strong className="snapshot-value snapshot-value-small">
              {state.lastSyncAt ? formatDate(state.lastSyncAt) : 'never'}
            </strong>
          </div>
        </div>
      </section>

      {/* Quota Health */}
      <section className="overview-section" aria-label="Quota health">
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
      </section>

      {/* Upcoming Resets */}
      <section className="overview-section" aria-label="Upcoming resets">
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
      </section>

      {/* Anomalies */}
      <section className="overview-section" aria-label="Anomalies">
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
      </section>

      {/* Recommendations */}
      <section className="overview-section" aria-label="Recommendations">
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
      </section>

      {/* Snapshot Insight (honest — not historical trend) */}
      <section className="overview-section" aria-label="Current trajectory snapshot">
        <h2 className="section-title">Trajectory Snapshot</h2>
        <div className="trajectory-snapshot">
          <p className="trajectory-note">
            This is a <strong>current-state snapshot</strong>, not a historical trend.
            It reflects the system as of {new Date().toLocaleString()}.
          </p>
          <div className="trajectory-grid">
            <div className="trajectory-item">
              <span className="trajectory-label">Total usage today</span>
              <strong className="trajectory-value">
                {state.accounts.reduce((sum, a) => sum + (a.usageCount ?? 0), 0)} requests
              </strong>
            </div>
            <div className="trajectory-item">
              <span className="trajectory-label">Accounts with fresh limits</span>
              <strong className="trajectory-value">
                {state.accounts.filter((a) => a.limitsConfidence === 'fresh').length}
              </strong>
            </div>
            <div className="trajectory-item">
              <span className="trajectory-label">Accounts needing attention</span>
              <strong className="trajectory-value">
                {state.accounts.filter((a) =>
                  a.limitsConfidence === 'error' ||
                  a.limitsConfidence === 'stale' ||
                  !isAccountEnabled(a) ||
                  a.authInvalid
                ).length}
              </strong>
            </div>
            <div className="trajectory-item">
              <span className="trajectory-label">Queue status</span>
              <strong className="trajectory-value">
                {state.queue?.running ? `Running (${state.queue.completed}/${state.queue.total})` : 'Idle'}
              </strong>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
