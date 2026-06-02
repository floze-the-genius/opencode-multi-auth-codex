import { useState, useMemo, useCallback } from 'react'
import { useDashboardState } from '../hooks/useDashboardState'
import type { LogLine } from '../types/api'
import { useLogsQuery } from '../api/queries'
import { inferLogSeverity } from '../lib/log-severity'
import './OperationsPage.css'

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

const LOG_LINE_RE = /^(\S+)\s+\[(\w+)\]\s+(.*)$/

/**
 * Normalizes a log line entry that may come as a raw string (from older backends)
 * or as a structured LogLine object. Returns a guaranteed LogLine.
 */
export function normalizeLogLine(raw: unknown): LogLine {
  // Already structured object with level
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    const message = typeof obj.message === 'string' ? obj.message : String(obj.message ?? '')
    const rawLevel = typeof obj.level === 'string' ? obj.level.toLowerCase() : 'unknown'
    const level = rawLevel === 'unknown' ? inferLogSeverity(message) : rawLevel
    return {
      time: typeof obj.time === 'string' ? obj.time : '',
      level,
      message
    }
  }
  // Raw string format: "ISO_TIMESTAMP [LEVEL] message"
  if (typeof raw === 'string') {
    const match = raw.match(LOG_LINE_RE)
    if (match) {
      const rawLevel = match[2].toLowerCase()
      const message = match[3]
      const level = rawLevel === 'unknown' ? inferLogSeverity(message) : rawLevel
      return { time: match[1], level, message }
    }
    const level = inferLogSeverity(raw)
    return { time: '', level, message: raw }
  }
  const message = String(raw ?? '')
  return { time: '', level: inferLogSeverity(message), message }
}

type SeverityFilter = 'all' | 'error' | 'warn' | 'info' | 'debug'

const SEVERITY_OPTIONS: { value: SeverityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' }
]

export function OperationsPage(): JSX.Element {
  const { data: state, isLoading: stateLoading, error: stateError } = useDashboardState()
  const { data: logsData, isLoading: logsLoading } = useLogsQuery(200)
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [logSearch, setLogSearch] = useState('')

  const normalizedLogs = useMemo(() => {
    if (!logsData?.lines) return []
    return logsData.lines.map((rawLine, index) => ({ ...normalizeLogLine(rawLine), id: index }))
  }, [logsData])

  const filteredLogs = useMemo(() => {
    let logs = normalizedLogs

    if (severityFilter !== 'all') {
      logs = logs.filter((l) => l.level === severityFilter)
    }

    if (logSearch.trim()) {
      const q = logSearch.trim().toLowerCase()
      logs = logs.filter((l) => l.message.toLowerCase().includes(q))
    }

    return logs
  }, [normalizedLogs, severityFilter, logSearch])

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = { error: 0, warn: 0, info: 0, debug: 0, unknown: 0 }
    for (const log of normalizedLogs) {
      counts[log.level] = (counts[log.level] || 0) + 1
    }
    return counts
  }, [normalizedLogs])

  const handleSeverityClick = useCallback((value: SeverityFilter) => {
    setSeverityFilter(value)
  }, [])

  if (stateLoading) {
    return (
      <div className="operations-page" data-testid="operations-loading">
        <div className="operations-loading">Loading dashboard...</div>
      </div>
    )
  }

  if (stateError || !state) {
    return (
      <div className="operations-page" data-testid="operations-error">
        <div className="operations-error">
          Failed to load dashboard state: {stateError?.message || 'Unknown error'}
        </div>
      </div>
    )
  }

  return (
    <div className="operations-page" data-dashboard-surface="operations-logs">
      {/* Observability Status */}
      <section className="operations-section" aria-label="Observability">
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
              {state.lastSyncAt ? formatDate(state.lastSyncAt) : 'never'}
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
        {(state.lastSyncError || state.storeStatus.error) && (
          <div className="operations-notice operations-notice--error" role="alert">
            {state.lastSyncError || state.storeStatus.error}
          </div>
        )}
      </section>

      {/* Logs Viewer */}
      <section className="operations-section" aria-label="Logs">
        <h2 className="section-title">Logs</h2>

        {/* Log Filters */}
        <div className="logs-toolbar">
          <div className="logs-severity-filters" role="group" aria-label="Filter by severity">
            {SEVERITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`severity-pill severity-pill--${opt.value}${severityFilter === opt.value ? ' severity-pill--active' : ''}`}
                onClick={() => handleSeverityClick(opt.value)}
                aria-pressed={severityFilter === opt.value}
              >
                {opt.label}
                {opt.value !== 'all' && severityCounts[opt.value] > 0 && (
                  <span className="severity-count">{severityCounts[opt.value]}</span>
                )}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search logs..."
            value={logSearch}
            onChange={(e) => setLogSearch(e.target.value)}
            aria-label="Search logs"
            className="logs-search-input"
          />
        </div>

        {logsLoading ? (
          <div className="operations-notice">Loading logs...</div>
        ) : filteredLogs.length > 0 ? (
          <div className="logs-container">
            <div className="logs-path">{logsData?.path} · Showing {filteredLogs.length} of {normalizedLogs.length} lines</div>
            <div className="logs-list" role="log" aria-live="polite">
              {filteredLogs.map((line) => (
                <div key={line.id} className={`log-line log-line--${line.level}`}>
                  <span className="log-time">{line.time ? new Date(line.time).toLocaleTimeString() : ''}</span>
                  <span className={`log-level log-level--${line.level}`}>{line.level}</span>
                  <span className="log-message">{line.message}</span>
                </div>
              ))}
            </div>
          </div>
        ) : normalizedLogs.length > 0 ? (
          <div className="operations-notice logs-empty-state">
            <div>No logs match your filters.</div>
            <button type="button" className="secondary small" onClick={() => { setSeverityFilter('all'); setLogSearch('') }}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="operations-notice">No logs available.</div>
        )}
      </section>
    </div>
  )
}
