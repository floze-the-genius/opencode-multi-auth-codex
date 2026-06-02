import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getState,
  getLogs,
  syncAuth,
  importCodexAuth,
  refreshToken,
  refreshLimits,
  stopRefreshQueue,
  startAuth,
  startAutoLogin,
  addAutoLoginAccount,
  switchAccount,
  useInCodex,
  enableAccount,
  removeAccount,
  updateAccountMeta,
  reauthAccount,
  getForceState,
  activateForce,
  clearForce,
  refreshAntigravityQuota,
  refreshAntigravityQuotaAll,
  getSettings,
  updateSettings,
  getFeatureFlags,
  updateFeatureFlags,
  resetSettings,
  applyPreset,
  getStickySessionConfig,
  updateStickySessionConfig,
  getStickySessionStatus,
  cleanupStickySessions
} from './client'
import type { DashboardState, LogsResponse, ForceState, SettingsInfo, FeatureFlagsResponse } from '../types/api'

// Query keys
export const queryKeys = {
  dashboardState: ['dashboardState'] as const,
  logs: (limit?: number) => ['logs', limit] as const,
  accounts: ['accounts'] as const,
  settings: ['settings'] as const,
  forceState: ['forceState'] as const,
  featureFlags: ['featureFlags'] as const,
  stickySessionConfig: ['stickySessionConfig'] as const,
  stickySessionStatus: ['stickySessionStatus'] as const
}

// Dashboard state query
export function useDashboardStateQuery(pollingInterval = 5000) {
  return useQuery<DashboardState>({
    queryKey: queryKeys.dashboardState,
    queryFn: getState,
    refetchInterval: (query) => (query.state.data?.queue?.running ? 1000 : pollingInterval),
    staleTime: Math.min(pollingInterval / 2, 2000)
  })
}

// Sync mutation
export function useSyncMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: syncAuth,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Refresh tokens mutation
export function useRefreshTokensMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (alias?: string) => refreshToken(alias),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Import from Codex auth.json mutation
export function useImportCodexAuthMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: importCodexAuth,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Refresh limits mutation
export function useRefreshLimitsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (alias?: string) => refreshLimits(alias),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Stop refresh queue mutation
export function useStopRefreshQueueMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: stopRefreshQueue,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Start auth mutation
export function useStartAuthMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: startAuth,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Start auto-login mutation
export function useStartAutoLoginMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (vars: { selector: string; visible?: boolean }) => startAutoLogin(vars.selector, vars.visible),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Add auto-login account mutation
export function useAddAutoLoginAccountMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: addAutoLoginAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Switch account mutation
export function useSwitchAccountMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: switchAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Use stored account in Codex mutation
export function useUseInCodexMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: useInCodex,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Enable/disable account mutation
export function useEnableAccountMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (vars: { alias: string; enabled: boolean }) => enableAccount(vars.alias, vars.enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Remove account mutation
export function useRemoveAccountMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: removeAccount,
    onMutate: async (alias: string) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboardState })

      const previousState = queryClient.getQueryData<DashboardState>(queryKeys.dashboardState)

      queryClient.setQueryData<DashboardState>(queryKeys.dashboardState, (currentState) => {
        if (!currentState) return currentState

        const codexActive = currentState.codexActive?.alias === alias
          ? { ...currentState.codexActive, status: 'unknown' as const, alias: null }
          : currentState.codexActive

        return {
          ...currentState,
          deviceAlias: currentState.deviceAlias === alias ? null : currentState.deviceAlias,
          codexActive,
          accounts: currentState.accounts.filter((account) => account.alias !== alias)
        }
      })

      return { previousState }
    },
    onError: (_error, _alias, context) => {
      if (context?.previousState) {
        queryClient.setQueryData(queryKeys.dashboardState, context.previousState)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState, refetchType: 'all' })
    }
  })
}

// Update account meta mutation
export function useUpdateAccountMetaMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (vars: { alias: string; tags?: string; notes?: string }) => updateAccountMeta(vars.alias, vars.tags, vars.notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Reauth account mutation
export function useReauthAccountMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (vars: { alias: string; actor?: string }) => reauthAccount(vars.alias, vars.actor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Logs query
export function useLogsQuery(limit = 50) {
  return useQuery<LogsResponse>({
    queryKey: queryKeys.logs(limit),
    queryFn: () => getLogs(limit),
    refetchInterval: 5000,
    staleTime: 2000
  })
}

// Force state query
export function useForceStateQuery() {
  return useQuery<ForceState>({
    queryKey: queryKeys.forceState,
    queryFn: getForceState,
    refetchInterval: 5000,
    staleTime: 2000
  })
}

// Activate force mutation
export function useActivateForceMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (vars: { alias: string; actor?: string }) => activateForce(vars.alias, vars.actor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.forceState })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Clear force mutation
export function useClearForceMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: clearForce,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.forceState })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Refresh antigravity quota mutation
export function useRefreshAntigravityMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: refreshAntigravityQuota,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Refresh all antigravity quotas mutation
export function useRefreshAntigravityAllMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: refreshAntigravityQuotaAll,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Settings query
export function useSettingsQuery() {
  return useQuery<SettingsInfo>({
    queryKey: queryKeys.settings,
    queryFn: getSettings,
    refetchInterval: 5000,
    staleTime: 2000
  })
}

// Update settings mutation
export function useUpdateSettingsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (vars: { updates: Parameters<typeof updateSettings>[0] }) => updateSettings(vars.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Feature flags query
export function useFeatureFlagsQuery() {
  return useQuery<FeatureFlagsResponse>({
    queryKey: queryKeys.featureFlags,
    queryFn: getFeatureFlags,
    refetchInterval: 5000,
    staleTime: 2000
  })
}

// Update feature flags mutation
export function useUpdateFeatureFlagsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (vars: { featureFlags: import('../types/api.ts').FeatureFlags; actor?: string }) =>
      updateFeatureFlags(vars.featureFlags, vars.actor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.featureFlags })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Reset settings mutation
export function useResetSettingsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (actor?: string) => resetSettings(actor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      queryClient.invalidateQueries({ queryKey: queryKeys.featureFlags })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Apply preset mutation
export function useApplyPresetMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (vars: { preset: import('../types/api.ts').WeightPreset; actor?: string }) => applyPreset(vars.preset, vars.actor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Sticky session config query
export function useStickySessionConfigQuery() {
  return useQuery<import('../types/api.ts').StickySessionSettings>({
    queryKey: queryKeys.stickySessionConfig,
    queryFn: getStickySessionConfig,
    enabled: false // manual fetch; panel triggers on mount
  })
}

// Sticky session status query
export function useStickySessionStatusQuery() {
  return useQuery<import('../types/api.ts').StickySessionStatus>({
    queryKey: queryKeys.stickySessionStatus,
    queryFn: getStickySessionStatus,
    enabled: false // manual refresh; no polling
  })
}

// Update sticky session config mutation
export function useUpdateStickySessionConfigMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (config: import('../types/api.ts').StickySessionSettings) => updateStickySessionConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.stickySessionConfig })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}

// Cleanup sticky sessions mutation
export function useCleanupStickySessionsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: cleanupStickySessions,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.stickySessionStatus })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardState })
    }
  })
}
