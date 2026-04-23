import { refreshRateLimitsForAccount, type LimitRefreshResult } from './limits-refresh.js'
import { updateAccount } from './store.js'
import { logInfo, logWarn } from './logger.js'
import type { AccountCredentials } from './types.js'

// Keep the default below Cloudflare's per-IP burst threshold for
// /backend-api/codex/usage. The env override still allows higher concurrency.
const DEFAULT_REFRESH_QUEUE_CONCURRENCY = 5
const MAX_REFRESH_QUEUE_CONCURRENCY = 20
const REFRESH_QUEUE_CONCURRENCY_ENV = 'OPENCODE_MULTI_AUTH_REFRESH_QUEUE_CONCURRENCY'

export interface RefreshQueueState {
  running: boolean
  startedAt: number
  finishedAt?: number
  total: number
  completed: number
  errors: number
  currentAlias?: string
  currentAliases: string[]
  active: number
  concurrency: number
  stopRequested: boolean
  stopped: boolean
  results: LimitRefreshResult[]
}

let queueState: RefreshQueueState | null = null
let stopRequested = false

export function getRefreshQueueState(): RefreshQueueState | null {
  return queueState
}

export function stopRefreshQueue(): void {
  stopRequested = true
  if (queueState) {
    queueState.stopRequested = true
  }
}

function resolveRefreshQueueConcurrency(targetCount: number): number {
  if (targetCount <= 1) {
    return targetCount
  }

  const raw = process.env[REFRESH_QUEUE_CONCURRENCY_ENV]
  const parsed = raw ? Number(raw) : DEFAULT_REFRESH_QUEUE_CONCURRENCY
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : DEFAULT_REFRESH_QUEUE_CONCURRENCY

  return Math.max(1, Math.min(targetCount, Math.min(normalized, MAX_REFRESH_QUEUE_CONCURRENCY)))
}

function syncActiveAliases(activeAliases: Set<string>): void {
  if (!queueState) return
  const currentAliases = Array.from(activeAliases.values())
  queueState.currentAliases = currentAliases
  queueState.active = currentAliases.length
  queueState.currentAlias = currentAliases[0]
}

async function runWorker(
  targets: AccountCredentials[],
  nextIndexRef: { value: number },
  activeAliases: Set<string>
): Promise<void> {
  for (;;) {
    if (!queueState || stopRequested) {
      return
    }

    const targetIndex = nextIndexRef.value
    nextIndexRef.value += 1
    if (targetIndex >= targets.length) {
      return
    }

    const account = targets[targetIndex]
    activeAliases.add(account.alias)
    syncActiveAliases(activeAliases)

    try {
      const result = await refreshRateLimitsForAccount(account)
      if (!queueState) {
        return
      }
      queueState.results.push(result)
      queueState.completed += 1
      if (result.error) {
        queueState.errors += 1
      }
    } finally {
      activeAliases.delete(account.alias)
      syncActiveAliases(activeAliases)
    }
  }
}

async function runQueue(targets: AccountCredentials[]): Promise<void> {
  if (!queueState) return

  const nextIndexRef = { value: 0 }
  const activeAliases = new Set<string>()
  const workers = Array.from({ length: queueState.concurrency }, () =>
    runWorker(targets, nextIndexRef, activeAliases)
  )

  await Promise.all(workers)

  if (queueState && stopRequested && nextIndexRef.value < targets.length) {
    for (let idx = nextIndexRef.value; idx < targets.length; idx += 1) {
      const account = targets[idx]
      updateAccount(account.alias, { limitStatus: 'stopped', limitError: 'Stopped by user' })
      queueState.results.push({ alias: account.alias, updated: false, error: 'Stopped' })
      queueState.completed += 1
    }
  }

  syncActiveAliases(activeAliases)
  queueState.running = false
  queueState.finishedAt = Date.now()
  queueState.stopped = stopRequested
  queueState.stopRequested = stopRequested
  if (stopRequested) {
    logWarn('Limit refresh queue stopped by user')
  } else {
    logInfo('Limit refresh queue completed')
  }
  stopRequested = false
}

export function startRefreshQueue(accounts: AccountCredentials[], alias?: string): RefreshQueueState {
  if (queueState?.running) {
    return queueState
  }

  const targets = alias ? accounts.filter((acc) => acc.alias === alias) : accounts
  const startedAt = Date.now()
  const concurrency = resolveRefreshQueueConcurrency(targets.length)

  queueState = {
    running: true,
    startedAt,
    total: targets.length,
    completed: 0,
    errors: 0,
    currentAliases: [],
    active: 0,
    concurrency,
    stopRequested: false,
    stopped: false,
    results: []
  }
  stopRequested = false

  if (targets.length === 0) {
    queueState.running = false
    queueState.finishedAt = Date.now()
    logWarn('Limit refresh queue requested with no targets')
    return queueState
  }

  for (const account of targets) {
    updateAccount(account.alias, { limitStatus: 'queued', limitError: undefined })
  }

  logInfo(`Limit refresh queue started (${targets.length} accounts, concurrency ${concurrency})`)
  void runQueue(targets)

  return queueState
}
