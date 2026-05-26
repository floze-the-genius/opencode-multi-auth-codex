/**
 * Shared TypeScript interfaces for the dashboard API contract.
 *
 * These types are derived from the frozen backend API surface
 * (src/web.ts and tests/integration/dashboard-api-contract.test.ts).
 * Do NOT mutate existing shapes without a corresponding API contract test.
 */

export interface RateLimitWindow {
  limit?: number
  remaining?: number
  resetAt?: number
  updatedAt?: number
}

export interface AccountRateLimits {
  fiveHour?: RateLimitWindow
  weekly?: RateLimitWindow
}

export interface RateLimitSnapshot {
  remaining?: number
  limit?: number
  resetAt?: number
}

export interface RateLimitHistoryEntry {
  at: number
  fiveHour?: RateLimitSnapshot
  weekly?: RateLimitSnapshot
}

export type LimitsConfidence = 'fresh' | 'stale' | 'error' | 'unknown'
export type LimitStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'stopped'

export interface AccountView {
  alias: string
  email?: string
  enabled: boolean
  disabledAt?: number
  disabledBy?: string
  disableReason?: string
  usageCount: number
  rateLimits?: AccountRateLimits
  rateLimitHistory?: RateLimitHistoryEntry[]
  limitsConfidence?: LimitsConfidence
  limitStatus?: LimitStatus
  limitError?: string
  lastLimitProbeAt?: number
  lastLimitErrorAt?: number
  tags?: string[]
  notes?: string
  source?: 'opencode' | 'codex'
  expiresAt?: number
  lastSeenAt?: number
  lastActiveUntil?: number
  lastUsed?: number
  rateLimitedUntil?: number
  modelUnsupportedUntil?: number
  workspaceDeactivatedUntil?: number
  authInvalid?: boolean
  lastRefresh?: string
}

export interface AuthSummary {
  hasAccessToken: boolean
  hasIdToken: boolean
  hasRefreshToken: boolean
}

export interface StoreStatus {
  locked: boolean
  encrypted: boolean
  error: string | null
}

export interface PendingLoginState {
  alias: string
  email?: string
  startedAt: number
  url?: string
  mode: 'manual' | 'auto'
  status: 'starting' | 'running' | 'waiting-callback'
  step?: string
  output: string[]
  pid?: number
}

export interface AutoLoginAccountView {
  alias: string
  email: string
  enabled: boolean
}

export interface AutoLoginConfigState {
  path: string
  scriptPath: string
  pythonPath: string
  configured: boolean
  accounts: AutoLoginAccountView[]
  error?: string
}

export interface AntigravityQuota {
  status: 'idle' | 'disabled' | string
  scope: string
}

export interface AntigravityState {
  accounts: Array<Record<string, unknown>>
  path: string
  quota?: AntigravityQuota
}

export interface RefreshQueueState {
  running: boolean
  total: number
  completed: number
  errors: number
  pending: number
}

export interface ForceState {
  active: boolean
  alias: string | null
  forcedAt: number | null
  forcedUntil: number | null
  forcedBy: string | null
  remainingMs: number
  remainingTime: string
  previousRotationStrategy: string | null
}

export interface FeatureFlags {
  antigravityEnabled: boolean
  stickySessionsEnabled?: boolean
}

export interface RotationSettings {
  rotationStrategy: 'round-robin' | 'least-used' | 'random' | 'weighted-round-robin'
  criticalThreshold: number
  lowThreshold: number
  accountWeights: Record<string, number>
  featureFlags?: FeatureFlags
  updatedAt?: number
  updatedBy?: string
}

export interface SettingsInfo {
  settings: RotationSettings
  source: string
  preset?: string
  canReset: boolean
}

export interface LogLine {
  time: string
  level: string
  message: string
}

export interface LogsResponse {
  path: string
  lines: LogLine[]
}

export interface DashboardState {
  authPath: string
  deviceAlias: string | null
  rotationAlias: string | null
  accounts: AccountView[]
  lastSyncAt: number
  lastSyncError: string | null
  lastSyncAlias: string | null
  authSummary: AuthSummary
  storeStatus: StoreStatus
  login: PendingLoginState | null
  lastLoginError: string | null
  antigravity: AntigravityState
  queue: RefreshQueueState | null
  recommendedAlias: string | null
  logPath: string
  autoLogin: AutoLoginConfigState
  rotationStrategy: string
  force: ForceState
  featureFlags: FeatureFlags
}

// Preset types
export type WeightPreset = 'balanced' | 'conservative' | 'aggressive' | 'custom'

// Request / Response wrappers
export interface ApiOkResponse {
  ok: true
}

export interface ApiErrorResponse {
  error: string
  code?: string
  details?: Array<{ field: string; message: string; constraint: string }>
  validPresets?: WeightPreset[]
  feature?: string
}

export interface EnableAccountResponse extends ApiOkResponse {
  alias: string
  enabled: boolean
  disabledAt?: number
  disabledBy?: string
}

export interface ReauthResponse extends ApiOkResponse {
  alias: string
  url: string
  message: string
}

export interface RefreshTokenResult {
  alias: string
  updated: boolean
  error?: string
}

export interface RefreshTokenResponse extends ApiOkResponse {
  results: RefreshTokenResult[]
}

export interface RefreshLimitsResponse extends ApiOkResponse {
  queue: RefreshQueueState
}

export interface ForceActivateResponse extends ApiOkResponse {
  alias: string
  forcedUntil?: number
  remainingMs: number
  remainingTime: string
  previousRotationStrategy?: string
}

export interface ForceClearResponse extends ApiOkResponse {
  restoredStrategy?: string
}

export interface SettingsUpdateResponse extends ApiOkResponse {
  settings: RotationSettings
}

export interface PresetApplyResponse extends ApiOkResponse {
  preset: WeightPreset
  settings: RotationSettings
}

export interface FeatureFlagsResponse {
  featureFlags: FeatureFlags
}

export interface FeatureFlagsUpdateResponse extends ApiOkResponse {
  featureFlags: FeatureFlags
}

// Sticky-session additive contracts (Phase 4+)
export type StickyIdentitySource =
  | 'header:session_id'
  | 'header:conversation_id'
  | 'body:metadata.session_id'
  | 'body:metadata.conversation_id'
  | 'body:prompt_cache_key'

export interface StickySessionSettings {
  enabled: boolean
  identitySources: StickyIdentitySource[]
  allowPromptCacheKey: boolean
  ttlMs: number
  maxEntries: number
  maxFileBytes: number
  updatedAt?: number
  updatedBy?: string
}

export interface StickySessionStatus {
  ok: boolean
  entries: number
  path: string
  exists: boolean
  ttlMs: number
  maxEntries: number
  maxFileBytes: number
  sizeBytes: number
  updatedAt: number
}

export interface StickySessionCleanupResponse extends ApiOkResponse {
  before: number
  after: number
  removed: number
  prunedAt: number
}
