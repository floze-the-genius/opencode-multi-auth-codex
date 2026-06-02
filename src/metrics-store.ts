import fs from 'node:fs'
import * as path from 'node:path'
import { hasMeaningfulRateLimits } from './rate-limits.js'
import { getStorePath } from './store.js'
import type {
  AccountRateLimits,
  LimitStatus,
  LimitsConfidence,
  RateLimitHistoryEntry,
  RateLimitSnapshot,
  RateLimitWindow
} from './types.js'

const METRICS_SIDE_CAR_FILE = 'account-metrics.json'
const METRICS_SIDE_CAR_VERSION = 1

// Coalesce high-frequency request telemetry; hot paths must not write per call.
export const METRICS_FLUSH_DEBOUNCE_MS = 2_000
// Bound telemetry loss during long-running processes even when updates never go idle.
export const METRICS_PERIODIC_FLUSH_MS = 30_000
const METRICS_SIGNAL_FLUSH_TIMEOUT_MS = 1_500

export interface MetricsData {
  lastRefresh?: string
  lastSeenAt?: number
  lastActiveUntil?: number
  lastUsed?: number
  usageCount?: number
  rateLimits?: AccountRateLimits
  rateLimitHistory?: RateLimitHistoryEntry[]
  limitStatus?: LimitStatus
  limitError?: string
  lastLimitProbeAt?: number
  lastLimitErrorAt?: number
  limitsConfidence?: LimitsConfidence
}

interface MetricsSideCarFile {
  version: 1
  updatedAt: number
  metrics: Record<string, MetricsData>
}

const metricsCache = new Map<string, MetricsData>()
let loaded = false
let loadedPath: string | null = null
let dirty = false
let debounceTimer: NodeJS.Timeout | null = null
let periodicTimer: NodeJS.Timeout | null = null
let metricsFlushHooksRegistered = false

type MetricsFlushHookDeps = {
  flush?: () => Promise<void>
  flushSync?: () => void
  process?: NodeJS.Process
}

function getMetricsPath(): string {
  return path.join(path.dirname(getStorePath()), METRICS_SIDE_CAR_FILE)
}

export function getMetricsStorePath(): string {
  return getMetricsPath()
}

function cloneRateLimitWindow(window: RateLimitWindow | undefined): RateLimitWindow | undefined {
  if (!window) return undefined
  const next: RateLimitWindow = {}
  if (typeof window.limit === 'number') next.limit = window.limit
  if (typeof window.remaining === 'number') next.remaining = window.remaining
  if (typeof window.resetAt === 'number') next.resetAt = window.resetAt
  if (typeof window.updatedAt === 'number') next.updatedAt = window.updatedAt
  return Object.keys(next).length > 0 ? next : undefined
}

function cloneRateLimits(rateLimits: AccountRateLimits | undefined): AccountRateLimits | undefined {
  if (!hasMeaningfulRateLimits(rateLimits)) return undefined
  return {
    fiveHour: cloneRateLimitWindow(rateLimits?.fiveHour),
    weekly: cloneRateLimitWindow(rateLimits?.weekly)
  }
}

function cloneSnapshot(window: RateLimitSnapshot | undefined): RateLimitSnapshot | undefined {
  if (!window) return undefined
  const next: RateLimitSnapshot = {}
  if (typeof window.limit === 'number') next.limit = window.limit
  if (typeof window.remaining === 'number') next.remaining = window.remaining
  if (typeof window.resetAt === 'number') next.resetAt = window.resetAt
  return Object.keys(next).length > 0 ? next : undefined
}

function cloneHistoryEntry(entry: RateLimitHistoryEntry): RateLimitHistoryEntry {
  return {
    at: entry.at,
    fiveHour: cloneSnapshot(entry.fiveHour),
    weekly: cloneSnapshot(entry.weekly)
  }
}

function cloneMetricsData(data: MetricsData): MetricsData {
  return {
    ...data,
    rateLimits: cloneRateLimits(data.rateLimits),
    rateLimitHistory: data.rateLimitHistory?.map(cloneHistoryEntry)
  }
}

function isLimitStatus(value: unknown): value is LimitStatus {
  return (
    value === 'idle' ||
    value === 'queued' ||
    value === 'running' ||
    value === 'success' ||
    value === 'error' ||
    value === 'stopped'
  )
}

function isLimitsConfidence(value: unknown): value is LimitsConfidence {
  return value === 'fresh' || value === 'stale' || value === 'error' || value === 'unknown'
}

function sanitizeHistory(value: unknown): RateLimitHistoryEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries = value
    .map((raw): RateLimitHistoryEntry | null => {
      if (!raw || typeof raw !== 'object') return null
      const entry = raw as Record<string, unknown>
      const candidate: RateLimitHistoryEntry = {
        at: typeof entry.at === 'number' ? entry.at : Date.now(),
        fiveHour: cloneSnapshot(entry.fiveHour as RateLimitSnapshot | undefined),
        weekly: cloneSnapshot(entry.weekly as RateLimitSnapshot | undefined)
      }
      return hasMeaningfulRateLimits({ fiveHour: candidate.fiveHour, weekly: candidate.weekly }) ? candidate : null
    })
    .filter((entry): entry is RateLimitHistoryEntry => entry !== null)
  return entries.length > 0 ? entries.slice(Math.max(0, entries.length - 160)) : undefined
}

function sanitizeMetricsData(value: unknown): MetricsData | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const next: MetricsData = {}

  if (typeof raw.lastRefresh === 'string') next.lastRefresh = raw.lastRefresh
  if (typeof raw.lastSeenAt === 'number') next.lastSeenAt = raw.lastSeenAt
  if (typeof raw.lastActiveUntil === 'number') next.lastActiveUntil = raw.lastActiveUntil
  if (typeof raw.lastUsed === 'number') next.lastUsed = raw.lastUsed
  if (typeof raw.usageCount === 'number') next.usageCount = raw.usageCount
  const rateLimits = cloneRateLimits(raw.rateLimits as AccountRateLimits | undefined)
  if (rateLimits) next.rateLimits = rateLimits
  const history = sanitizeHistory(raw.rateLimitHistory)
  if (history) next.rateLimitHistory = history
  if (isLimitStatus(raw.limitStatus)) next.limitStatus = raw.limitStatus
  if (typeof raw.limitError === 'string') next.limitError = raw.limitError
  if (typeof raw.lastLimitProbeAt === 'number') next.lastLimitProbeAt = raw.lastLimitProbeAt
  if (typeof raw.lastLimitErrorAt === 'number') next.lastLimitErrorAt = raw.lastLimitErrorAt
  if (isLimitsConfidence(raw.limitsConfidence)) next.limitsConfidence = raw.limitsConfidence

  return Object.keys(next).length > 0 ? next : null
}

function sanitizeMetricsFile(value: unknown): Record<string, MetricsData> {
  if (!value || typeof value !== 'object') return {}
  const file = value as Record<string, unknown>
  const rawMetrics = file.metrics && typeof file.metrics === 'object'
    ? file.metrics as Record<string, unknown>
    : file
  const metrics: Record<string, MetricsData> = {}
  for (const [alias, raw] of Object.entries(rawMetrics)) {
    if (!alias.trim()) continue
    const sanitized = sanitizeMetricsData(raw)
    if (sanitized) metrics[alias] = sanitized
  }
  return metrics
}

export function ensureLoaded(): void {
  const file = getMetricsPath()
  if (loaded && loadedPath === file) return
  loaded = true
  loadedPath = file
  metricsCache.clear()

  if (!fs.existsSync(file)) return

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const [alias, metrics] of Object.entries(sanitizeMetricsFile(parsed))) {
      metricsCache.set(alias, metrics)
    }
  } catch (err) {
    console.warn('[multi-auth] Failed to load account metrics sidecar; starting with empty metrics:', err)
  }
}

export function loadAccountMetricsOnStartup(): Map<string, MetricsData> {
  ensureLoaded()
  return new Map(Array.from(metricsCache.entries(), ([alias, data]) => [alias, cloneMetricsData(data)]))
}

function buildSnapshot(window?: { remaining?: number; limit?: number; resetAt?: number }): RateLimitSnapshot | undefined {
  if (!window) return undefined
  return {
    remaining: window.remaining,
    limit: window.limit,
    resetAt: window.resetAt
  }
}

export function buildHistoryEntry(rateLimits?: AccountRateLimits): RateLimitHistoryEntry | null {
  if (!hasMeaningfulRateLimits(rateLimits)) return null
  const updatedAtValues = [rateLimits?.fiveHour?.updatedAt, rateLimits?.weekly?.updatedAt].filter(
    (value): value is number => typeof value === 'number'
  )
  const at = updatedAtValues.length > 0 ? Math.max(...updatedAtValues) : Date.now()
  return {
    at,
    fiveHour: buildSnapshot(rateLimits?.fiveHour),
    weekly: buildSnapshot(rateLimits?.weekly)
  }
}

export function appendHistory(
  history: RateLimitHistoryEntry[] | undefined,
  entry: RateLimitHistoryEntry
): RateLimitHistoryEntry[] {
  const next = history ? history.map(cloneHistoryEntry) : []
  const last = next[next.length - 1]
  const same =
    last &&
    last.fiveHour?.remaining === entry.fiveHour?.remaining &&
    last.weekly?.remaining === entry.weekly?.remaining &&
    last.fiveHour?.resetAt === entry.fiveHour?.resetAt &&
    last.weekly?.resetAt === entry.weekly?.resetAt
  if (!same) {
    next.push(cloneHistoryEntry(entry))
  }
  if (next.length > 160) {
    return next.slice(next.length - 160)
  }
  return next
}

function clearDebounceTimer(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

function clearPeriodicTimer(): void {
  if (periodicTimer) {
    clearTimeout(periodicTimer)
    periodicTimer = null
  }
}

function unrefTimer(timer: NodeJS.Timeout): void {
  if (typeof timer.unref === 'function') timer.unref()
}

function scheduleFlush(): void {
  clearDebounceTimer()
  debounceTimer = setTimeout(() => {
    void flush().catch((err) => {
      console.warn('[multi-auth] Failed to flush account metrics:', err)
    })
  }, METRICS_FLUSH_DEBOUNCE_MS)
  unrefTimer(debounceTimer)

  if (!periodicTimer) {
    periodicTimer = setTimeout(() => {
      void flush().catch((err) => {
        console.warn('[multi-auth] Failed to periodic-flush account metrics:', err)
      })
    }, METRICS_PERIODIC_FLUSH_MS)
    unrefTimer(periodicTimer)
  }
}

function markDirty(): void {
  dirty = true
  scheduleFlush()
}

function getWriteMetricsPath(): string {
  return loadedPath ?? getMetricsPath()
}

function ensureStoreDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
}

function writeMetricsFile(): void {
  const file = getWriteMetricsPath()
  ensureStoreDir(file)
  const payload: MetricsSideCarFile = {
    version: METRICS_SIDE_CAR_VERSION,
    updatedAt: Date.now(),
    metrics: Object.fromEntries(
      Array.from(metricsCache.entries()).map(([alias, data]) => [alias, cloneMetricsData(data)])
    )
  }
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 })
  try {
    fs.renameSync(tmp, file)
  } catch (err: any) {
    if (err?.code === 'EPERM' || err?.code === 'EEXIST') {
      try {
        fs.unlinkSync(file)
      } catch {
        // ignore
      }
      fs.renameSync(tmp, file)
    } else {
      try {
        fs.unlinkSync(tmp)
      } catch {
        // ignore
      }
      throw err
    }
  }
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // ignore chmod failures on platforms that do not support it
  }
}

export function getMetrics(alias: string): MetricsData | undefined {
  ensureLoaded()
  const data = metricsCache.get(alias)
  return data ? cloneMetricsData(data) : undefined
}

export function getAllMetrics(): Record<string, MetricsData> {
  ensureLoaded()
  return Object.fromEntries(
    Array.from(metricsCache.entries()).map(([alias, data]) => [alias, cloneMetricsData(data)])
  )
}

export function setMetrics(alias: string, partial: MetricsData): MetricsData {
  ensureLoaded()
  const current = metricsCache.get(alias) ?? {}
  const next: MetricsData = {
    ...current,
    ...partial,
    rateLimits: partial.rateLimits !== undefined ? cloneRateLimits(partial.rateLimits) : cloneRateLimits(current.rateLimits),
    rateLimitHistory: partial.rateLimitHistory !== undefined
      ? partial.rateLimitHistory.map(cloneHistoryEntry).slice(Math.max(0, partial.rateLimitHistory.length - 160))
      : current.rateLimitHistory?.map(cloneHistoryEntry)
  }

  if (partial.rateLimits !== undefined) {
    const entry = buildHistoryEntry(next.rateLimits)
    if (entry) {
      next.rateLimitHistory = appendHistory(current.rateLimitHistory, entry)
    }
  }

  metricsCache.set(alias, next)
  markDirty()
  return cloneMetricsData(next)
}

function preferExistingNumber(existing: number | undefined, incoming: number | undefined): number | undefined {
  return typeof existing === 'number' ? existing : incoming
}

function maxNumber(existing: number | undefined, incoming: number | undefined): number | undefined {
  if (typeof existing === 'number' && typeof incoming === 'number') return Math.max(existing, incoming)
  return preferExistingNumber(existing, incoming)
}

function preferExistingString(existing: string | undefined, incoming: string | undefined): string | undefined {
  return typeof existing === 'string' ? existing : incoming
}

function mergeHistoryForMigration(
  existing: RateLimitHistoryEntry[] | undefined,
  incoming: RateLimitHistoryEntry[] | undefined,
  rateLimits: AccountRateLimits | undefined
): RateLimitHistoryEntry[] | undefined {
  const entries = [...(existing ?? []), ...(incoming ?? [])]
    .map(cloneHistoryEntry)
    .sort((a, b) => a.at - b.at)
  let merged: RateLimitHistoryEntry[] | undefined
  for (const entry of entries) {
    merged = appendHistory(merged, entry)
  }

  const derived = buildHistoryEntry(rateLimits)
  if (derived) {
    merged = appendHistory(merged, derived)
  }
  return merged && merged.length > 0 ? merged : undefined
}

function setIfDefined<K extends keyof MetricsData>(target: MetricsData, key: K, value: MetricsData[K]): void {
  if (value !== undefined) target[key] = value
}

export function mergeMetricsForMigration(alias: string, incoming: MetricsData): MetricsData {
  ensureLoaded()
  const current = metricsCache.get(alias) ?? {}
  const rateLimits = current.rateLimits ?? incoming.rateLimits
  const next: MetricsData = {}

  setIfDefined(next, 'lastRefresh', preferExistingString(current.lastRefresh, incoming.lastRefresh))
  setIfDefined(next, 'lastSeenAt', maxNumber(current.lastSeenAt, incoming.lastSeenAt))
  setIfDefined(next, 'lastActiveUntil', maxNumber(current.lastActiveUntil, incoming.lastActiveUntil))
  setIfDefined(next, 'lastUsed', maxNumber(current.lastUsed, incoming.lastUsed))
  setIfDefined(next, 'usageCount', preferExistingNumber(current.usageCount, incoming.usageCount))
  setIfDefined(next, 'rateLimits', rateLimits ? cloneRateLimits(rateLimits) : undefined)
  setIfDefined(
    next,
    'rateLimitHistory',
    mergeHistoryForMigration(current.rateLimitHistory, incoming.rateLimitHistory, rateLimits)
  )
  setIfDefined(next, 'limitStatus', current.limitStatus ?? incoming.limitStatus)
  setIfDefined(next, 'limitError', preferExistingString(current.limitError, incoming.limitError))
  setIfDefined(next, 'lastLimitProbeAt', maxNumber(current.lastLimitProbeAt, incoming.lastLimitProbeAt))
  setIfDefined(next, 'lastLimitErrorAt', maxNumber(current.lastLimitErrorAt, incoming.lastLimitErrorAt))
  setIfDefined(next, 'limitsConfidence', current.limitsConfidence ?? incoming.limitsConfidence)

  if (Object.keys(next).length > 0) {
    metricsCache.set(alias, next)
    markDirty()
  }
  return cloneMetricsData(next)
}

export function updateRateLimits(alias: string, rateLimits: AccountRateLimits): MetricsData {
  return setMetrics(alias, { rateLimits })
}

export function removeMetrics(alias: string): void {
  ensureLoaded()
  if (metricsCache.delete(alias)) {
    markDirty()
  }
}

export async function flush(): Promise<void> {
  flushSync()
}

export function flushSync(force = false): void {
  if (!loaded) {
    if (force) ensureLoaded()
    else return
  } else if (force && !dirty && loadedPath !== getMetricsPath()) {
    ensureLoaded()
  }
  if (!loaded || (!dirty && !force)) return
  clearDebounceTimer()
  clearPeriodicTimer()
  writeMetricsFile()
  dirty = false
}

export function registerMetricsFlushHooks(deps: MetricsFlushHookDeps = {}): void {
  if (metricsFlushHooksRegistered) return
  metricsFlushHooksRegistered = true

  const targetProcess = deps.process ?? process
  const asyncFlush = deps.flush ?? flush
  const syncFlush = deps.flushSync ?? (() => flushSync())

  const runBestEffortFlush = async (): Promise<void> => {
    try {
      await asyncFlush()
    } catch (err) {
      void err
      console.warn('[multi-auth] Failed to flush account metrics during shutdown')
    }
  }

  const handleSignal = (signal: NodeJS.Signals, listener: () => void): void => {
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      try {
        targetProcess.removeListener(signal, listener)
        targetProcess.kill(targetProcess.pid, signal)
      } catch (err) {
        void err
        console.warn(`[multi-auth] Failed to re-raise ${signal} after metrics flush`)
      }
    }
    const timeout = setTimeout(finish, METRICS_SIGNAL_FLUSH_TIMEOUT_MS)
    unrefTimer(timeout)
    void runBestEffortFlush().finally(() => {
      clearTimeout(timeout)
      finish()
    })
  }
  const handleSigint = (): void => handleSignal('SIGINT', handleSigint)
  const handleSigterm = (): void => handleSignal('SIGTERM', handleSigterm)

  targetProcess.on('beforeExit', () => {
    void runBestEffortFlush()
  })
  targetProcess.on('SIGINT', handleSigint)
  targetProcess.on('SIGTERM', handleSigterm)
  targetProcess.on('exit', () => {
    try {
      syncFlush()
    } catch (err) {
      void err
      console.warn('[multi-auth] Failed to synchronously flush account metrics during exit')
    }
  })
}
