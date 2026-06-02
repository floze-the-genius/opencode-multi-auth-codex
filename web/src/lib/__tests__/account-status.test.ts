import { describe, test, expect } from 'vitest'
import { isAccountEnabled } from '../account-status'

describe('isAccountEnabled', () => {
  test('returns true when enabled is true', () => {
    expect(isAccountEnabled({ enabled: true })).toBe(true)
  })

  test('returns true when enabled is undefined (default active)', () => {
    expect(isAccountEnabled({ enabled: undefined })).toBe(true)
  })

  test('returns false only when enabled is explicitly false', () => {
    expect(isAccountEnabled({ enabled: false })).toBe(false)
  })
})
