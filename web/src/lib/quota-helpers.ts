/**
 * Shared quota calculation helpers used by Dashboard and Accounts pages.
 * Extracted to keep status semantics consistent across surfaces.
 */

export function quotaPercent(remaining: number | undefined, limit: number | undefined): number {
  if (!limit || limit === 0) return 100
  if (remaining === undefined) return 0
  return Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)))
}

/**
 * Severity based on remaining quota percentage.
 * - critical: ≤10% remaining (nearly exhausted)
 * - low: ≤30% remaining (approaching limit)
 * - ok: >30% remaining (healthy)
 */
export function quotaSeverity(percent: number): 'critical' | 'low' | 'ok' {
  if (percent <= 10) return 'critical'
  if (percent <= 30) return 'low'
  return 'ok'
}

export function formatQuotaLabel(remaining: number | undefined, limit: number | undefined): string {
  if (remaining === undefined || limit === undefined) return '— / —'
  return `${remaining} / ${limit}`
}
