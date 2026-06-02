import { describe, test, expect } from 'vitest'
import { inferLogSeverity } from '../log-severity'

describe('inferLogSeverity', () => {
  test('infers error from "error" in message', () => {
    expect(inferLogSeverity('Something went wrong: error')).toBe('error')
  })

  test('infers error from "failed"', () => {
    expect(inferLogSeverity('Request failed')).toBe('error')
  })

  test('infers error from "timeout"', () => {
    expect(inferLogSeverity('Connection timeout')).toBe('error')
  })

  test('infers error from "rate limit exceeded"', () => {
    expect(inferLogSeverity('rate limit exceeded for account alpha')).toBe('error')
  })

  test('infers warn from "stale"', () => {
    expect(inferLogSeverity('Limits data is stale')).toBe('warn')
  })

  test('infers warn from "retry"', () => {
    expect(inferLogSeverity('Retrying request')).toBe('warn')
  })

  test('infers debug from "probe"', () => {
    expect(inferLogSeverity('Probing limits for alpha')).toBe('debug')
  })

  test('defaults to info for neutral messages', () => {
    expect(inferLogSeverity('Account switched to alpha')).toBe('info')
  })

  test('defaults to info for empty string', () => {
    expect(inferLogSeverity('')).toBe('info')
  })
})
