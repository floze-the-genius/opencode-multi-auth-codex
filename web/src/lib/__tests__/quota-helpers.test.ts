import { describe, test, expect } from 'vitest'
import { quotaPercent, quotaSeverity, formatQuotaLabel } from '../quota-helpers'

describe('quotaPercent', () => {
  test('returns 100 when limit is 0', () => {
    expect(quotaPercent(5, 0)).toBe(100)
  })

  test('returns 0 when remaining is undefined', () => {
    expect(quotaPercent(undefined, 100)).toBe(0)
  })

  test('returns 0 when limit is undefined', () => {
    expect(quotaPercent(50, undefined)).toBe(100)
  })

  test('calculates correct percentage', () => {
    expect(quotaPercent(25, 100)).toBe(25)
  })

  test('caps at 100', () => {
    expect(quotaPercent(150, 100)).toBe(100)
  })

  test('floors at 0', () => {
    expect(quotaPercent(-10, 100)).toBe(0)
  })
})

describe('quotaSeverity', () => {
  test('returns critical at 10%', () => {
    expect(quotaSeverity(10)).toBe('critical')
  })

  test('returns critical below 10%', () => {
    expect(quotaSeverity(5)).toBe('critical')
  })

  test('returns low at 30%', () => {
    expect(quotaSeverity(30)).toBe('low')
  })

  test('returns low between 10% and 30%', () => {
    expect(quotaSeverity(20)).toBe('low')
  })

  test('returns ok above 30%', () => {
    expect(quotaSeverity(31)).toBe('ok')
  })
})

describe('formatQuotaLabel', () => {
  test('returns dash when both undefined', () => {
    expect(formatQuotaLabel(undefined, undefined)).toBe('— / —')
  })

  test('returns dash when remaining undefined', () => {
    expect(formatQuotaLabel(undefined, 100)).toBe('— / —')
  })

  test('formats values when present', () => {
    expect(formatQuotaLabel(80, 100)).toBe('80 / 100')
  })
})
