import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useDashboardState } from '../hooks/useDashboardState'
import {
  useSettingsQuery,
  useUpdateSettingsMutation,
  useFeatureFlagsQuery,
  useUpdateFeatureFlagsMutation,
  useResetSettingsMutation,
  useApplyPresetMutation,
  useForceStateQuery,
  useActivateForceMutation,
  useClearForceMutation
} from '../api/queries'
import { StickySessionPanel } from './StickySessionPanel'
import './ConfigurationPage.css'

const rotationStrategyHelp: Record<string, string> = {
  'round-robin': 'Cycle through enabled accounts in order.',
  'least-used': 'Prefer the enabled account with the lowest usage count.',
  'random': 'Randomly pick from healthy accounts each request.',
  'weighted-round-robin': 'Split requests by your account weights (example: 0.70/0.20/0.10 sends about 70%/20%/10%). Limited or disabled accounts are skipped automatically.'
}

function describeRotationStrategy(strategy: string): string {
  return rotationStrategyHelp[strategy] || 'Rotation strategy controls how the next account is selected.'
}

function roundWeight(value: number): number {
  return Math.round(value * 1000) / 1000
}

function validateWeights(weights: Record<string, number>): string | null {
  const values = Object.values(weights)
  const total = values.reduce((sum, w) => sum + w, 0)
  if (Math.abs(total - 1) > 0.01) {
    return 'Weights must sum to 1.0'
  }
  for (const [alias, weight] of Object.entries(weights)) {
    if (weight <= 0 || weight > 1) {
      return `Weight for ${alias} must be between 0 and 1`
    }
  }
  return null
}

export function ConfigurationPage(): JSX.Element {
  const { data: state } = useDashboardState()
  const settingsQuery = useSettingsQuery()
  const featureFlagsQuery = useFeatureFlagsQuery()
  const forceQuery = useForceStateQuery()

  const updateSettingsMutation = useUpdateSettingsMutation()
  const updateFeatureFlagsMutation = useUpdateFeatureFlagsMutation()
  const resetSettingsMutation = useResetSettingsMutation()
  const applyPresetMutation = useApplyPresetMutation()
  const activateForceMutation = useActivateForceMutation()
  const clearForceMutation = useClearForceMutation()

  const stickySessionsEnabled = state?.featureFlags?.stickySessionsEnabled ?? false
  const accounts = state?.accounts ?? []
  const enabledAccounts = accounts.filter(acc => acc.enabled !== false)

  // Local form state
  const [rotationStrategy, setRotationStrategy] = useState<string>('round-robin')
  const [criticalThreshold, setCriticalThreshold] = useState<number>(10)
  const [lowThreshold, setLowThreshold] = useState<number>(30)
  const [antigravityEnabled, setAntigravityEnabled] = useState<boolean>(false)
  const [stickyEnabled, setStickyEnabled] = useState<boolean>(false)
  const [forceAlias, setForceAlias] = useState<string>('')
  const [showForceAliasSelect, setShowForceAliasSelect] = useState<boolean>(false)
  const [accountWeights, setAccountWeights] = useState<Record<string, number>>({})
  const [weightError, setWeightError] = useState<string | null>(null)

  // Sync form state when data loads
  useEffect(() => {
    if (settingsQuery.data?.settings) {
      setRotationStrategy(settingsQuery.data.settings.rotationStrategy)
      setCriticalThreshold(settingsQuery.data.settings.criticalThreshold)
      setLowThreshold(settingsQuery.data.settings.lowThreshold)
      setAccountWeights(settingsQuery.data.settings.accountWeights ?? {})
      setWeightError(null)
    }
  }, [settingsQuery.data])

  useEffect(() => {
    if (featureFlagsQuery.data?.featureFlags) {
      setAntigravityEnabled(featureFlagsQuery.data.featureFlags.antigravityEnabled)
      setStickyEnabled(featureFlagsQuery.data.featureFlags.stickySessionsEnabled ?? false)
    }
  }, [featureFlagsQuery.data])

  useEffect(() => {
    if (forceQuery.data) {
      setShowForceAliasSelect(false)
    }
  }, [forceQuery.data])

  const handleStrategyChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const strategy = e.target.value as import('../types/api').RotationSettings['rotationStrategy']
    setRotationStrategy(strategy)
    updateSettingsMutation.mutate({ updates: { rotationStrategy: strategy } })
  }, [updateSettingsMutation])

  const handleThresholdChange = useCallback((field: 'criticalThreshold' | 'lowThreshold', value: number) => {
    if (field === 'criticalThreshold') {
      setCriticalThreshold(value)
    } else {
      setLowThreshold(value)
    }
    updateSettingsMutation.mutate({ updates: { [field]: value } })
  }, [updateSettingsMutation])

  const handleFeatureFlagChange = useCallback((flag: 'antigravityEnabled' | 'stickySessionsEnabled', value: boolean) => {
    if (flag === 'antigravityEnabled') {
      setAntigravityEnabled(value)
    } else {
      setStickyEnabled(value)
    }
    const currentFlags = featureFlagsQuery.data?.featureFlags ?? { antigravityEnabled: false }
    updateFeatureFlagsMutation.mutate({
      featureFlags: { ...currentFlags, [flag]: value }
    })
  }, [featureFlagsQuery.data, updateFeatureFlagsMutation])

  const handleReset = useCallback(() => {
    if (window.confirm('Reset all settings to defaults? This cannot be undone.')) {
      resetSettingsMutation.mutate(undefined)
    }
  }, [resetSettingsMutation])

  const handlePreset = useCallback((preset: 'balanced' | 'conservative' | 'aggressive') => {
    applyPresetMutation.mutate({ preset })
  }, [applyPresetMutation])

  const handleForceToggle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked
    if (isChecked) {
      setShowForceAliasSelect(true)
    } else {
      clearForceMutation.mutate()
    }
  }, [clearForceMutation])

  const handleForceAliasSelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const alias = e.target.value
    if (!alias) return
    setForceAlias(alias)
    activateForceMutation.mutate({ alias })
  }, [activateForceMutation])

  const handleWeightChange = useCallback((alias: string, value: number) => {
    const newWeights = { ...accountWeights, [alias]: roundWeight(value) }
    setAccountWeights(newWeights)
    const error = validateWeights(newWeights)
    setWeightError(error)
  }, [accountWeights])

  const handleWeightBlur = useCallback((alias: string, value: number) => {
    const newWeights = { ...accountWeights, [alias]: roundWeight(value) }
    const error = validateWeights(newWeights)
    if (!error) {
      updateSettingsMutation.mutate({ updates: { accountWeights: newWeights } })
    }
    setWeightError(error)
  }, [accountWeights, updateSettingsMutation])

  const isLoading = settingsQuery.isLoading || featureFlagsQuery.isLoading || forceQuery.isLoading
  const hasError = settingsQuery.isError || featureFlagsQuery.isError || forceQuery.isError

  const forceActive = forceQuery.data?.active ?? false
  const forceAliasValue = forceQuery.data?.alias ?? null
  const forceRemainingTime = forceQuery.data?.remainingTime ?? '0s'

  const showWeightEditor = rotationStrategy === 'weighted-round-robin'

  return (
    <main className="configuration-page" role="main" aria-label="Configuration">
      <h1 className="configuration-page-heading">Configuration</h1>

      {isLoading && <p className="configuration-page-placeholder">Loading configuration...</p>}
      {hasError && (
        <p className="configuration-page-placeholder">
          Error loading configuration. Please refresh the page.
        </p>
      )}

      {!isLoading && !hasError && (
        <>
          {/* Rotation Strategy */}
          <section className="configuration-section" aria-labelledby="strategy-heading">
            <h2 id="strategy-heading" className="configuration-section-heading">Rotation Strategy</h2>
            <div className="configuration-field">
              <label htmlFor="rotation-strategy" className="configuration-label">Strategy</label>
              <select
                id="rotation-strategy"
                value={rotationStrategy}
                onChange={handleStrategyChange}
                className="configuration-select"
                aria-label="Rotation strategy"
                title={describeRotationStrategy(rotationStrategy)}
              >
                <option value="round-robin">round-robin</option>
                <option value="least-used">least-used</option>
                <option value="random">random</option>
                <option value="weighted-round-robin">weighted-round-robin</option>
              </select>
              <p className="configuration-help">
                {describeRotationStrategy(rotationStrategy)}
                {forceActive ? ' Saved now, active after force mode is turned off.' : ' Active now while force mode is off.'}
              </p>
            </div>
          </section>

          {/* Thresholds */}
          <section className="configuration-section" aria-labelledby="thresholds-heading">
            <h2 id="thresholds-heading" className="configuration-section-heading">Thresholds</h2>
            <p className="configuration-help">
              Quota remaining percentages that trigger severity colors on dashboard cards.
            </p>
            <div className="configuration-field-row">
              <div className="configuration-field">
                <label htmlFor="critical-threshold" className="configuration-label">
                  Critical Threshold <span className="configuration-unit">(%)</span>
                </label>
                <input
                  id="critical-threshold"
                  type="number"
                  value={criticalThreshold}
                  onChange={e => handleThresholdChange('criticalThreshold', Number(e.target.value))}
                  min={0}
                  max={100}
                  className="configuration-input"
                  aria-label="Critical threshold percent"
                />
                <p className="configuration-help">Quota bars turn red when remaining is at or below this value.</p>
              </div>
              <div className="configuration-field">
                <label htmlFor="low-threshold" className="configuration-label">
                  Low Threshold <span className="configuration-unit">(%)</span>
                </label>
                <input
                  id="low-threshold"
                  type="number"
                  value={lowThreshold}
                  onChange={e => handleThresholdChange('lowThreshold', Number(e.target.value))}
                  min={0}
                  max={100}
                  className="configuration-input"
                  aria-label="Low threshold percent"
                />
                <p className="configuration-help">Quota bars turn yellow when remaining is at or below this value.</p>
              </div>
            </div>
          </section>

          {/* Account Weights */}
          {showWeightEditor && (
            <section className="configuration-section" aria-labelledby="weights-heading">
              <h2 id="weights-heading" className="configuration-section-heading">Account Weights</h2>
              <p className="configuration-help">
                Adjust the share of requests each account receives. Weights must sum to 1.0.
                Disabled accounts are shown for reference but skipped at runtime.
              </p>
              <div className="account-weights-list">
                {accounts.map(acc => {
                  const weight = accountWeights[acc.alias] ?? 0
                  return (
                    <div
                      key={acc.alias}
                      className={`account-weight-row ${acc.enabled === false ? 'account-weight-disabled' : ''}`}
                    >
                      <label htmlFor={`weight-${acc.alias}`} className="account-weight-label">
                        {acc.alias}
                        {acc.enabled === false && <span className="account-weight-badge">disabled</span>}
                      </label>
                      <input
                        id={`weight-${acc.alias}`}
                        type="number"
                        value={weight}
                        onChange={e => handleWeightChange(acc.alias, Number(e.target.value))}
                        onBlur={e => handleWeightBlur(acc.alias, Number(e.target.value))}
                        min={0}
                        max={1}
                        step={0.01}
                        className="configuration-input account-weight-input"
                        aria-label={`${acc.alias} weight`}
                        disabled={acc.enabled === false}
                      />
                    </div>
                  )
                })}
              </div>
              {weightError && (
                <p className="configuration-error" role="alert">
                  {weightError}
                </p>
              )}
            </section>
          )}

          {/* Feature Flags */}
          <section className="configuration-section" aria-labelledby="feature-flags-heading">
            <h2 id="feature-flags-heading" className="configuration-section-heading">Feature Flags</h2>
            <div className="configuration-field">
              <label className="configuration-label configuration-toggle">
                <input
                  type="checkbox"
                  checked={antigravityEnabled}
                  onChange={e => handleFeatureFlagChange('antigravityEnabled', e.target.checked)}
                  aria-label="Enable antigravity"
                />
                Enable Antigravity
              </label>
            </div>
            <div className="configuration-field">
              <label className="configuration-label configuration-toggle">
                <input
                  type="checkbox"
                  checked={stickyEnabled}
                  onChange={e => handleFeatureFlagChange('stickySessionsEnabled', e.target.checked)}
                  aria-label="Enable sticky sessions"
                />
                Enable Sticky Sessions
              </label>
            </div>
          </section>

          {/* Antigravity Controls — Settings subsection discoverable when feature enabled */}
          {antigravityEnabled && (
            <section className="configuration-section" aria-labelledby="antigravity-controls-heading">
              <h2 id="antigravity-controls-heading" className="configuration-section-heading">Antigravity Controls</h2>
              <p className="configuration-help">
                Manage antigravity quota distribution, scope configuration, and account-level token monitoring.
              </p>
              <div className="configuration-actions">
                <Link
                  to="/settings/antigravity"
                  className="configuration-button"
                  aria-label="Manage Antigravity"
                >
                  Manage Antigravity
                </Link>
              </div>
            </section>
          )}

          {/* Presets */}
          <section className="configuration-section" aria-labelledby="presets-heading">
            <h2 id="presets-heading" className="configuration-section-heading">Presets</h2>
            <div className="configuration-actions">
              <button
                type="button"
                className="configuration-button"
                onClick={() => handlePreset('balanced')}
                disabled={applyPresetMutation.isPending}
              >
                Balanced
              </button>
              <button
                type="button"
                className="configuration-button"
                onClick={() => handlePreset('conservative')}
                disabled={applyPresetMutation.isPending}
              >
                Conservative
              </button>
              <button
                type="button"
                className="configuration-button"
                onClick={() => handlePreset('aggressive')}
                disabled={applyPresetMutation.isPending}
              >
                Aggressive
              </button>
            </div>
            {applyPresetMutation.isSuccess && (
              <p className="configuration-success">Preset applied successfully.</p>
            )}
            {applyPresetMutation.isError && (
              <p className="configuration-error">
                Failed to apply preset: {applyPresetMutation.error instanceof Error ? applyPresetMutation.error.message : 'Unknown error'}
              </p>
            )}
          </section>

          {/* Force Mode */}
          <section className="configuration-section" aria-labelledby="force-mode-heading">
            <h2 id="force-mode-heading" className="configuration-section-heading">Force Mode</h2>
            <div className="configuration-field">
              <label className="configuration-label configuration-toggle" title="Force mode pins all requests to one selected account for up to 24 hours. While force mode is on, rotation strategy is paused.">
                <input
                  type="checkbox"
                  checked={forceActive}
                  onChange={handleForceToggle}
                  aria-label="Force mode"
                />
                Force mode {forceActive ? `On (${forceRemainingTime})` : 'Off'}
              </label>
            </div>

            {showForceAliasSelect && !forceActive && (
              <div className="configuration-field">
                <label htmlFor="force-alias" className="configuration-label">Force Alias</label>
                <select
                  id="force-alias"
                  value={forceAlias}
                  onChange={handleForceAliasSelect}
                  className="configuration-select"
                  aria-label="Force alias"
                  title="Choose the account that force mode should pin."
                >
                  <option value="">Select account...</option>
                  {enabledAccounts.map(acc => (
                    <option key={acc.alias} value={acc.alias}>{acc.alias}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="configuration-force-status" role="status" aria-live="polite">
              {forceActive ? (
                <p>
                  Force mode active for <strong>{forceAliasValue}</strong> — {forceRemainingTime} remaining
                </p>
              ) : (
                <p>Force mode disabled. Rotation will use normal strategy.</p>
              )}
            </div>
          </section>

          {/* Reset */}
          <section className="configuration-section configuration-section--danger" aria-labelledby="reset-heading">
            <h2 id="reset-heading" className="configuration-section-heading">Reset Settings</h2>
            <p className="configuration-help">
              This will restore all settings to their default values. This action cannot be undone.
            </p>
            <div className="configuration-actions">
              <button
                type="button"
                className="configuration-button danger"
                onClick={handleReset}
                disabled={resetSettingsMutation.isPending}
                aria-describedby="reset-heading"
              >
                {resetSettingsMutation.isPending ? 'Resetting...' : 'Reset to Defaults'}
              </button>
            </div>
            {resetSettingsMutation.isSuccess && (
              <p className="configuration-success">Settings reset to defaults.</p>
            )}
            {resetSettingsMutation.isError && (
              <p className="configuration-error">
                Failed to reset: {resetSettingsMutation.error instanceof Error ? resetSettingsMutation.error.message : 'Unknown error'}
              </p>
            )}
          </section>

          {/* Sticky Sessions */}
          {stickySessionsEnabled && <StickySessionPanel />}

          {!stickySessionsEnabled && (
            <p className="configuration-page-placeholder" role="status">
              Sticky sessions are disabled. Enable the feature flag to configure sticky session settings.
            </p>
          )}
        </>
      )}
    </main>
  )
}
