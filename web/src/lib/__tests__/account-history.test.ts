import { describe, test, expect } from 'vitest'
import {
  normalizeHistory,
  getSparklinePoints,
  getChartData,
  calculateVelocity,
  estimateExhaustion,
  formatVelocity,
  formatTimeToExhaustion,
  toRechartsData,
  type HistoryPoint
} from '../account-history'
import type { RateLimitHistoryEntry } from '../../types/api'

describe('normalizeHistory', () => {
  test('returns empty array for undefined history', () => {
    expect(normalizeHistory(undefined)).toEqual([])
  })

  test('returns empty array for empty history', () => {
    expect(normalizeHistory([])).toEqual([])
  })

  test('normalizes history entries with both windows', () => {
    const now = Date.now()
    const history: RateLimitHistoryEntry[] = [
      { at: now - 3600_000, fiveHour: { remaining: 80, limit: 100 }, weekly: { remaining: 700, limit: 1000 } },
      { at: now - 1800_000, fiveHour: { remaining: 60, limit: 100 }, weekly: { remaining: 650, limit: 1000 } },
      { at: now, fiveHour: { remaining: 40, limit: 100 }, weekly: { remaining: 600, limit: 1000 } }
    ]
    const result = normalizeHistory(history)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ at: now - 3600_000, fiveHourPct: 80, weeklyPct: 70 })
    expect(result[1]).toEqual({ at: now - 1800_000, fiveHourPct: 60, weeklyPct: 65 })
    expect(result[2]).toEqual({ at: now, fiveHourPct: 40, weeklyPct: 60 })
  })

  test('handles entries with missing fiveHour data', () => {
    const now = Date.now()
    const history: RateLimitHistoryEntry[] = [
      { at: now - 1800_000, weekly: { remaining: 700, limit: 1000 } },
      { at: now, fiveHour: { remaining: 40, limit: 100 }, weekly: { remaining: 600, limit: 1000 } }
    ]
    const result = normalizeHistory(history)
    expect(result[0]).toEqual({ at: now - 1800_000, fiveHourPct: null, weeklyPct: 70 })
    expect(result[1]).toEqual({ at: now, fiveHourPct: 40, weeklyPct: 60 })
  })

  test('returns null percentage for entries with zero limit defensively', () => {
    const now = Date.now()
    const history: RateLimitHistoryEntry[] = [
      { at: now - 1800_000, fiveHour: { remaining: 80, limit: 100 } },
      { at: now - 900_000, fiveHour: { remaining: 60, limit: 0 } },
      { at: now, fiveHour: { remaining: 40, limit: 100 } }
    ]
    const result = normalizeHistory(history)
    expect(result).toHaveLength(3)
    expect(result[0].fiveHourPct).toBe(80)
    expect(result[1].fiveHourPct).toBeNull()
    expect(result[2].fiveHourPct).toBe(40)
  })

  test('sorts by timestamp ascending', () => {
    const now = Date.now()
    const history: RateLimitHistoryEntry[] = [
      { at: now, fiveHour: { remaining: 40, limit: 100 } },
      { at: now - 3600_000, fiveHour: { remaining: 80, limit: 100 } }
    ]
    const result = normalizeHistory(history)
    expect(result[0].at).toBe(now - 3600_000)
    expect(result[1].at).toBe(now)
  })
})

describe('getSparklinePoints', () => {
  test('returns empty string for empty points', () => {
    expect(getSparklinePoints([], 'fiveHour')).toBe('')
  })

  test('returns SVG polyline points for fiveHour', () => {
    const points: HistoryPoint[] = [
      { at: 0, fiveHourPct: 100, weeklyPct: 80 },
      { at: 1, fiveHourPct: 80, weeklyPct: 70 },
      { at: 2, fiveHourPct: 60, weeklyPct: 60 },
      { at: 3, fiveHourPct: 40, weeklyPct: 50 }
    ]
    const svg = getSparklinePoints(points, 'fiveHour')
    // 4 points mapped to viewBox 0 0 100 30
    expect(svg).toContain('0.00,0.00')
    expect(svg).toContain('33.33')
    expect(svg).toContain('100.00,18.00')
  })

  test('returns SVG polyline points for weekly', () => {
    const points: HistoryPoint[] = [
      { at: 0, fiveHourPct: 100, weeklyPct: 80 },
      { at: 1, fiveHourPct: 80, weeklyPct: 70 },
      { at: 2, fiveHourPct: 60, weeklyPct: 60 }
    ]
    const svg = getSparklinePoints(points, 'weekly')
    expect(svg).toContain('0.00,6.00')
    expect(svg).toContain('100.00,12.00')
  })

  test('skips null values in the series', () => {
    const points: HistoryPoint[] = [
      { at: 0, fiveHourPct: 100, weeklyPct: null },
      { at: 1, fiveHourPct: null, weeklyPct: null },
      { at: 2, fiveHourPct: 60, weeklyPct: null }
    ]
    const svg = getSparklinePoints(points, 'fiveHour')
    expect(svg).toContain('0.00,0.00')
    expect(svg).toContain('100.00,12.00')
  })
})

describe('calculateVelocity', () => {
  test('returns null for fewer than 2 points', () => {
    expect(calculateVelocity([], 'fiveHour')).toBeNull()
    const one: HistoryPoint[] = [{ at: Date.now(), fiveHourPct: 80, weeklyPct: 70 }]
    expect(calculateVelocity(one, 'fiveHour')).toBeNull()
  })

  test('returns null when time span is less than 1 minute', () => {
    const now = Date.now()
    const points: HistoryPoint[] = [
      { at: now - 30_000, fiveHourPct: 80, weeklyPct: 70 },
      { at: now, fiveHourPct: 60, weeklyPct: 60 }
    ]
    expect(calculateVelocity(points, 'fiveHour')).toBeNull()
  })

  test('calculates negative velocity for consumption', () => {
    const now = Date.now()
    const points: HistoryPoint[] = [
      { at: now - 3600_000, fiveHourPct: 80, weeklyPct: 70 },
      { at: now, fiveHourPct: 60, weeklyPct: 60 }
    ]
    const velocity = calculateVelocity(points, 'fiveHour')
    // 20 percentage points consumed over 1 hour = -20 pp/hour
    expect(velocity).toBeCloseTo(-20, 0)
  })

  test('calculates positive velocity for replenishment', () => {
    const now = Date.now()
    const points: HistoryPoint[] = [
      { at: now - 3600_000, fiveHourPct: 60, weeklyPct: 70 },
      { at: now, fiveHourPct: 80, weeklyPct: 60 }
    ]
    const velocity = calculateVelocity(points, 'fiveHour')
    expect(velocity).toBeCloseTo(20, 0)
  })

  test('returns null when all values for window are null', () => {
    const now = Date.now()
    const points: HistoryPoint[] = [
      { at: now - 3600_000, fiveHourPct: null, weeklyPct: 70 },
      { at: now, fiveHourPct: null, weeklyPct: 60 }
    ]
    expect(calculateVelocity(points, 'fiveHour')).toBeNull()
  })
})

describe('estimateExhaustion', () => {
  test('returns null for null velocity', () => {
    expect(estimateExhaustion(null, 50, 100, Date.now() + 3600_000)).toBeNull()
  })

  test('returns null for positive velocity (replenishing)', () => {
    expect(estimateExhaustion(10, 50, 100, Date.now() + 3600_000)).toBeNull()
  })

  test('returns null for zero velocity', () => {
    expect(estimateExhaustion(0, 50, 100, Date.now() + 3600_000)).toBeNull()
  })

  test('estimates time to exhaustion from current remaining and velocity', () => {
    const resetAt = Date.now() + 7200_000
    // velocity = -20 pp/hour, current remaining = 40 out of 100 = 40%
    // time to exhaust 40% at 20%/hour = 2 hours = 7200000ms
    const result = estimateExhaustion(-20, 40, 100, resetAt)
    expect(result).not.toBeNull()
    expect(result!.timeToExhaustionMs).toBeCloseTo(7200_000, -3)
    expect(result!.exhaustsBeforeReset).toBe(true)
  })

  test('detects when reset happens before exhaustion', () => {
    const resetAt = Date.now() + 1800_000 // 30 min
    // velocity = -20 pp/hour, current = 40%
    // exhaust in 2 hours, reset in 30 min
    const result = estimateExhaustion(-20, 40, 100, resetAt)
    expect(result).not.toBeNull()
    expect(result!.exhaustsBeforeReset).toBe(false)
  })

  test('returns exhausted now when remaining is 0', () => {
    const resetAt = Date.now() + 3600_000
    const result = estimateExhaustion(-10, 0, 100, resetAt)
    expect(result).not.toBeNull()
    expect(result!.timeToExhaustionMs).toBe(0)
  })
})

describe('formatVelocity', () => {
  test('returns fallback for null', () => {
    expect(formatVelocity(null)).toBe('Insufficient history')
  })

  test('formats consumption velocity', () => {
    expect(formatVelocity(-20)).toBe('−20%/h')
  })

  test('formats replenishment velocity', () => {
    expect(formatVelocity(15)).toBe('+15%/h')
  })

  test('formats near-zero velocity', () => {
    expect(formatVelocity(-0.5)).toBe('−0.5%/h')
  })
})

describe('getChartData', () => {
  test('returns null for fewer than 2 valid points', () => {
    expect(getChartData([], 'fiveHour')).toBeNull()
    const one: HistoryPoint[] = [{ at: Date.now(), fiveHourPct: 80, weeklyPct: 70 }]
    expect(getChartData(one, 'fiveHour')).toBeNull()
  })

  test('returns structured chart data with coordinates for fiveHour', () => {
    const points: HistoryPoint[] = [
      { at: 0, fiveHourPct: 100, weeklyPct: 80 },
      { at: 1, fiveHourPct: 80, weeklyPct: 70 },
      { at: 2, fiveHourPct: 60, weeklyPct: 60 },
      { at: 3, fiveHourPct: 40, weeklyPct: 50 }
    ]
    const data = getChartData(points, 'fiveHour')
    expect(data).not.toBeNull()
    expect(data!.points).toHaveLength(4)
    expect(data!.points[0].x).toBe(0)
    expect(data!.points[0].y).toBe(0)
    expect(data!.points[0].pct).toBe(100)
    expect(data!.points[3].x).toBe(100)
    expect(data!.points[3].y).toBeCloseTo(18, 0) // 100 - 40 = 60% of 30 = 18
  })

  test('returns structured chart data with coordinates for weekly', () => {
    const points: HistoryPoint[] = [
      { at: 0, fiveHourPct: 100, weeklyPct: 80 },
      { at: 1, fiveHourPct: 80, weeklyPct: 70 },
      { at: 2, fiveHourPct: 60, weeklyPct: 60 }
    ]
    const data = getChartData(points, 'weekly')
    expect(data).not.toBeNull()
    expect(data!.points).toHaveLength(3)
    expect(data!.points[0].pct).toBe(80)
    expect(data!.points[2].pct).toBe(60)
  })

  test('skips null values and still produces valid data', () => {
    const points: HistoryPoint[] = [
      { at: 0, fiveHourPct: 100, weeklyPct: null },
      { at: 1, fiveHourPct: null, weeklyPct: null },
      { at: 2, fiveHourPct: 60, weeklyPct: null }
    ]
    const data = getChartData(points, 'fiveHour')
    expect(data).not.toBeNull()
    expect(data!.points).toHaveLength(2)
    expect(data!.points[0].pct).toBe(100)
    expect(data!.points[1].pct).toBe(60)
  })

  test('includes timestamps for each point', () => {
    const now = Date.now()
    const points: HistoryPoint[] = [
      { at: now - 3600_000, fiveHourPct: 80, weeklyPct: 70 },
      { at: now, fiveHourPct: 60, weeklyPct: 60 }
    ]
    const data = getChartData(points, 'fiveHour')
    expect(data).not.toBeNull()
    expect(data!.points[0].at).toBe(now - 3600_000)
    expect(data!.points[1].at).toBe(now)
  })
})

describe('formatTimeToExhaustion', () => {
  test('returns null for null input', () => {
    expect(formatTimeToExhaustion(null)).toBeNull()
  })

  test('formats hours and minutes', () => {
    expect(formatTimeToExhaustion(2 * 3600_000 + 30 * 60_000)).toBe('2h 30m')
  })

  test('formats minutes only', () => {
    expect(formatTimeToExhaustion(45 * 60_000)).toBe('45m')
  })

  test('formats days and hours', () => {
    expect(formatTimeToExhaustion(2 * 24 * 3600_000 + 5 * 3600_000)).toBe('2d 5h')
  })

  test('formats "now" for zero or negative', () => {
    expect(formatTimeToExhaustion(0)).toBe('now')
    expect(formatTimeToExhaustion(-1000)).toBe('now')
  })
})

describe('toRechartsData', () => {
  test('returns empty array for empty points', () => {
    expect(toRechartsData([], 'fiveHour')).toEqual([])
  })

  test('transforms fiveHour points into Recharts format', () => {
    const now = Date.now()
    const points: HistoryPoint[] = [
      { at: now - 3600_000, fiveHourPct: 80, weeklyPct: 70 },
      { at: now - 1800_000, fiveHourPct: 60, weeklyPct: 65 },
      { at: now, fiveHourPct: 40, weeklyPct: 60 }
    ]
    const result = toRechartsData(points, 'fiveHour')
    expect(result).toHaveLength(3)
    expect(result[0].pct).toBe(80)
    expect(result[1].pct).toBe(60)
    expect(result[2].pct).toBe(40)
    expect(result[0].at).toBe(now - 3600_000)
    expect(typeof result[0].label).toBe('string')
  })

  test('transforms weekly points into Recharts format', () => {
    const now = Date.now()
    const points: HistoryPoint[] = [
      { at: now - 3600_000, fiveHourPct: 80, weeklyPct: 70 },
      { at: now, fiveHourPct: 40, weeklyPct: 60 }
    ]
    const result = toRechartsData(points, 'weekly')
    expect(result).toHaveLength(2)
    expect(result[0].pct).toBe(70)
    expect(result[1].pct).toBe(60)
  })

  test('skips null values in the series', () => {
    const now = Date.now()
    const points: HistoryPoint[] = [
      { at: now - 3600_000, fiveHourPct: 80, weeklyPct: null },
      { at: now - 1800_000, fiveHourPct: null, weeklyPct: null },
      { at: now, fiveHourPct: 40, weeklyPct: null }
    ]
    const result = toRechartsData(points, 'fiveHour')
    expect(result).toHaveLength(2)
    expect(result[0].pct).toBe(80)
    expect(result[1].pct).toBe(40)
  })

  test('returns empty array when all values are null', () => {
    const now = Date.now()
    const points: HistoryPoint[] = [
      { at: now - 3600_000, fiveHourPct: null, weeklyPct: null },
      { at: now, fiveHourPct: null, weeklyPct: null }
    ]
    expect(toRechartsData(points, 'fiveHour')).toEqual([])
  })
})
