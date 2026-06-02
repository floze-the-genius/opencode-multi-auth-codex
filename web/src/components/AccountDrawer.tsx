import { useState, useCallback, useEffect, useRef } from 'react'
import { isAccountEnabled } from '../lib/account-status'
import { formatResetTime } from '../lib/reset-time'
import type { AccountView, CodexActiveState } from '../types/api'
import './AccountDrawer.css'

export interface AccountDrawerProps {
  account: AccountView
  isActive: boolean
  codexActive?: CodexActiveState
  onClose: () => void
  onToggleEnable: () => void
  onRemove: () => void
  onUpdateMeta: (tags: string, notes: string) => void
  onReauth: () => void
  onRefreshTokens: () => void
  onRefreshLimits: () => void
  onSwitch: () => void
  onUseInCodex?: () => void
  useInCodexPending?: boolean
  useInCodexError?: string | null
  useInCodexSuccess?: boolean
  isBusy: boolean
}

export function AccountDrawer({
  account,
  isActive,
  codexActive,
  onClose,
  onToggleEnable,
  onRemove,
  onUpdateMeta,
  onReauth,
  onRefreshTokens,
  onRefreshLimits,
  onSwitch,
  onUseInCodex,
  useInCodexPending = false,
  useInCodexError = null,
  useInCodexSuccess = false,
  isBusy
}: AccountDrawerProps): JSX.Element {
  const [tags, setTags] = useState(account.tags?.join(', ') || '')
  const [notes, setNotes] = useState(account.notes || '')
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const isCodexActive = codexActive?.status === 'matched' && codexActive.alias === account.alias

  const handleSaveMeta = useCallback(() => {
    onUpdateMeta(tags, notes)
  }, [onUpdateMeta, tags, notes])

  const handleRemove = useCallback(() => {
    if (window.confirm(`Remove account "${account.alias}" permanently?`)) {
      onRemove()
    }
  }, [onRemove, account.alias])

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="account-drawer-overlay" onClick={onClose}>
      <div
        className="account-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Account details"
        aria-modal="true"
      >
        <header className="account-drawer-header">
          <h3>{account.alias}</h3>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close drawer"
            disabled={isBusy}
          >
            ×
          </button>
        </header>

        <div className="account-drawer-body">
          {isCodexActive && (
            <div className="drawer-codex-active-banner" role="status" aria-label="This account is active in Codex">
              <span className="drawer-codex-active-icon" aria-hidden="true">✓</span>
              <span>Active in Codex — this account is written to <code>~/.codex/auth.json</code></span>
            </div>
          )}
          <div className="drawer-section">
            <div className="drawer-field">
              <span className="drawer-label">Email</span>
              <span className="drawer-value">{account.email || '-'}</span>
            </div>
            <div className="drawer-field">
              <span className="drawer-label">Status</span>
              <span className="drawer-value">
                {isAccountEnabled(account) ? (
                  <span className="badge badge--enabled">enabled</span>
                ) : (
                  <span className="badge badge--disabled">disabled</span>
                )}
              </span>
            </div>
            <div className="drawer-field">
              <span className="drawer-label">Codex</span>
              <span className="drawer-value">
                {isCodexActive ? (
                  <span className="badge badge--codex-active" aria-label="Active in Codex">Codex ✓</span>
                ) : (
                  <span className="badge badge--codex-inactive" aria-label="Not active in Codex">Not in Codex</span>
                )}
              </span>
            </div>
            <div className="drawer-field">
              <span className="drawer-label">Source</span>
              <span className="drawer-value">{account.source || '-'}</span>
            </div>
            <div className="drawer-field">
              <span className="drawer-label">Usage</span>
              <span className="drawer-value">{account.usageCount}</span>
            </div>
            {account.disabledAt && (
              <div className="drawer-field">
                <span className="drawer-label">Disabled</span>
                <span className="drawer-value">
                  {new Date(account.disabledAt).toLocaleString()} by {account.disabledBy || 'unknown'}
                </span>
              </div>
            )}
            {account.lastRefresh && (
              <div className="drawer-field">
                <span className="drawer-label">Last refresh</span>
                <span className="drawer-value">{new Date(account.lastRefresh).toLocaleString()}</span>
              </div>
            )}
            {account.rateLimits?.fiveHour?.resetAt && (
              <div className="drawer-field">
                <span className="drawer-label">5h reset</span>
                <span className="drawer-value">{formatResetTime(account.rateLimits.fiveHour.resetAt)}</span>
              </div>
            )}
            {account.rateLimits?.weekly?.resetAt && (
              <div className="drawer-field">
                <span className="drawer-label">Weekly reset</span>
                <span className="drawer-value">{formatResetTime(account.rateLimits.weekly.resetAt)}</span>
              </div>
            )}
          </div>

          <div className="drawer-section drawer-actions">
            {!isActive && isAccountEnabled(account) && (
              <button type="button" onClick={onSwitch} disabled={isBusy} className="secondary">
                Switch to this account
              </button>
            )}
            {onUseInCodex !== undefined && (
              <button
                type="button"
                onClick={onUseInCodex}
                disabled={isBusy || useInCodexPending || isCodexActive}
                aria-busy={useInCodexPending}
                aria-disabled={isCodexActive}
                className="secondary codex-use-btn"
                title={isCodexActive ? 'This account is already active in Codex' : 'Write this account to ~/.codex/auth.json'}
              >
                {useInCodexPending
                  ? 'Setting Codex account…'
                  : isCodexActive
                  ? 'Active in Codex'
                  : 'Use in Codex'}
              </button>
            )}
            {useInCodexSuccess && !isCodexActive && (
              <div className="drawer-codex-feedback drawer-codex-feedback--success" role="status" aria-live="polite">
                ✓ Codex account updated
              </div>
            )}
            {useInCodexError && (
              <div className="drawer-codex-feedback drawer-codex-feedback--error" role="alert">
                {useInCodexError}
              </div>
            )}
            <button
              type="button"
              onClick={onToggleEnable}
              disabled={isBusy}
              className={isAccountEnabled(account) ? 'danger' : 'secondary'}
            >
              {isAccountEnabled(account) ? 'Disable' : 'Enable'}
            </button>
            <button type="button" onClick={onReauth} disabled={isBusy} className="secondary">
              Re-authenticate
            </button>
            <button type="button" onClick={onRefreshTokens} disabled={isBusy} className="secondary">
              Refresh tokens
            </button>
            <button type="button" onClick={onRefreshLimits} disabled={isBusy} className="secondary">
              Refresh limits
            </button>
            <button type="button" onClick={handleRemove} disabled={isBusy} className="danger">
              Remove account
            </button>
          </div>

          <div className="drawer-section">
            <h4>Tags</h4>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Comma-separated tags"
              aria-label="Tags"
            />
            <h4>Notes</h4>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes about this account"
              aria-label="Notes"
              rows={3}
            />
            <button type="button" onClick={handleSaveMeta} disabled={isBusy} className="secondary">
              Save tags & notes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
