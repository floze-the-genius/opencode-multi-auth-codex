import { loadStore, mutateStore } from './store.js'
import type { AccountStore } from './types.js'

export interface ForceState {
  forcedAlias: string | null
  forcedUntil: number | null
  previousRotationStrategy: string | null
  forcedBy: string | null
}

const FORCE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const ROTATION_STRATEGIES = new Set([
  'round-robin',
  'least-used',
  'random',
  'weighted-round-robin'
])

function isRotationStrategy(value: string | null | undefined): value is NonNullable<AccountStore['rotationStrategy']> {
  return typeof value === 'string' && ROTATION_STRATEGIES.has(value)
}

export function getForceState(): ForceState {
  const store = loadStore()
  return {
    forcedAlias: store.forcedAlias ?? null,
    forcedUntil: store.forcedUntil ?? null,
    previousRotationStrategy: store.previousRotationStrategy ?? null,
    forcedBy: store.forcedBy ?? null
  }
}

export function isForceActive(): boolean {
  const state = getForceState()
  if (!state.forcedAlias || !state.forcedUntil) {
    return false
  }
  
  const now = Date.now()
  if (now > state.forcedUntil) {
    return false
  }
  
  // Check if forced alias still exists and is eligible
  const store = loadStore()
  const forcedAccount = store.accounts[state.forcedAlias]
  if (!forcedAccount) {
    return false
  }
  
  // Check if account is disabled
  if (forcedAccount.enabled === false) {
    return false
  }
  
  return true
}

export function activateForce(
  alias: string,
  actor: string = 'system'
): { success: boolean; error?: string; state?: ForceState } {
  const now = Date.now()
  let result: { success: boolean; error?: string; state?: ForceState } = { success: false }

  mutateStore((currentStore) => {
    // Validate alias against the latest persisted state under lock.
    if (!currentStore.accounts[alias]) {
      result = { success: false, error: `Account '${alias}' not found` }
      return currentStore
    }

    if (currentStore.accounts[alias].enabled === false) {
      result = { success: false, error: `Account '${alias}' is disabled` }
      return currentStore
    }

    const keepExistingTtl =
      currentStore.forcedAlias === alias &&
      typeof currentStore.forcedUntil === 'number' &&
      currentStore.forcedUntil > now
    const forcedUntil = keepExistingTtl ? currentStore.forcedUntil! : now + FORCE_TTL_MS

    const currentStrategy =
      currentStore.settings?.rotationStrategy ||
      currentStore.rotationStrategy ||
      'round-robin'

    // Store previous rotation strategy if not already forcing.
    const previousStrategy = (currentStore.forcedAlias ? currentStore.previousRotationStrategy : currentStrategy) ?? null

    currentStore.forcedAlias = alias
    currentStore.forcedUntil = forcedUntil
    currentStore.previousRotationStrategy = previousStrategy
    currentStore.forcedBy = actor
    result = {
      success: true,
      state: {
        forcedAlias: alias,
        forcedUntil,
        previousRotationStrategy: previousStrategy,
        forcedBy: actor
      }
    }
    return currentStore
  })

  return result
}

export function clearForce(): { success: boolean; restoredStrategy?: string | null } {
  let result: { success: boolean; restoredStrategy?: string | null } = { success: true }

  mutateStore((currentStore) => {
    const restoredStrategy = currentStore.previousRotationStrategy
    const currentStrategy =
      currentStore.settings?.rotationStrategy ||
      currentStore.rotationStrategy ||
      'round-robin'
    const nextStrategy = isRotationStrategy(restoredStrategy)
      ? restoredStrategy
      : currentStrategy

    currentStore.forcedAlias = null
    currentStore.forcedUntil = null
    currentStore.rotationStrategy = nextStrategy
    currentStore.previousRotationStrategy = null
    currentStore.forcedBy = null

    if (currentStore.settings) {
      currentStore.settings = {
        ...currentStore.settings,
        rotationStrategy: nextStrategy
      }
    }
    result = {
      success: true,
      restoredStrategy
    }
    return currentStore
  })

  return result
}

export function checkAndAutoClearForce(): { wasCleared: boolean; reason?: string } {
  const state = getForceState()
  
  if (!state.forcedAlias) {
    return { wasCleared: false }
  }
  
  const store = loadStore()
  const now = Date.now()
  
  // Check expiry
  if (state.forcedUntil && now > state.forcedUntil) {
    clearForce()
    return { wasCleared: true, reason: 'expired' }
  }
  
  // Check if alias still exists
  if (!store.accounts[state.forcedAlias]) {
    clearForce()
    return { wasCleared: true, reason: 'account_removed' }
  }
  
  // Check if alias is disabled
  if (store.accounts[state.forcedAlias].enabled === false) {
    clearForce()
    return { wasCleared: true, reason: 'account_disabled' }
  }
  
  return { wasCleared: false }
}

export function getRemainingForceTimeMs(): number {
  const state = getForceState()
  if (!state.forcedUntil) {
    return 0
  }
  const remaining = state.forcedUntil - Date.now()
  return Math.max(0, remaining)
}

export function formatForceDuration(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000))
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}
