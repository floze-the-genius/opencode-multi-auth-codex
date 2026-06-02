export const dashboardAlphaMetrics: any
export const dashboardBetaMetrics: any
export function writeDashboardSandbox(options: {
  root: string
  storeFile: string
  authFile: string
  stickyEnabled?: boolean
  accountSet?: 'alpha' | 'alpha-beta' | 'alpha-beta-gamma'
}): void
