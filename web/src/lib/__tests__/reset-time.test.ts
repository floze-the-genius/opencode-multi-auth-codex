import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatResetTime, formatResetTimeCompact } from '../reset-time'

describe('formatResetTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns fallback when resetAt is undefined', () => {
    expect(formatResetTime(undefined)).toBe('Reset unavailable')
  })

  test('returns fallback when resetAt is not a number', () => {
    expect(formatResetTime(NaN)).toBe('Reset unavailable')
  })

  test('shows relative time and exact date for future reset', () => {
    // 2h 30m in the future
    const resetAt = Date.now() + 2 * 60 * 60 * 1000 + 30 * 60 * 1000
    const result = formatResetTime(resetAt)
    expect(result).toMatch(/^in 2h 30m ·/)
  })

  test('shows days when reset is more than 24h away', () => {
    const resetAt = Date.now() + 3 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000
    const result = formatResetTime(resetAt)
    expect(result).toMatch(/^in 3d 5h ·/)
  })

  test('shows minutes only for short resets', () => {
    const resetAt = Date.now() + 45 * 60 * 1000
    const result = formatResetTime(resetAt)
    expect(result).toMatch(/^in 45m ·/)
  })

  test('returns "Resets now" when resetAt is in the past', () => {
    const resetAt = Date.now() - 60 * 1000
    expect(formatResetTime(resetAt)).toBe('Resets now')
  })
})

describe('formatResetTimeCompact', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns dash when resetAt is undefined', () => {
    expect(formatResetTimeCompact(undefined)).toBe('—')
  })

  test('returns compact hours and minutes', () => {
    const resetAt = Date.now() + 2 * 60 * 60 * 1000 + 15 * 60 * 1000
    expect(formatResetTimeCompact(resetAt)).toBe('2h 15m')
  })

  test('returns compact days and hours', () => {
    const resetAt = Date.now() + 2 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000
    expect(formatResetTimeCompact(resetAt)).toBe('2d 4h')
  })

  test('returns minutes only for short resets', () => {
    const resetAt = Date.now() + 25 * 60 * 1000
    expect(formatResetTimeCompact(resetAt)).toBe('25m')
  })
})
