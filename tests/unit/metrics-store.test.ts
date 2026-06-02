// @ts-ignore - ESM Jest globals are available at runtime in the test environment.
import { jest } from '@jest/globals'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const require = createRequire(import.meta.url)
const fsForSpies = require('node:fs') as typeof import('node:fs')

const originalEnv = process.env

async function importMetricsStore() {
  return import('../../src/metrics-store.js')
}

describe('account metrics sidecar store', () => {
  let testDir: string
  let testStoreFile: string

  beforeEach(() => {
    jest.resetModules()
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-metrics-store-'))
    testStoreFile = path.join(testDir, 'accounts.json')
    process.env = {
      ...originalEnv,
      OPENCODE_MULTI_AUTH_STORE_DIR: testDir,
      OPENCODE_MULTI_AUTH_STORE_FILE: testStoreFile
    }
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    process.env = originalEnv
    fs.rmSync(testDir, { recursive: true, force: true })
    jest.resetModules()
  })

  it('resolves account-metrics.json beside the active accounts.json path', async () => {
    const nestedDir = path.join(testDir, 'nested-store')
    process.env.OPENCODE_MULTI_AUTH_STORE_FILE = path.join(nestedDir, 'accounts.override.json')
    const metricsStore = await importMetricsStore()

    expect(metricsStore.getMetricsStorePath()).toBe(path.join(nestedDir, 'account-metrics.json'))
  })

  it('lazily loads sidecar metrics once and serves later reads from the cache', async () => {
    const metricsPath = path.join(testDir, 'account-metrics.json')
    fs.writeFileSync(
      metricsPath,
      JSON.stringify({
        version: 1,
        updatedAt: 1_700_000_000_000,
        metrics: {
          alpha: { usageCount: 12, lastUsed: 1_700_000_001_000 },
          beta: { usageCount: 2, lastLimitErrorAt: 1_700_000_002_000 }
        }
      }),
      'utf8'
    )
    const metricsStore = await importMetricsStore()
    const readSpy = jest.spyOn(fsForSpies, 'readFileSync')

    expect(metricsStore.getMetrics('alpha')).toEqual({ usageCount: 12, lastUsed: 1_700_000_001_000 })
    expect(metricsStore.getMetrics('beta')).toEqual({ usageCount: 2, lastLimitErrorAt: 1_700_000_002_000 })
    expect(readSpy).toHaveBeenCalledTimes(1)
  })

  it('stores only the metrics fields for each alias and flushes them to the sidecar', async () => {
    const metricsStore = await importMetricsStore()

    metricsStore.setMetrics('alpha', {
      lastRefresh: '2026-01-01T00:00:00.000Z',
      lastSeenAt: 1,
      lastActiveUntil: 2,
      lastUsed: 3,
      usageCount: 4,
      rateLimits: { fiveHour: { remaining: 40, limit: 100, resetAt: 10, updatedAt: 11 } },
      limitStatus: 'success',
      limitError: 'soft limit',
      lastLimitProbeAt: 12,
      lastLimitErrorAt: 13,
      limitsConfidence: 'fresh'
    })

    await metricsStore.flush()
    const persisted = JSON.parse(fs.readFileSync(path.join(testDir, 'account-metrics.json'), 'utf8'))

    expect(persisted).toEqual({
      version: 1,
      updatedAt: expect.any(Number),
      metrics: {
        alpha: expect.objectContaining({
          lastRefresh: '2026-01-01T00:00:00.000Z',
          lastSeenAt: 1,
          lastActiveUntil: 2,
          lastUsed: 3,
          usageCount: 4,
          rateLimits: { fiveHour: { remaining: 40, limit: 100, resetAt: 10, updatedAt: 11 } },
          limitStatus: 'success',
          limitError: 'soft limit',
          lastLimitProbeAt: 12,
          lastLimitErrorAt: 13,
          limitsConfidence: 'fresh'
        })
      }
    })
    expect(persisted.metrics.alpha.rateLimitHistory).toHaveLength(1)
  })

  it('coalesces rapid set calls instead of writing on the hot path, while flush persists synchronously', async () => {
    jest.useFakeTimers()
    const metricsStore = await importMetricsStore()
    const writeSpy = jest.spyOn(fsForSpies, 'writeFileSync')

    for (let i = 0; i < 25; i++) {
      metricsStore.setMetrics('alpha', { usageCount: i })
    }

    expect(writeSpy).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(testDir, 'account-metrics.json'))).toBe(false)

    await metricsStore.flush()

    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fs.readFileSync(path.join(testDir, 'account-metrics.json'), 'utf8')).metrics.alpha.usageCount).toBe(24)
  })

  it('flushes pending debounced writes to the sidecar path captured before env restoration', async () => {
    jest.useFakeTimers()
    const metricsStore = await importMetricsStore()
    const restoredDir = path.join(testDir, 'restored-store')
    const restoredMetricsPath = path.join(restoredDir, 'account-metrics.json')

    metricsStore.setMetrics('test-alias', { usageCount: 123, limitStatus: 'success' })
    process.env = {
      ...originalEnv,
      OPENCODE_MULTI_AUTH_STORE_DIR: restoredDir,
      OPENCODE_MULTI_AUTH_STORE_FILE: path.join(restoredDir, 'accounts.json')
    }

    metricsStore.flushSync(true)
    await jest.advanceTimersByTimeAsync(metricsStore.METRICS_FLUSH_DEBOUNCE_MS)

    expect(fs.existsSync(restoredMetricsPath)).toBe(false)
    expect(JSON.parse(fs.readFileSync(path.join(testDir, 'account-metrics.json'), 'utf8')).metrics['test-alias']).toEqual(
      expect.objectContaining({ usageCount: 123, limitStatus: 'success' })
    )
  })

  it('derives rate-limit history with existing dedup semantics and caps history at 160 entries', async () => {
    const metricsStore = await importMetricsStore()

    metricsStore.updateRateLimits('alpha', {
      fiveHour: { remaining: 10, limit: 100, resetAt: 1_700_000_000_000, updatedAt: 1_700_000_000_100 }
    })
    metricsStore.updateRateLimits('alpha', {
      fiveHour: { remaining: 10, limit: 100, resetAt: 1_700_000_000_000, updatedAt: 1_700_000_000_200 }
    })
    expect(metricsStore.getMetrics('alpha')?.rateLimitHistory).toHaveLength(1)

    for (let i = 0; i < 170; i++) {
      metricsStore.updateRateLimits('alpha', {
        fiveHour: { remaining: i, limit: 100, resetAt: 1_700_000_001_000 + i, updatedAt: 1_700_000_002_000 + i }
      })
    }

    const history = metricsStore.getMetrics('alpha')?.rateLimitHistory ?? []
    expect(history).toHaveLength(160)
    expect(history[0].fiveHour?.remaining).toBe(10)
    expect(history[history.length - 1].fiveHour?.remaining).toBe(169)
  })

  it('registers shutdown flush hooks once and routes async/sync flushes to the right events', async () => {
    const metricsStore = await importMetricsStore()
    const handlers = new Map<string | symbol, (...args: any[]) => any>()
    const processOnSpy = jest.spyOn(process, 'on').mockImplementation(((event: string | symbol, listener: (...args: any[]) => any) => {
      handlers.set(event, listener)
      return process
    }) as typeof process.on)
    const flushSpy = jest.fn(async () => {})
    const flushSyncSpy = jest.fn(() => {})
    const killSpy = jest.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill)

    ;(metricsStore as any).registerMetricsFlushHooks({ flush: flushSpy, flushSync: flushSyncSpy })
    ;(metricsStore as any).registerMetricsFlushHooks({ flush: flushSpy, flushSync: flushSyncSpy })

    expect(processOnSpy.mock.calls.map((call: any[]) => call[0])).toEqual(['beforeExit', 'SIGINT', 'SIGTERM', 'exit'])

    await handlers.get('beforeExit')?.()
    await handlers.get('SIGINT')?.()
    await handlers.get('SIGTERM')?.()
    await Promise.resolve()
    await Promise.resolve()
    handlers.get('exit')?.()

    expect(flushSpy).toHaveBeenCalledTimes(3)
    expect(flushSyncSpy).toHaveBeenCalledTimes(1)
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGINT')
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM')
  })
})
