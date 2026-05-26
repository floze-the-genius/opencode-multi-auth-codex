import { useQuery } from '@tanstack/react-query'
import { getState } from '../api/client'
import type { DashboardState } from '../types/api'

export interface UseDashboardStateOptions {
  pollingInterval?: number
}

export function getDashboardRefetchInterval(pollingInterval: number, state?: DashboardState): number {
  return state?.queue?.running ? 1000 : pollingInterval
}

export function useDashboardState(options: UseDashboardStateOptions = {}) {
  const pollingInterval = options.pollingInterval ?? 5000

  return useQuery<DashboardState>({
    queryKey: ['dashboardState'],
    queryFn: getState,
    refetchInterval: (query) => getDashboardRefetchInterval(pollingInterval, query.state.data),
    staleTime: Math.min(pollingInterval / 2, 2000)
  })
}
