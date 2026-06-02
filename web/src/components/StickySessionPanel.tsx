import { useState, useEffect, useCallback } from 'react'
import {
  useStickySessionConfigQuery,
  useStickySessionStatusQuery,
  useUpdateStickySessionConfigMutation,
  useCleanupStickySessionsMutation
} from '../api/queries'
import type { StickyIdentitySource } from '../types/api'
import './StickySessionPanel.css'

const DEFAULT_IDENTITY_SOURCES: StickyIdentitySource[] = [
  'header:x-session-affinity',
  'header:session-id',
  'header:session_id',
  'header:conversation_id',
  'body:metadata.session_id',
  'body:metadata.conversation_id'
]

const ADVANCED_IDENTITY_SOURCE: StickyIdentitySource = 'body:prompt_cache_key'

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function StickySessionPanel(): JSX.Element {
  const configQuery = useStickySessionConfigQuery()
  const statusQuery = useStickySessionStatusQuery()
  const updateConfigMutation = useUpdateStickySessionConfigMutation()
  const cleanupMutation = useCleanupStickySessionsMutation()

  const [identitySources, setIdentitySources] = useState<StickyIdentitySource[]>([])
  const [allowPromptCacheKey, setAllowPromptCacheKey] = useState(false)
  const [ttlMs, setTtlMs] = useState(86_400_000)
  const [maxEntries, setMaxEntries] = useState(1000)
  const [maxFileBytes, setMaxFileBytes] = useState(1_048_576)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<string | null>(null)

  // Derived: available sources depend on whether advanced prompt-cache-key is allowed
  const availableSources = allowPromptCacheKey
    ? [...DEFAULT_IDENTITY_SOURCES, ADVANCED_IDENTITY_SOURCE]
    : DEFAULT_IDENTITY_SOURCES

  // Fetch config and status on mount
  useEffect(() => {
    configQuery.refetch()
    statusQuery.refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync form state when config loads
  useEffect(() => {
    if (configQuery.data) {
      setIdentitySources(configQuery.data.identitySources)
      setAllowPromptCacheKey(configQuery.data.allowPromptCacheKey)
      setTtlMs(configQuery.data.ttlMs)
      setMaxEntries(configQuery.data.maxEntries)
      setMaxFileBytes(configQuery.data.maxFileBytes)
    }
  }, [configQuery.data])

  // When allowPromptCacheKey is disabled, remove the advanced source from selection
  useEffect(() => {
    if (!allowPromptCacheKey) {
      setIdentitySources(prev => prev.filter(s => s !== ADVANCED_IDENTITY_SOURCE))
    }
  }, [allowPromptCacheKey])

  const handleToggleSource = useCallback((source: StickyIdentitySource) => {
    setIdentitySources(prev =>
      prev.includes(source) ? prev.filter(s => s !== source) : [...prev, source]
    )
  }, [])

  const handleSave = useCallback(() => {
    setCleanupResult(null)
    updateConfigMutation.mutate({
      enabled: true,
      identitySources,
      allowPromptCacheKey,
      ttlMs,
      maxEntries,
      maxFileBytes
    })
  }, [identitySources, allowPromptCacheKey, ttlMs, maxEntries, maxFileBytes, updateConfigMutation])

  const handleCleanup = useCallback(() => {
    setCleanupResult(null)
    cleanupMutation.mutate(undefined, {
      onSuccess: (data) => {
        setCleanupResult(`Cleanup complete: removed ${data.removed} entries`)
        statusQuery.refetch()
      },
      onError: (error) => {
        setCleanupResult(`Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    })
  }, [cleanupMutation, statusQuery])

  const handleRefreshStatus = useCallback(() => {
    setCleanupResult(null)
    statusQuery.refetch()
  }, [statusQuery])

  const isLoading = configQuery.isLoading || statusQuery.isLoading
  const hasError = configQuery.isError || statusQuery.isError

  return (
    <section className="sticky-session-panel" aria-labelledby="sticky-session-heading">
      <h2 id="sticky-session-heading" className="sticky-session-heading">Sticky Sessions</h2>

      {isLoading && <p className="sticky-session-loading">Loading sticky session configuration...</p>}
      {hasError && (
        <p className="sticky-session-error">
          Error loading sticky session data. Ensure the sticky sessions feature is enabled.
        </p>
      )}

      {!isLoading && !hasError && (
        <>
          <fieldset className="sticky-session-fieldset" data-testid="identity-sources-fieldset">
            <legend className="sticky-session-legend">Identity Sources</legend>
            <p className="sticky-session-help" id="identity-sources-help">
              Select which request attributes are used to identify sticky sessions.
            </p>
            {availableSources.map(source => (
              <label key={source} className="sticky-session-label sticky-session-label--source">
                <input
                  type="checkbox"
                  checked={identitySources.includes(source)}
                  onChange={() => handleToggleSource(source)}
                  aria-label={`Identity source ${source}`}
                  aria-describedby="identity-sources-help"
                />
                <span className="sticky-session-source-name">{source}</span>
              </label>
            ))}
            {!allowPromptCacheKey && (
              <p className="sticky-session-help">
                Advanced source <code>body:prompt_cache_key</code> is hidden. Enable it in Advanced options.
              </p>
            )}
          </fieldset>

          <div className="sticky-session-field">
            <label htmlFor="sticky-ttl" className="sticky-session-label">
              TTL <span className="sticky-session-unit">({formatDuration(ttlMs)})</span>
            </label>
            <input
              id="sticky-ttl"
              type="number"
              value={ttlMs}
              onChange={e => setTtlMs(Number(e.target.value))}
              min={1000}
              className="sticky-session-input"
              aria-describedby="sticky-ttl-help"
            />
            <p className="sticky-session-help" id="sticky-ttl-help">Time-to-live in milliseconds. Minimum 1000 ms (1 second).</p>
          </div>

          <div className="sticky-session-field">
            <label htmlFor="sticky-max-entries" className="sticky-session-label">Max Entries</label>
            <input
              id="sticky-max-entries"
              type="number"
              value={maxEntries}
              onChange={e => setMaxEntries(Number(e.target.value))}
              min={1}
              className="sticky-session-input"
              aria-describedby="sticky-max-entries-help"
            />
            <p className="sticky-session-help" id="sticky-max-entries-help">Maximum number of sticky session mappings to keep in memory.</p>
          </div>

          <div className="sticky-session-field">
            <label htmlFor="sticky-max-file-bytes" className="sticky-session-label">
              Max File Size <span className="sticky-session-unit">({formatBytes(maxFileBytes)})</span>
            </label>
            <input
              id="sticky-max-file-bytes"
              type="number"
              value={maxFileBytes}
              onChange={e => setMaxFileBytes(Number(e.target.value))}
              min={1024}
              className="sticky-session-input"
              aria-describedby="sticky-max-file-help"
            />
            <p className="sticky-session-help" id="sticky-max-file-help">Maximum on-disk file size in bytes. Minimum 1024 bytes (1 KB).</p>
          </div>

          <div className="sticky-session-advanced" data-testid="advanced-section">
            <button
              type="button"
              className="sticky-session-advanced-toggle"
              onClick={() => setShowAdvanced(prev => !prev)}
              aria-expanded={showAdvanced}
              aria-controls="advanced-options-content"
            >
              {showAdvanced ? 'Hide' : 'Show'} Advanced
            </button>

            {showAdvanced && (
              <div id="advanced-options-content" className="sticky-session-advanced-content" role="region" aria-label="Advanced sticky session options">
                <div className="sticky-session-field">
                  <label className="sticky-session-label sticky-session-label--toggle">
                    <input
                      type="checkbox"
                      checked={allowPromptCacheKey}
                      onChange={e => setAllowPromptCacheKey(e.target.checked)}
                      aria-label="Allow prompt cache key as an advanced identity source"
                    />
                    <span>Allow prompt cache key as an identity source</span>
                  </label>
                  <p className="sticky-session-help" id="allow-prompt-cache-help">
                    When enabled, <code>body:prompt_cache_key</code> can be selected as an identity source.
                    This is an advanced option and is not a default sticky identity behavior.
                    Use with caution.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="sticky-session-actions">
            <button
              type="button"
              className="sticky-session-button primary"
              onClick={handleSave}
              disabled={updateConfigMutation.isPending}
            >
              {updateConfigMutation.isPending ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>

          {updateConfigMutation.isSuccess && (
            <p className="sticky-session-success">Configuration saved successfully.</p>
          )}
          {updateConfigMutation.isError && (
            <p className="sticky-session-error">
              Failed to save: {updateConfigMutation.error instanceof Error ? updateConfigMutation.error.message : 'Unknown error'}
            </p>
          )}

          <div className="sticky-session-status" role="region" aria-label="Sticky session status and cleanup">
            <h3 className="sticky-session-status-heading">Current Status</h3>
            {statusQuery.data ? (
              <dl className="sticky-session-status-grid" data-testid="sticky-status-grid">
                <div className="sticky-session-status-item">
                  <dt className="sticky-session-status-label">Entries</dt>
                  <dd className="sticky-session-status-value">
                    {statusQuery.data.entries} {statusQuery.data.entries === 1 ? 'entry' : 'entries'}
                  </dd>
                </div>
                <div className="sticky-session-status-item">
                  <dt className="sticky-session-status-label">Size</dt>
                  <dd className="sticky-session-status-value">{formatBytes(statusQuery.data.sizeBytes)}</dd>
                </div>
                <div className="sticky-session-status-item">
                  <dt className="sticky-session-status-label">File Exists</dt>
                  <dd className="sticky-session-status-value">{statusQuery.data.exists ? 'Yes' : 'No'}</dd>
                </div>
                <div className="sticky-session-status-item">
                  <dt className="sticky-session-status-label">Updated</dt>
                  <dd className="sticky-session-status-value">
                    {statusQuery.data.updatedAt ? new Date(statusQuery.data.updatedAt).toLocaleString() : 'Never'}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="sticky-session-help">No status available.</p>
            )}

            <div className="sticky-session-status-actions">
              <button
                type="button"
                className="sticky-session-button"
                onClick={handleRefreshStatus}
                disabled={statusQuery.isFetching}
              >
                {statusQuery.isFetching ? 'Refreshing...' : 'Refresh Status'}
              </button>
              <button
                type="button"
                className="sticky-session-button"
                onClick={handleCleanup}
                disabled={cleanupMutation.isPending}
              >
                {cleanupMutation.isPending ? 'Running...' : 'Run Cleanup'}
              </button>
            </div>

            {cleanupResult && (
              <p
                className={cleanupResult.startsWith('Cleanup failed') ? 'sticky-session-error' : 'sticky-session-success'}
                role="status"
                aria-live="polite"
                data-testid="cleanup-result"
              >
                {cleanupResult}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
