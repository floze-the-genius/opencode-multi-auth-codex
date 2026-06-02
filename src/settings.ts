import { loadStore, saveStore, updateAccount } from './store.js'
import { getMetrics } from './metrics-store.js'
import { logInfo, logError } from './logger.js'
import {
  ALL_STICKY_IDENTITY_SOURCES,
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_ROTATION_SETTINGS,
  DEFAULT_STICKY_SESSION_SETTINGS,
  WEIGHTED_PRESETS,
  validateSettings,
  type RotationSettings,
  type StickyIdentitySource,
  type StickySessionAdminConfig,
  type StickySessionSettings,
  type PersistedStickySessionSettings,
  type WeightPreset,
  type SettingsValidationError
} from './types.js'

// Phase F: Settings precedence: defaults -> persisted -> runtime -> env

export interface SettingsResult {
  settings: RotationSettings
  source: 'default' | 'persisted' | 'runtime' | 'env'
  errors?: SettingsValidationError[]
}

export interface StickySessionConfigResult {
  config: StickySessionAdminConfig
  source: 'default' | 'persisted'
  errors?: SettingsValidationError[]
}

function getStoredStickySessionSettings(): PersistedStickySessionSettings | undefined {
  const store = loadStore()
  const sticky = store.stickySessions
  if (!sticky) return undefined

  return {
    ...DEFAULT_STICKY_SESSION_SETTINGS,
    ...sticky,
    identitySources: Array.isArray(sticky.identitySources)
      ? sticky.identitySources
      : DEFAULT_STICKY_SESSION_SETTINGS.identitySources
  }
}

function validateStickyIdentitySources(value: unknown): value is StickyIdentitySource[] {
  return (
    Array.isArray(value) &&
    value.every((source) => typeof source === 'string' && ALL_STICKY_IDENTITY_SOURCES.includes(source as StickyIdentitySource))
  )
}

export function validateStickySessionConfig(config: StickySessionAdminConfig): SettingsValidationError[] {
  const errors: SettingsValidationError[] = []

  if (typeof config.enabled !== 'boolean') {
    errors.push({
      field: 'enabled',
      message: 'Enabled must be a boolean',
      constraint: 'typeof enabled === boolean'
    })
  }

  if (!validateStickyIdentitySources(config.identitySources)) {
    errors.push({
      field: 'identitySources',
      message: 'Identity sources must be a non-empty array of supported sticky identity sources',
      constraint: `identitySources ∈ ${ALL_STICKY_IDENTITY_SOURCES.join(', ')}`
    })
  } else {
    if (config.identitySources.length === 0) {
      errors.push({
        field: 'identitySources',
        message: 'At least one identity source is required',
        constraint: 'identitySources.length > 0'
      })
    }

    if (new Set(config.identitySources).size !== config.identitySources.length) {
      errors.push({
        field: 'identitySources',
        message: 'Identity sources must not contain duplicates',
        constraint: 'identitySources are unique'
      })
    }
  }

  if (typeof config.allowPromptCacheKey !== 'boolean') {
    errors.push({
      field: 'allowPromptCacheKey',
      message: 'allowPromptCacheKey must be a boolean',
      constraint: 'typeof allowPromptCacheKey === boolean'
    })
  }

  if (
    Array.isArray(config.identitySources) &&
    config.identitySources.includes('body:prompt_cache_key') &&
    config.allowPromptCacheKey !== true
  ) {
    errors.push({
      field: 'identitySources',
      message: 'body:prompt_cache_key requires allowPromptCacheKey to be true',
      constraint: 'allowPromptCacheKey === true when body:prompt_cache_key is configured'
    })
  }

  for (const [field, value] of [
    ['ttlMs', config.ttlMs],
    ['maxEntries', config.maxEntries],
    ['maxFileBytes', config.maxFileBytes]
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push({
        field,
        message: `${field} must be a positive integer`,
        constraint: `${field} ∈ positive integers`
      })
    }
  }

  return errors
}

function resolveSettings(includeEnvOverrides: boolean): SettingsResult {
  const store = loadStore()
  
  // Start with defaults
  let settings: RotationSettings = { ...DEFAULT_ROTATION_SETTINGS }
  let source: SettingsResult['source'] = 'default'
  
  // Layer 1: Persisted settings from store
  if (store.settings) {
    const persistedFeatureFlags = store.settings.featureFlags
    settings = {
      ...settings,
      ...store.settings,
      featureFlags: persistedFeatureFlags
        ? {
            ...DEFAULT_FEATURE_FLAGS,
            ...settings.featureFlags,
            ...persistedFeatureFlags
          }
        : settings.featureFlags
    }
    source = 'persisted'
  }
  
  // Layer 2: Environment variables override (optional for runtime behavior)
  if (includeEnvOverrides) {
    const envStrategy = process.env.OPENCODE_MULTI_AUTH_ROTATION_STRATEGY
    if (envStrategy && ['round-robin', 'least-used', 'random', 'weighted-round-robin'].includes(envStrategy)) {
      settings.rotationStrategy = envStrategy as RotationSettings['rotationStrategy']
      source = 'env'
    }
    
    const envCriticalThreshold = process.env.OPENCODE_MULTI_AUTH_CRITICAL_THRESHOLD
    if (envCriticalThreshold) {
      const parsed = parseFloat(envCriticalThreshold)
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        settings.criticalThreshold = parsed
        source = 'env'
      }
    }
    
    const envLowThreshold = process.env.OPENCODE_MULTI_AUTH_LOW_THRESHOLD
    if (envLowThreshold) {
      const parsed = parseFloat(envLowThreshold)
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        settings.lowThreshold = parsed
        source = 'env'
      }
    }
    
    // Phase G: Feature flag environment overrides
    const envAntigravity = process.env.OPENCODE_MULTI_AUTH_ANTIGRAVITY_ENABLED
    if (envAntigravity) {
      const enabled = envAntigravity.toLowerCase() === 'true' || envAntigravity === '1'
      settings.featureFlags = {
        ...DEFAULT_FEATURE_FLAGS,
        ...(settings.featureFlags || {}),
        antigravityEnabled: enabled
      }
      source = 'env'
    }

    const envStickySessions = process.env.OPENCODE_MULTI_AUTH_STICKY_SESSIONS_ENABLED
    if (envStickySessions) {
      const enabled = envStickySessions.toLowerCase() === 'true' || envStickySessions === '1'
      settings.featureFlags = {
        ...DEFAULT_FEATURE_FLAGS,
        ...(settings.featureFlags || {}),
        stickySessionsEnabled: enabled
      }
      source = 'env'
    }
  }
  
  // Validate final settings
  const errors = validateSettings(settings)
  
  if (errors.length > 0) {
    logError(`Settings validation errors: ${errors.map(e => e.message).join(', ')}`)
  }
  
  return { settings, source, errors: errors.length > 0 ? errors : undefined }
}

// Phase F: Get settings with proper precedence (including env overrides)
export function getSettings(): SettingsResult {
  return resolveSettings(true)
}

// Runtime behavior should use persisted settings so dashboard changes take effect immediately.
export function getRuntimeSettings(): SettingsResult {
  return resolveSettings(false)
}

export function getStickySessionRuntimeSettings(): StickySessionSettings {
  const stored = getStoredStickySessionSettings()
  return {
    ...DEFAULT_STICKY_SESSION_SETTINGS,
    ...stored,
    identitySources: stored?.identitySources || DEFAULT_STICKY_SESSION_SETTINGS.identitySources
  }
}

export function getStickySessionConfig(): StickySessionConfigResult {
  const sticky = getStoredStickySessionSettings()
  const enabled = getRuntimeSettings().settings.featureFlags?.stickySessionsEnabled === true
  const config: StickySessionAdminConfig = {
    enabled,
    ...DEFAULT_STICKY_SESSION_SETTINGS,
    ...sticky,
    identitySources: sticky?.identitySources || DEFAULT_STICKY_SESSION_SETTINGS.identitySources
  }
  const errors = validateStickySessionConfig(config)

  return {
    config,
    source: sticky ? 'persisted' : 'default',
    errors: errors.length > 0 ? errors : undefined
  }
}

export function updateStickySessionConfig(
  updates: StickySessionAdminConfig,
  actor: string = 'system'
): { success: boolean; config?: StickySessionAdminConfig; errors?: SettingsValidationError[] } {
  const now = Date.now()
  const config: StickySessionAdminConfig = {
    enabled: updates.enabled,
    identitySources: updates.identitySources,
    allowPromptCacheKey: updates.allowPromptCacheKey,
    ttlMs: updates.ttlMs,
    maxEntries: updates.maxEntries,
    maxFileBytes: updates.maxFileBytes,
    updatedAt: now,
    updatedBy: actor
  }

  const errors = validateStickySessionConfig(config)
  if (errors.length > 0) {
    logError(`Sticky-session config update failed validation: ${errors.map(e => e.message).join(', ')}`)
    return { success: false, errors }
  }

  const store = loadStore()
  const current = getRuntimeSettings().settings
  store.settings = {
    ...DEFAULT_ROTATION_SETTINGS,
    ...current,
    featureFlags: {
      ...DEFAULT_FEATURE_FLAGS,
      ...(current.featureFlags || {}),
      stickySessionsEnabled: config.enabled
    },
    updatedAt: now,
    updatedBy: actor
  }
  store.rotationStrategy = store.settings.rotationStrategy
  store.stickySessions = {
    identitySources: [...config.identitySources],
    allowPromptCacheKey: config.allowPromptCacheKey,
    ttlMs: config.ttlMs,
    maxEntries: config.maxEntries,
    maxFileBytes: config.maxFileBytes,
    updatedAt: now,
    updatedBy: actor
  }
  saveStore(store)

  logInfo(`Sticky-session config updated by ${actor}: ${JSON.stringify({ ...config, updatedAt: now, updatedBy: actor })}`)
  return { success: true, config }
}

// Phase F: Update settings with validation
export function updateSettings(
  updates: Partial<RotationSettings> & { featureFlags?: Partial<NonNullable<RotationSettings['featureFlags']>> },
  actor: string = 'system'
): { success: boolean; settings?: RotationSettings; errors?: SettingsValidationError[] } {
  const current = getRuntimeSettings()
  
  // Merge updates with current settings
  const newSettings: RotationSettings = {
    ...current.settings,
    ...updates,
    featureFlags: {
      ...DEFAULT_FEATURE_FLAGS,
      ...(current.settings.featureFlags || {}),
      ...(updates.featureFlags || {})
    },
    updatedAt: Date.now(),
    updatedBy: actor
  }
  
  // Validate new settings
  const errors = validateSettings(newSettings)
  if (errors.length > 0) {
    logError(`Settings update failed validation: ${errors.map(e => e.message).join(', ')}`)
    return { success: false, errors }
  }
  
  // Save to store
  const store = loadStore()
  store.settings = newSettings
  // Keep legacy field in sync for force-mode compatibility.
  store.rotationStrategy = newSettings.rotationStrategy
  saveStore(store)
  
  logInfo(`Settings updated by ${actor}: ${JSON.stringify(updates)}`)
  return { success: true, settings: newSettings }
}

// Phase F: Reset settings to defaults
export function resetSettings(actor: string = 'system'): RotationSettings {
  const store = loadStore()
  delete (store as any).settings
  store.rotationStrategy = DEFAULT_ROTATION_SETTINGS.rotationStrategy
  saveStore(store)
  
  logInfo(`Settings reset to defaults by ${actor}`)
  return { ...DEFAULT_ROTATION_SETTINGS }
}

// Phase F: Apply a preset
export function applyPreset(
  preset: WeightPreset,
  actor: string = 'system'
): { success: boolean; settings?: RotationSettings; errors?: SettingsValidationError[] } {
  const store = loadStore()
  const accounts = Object.keys(store.accounts)
  
  const presetConfig = WEIGHTED_PRESETS[preset]
  
  let accountWeights: Record<string, number> = {}
  
  if (preset === 'balanced') {
    // Equal weights for all accounts
    const weight = accounts.length > 0 ? 1 / accounts.length : 0
    accounts.forEach(alias => {
      accountWeights[alias] = weight
    })
  } else if (preset === 'conservative') {
    // Weights based on limit health (normalized to percentages)
    accounts.forEach(alias => {
      const account = store.accounts[alias]
      const rateLimits = getMetrics(alias)?.rateLimits ?? account.rateLimits
      const fiveHourLimit = rateLimits?.fiveHour?.limit ?? 100
      const fiveHourRemaining = rateLimits?.fiveHour?.remaining ?? (fiveHourLimit / 2)
      const weeklyLimit = rateLimits?.weekly?.limit ?? 1000
      const weeklyRemaining = rateLimits?.weekly?.remaining ?? (weeklyLimit / 2)
      const fiveHourPct = fiveHourLimit > 0 ? (fiveHourRemaining / fiveHourLimit) * 100 : 50
      const weeklyPct = weeklyLimit > 0 ? (weeklyRemaining / weeklyLimit) * 100 : 50
      const health = (fiveHourPct + weeklyPct) / 2
      accountWeights[alias] = health / 100
    })
    // Normalize to sum to 1
    const total = Object.values(accountWeights).reduce((sum, w) => sum + w, 0)
    if (total > 0) {
      accounts.forEach(alias => {
        accountWeights[alias] = accountWeights[alias] / total
      })
    }
  } else if (preset === 'aggressive') {
    // Favor accounts with high usage (lower remaining)
    accounts.forEach(alias => {
      const account = store.accounts[alias]
      const rateLimits = getMetrics(alias)?.rateLimits ?? account.rateLimits
      const fiveHourLimit = rateLimits?.fiveHour?.limit ?? 100
      const fiveHourRemaining = rateLimits?.fiveHour?.remaining ?? (fiveHourLimit / 2)
      const weeklyLimit = rateLimits?.weekly?.limit ?? 1000
      const weeklyRemaining = rateLimits?.weekly?.remaining ?? (weeklyLimit / 2)
      const fiveHourPct = fiveHourLimit > 0 ? (fiveHourRemaining / fiveHourLimit) * 100 : 50
      const weeklyPct = weeklyLimit > 0 ? (weeklyRemaining / weeklyLimit) * 100 : 50
      const health = (fiveHourPct + weeklyPct) / 2
      // Inverse: lower health = higher weight
      accountWeights[alias] = (100 - health) / 100
    })
    // Normalize to sum to 1
    const total = Object.values(accountWeights).reduce((sum, w) => sum + w, 0)
    if (total > 0) {
      accounts.forEach(alias => {
        accountWeights[alias] = accountWeights[alias] / total
      })
    }
  }
  
  const updates: Partial<RotationSettings> = {
    rotationStrategy: 'weighted-round-robin',
    criticalThreshold: presetConfig.thresholds.critical,
    lowThreshold: presetConfig.thresholds.low,
    accountWeights
  }
  
  return updateSettings(updates, actor)
}

// Phase F: Calculate weighted selection
export function calculateWeightedSelection(
  aliases: string[],
  weights: Record<string, number>
): string | null {
  if (aliases.length === 0) return null
  
  // Filter to only available aliases
  const available = aliases.filter(alias => weights[alias] > 0)
  if (available.length === 0) return null
  
  // Calculate total weight
  const totalWeight = available.reduce((sum, alias) => sum + (weights[alias] || 0), 0)
  if (totalWeight === 0) return null
  
  // Weighted random selection
  let random = Math.random() * totalWeight
  
  for (const alias of available) {
    random -= weights[alias] || 0
    if (random <= 0) {
      return alias
    }
  }
  
  // Fallback to last
  return available[available.length - 1]
}

// Phase F: Get settings with environment info
export function getSettingsWithInfo(): {
  settings: RotationSettings
  source: string
  preset?: WeightPreset
  canReset: boolean
} {
  const result = getSettings()
  const store = loadStore()
  
  // Detect if using a preset
  let preset: WeightPreset | undefined
  if (result.settings.rotationStrategy === 'weighted-round-robin') {
    // Check if weights match a preset pattern
    for (const [presetName, config] of Object.entries(WEIGHTED_PRESETS)) {
      if (presetName !== 'custom' &&
          Math.abs(result.settings.criticalThreshold - config.thresholds.critical) < 0.01 &&
          Math.abs(result.settings.lowThreshold - config.thresholds.low) < 0.01) {
        preset = presetName as WeightPreset
        break
      }
    }
  }
  
  return {
    settings: result.settings,
    source: result.source,
    preset,
    canReset: !!store.settings
  }
}

// Phase G: Check if a feature flag is enabled
export function isFeatureEnabled(flag: keyof NonNullable<RotationSettings['featureFlags']>): boolean {
  const settings = getSettings()
  return settings.settings.featureFlags?.[flag] ?? false
}
