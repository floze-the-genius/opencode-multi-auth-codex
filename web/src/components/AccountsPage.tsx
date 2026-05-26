import { useState, useMemo, useCallback } from 'react'
import { useDashboardState } from '../hooks/useDashboardState'
import {
  useEnableAccountMutation,
  useRemoveAccountMutation,
  useUpdateAccountMetaMutation,
  useReauthAccountMutation,
  useRefreshTokensMutation,
  useRefreshLimitsMutation,
  useSwitchAccountMutation
} from '../api/queries'
import { useNotification } from '../hooks/useNotification'
import { AccountDrawer } from './AccountDrawer'
import { CreateAccountModal } from './CreateAccountModal'
import { isAccountEnabled } from '../lib/account-status'
import { formatResetTimeCompact } from '../lib/reset-time'
import { quotaPercent, quotaSeverity, formatQuotaLabel } from '../lib/quota-helpers'
import type { AccountView } from '../types/api'
import './AccountsPage.css'

type SortOption = 'alias-asc' | 'alias-desc' | 'usage-desc' | 'usage-asc'
type StatusFilter = 'all' | 'enabled' | 'disabled'

function AccountStatusBadges({
  account,
  rotationAlias,
  recommendedAlias
}: {
  account: AccountView
  rotationAlias: string | null
  recommendedAlias: string | null
}) {
  const isActive = rotationAlias === account.alias
  const isRecommended = recommendedAlias === account.alias
  const accountEnabled = isAccountEnabled(account)

  if (!accountEnabled) {
    return <span className="badge badge--disabled">disabled</span>
  }

  return (
    <>
      {isActive && <span className="badge badge--active">active</span>}
      {isRecommended && <span className="badge badge--recommended">recommended</span>}
      {!isActive && !isRecommended && <span className="badge badge--enabled">enabled</span>}
    </>
  )
}

function AccountQuotaCell({ account }: { account: AccountView }) {
  if (!account.rateLimits?.fiveHour && !account.rateLimits?.weekly) {
    return <span className="quota-cell-unavailable">—</span>
  }

  return (
    <div className="quota-cell">
      {account.rateLimits?.fiveHour && (
        <div className="quota-cell-row">
          <span className="quota-cell-label">5h</span>
          <div className="quota-cell-bar-container">
            <div
              className={`quota-cell-bar quota-cell-bar--${quotaSeverity(quotaPercent(account.rateLimits.fiveHour.remaining, account.rateLimits.fiveHour.limit))}`}
              style={{ width: `${quotaPercent(account.rateLimits.fiveHour.remaining, account.rateLimits.fiveHour.limit)}%` }}
            />
          </div>
          <span className={`quota-cell-value quota-cell-value--${quotaSeverity(quotaPercent(account.rateLimits.fiveHour.remaining, account.rateLimits.fiveHour.limit))}`}>
            {formatQuotaLabel(account.rateLimits.fiveHour.remaining, account.rateLimits.fiveHour.limit)}
          </span>
        </div>
      )}
      {account.rateLimits?.weekly && (
        <div className="quota-cell-row">
          <span className="quota-cell-label">7d</span>
          <div className="quota-cell-bar-container">
            <div
              className={`quota-cell-bar quota-cell-bar--${quotaSeverity(quotaPercent(account.rateLimits.weekly.remaining, account.rateLimits.weekly.limit))}`}
              style={{ width: `${quotaPercent(account.rateLimits.weekly.remaining, account.rateLimits.weekly.limit)}%` }}
            />
          </div>
          <span className={`quota-cell-value quota-cell-value--${quotaSeverity(quotaPercent(account.rateLimits.weekly.remaining, account.rateLimits.weekly.limit))}`}>
            {formatQuotaLabel(account.rateLimits.weekly.remaining, account.rateLimits.weekly.limit)}
          </span>
        </div>
      )}
    </div>
  )
}

function MobileAccountCard({
  account,
  rotationAlias,
  recommendedAlias,
  onOpenDrawer
}: {
  account: AccountView
  rotationAlias: string | null
  recommendedAlias: string | null
  onOpenDrawer: (account: AccountView) => void
}) {
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

  return (
    <div
      className={`mobile-account-card${!accountEnabled ? ' mobile-account-card--disabled' : ''}${rotationAlias === account.alias ? ' mobile-account-card--active' : ''}`}
      data-testid={`mobile-account-card-${account.alias}`}
      onClick={() => onOpenDrawer(account)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenDrawer(account) }}
    >
      <div className="mobile-account-card-header">
        <div className="mobile-account-card-name">
          <strong className="mobile-account-alias">{account.alias}</strong>
          {account.email && <span className="mobile-account-email">{account.email}</span>}
        </div>
        <div className="mobile-account-card-badges">
          <AccountStatusBadges account={account} rotationAlias={rotationAlias} recommendedAlias={recommendedAlias} />
        </div>
      </div>

      {(account.rateLimits?.fiveHour || account.rateLimits?.weekly) && (
        <div className="mobile-account-card-quotas">
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
                {formatQuotaLabel(account.rateLimits.fiveHour.remaining, account.rateLimits.fiveHour.limit)}
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
                {formatQuotaLabel(account.rateLimits.weekly.remaining, account.rateLimits.weekly.limit)}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mobile-account-card-meta">
        {account.limitsConfidence && (
          <span className={`confidence confidence--${account.limitsConfidence}`}>
            {account.limitsConfidence}
          </span>
        )}
        {account.source && <span className="account-source">{account.source}</span>}
        {account.usageCount > 0 && <span className="account-usage">{account.usageCount} uses</span>}
        {account.tags && account.tags.length > 0 && (
          <span className="account-tags">
            {account.tags.map((t) => <span key={t} className="tag">{t}</span>)}
          </span>
        )}
      </div>

      {(account.rateLimits?.fiveHour?.resetAt || account.rateLimits?.weekly?.resetAt) && (
        <div className="mobile-account-card-resets">
          {account.rateLimits?.fiveHour?.resetAt && (
            <span>5h reset: {formatResetTimeCompact(account.rateLimits.fiveHour.resetAt)}</span>
          )}
          {account.rateLimits?.weekly?.resetAt && (
            <span>wk reset: {formatResetTimeCompact(account.rateLimits.weekly.resetAt)}</span>
          )}
        </div>
      )}

      <div className="mobile-account-card-actions">
        <button type="button" className="secondary small" onClick={(e) => { e.stopPropagation(); onOpenDrawer(account) }}>
          Manage
        </button>
      </div>
    </div>
  )
}

export function AccountsPage(): JSX.Element {
  const { data: state, isLoading, error } = useDashboardState()
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('alias-asc')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedAccount, setSelectedAccount] = useState<AccountView | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [selectedAliases, setSelectedAliases] = useState<Set<string>>(new Set())

  const { addNotification } = useNotification()
  const enableMutation = useEnableAccountMutation()
  const removeMutation = useRemoveAccountMutation()
  const updateMetaMutation = useUpdateAccountMetaMutation()
  const reauthMutation = useReauthAccountMutation()
  const refreshTokensMutation = useRefreshTokensMutation()
  const refreshLimitsMutation = useRefreshLimitsMutation()
  const switchMutation = useSwitchAccountMutation()

  const filteredAccounts = useMemo(() => {
    if (!state) return []

    let accounts = [...state.accounts]

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      accounts = accounts.filter(
        (a) =>
          a.alias.toLowerCase().includes(q) ||
          (a.email && a.email.toLowerCase().includes(q)) ||
          (a.notes && a.notes.toLowerCase().includes(q)) ||
          (a.tags && a.tags.some((t) => t.toLowerCase().includes(q)))
      )
    }

    if (statusFilter !== 'all') {
      accounts = accounts.filter((a) => (statusFilter === 'enabled' ? isAccountEnabled(a) : !isAccountEnabled(a)))
    }

    accounts.sort((a, b) => {
      switch (sortBy) {
        case 'alias-asc':
          return a.alias.localeCompare(b.alias)
        case 'alias-desc':
          return b.alias.localeCompare(a.alias)
        case 'usage-desc':
          return b.usageCount - a.usageCount
        case 'usage-asc':
          return a.usageCount - b.usageCount
        default:
          return 0
      }
    })

    return accounts
  }, [state, search, sortBy, statusFilter])

  const handleOpenDrawer = useCallback((account: AccountView) => {
    setSelectedAccount(account)
    setDrawerOpen(true)
  }, [])

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false)
    setSelectedAccount(null)
  }, [])

  const handleToggleEnable = useCallback(
    (account: AccountView) => {
      const currentlyEnabled = isAccountEnabled(account)
      enableMutation.mutate(
        { alias: account.alias, enabled: !currentlyEnabled },
        {
          onSuccess: () => {
            addNotification({
              message: `Account ${account.alias} ${currentlyEnabled ? 'disabled' : 'enabled'}`,
              type: 'success'
            })
          },
          onError: (err: Error) => {
            addNotification({ message: err.message, type: 'error' })
          }
        }
      )
    },
    [enableMutation, addNotification]
  )

  const handleRemove = useCallback(
    (alias: string) => {
      if (!window.confirm(`Remove account "${alias}" permanently?`)) return
      removeMutation.mutate(alias, {
        onSuccess: () => {
          addNotification({ message: `Account ${alias} removed`, type: 'success' })
          handleCloseDrawer()
        },
        onError: (err: Error) => {
          addNotification({ message: err.message, type: 'error' })
        }
      })
    },
    [removeMutation, addNotification, handleCloseDrawer]
  )

  const handleUpdateMeta = useCallback(
    (alias: string, tags: string, notes: string) => {
      updateMetaMutation.mutate(
        { alias, tags, notes },
        {
          onSuccess: () => {
            addNotification({ message: `Account ${alias} updated`, type: 'success' })
          },
          onError: (err: Error) => {
            addNotification({ message: err.message, type: 'error' })
          }
        }
      )
    },
    [updateMetaMutation, addNotification]
  )

  const handleReauth = useCallback(
    (alias: string) => {
      reauthMutation.mutate(
        { alias },
        {
          onSuccess: (data) => {
            addNotification({ message: `Re-auth started for ${alias}`, type: 'info' })
            if (data.url) {
              window.open(data.url, '_blank')
            }
          },
          onError: (err: Error) => {
            addNotification({ message: err.message, type: 'error' })
          }
        }
      )
    },
    [reauthMutation, addNotification]
  )

  const handleRefreshTokens = useCallback(
    (alias: string) => {
      refreshTokensMutation.mutate(alias, {
        onSuccess: (data) => {
          const result = data.results.find((item) => item.alias === alias)
          if (result?.error) {
            addNotification({ message: result.error, type: 'error' })
            return
          }
          if (result?.updated) {
            addNotification({ message: `Tokens refreshed for ${alias}`, type: 'success' })
            return
          }
          addNotification({ message: `Failed to refresh tokens for ${alias}`, type: 'error' })
        },
        onError: (err: Error) => {
          addNotification({ message: err.message, type: 'error' })
        }
      })
    },
    [refreshTokensMutation, addNotification]
  )

  const handleRefreshLimits = useCallback(
    (alias: string) => {
      refreshLimitsMutation.mutate(alias, {
        onSuccess: (data) => {
          addNotification({
            message: data.queue.running ? `Limit refresh queued for ${alias}` : `Limit refresh started for ${alias}`,
            type: 'info'
          })
        },
        onError: (err: Error) => {
          addNotification({ message: err.message, type: 'error' })
        }
      })
    },
    [refreshLimitsMutation, addNotification]
  )

  const handleSwitch = useCallback(
    (alias: string) => {
      switchMutation.mutate(alias, {
        onSuccess: () => {
          addNotification({ message: `Switched to ${alias}`, type: 'success' })
        },
        onError: (err: Error) => {
          addNotification({ message: err.message, type: 'error' })
        }
      })
    },
    [switchMutation, addNotification]
  )

  const toggleSelection = useCallback((alias: string) => {
    setSelectedAliases(prev => {
      const next = new Set(prev)
      if (next.has(alias)) {
        next.delete(alias)
      } else {
        next.add(alias)
      }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedAliases(prev => {
      if (prev.size === filteredAccounts.length) {
        return new Set()
      }
      return new Set(filteredAccounts.map(a => a.alias))
    })
  }, [filteredAccounts])

  const handleBulkEnable = useCallback(() => {
    selectedAliases.forEach(alias => {
      enableMutation.mutate(
        { alias, enabled: true },
        {
          onSuccess: () => {
            addNotification({ message: `Account ${alias} enabled`, type: 'success' })
          },
          onError: (err: Error) => {
            addNotification({ message: err.message, type: 'error' })
          }
        }
      )
    })
    setSelectedAliases(new Set())
  }, [selectedAliases, enableMutation, addNotification])

  const handleBulkDisable = useCallback(() => {
    selectedAliases.forEach(alias => {
      enableMutation.mutate(
        { alias, enabled: false },
        {
          onSuccess: () => {
            addNotification({ message: `Account ${alias} disabled`, type: 'success' })
          },
          onError: (err: Error) => {
            addNotification({ message: err.message, type: 'error' })
          }
        }
      )
    })
    setSelectedAliases(new Set())
  }, [selectedAliases, enableMutation, addNotification])

  const handleBulkRemove = useCallback(() => {
    if (!window.confirm(`Remove ${selectedAliases.size} selected account(s) permanently?`)) return
    selectedAliases.forEach(alias => {
      removeMutation.mutate(alias, {
        onSuccess: () => {
          addNotification({ message: `Account ${alias} removed`, type: 'success' })
        },
        onError: (err: Error) => {
          addNotification({ message: err.message, type: 'error' })
        }
      })
    })
    setSelectedAliases(new Set())
  }, [selectedAliases, removeMutation, addNotification])

  if (isLoading) {
    return (
      <div className="accounts-page" data-testid="accounts-loading">
        <div className="accounts-loading">Loading accounts...</div>
      </div>
    )
  }

  if (error || !state) {
    return (
      <div className="accounts-page" data-testid="accounts-error">
        <div className="accounts-error">
          Failed to load accounts: {error?.message || 'Unknown error'}
        </div>
      </div>
    )
  }

  return (
    <div className="accounts-page" data-dashboard-surface="accounts">
      <header className="accounts-header">
        <h2>Accounts</h2>
        <button type="button" className="primary" onClick={() => setCreateModalOpen(true)}>
          Add account
        </button>
      </header>

      <div className="accounts-toolbar">
        <input
          type="text"
          placeholder="Search accounts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search accounts"
        />
        <select
          aria-label="Sort by"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
        >
          <option value="alias-asc">Alias A-Z</option>
          <option value="alias-desc">Alias Z-A</option>
          <option value="usage-desc">Usage high-low</option>
          <option value="usage-asc">Usage low-high</option>
        </select>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="all">All statuses</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      {selectedAliases.size > 0 && (
        <div className="accounts-bulk-toolbar">
          <span>{selectedAliases.size} selected</span>
          <button type="button" onClick={handleBulkEnable} disabled={enableMutation.isPending}>
            Enable selected
          </button>
          <button type="button" onClick={handleBulkDisable} disabled={enableMutation.isPending}>
            Disable selected
          </button>
          <button type="button" onClick={handleBulkRemove} disabled={removeMutation.isPending} className="danger">
            Remove selected
          </button>
        </div>
      )}

      {filteredAccounts.length === 0 ? (
        <div className="accounts-empty">No accounts match your filters.</div>
      ) : (
        <>
          {/* Desktop Table */}
          <table className="accounts-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all accounts"
                    checked={selectedAliases.size === filteredAccounts.length && filteredAccounts.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>Alias</th>
                <th>Email</th>
                <th>Status</th>
                <th>Usage</th>
                <th>Source</th>
                <th>Tags</th>
                <th>5h / wk</th>
                <th>Resets</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map((account) => (
                <tr
                  key={account.alias}
                  onClick={() => handleOpenDrawer(account)}
                  className={isAccountEnabled(account) ? '' : 'account-row--disabled'}
                  style={{ cursor: 'pointer' }}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${account.alias}`}
                      checked={selectedAliases.has(account.alias)}
                      onChange={() => toggleSelection(account.alias)}
                    />
                  </td>
                  <td>
                    <strong>{account.alias}</strong>
                    <div className="table-badges">
                      <AccountStatusBadges
                        account={account}
                        rotationAlias={state.rotationAlias}
                        recommendedAlias={state.recommendedAlias}
                      />
                    </div>
                  </td>
                  <td>{account.email || '-'}</td>
                  <td>
                    {isAccountEnabled(account) ? (
                      <span className="badge badge--enabled">enabled</span>
                    ) : (
                      <span className="badge badge--disabled">disabled</span>
                    )}
                  </td>
                  <td>{account.usageCount}</td>
                  <td>{account.source || '-'}</td>
                  <td>
                    {account.tags && account.tags.length > 0
                      ? account.tags.map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))
                      : '-'}
                  </td>
                  <td>
                    <AccountQuotaCell account={account} />
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {account.rateLimits?.fiveHour?.resetAt && (
                      <div>5h: {formatResetTimeCompact(account.rateLimits.fiveHour.resetAt)}</div>
                    )}
                    {account.rateLimits?.weekly?.resetAt && (
                      <div>wk: {formatResetTimeCompact(account.rateLimits.weekly.resetAt)}</div>
                    )}
                    {!account.rateLimits?.fiveHour?.resetAt && !account.rateLimits?.weekly?.resetAt && '-'}
                  </td>
                  <td>
                    {account.limitsConfidence ? (
                      <span className={`confidence confidence--${account.limitsConfidence}`}>
                        {account.limitsConfidence}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile Cards */}
          <div className="mobile-account-cards">
            {filteredAccounts.map((account) => (
              <MobileAccountCard
                key={account.alias}
                account={account}
                rotationAlias={state.rotationAlias}
                recommendedAlias={state.recommendedAlias}
                onOpenDrawer={handleOpenDrawer}
              />
            ))}
          </div>
        </>
      )}

      {drawerOpen && selectedAccount && (
        <AccountDrawer
          account={selectedAccount}
          isActive={state.rotationAlias === selectedAccount.alias}
          onClose={handleCloseDrawer}
          onToggleEnable={() => handleToggleEnable(selectedAccount)}
          onRemove={() => handleRemove(selectedAccount.alias)}
          onUpdateMeta={(tags, notes) => handleUpdateMeta(selectedAccount.alias, tags, notes)}
          onReauth={() => handleReauth(selectedAccount.alias)}
          onRefreshTokens={() => handleRefreshTokens(selectedAccount.alias)}
          onRefreshLimits={() => handleRefreshLimits(selectedAccount.alias)}
          onSwitch={() => handleSwitch(selectedAccount.alias)}
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

      {createModalOpen && (
        <CreateAccountModal
          autoLogin={state.autoLogin}
          onClose={() => setCreateModalOpen(false)}
        />
      )}
    </div>
  )
}
