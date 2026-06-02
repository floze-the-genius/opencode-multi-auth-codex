/**
 * Typed fetch wrapper for the dashboard API.
 *
 * All requests are unauthenticated (localhost-only dashboard).
 * Errors are normalized to a consistent ApiError shape.
 */

import type { ApiErrorResponse } from '../types/api.ts'

export class ApiError extends Error {
  status: number
  code?: string
  details?: ApiErrorResponse['details']

  constructor(status: number, body: ApiErrorResponse) {
    super(body.error)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.details = body.details
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(response.status, { error: 'Invalid JSON response' })
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await parseJsonResponse<ApiErrorResponse>(response)
    throw new ApiError(response.status, body)
  }
  return parseJsonResponse<T>(response)
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
}

export async function apiRequest<T>(pathname: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(pathname, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  })
  return handleResponse<T>(response)
}

// Convenience helpers aligned with frozen API contracts

export function getState() {
  return apiRequest<import('../types/api.ts').DashboardState>('/api/state')
}

export function getLogs(limit?: number) {
  const qs = limit !== undefined ? `?limit=${limit}` : ''
  return apiRequest<import('../types/api.ts').LogsResponse>(`/api/logs${qs}`)
}

export function getAccounts() {
  return apiRequest<{ accounts: import('../types/api.ts').AccountView[] }>('/api/accounts')
}

export function syncAuth() {
  return apiRequest<import('../types/api.ts').ApiOkResponse>('/api/sync', { method: 'POST' })
}

export function importCodexAuth() {
  return apiRequest<import('../types/api.ts').ImportCodexAuthResponse>('/api/codex/import', { method: 'POST' })
}

export function startAuth(alias: string) {
  return apiRequest<{ ok: true; url: string }>('/api/auth/start', {
    method: 'POST',
    body: { alias }
  })
}

export function startAutoLogin(selector: string, visible?: boolean) {
  return apiRequest<{ ok: true; url?: string }>('/api/auto-login/start', {
    method: 'POST',
    body: { selector, visible }
  })
}

export function addAutoLoginAccount(input: {
  email: string
  password: string
  alias?: string
  chatgptPassword?: string
}) {
  return apiRequest<{ ok: true }>('/api/auto-login/add', {
    method: 'POST',
    body: input
  })
}

export function switchAccount(alias: string) {
  return apiRequest<import('../types/api.ts').ApiOkResponse>('/api/switch', {
    method: 'POST',
    body: { alias }
  })
}

export function useInCodex(alias: string) {
  return apiRequest<import('../types/api.ts').UseInCodexResponse>('/api/codex/use', {
    method: 'POST',
    body: { alias }
  })
}

export function removeAccount(alias: string) {
  return apiRequest<import('../types/api.ts').ApiOkResponse>('/api/remove', {
    method: 'POST',
    body: { alias }
  })
}

export function updateAccountMeta(alias: string, tags?: string, notes?: string) {
  return apiRequest<import('../types/api.ts').ApiOkResponse>('/api/account/meta', {
    method: 'POST',
    body: { alias, tags, notes }
  })
}

export function refreshToken(alias?: string) {
  return apiRequest<import('../types/api.ts').RefreshTokenResponse>('/api/token/refresh', {
    method: 'POST',
    body: { alias }
  })
}

export function refreshLimits(alias?: string) {
  return apiRequest<import('../types/api.ts').RefreshLimitsResponse>('/api/limits/refresh', {
    method: 'POST',
    body: { alias }
  })
}

export function stopRefreshQueue() {
  return apiRequest<import('../types/api.ts').ApiOkResponse>('/api/limits/stop', {
    method: 'POST'
  })
}

export function getForceState() {
  return apiRequest<import('../types/api.ts').ForceState>('/api/force')
}

export function activateForce(alias: string, actor?: string) {
  return apiRequest<import('../types/api.ts').ForceActivateResponse>('/api/force', {
    method: 'POST',
    body: { alias, actor }
  })
}

export function clearForce() {
  return apiRequest<import('../types/api.ts').ForceClearResponse>('/api/force/clear', {
    method: 'POST'
  })
}

export function getSettings() {
  return apiRequest<import('../types/api.ts').SettingsInfo>('/api/settings')
}

export function updateSettings(
  updates: Partial<import('../types/api.ts').RotationSettings> & { actor?: string }
) {
  return apiRequest<import('../types/api.ts').SettingsUpdateResponse>('/api/settings', {
    method: 'PUT',
    body: updates
  })
}

export function getFeatureFlags() {
  return apiRequest<import('../types/api.ts').FeatureFlagsResponse>('/api/settings/feature-flags')
}

export function updateFeatureFlags(featureFlags: import('../types/api.ts').FeatureFlags, actor?: string) {
  return apiRequest<import('../types/api.ts').FeatureFlagsUpdateResponse>('/api/settings/feature-flags', {
    method: 'PUT',
    body: { featureFlags, actor }
  })
}

export function resetSettings(actor?: string) {
  return apiRequest<import('../types/api.ts').SettingsUpdateResponse>('/api/settings/reset', {
    method: 'POST',
    body: { actor }
  })
}

export function applyPreset(preset: import('../types/api.ts').WeightPreset, actor?: string) {
  return apiRequest<import('../types/api.ts').PresetApplyResponse>('/api/settings/preset', {
    method: 'POST',
    body: { preset, actor }
  })
}

export function enableAccount(alias: string, enabled: boolean) {
  return apiRequest<import('../types/api.ts').EnableAccountResponse>(`/api/accounts/${encodeURIComponent(alias)}/enabled`, {
    method: 'PUT',
    body: { enabled }
  })
}

export function reauthAccount(alias: string, actor?: string) {
  return apiRequest<import('../types/api.ts').ReauthResponse>(`/api/accounts/${encodeURIComponent(alias)}/reauth`, {
    method: 'POST',
    body: { actor }
  })
}

export function refreshAntigravityQuota() {
  return apiRequest<{ ok: true; quota: import('../types/api.ts').AntigravityQuota }>('/api/antigravity/refresh', {
    method: 'POST'
  })
}

export function refreshAntigravityQuotaAll() {
  return apiRequest<{ ok: true; quota: import('../types/api.ts').AntigravityQuota }>('/api/antigravity/refresh-all', {
    method: 'POST'
  })
}

// Sticky-session additive contracts (Phase 4+)

export function getStickySessionConfig() {
  return apiRequest<import('../types/api.ts').StickySessionSettings>('/api/sticky-sessions/config')
}

export function updateStickySessionConfig(config: import('../types/api.ts').StickySessionSettings) {
  return apiRequest<import('../types/api.ts').StickySessionSettings>('/api/sticky-sessions/config', {
    method: 'PUT',
    body: config
  })
}

export function getStickySessionStatus() {
  return apiRequest<import('../types/api.ts').StickySessionStatus>('/api/sticky-sessions/status')
}

export function cleanupStickySessions() {
  return apiRequest<import('../types/api.ts').StickySessionCleanupResponse>('/api/sticky-sessions/cleanup', {
    method: 'POST'
  })
}
