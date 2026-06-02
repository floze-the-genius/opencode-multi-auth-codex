import { Link } from 'react-router-dom'
import { useDashboardState } from '../hooks/useDashboardState'
import {
  useRefreshAntigravityMutation,
  useRefreshAntigravityAllMutation
} from '../api/queries'
import './AntigravityPage.css'

export function AntigravityPage(): JSX.Element {
  const { data: state, isLoading, error } = useDashboardState()

  const refreshQuotaMutation = useRefreshAntigravityMutation()
  const refreshAllMutation = useRefreshAntigravityAllMutation()

  if (isLoading) {
    return (
      <div className="antigravity-page" data-testid="antigravity-loading">
        <div className="antigravity-loading">Loading...</div>
      </div>
    )
  }

  if (error || !state) {
    return (
      <div className="antigravity-page" data-testid="antigravity-error">
        <div className="antigravity-error">
          Failed to load dashboard state: {error?.message || 'Unknown error'}
        </div>
      </div>
    )
  }

  const antigravity = state.antigravity
  const isEnabled = state.featureFlags.antigravityEnabled

  const handleRefreshQuota = () => {
    refreshQuotaMutation.mutate()
  }

  const handleRefreshAll = () => {
    refreshAllMutation.mutate()
  }

  return (
    <div className="antigravity-page" data-dashboard-surface="antigravity">
      <nav className="antigravity-breadcrumb" aria-label="Breadcrumb">
        <Link to="/settings" className="antigravity-breadcrumb-link">
          &larr; Back to Settings
        </Link>
      </nav>
      <section className="antigravity-section" aria-label="Antigravity status">
        <h2 className="section-title">Antigravity</h2>

        {!isEnabled && (
          <div className="antigravity-notice antigravity-notice--warning" role="alert">
            Antigravity feature is disabled. Enable it in Configuration to use these controls.
          </div>
        )}

        <div className="meta-grid">
          <div className="meta-card">
            <span className="meta-label">Status</span>
            <strong className="meta-value">
              {antigravity.quota?.status || 'disabled'}
            </strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Scope</span>
            <strong className="meta-value">
              {antigravity.quota?.scope || 'n/a'}
            </strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Accounts</span>
            <strong className="meta-value">
              {antigravity.accounts?.length || 0}
            </strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Path</span>
            <strong className="meta-value meta-value-small">
              {antigravity.path || 'not configured'}
            </strong>
          </div>
        </div>
      </section>

      {isEnabled && antigravity.accounts && antigravity.accounts.length > 0 && (
        <section className="antigravity-section" aria-label="Antigravity accounts">
          <h3 className="section-subtitle">Accounts</h3>
          <div className="antigravity-accounts">
            {antigravity.accounts.map((account, index) => {
              const alias = (account as Record<string, unknown>).alias as string || `account-${index}`
              const projectId = (account as Record<string, unknown>).projectId as string
              const managedProjectId = (account as Record<string, unknown>).managedProjectId as string
              const hasRefreshToken = (account as Record<string, unknown>).hasRefreshToken as boolean

              return (
                <div key={alias} className="antigravity-account-card">
                  <div className="antigravity-account-header">
                    <strong>{alias}</strong>
                    {hasRefreshToken !== undefined && (
                      <span className={`token-badge ${hasRefreshToken ? 'token-present' : 'token-missing'}`}>
                        {hasRefreshToken ? 'Token present' : 'No token'}
                      </span>
                    )}
                  </div>
                  {projectId && <div className="antigravity-account-meta">Project: {projectId}</div>}
                  {managedProjectId && <div className="antigravity-account-meta">Managed: {managedProjectId}</div>}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="antigravity-section" aria-label="Antigravity actions">
        <h3 className="section-subtitle">Actions</h3>
        <div className="actions-row">
          <button
            type="button"
            onClick={handleRefreshQuota}
            disabled={!isEnabled || refreshQuotaMutation.isPending}
          >
            {refreshQuotaMutation.isPending ? 'Refreshing...' : 'Refresh quota'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={handleRefreshAll}
            disabled={!isEnabled || refreshAllMutation.isPending}
          >
            {refreshAllMutation.isPending ? 'Refreshing...' : 'Refresh all quotas'}
          </button>
        </div>
        {!isEnabled && (
          <div className="antigravity-notice antigravity-notice--info">
            Click &quot;Refresh limits&quot; on the Overview or Operations page to load Antigravity quotas after enabling the feature.
          </div>
        )}
      </section>
    </div>
  )
}
