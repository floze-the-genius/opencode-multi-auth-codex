import type { RateLimitHistoryEntry } from '../types/api'

export interface HistoryPoint {
  at: number
  fiveHourPct: number | null
  weeklyPct: number | null
}

export interface ExhaustionEstimate {
  timeToExhaustionMs: number
  exhaustsBeforeReset: boolean
}

function toPercent(remaining: number | undefined, limit: number | undefined): number | null {
  if (typeof remaining !== 'number' || typeof limit !== 'number' || limit === 0) return null
  return Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)))
}

export function normalizeHistory(history: RateLimitHistoryEntry[] | undefined): HistoryPoint[] {
  if (!Array.isArray(history) || history.length === 0) return []
  const sorted = [...history].sort((a, b) => a.at - b.at)
  return sorted.map((entry) => ({
    at: entry.at,
    fiveHourPct: toPercent(entry.fiveHour?.remaining, entry.fiveHour?.limit),
    weeklyPct: toPercent(entry.weekly?.remaining, entry.weekly?.limit)
  }))
}

export interface ChartPoint {
  x: number
  y: number
  pct: number
  at: number
}

export interface ChartData {
  points: ChartPoint[]
  minPct: number
  maxPct: number
}

export function getChartData(
  points: HistoryPoint[],
  type: 'fiveHour' | 'weekly'
): ChartData | null {
  if (points.length === 0) return null
  const key = type === 'fiveHour' ? 'fiveHourPct' : 'weeklyPct'
  const valid = points
    .map((p) => ({ at: p.at, val: p[key] }))
    .filter((p): p is { at: number; val: number } => p.val !== null)
  if (valid.length < 2) return null

  const count = valid.length
  const width = 100
  const height = 30
  const minPct = 0
  const maxPct = 100

  const chartPoints: ChartPoint[] = valid.map(({ at, val }, idx) => {
    const x = (idx / (count - 1)) * width
    const y = height - ((val - minPct) / (maxPct - minPct)) * height
    return { x, y, pct: val, at }
  })

  return { points: chartPoints, minPct, maxPct }
}

export function getSparklinePoints(
  points: HistoryPoint[],
  type: 'fiveHour' | 'weekly'
): string {
  if (points.length === 0) return ''
  const key = type === 'fiveHour' ? 'fiveHourPct' : 'weeklyPct'
  const valid = points
    .map((p, i) => ({ i, val: p[key] }))
    .filter((p): p is { i: number; val: number } => p.val !== null)
  if (valid.length < 2) return ''
  const count = valid.length
  const maxVal = 100
  const minVal = 0
  const width = 100
  const height = 30
  return valid
    .map(({ val }, idx) => {
      const x = (idx / (count - 1)) * width
      const y = height - ((val - minVal) / (maxVal - minVal)) * height
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

export function calculateVelocity(
  points: HistoryPoint[],
  type: 'fiveHour' | 'weekly'
): number | null {
  if (points.length < 2) return null
  const key = type === 'fiveHour' ? 'fiveHourPct' : 'weeklyPct'
  const valid = points.filter((p) => p[key] !== null) as Array<HistoryPoint & { [K in typeof key]: number }>
  if (valid.length < 2) return null
  const first = valid[0]
  const last = valid[valid.length - 1]
  const hours = (last.at - first.at) / (1000 * 60 * 60)
  if (hours < 1 / 60) return null // less than 1 minute
  const delta = last[key] - first[key]
  return delta / hours
}

export function estimateExhaustion(
  velocity: number | null,
  currentRemaining: number | undefined,
  currentLimit: number | undefined,
  resetAt: number | undefined
): ExhaustionEstimate | null {
  if (velocity === null || velocity >= 0) return null
  if (typeof currentRemaining !== 'number' || typeof currentLimit !== 'number' || currentLimit === 0) return null
  const currentPct = (currentRemaining / currentLimit) * 100
  if (currentPct <= 0) {
    return { timeToExhaustionMs: 0, exhaustsBeforeReset: true }
  }
  // velocity is negative (percentage points per hour)
  const hoursToExhaust = currentPct / Math.abs(velocity)
  const msToExhaust = Math.round(hoursToExhaust * 60 * 60 * 1000)
  const exhaustsBeforeReset = typeof resetAt === 'number' && resetAt > 0
    ? Date.now() + msToExhaust <= resetAt
    : true
  return { timeToExhaustionMs: msToExhaust, exhaustsBeforeReset }
}

export function formatVelocity(velocity: number | null): string {
  if (velocity === null) return 'Insufficient history'
  const sign = velocity > 0 ? '+' : velocity < 0 ? '−' : ''
  const abs = Math.abs(velocity)
  return `${sign}${abs.toFixed(1).replace(/\.0$/, '')}%/h`
}

export function formatTimeToExhaustion(ms: number | null): string | null {
  if (ms === null) return null
  if (ms <= 0) return 'now'
  const totalMins = Math.floor(ms / 60000)
  const days = Math.floor(totalMins / (60 * 24))
  const hours = Math.floor((totalMins % (60 * 24)) / 60)
  const mins = totalMins % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export interface RechartsDataPoint {
  at: number
  pct: number
  label: string
}

export function toRechartsData(
  points: HistoryPoint[],
  type: 'fiveHour' | 'weekly'
): RechartsDataPoint[] {
  if (points.length === 0) return []
  const key = type === 'fiveHour' ? 'fiveHourPct' : 'weeklyPct'
  return points
    .map((p) => ({ at: p.at, val: p[key] }))
    .filter((p): p is { at: number; val: number } => p.val !== null)
    .map((p) => ({
      at: p.at,
      pct: p.val,
      label: new Date(p.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }))
}
