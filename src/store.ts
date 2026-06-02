import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'node:crypto'
import { hasMeaningfulRateLimits } from './rate-limits.js'
import {
  flushSync as flushMetricsSync,
  getMetrics,
  getMetricsStorePath,
  mergeMetricsForMigration,
  removeMetrics,
  setMetrics
} from './metrics-store.js'
import type { MetricsData } from './metrics-store.js'
import type {
  AccountStore,
  AccountCredentials,
  RateLimitHistoryEntry,
  RateLimitSnapshot
} from './types.js'

const STORE_DIR_ENV = 'OPENCODE_MULTI_AUTH_STORE_DIR'
const STORE_FILE_ENV = 'OPENCODE_MULTI_AUTH_STORE_FILE'
const DEFAULT_STORE_DIR = path.join(os.homedir(), '.config', 'opencode-multi-auth')
const DEFAULT_STORE_FILE = 'accounts.json'

function getStoreDir(): string {
  const override = process.env[STORE_DIR_ENV]
  if (override && override.trim()) return path.resolve(override.trim())
  return DEFAULT_STORE_DIR
}

function getStoreFile(): string {
  const override = process.env[STORE_FILE_ENV]
  if (override && override.trim()) return path.resolve(override.trim())
  return path.join(getStoreDir(), DEFAULT_STORE_FILE)
}

const STORE_ENV_PASSPHRASE = 'CODEX_SOFT_STORE_PASSPHRASE'
const CURRENT_STORE_VERSION = 3

const ACCOUNT_METRIC_FIELDS = [
  'lastRefresh',
  'lastSeenAt',
  'lastActiveUntil',
  'lastUsed',
  'usageCount',
  'rateLimits',
  'rateLimitHistory',
  'limitStatus',
  'limitError',
  'lastLimitProbeAt',
  'lastLimitErrorAt',
  'limitsConfidence'
] as const

const ACCOUNT_METRIC_FIELD_SET = new Set<string>(ACCOUNT_METRIC_FIELDS)

type EncryptedStoreFile = {
  encrypted: true
  version: number
  salt: string
  iv: string
  tag: string
  data: string
}

type StoreFileV1 = {
  accounts: Record<string, AccountCredentials>
  activeAlias: string | null
  rotationIndex: number
  lastRotation: number
}

type StoreFileV2 = StoreFileV1 & {
  version: 2
  settings?: {
    rotationStrategy?: 'round-robin' | 'least-used' | 'random' | 'weighted-round-robin'
  }
  force?: {
    forcedAlias: string | null
    forcedUntil: number | null
    previousRotationStrategy: string | null
    forcedBy: string | null
  }
}

type StoreFileV3 = Omit<StoreFileV2, 'version'> & {
  version: 3
}

type AnyStoreFile = StoreFileV1 | StoreFileV2 | StoreFileV3

let storeLocked = false
let lastStoreError: string | null = null
let lastStoreEncrypted = false
let writeLock = false
let writeLockQueue: Array<() => void> = []
let storeSavedDuringMigration = false

function ensureDir(): void {
  const dir = getStoreDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

function emptyStore(): AccountStore {
  return {
    version: CURRENT_STORE_VERSION,
    accounts: {},
    activeAlias: null,
    rotationIndex: 0,
    lastRotation: Date.now()
  }
}

function getPassphrase(): string | null {
  const value = process.env[STORE_ENV_PASSPHRASE]
  return value && value.trim().length > 0 ? value : null
}

function isEncryptedFile(payload: any): payload is EncryptedStoreFile {
  return Boolean(payload && payload.encrypted === true && typeof payload.data === 'string')
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32)
}

function encryptStore(store: AccountStore, passphrase: string): EncryptedStoreFile {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = deriveKey(passphrase, salt)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const serialized = JSON.stringify(store)
  const encrypted = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    encrypted: true,
    version: CURRENT_STORE_VERSION,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  }
}

function decryptStore(file: EncryptedStoreFile, passphrase: string): AccountStore {
  const salt = Buffer.from(file.salt, 'base64')
  const iv = Buffer.from(file.iv, 'base64')
  const tag = Buffer.from(file.tag, 'base64')
  const data = Buffer.from(file.data, 'base64')
  const key = deriveKey(passphrase, salt)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  return JSON.parse(decrypted) as AccountStore
}

function validateAccount(acc: any, alias: string): AccountCredentials | null {
  if (!acc || typeof acc !== 'object') return null
  if (typeof acc.accessToken !== 'string' || !acc.accessToken) return null
  if (typeof acc.refreshToken !== 'string' || !acc.refreshToken) return null
  if (typeof acc.expiresAt !== 'number') return null

  const rateLimitHistory = Array.isArray(acc.rateLimitHistory)
    ? acc.rateLimitHistory.filter((entry: any) =>
        hasMeaningfulRateLimits({ fiveHour: entry?.fiveHour, weekly: entry?.weekly })
      )
    : undefined
  const rateLimits = hasMeaningfulRateLimits(acc.rateLimits) ? acc.rateLimits : undefined

  return {
    alias,
    accessToken: acc.accessToken,
    refreshToken: acc.refreshToken,
    idToken: typeof acc.idToken === 'string' ? acc.idToken : undefined,
    accountId: typeof acc.accountId === 'string' ? acc.accountId : undefined,
    accountUserId: typeof acc.accountUserId === 'string' ? acc.accountUserId : undefined,
    userId: typeof acc.userId === 'string' ? acc.userId : undefined,
    planType: typeof acc.planType === 'string' ? acc.planType : undefined,
    expiresAt: acc.expiresAt,
    email: typeof acc.email === 'string' ? acc.email : undefined,
    lastRefresh: typeof acc.lastRefresh === 'string' ? acc.lastRefresh : undefined,
    lastSeenAt: typeof acc.lastSeenAt === 'number' ? acc.lastSeenAt : undefined,
    lastActiveUntil: typeof acc.lastActiveUntil === 'number' ? acc.lastActiveUntil : undefined,
    lastUsed: typeof acc.lastUsed === 'number' ? acc.lastUsed : undefined,
    usageCount: typeof acc.usageCount === 'number' ? acc.usageCount : 0,
    rateLimitedUntil: typeof acc.rateLimitedUntil === 'number' ? acc.rateLimitedUntil : undefined,
    modelUnsupportedUntil: typeof acc.modelUnsupportedUntil === 'number' ? acc.modelUnsupportedUntil : undefined,
    modelUnsupportedAt: typeof acc.modelUnsupportedAt === 'number' ? acc.modelUnsupportedAt : undefined,
    modelUnsupportedModel: typeof acc.modelUnsupportedModel === 'string' ? acc.modelUnsupportedModel : undefined,
    modelUnsupportedError: typeof acc.modelUnsupportedError === 'string' ? acc.modelUnsupportedError : undefined,
    workspaceDeactivatedUntil: typeof acc.workspaceDeactivatedUntil === 'number' ? acc.workspaceDeactivatedUntil : undefined,
    workspaceDeactivatedAt: typeof acc.workspaceDeactivatedAt === 'number' ? acc.workspaceDeactivatedAt : undefined,
    workspaceDeactivatedError: typeof acc.workspaceDeactivatedError === 'string' ? acc.workspaceDeactivatedError : undefined,
    authInvalid: typeof acc.authInvalid === 'boolean' ? acc.authInvalid : undefined,
    authInvalidatedAt: typeof acc.authInvalidatedAt === 'number' ? acc.authInvalidatedAt : undefined,
    // Phase D: Account availability fields
    enabled: typeof acc.enabled === 'boolean' ? acc.enabled : undefined,
    disabledAt: typeof acc.disabledAt === 'number' ? acc.disabledAt : undefined,
    disabledBy: typeof acc.disabledBy === 'string' ? acc.disabledBy : undefined,
    disableReason: typeof acc.disableReason === 'string' ? acc.disableReason : undefined,
    rateLimits,
    rateLimitHistory: rateLimitHistory && rateLimitHistory.length > 0 ? rateLimitHistory : undefined,
    limitStatus: typeof acc.limitStatus === 'string' ? acc.limitStatus : undefined,
    limitError: typeof acc.limitError === 'string' ? acc.limitError : undefined,
    lastLimitProbeAt: typeof acc.lastLimitProbeAt === 'number' ? acc.lastLimitProbeAt : undefined,
    lastLimitErrorAt: typeof acc.lastLimitErrorAt === 'number' ? acc.lastLimitErrorAt : undefined,
    limitsConfidence:
      acc.limitsConfidence === 'fresh' ||
      acc.limitsConfidence === 'stale' ||
      acc.limitsConfidence === 'error' ||
      acc.limitsConfidence === 'unknown'
        ? acc.limitsConfidence
        : undefined,
    tags: Array.isArray(acc.tags) ? acc.tags : undefined,
    notes: typeof acc.notes === 'string' ? acc.notes : undefined,
    source: acc.source === 'opencode' || acc.source === 'codex' ? acc.source : undefined
  }
}

function validateStore(data: any): AccountStore | null {
  if (!data || typeof data !== 'object') return null
  
  const accounts: Record<string, AccountCredentials> = {}
  const rawAccounts = data.accounts
  if (rawAccounts && typeof rawAccounts === 'object') {
    for (const [alias, acc] of Object.entries(rawAccounts)) {
      const validated = validateAccount(acc, alias)
      if (validated) {
        accounts[alias] = validated
      }
    }
  }
  
  return {
    version: typeof data.version === 'number' ? data.version : undefined,
    accounts,
    activeAlias: typeof data.activeAlias === 'string' ? data.activeAlias : null,
    rotationIndex: typeof data.rotationIndex === 'number' ? data.rotationIndex : 0,
    lastRotation: typeof data.lastRotation === 'number' ? data.lastRotation : Date.now(),
    // Phase E: Preserve force mode fields
    forcedAlias: data.forcedAlias ?? null,
    forcedUntil: data.forcedUntil ?? null,
    previousRotationStrategy: data.previousRotationStrategy ?? null,
    forcedBy: data.forcedBy ?? null,
    // Phase F: Preserve rotation strategy and settings
    rotationStrategy: data.rotationStrategy ?? 'round-robin',
    settings: data.settings ?? undefined,
    stickySessions: data.stickySessions ?? undefined
  }
}

function migrateV1toV2(data: StoreFileV1): StoreFileV2 {
  return {
    ...data,
    version: 2,
    settings: {
      rotationStrategy: 'round-robin'
    },
    force: {
      forcedAlias: null,
      forcedUntil: null,
      previousRotationStrategy: null,
      forcedBy: null
    }
  }
}

function isLimitStatus(value: unknown): value is MetricsData['limitStatus'] {
  return (
    value === 'idle' ||
    value === 'queued' ||
    value === 'running' ||
    value === 'success' ||
    value === 'error' ||
    value === 'stopped'
  )
}

function isLimitsConfidence(value: unknown): value is MetricsData['limitsConfidence'] {
  return value === 'fresh' || value === 'stale' || value === 'error' || value === 'unknown'
}

function extractAccountMetrics(acc: any): MetricsData {
  const metrics: MetricsData = {}
  if (!acc || typeof acc !== 'object') return metrics

  if (typeof acc.lastRefresh === 'string') metrics.lastRefresh = acc.lastRefresh
  if (typeof acc.lastSeenAt === 'number') metrics.lastSeenAt = acc.lastSeenAt
  if (typeof acc.lastActiveUntil === 'number') metrics.lastActiveUntil = acc.lastActiveUntil
  if (typeof acc.lastUsed === 'number') metrics.lastUsed = acc.lastUsed
  if (typeof acc.usageCount === 'number') metrics.usageCount = acc.usageCount
  if (hasMeaningfulRateLimits(acc.rateLimits)) metrics.rateLimits = acc.rateLimits
  if (Array.isArray(acc.rateLimitHistory)) {
    const history = acc.rateLimitHistory.filter((entry: any) =>
      hasMeaningfulRateLimits({ fiveHour: entry?.fiveHour, weekly: entry?.weekly })
    )
    if (history.length > 0) metrics.rateLimitHistory = history
  }
  if (isLimitStatus(acc.limitStatus)) metrics.limitStatus = acc.limitStatus
  if (typeof acc.limitError === 'string') metrics.limitError = acc.limitError
  if (typeof acc.lastLimitProbeAt === 'number') metrics.lastLimitProbeAt = acc.lastLimitProbeAt
  if (typeof acc.lastLimitErrorAt === 'number') metrics.lastLimitErrorAt = acc.lastLimitErrorAt
  if (isLimitsConfidence(acc.limitsConfidence)) metrics.limitsConfidence = acc.limitsConfidence

  return metrics
}

function hasMetrics(metrics: MetricsData): boolean {
  return Object.keys(metrics).some((key) => metrics[key as keyof MetricsData] !== undefined)
}

function stripAccountMetrics(acc: any): any {
  if (!acc || typeof acc !== 'object') return acc
  const next = { ...acc }
  for (const field of ACCOUNT_METRIC_FIELDS) {
    delete next[field]
  }
  return next
}

function pickAccountMetricUpdates(acc: Partial<AccountCredentials>): MetricsData {
  const metrics: MetricsData = {}
  for (const field of ACCOUNT_METRIC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(acc, field)) {
      ;(metrics as any)[field] = acc[field as keyof AccountCredentials]
    }
  }
  return metrics
}

function hasAccountMetricUpdates(acc: Partial<AccountCredentials>): boolean {
  return ACCOUNT_METRIC_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(acc, field))
}

function hasAccountStateUpdates(acc: Partial<AccountCredentials>): boolean {
  return Object.keys(acc).some((field) => !ACCOUNT_METRIC_FIELD_SET.has(field))
}

function stripStoreMetrics(store: AccountStore): AccountStore {
  const accounts = Object.fromEntries(
    Object.entries(store.accounts).map(([alias, account]) => [alias, stripAccountMetrics(account)])
  ) as Record<string, AccountCredentials>
  return { ...store, version: 3, accounts }
}

function writeMetricsSidecarFirst(data: any): boolean {
  const rawAccounts = data.accounts && typeof data.accounts === 'object'
    ? data.accounts as Record<string, any>
    : {}
  for (const [alias, account] of Object.entries(rawAccounts)) {
    const metrics = extractAccountMetrics(account)
    if (hasMetrics(metrics)) {
      mergeMetricsForMigration(alias, metrics)
    }
  }

  try {
    flushMetricsSync(true)
    return true
  } catch (err) {
    console.warn('[multi-auth] Deferred account store v3 migration because account metrics sidecar could not be written:', err)
    return false
  }
}

function persistStateOnlyV3(data: any): AccountStore | null {
  const rawAccounts = data.accounts && typeof data.accounts === 'object'
    ? data.accounts as Record<string, any>
    : {}
  const strippedRaw = Object.fromEntries(
    Object.entries(rawAccounts).map(([alias, account]) => [alias, stripAccountMetrics(account)])
  )
  const validated = validateStore({ ...data, version: 3, accounts: strippedRaw })
  if (!validated) return null
  const stateOnly = stripStoreMetrics(validated)
  // saveStore keeps the credentials file crash-safe via atomic rename plus .bak/.lkg recovery cues.
  saveStore(stateOnly)
  storeSavedDuringMigration = true
  return stateOnly
}

function migrateV2toV3(data: StoreFileV2): AccountStore | null {
  if (!writeMetricsSidecarFirst(data)) {
    return validateStore(data)
  }
  const migrated = persistStateOnlyV3(data)
  if (migrated) {
    console.log('[multi-auth] Migrated store from v2 to v3')
  }
  // Keep the runtime view compatible until later phases route all readers through the metrics cache.
  return validateStore({ ...data, version: 3 }) ?? migrated
}

function ensureV3MetricsSidecar(data: any): AccountStore | null {
  const rawAccounts = data.accounts && typeof data.accounts === 'object'
    ? data.accounts as Record<string, any>
    : {}
  const sidecarMissing = !fs.existsSync(getMetricsStorePath())

  if (!sidecarMissing) {
    return validateStore(data)
  }

  if (!writeMetricsSidecarFirst(data)) {
    return validateStore(data)
  }

  return validateStore(data)
}

function migrateStore(data: any): AccountStore | null {
  if (!data || typeof data !== 'object') return null
  
  const version = typeof data.version === 'number' ? data.version : 1
  
  if (version > CURRENT_STORE_VERSION) {
    console.warn(`[multi-auth] Store version ${version} is newer than supported ${CURRENT_STORE_VERSION}. Proceeding with caution.`)
    return validateStore(data)
  }
  
  let migrated: any = data
  if (version === 1) {
    migrated = migrateV1toV2(data as StoreFileV1)
    console.log('[multi-auth] Migrated store from v1 to v2')
  }

  if (version < 3) {
    return migrateV2toV3(migrated as StoreFileV2)
  }

  if (version === 3) {
    return ensureV3MetricsSidecar(migrated)
  }
  
  return validateStore(migrated)
}

function getLastKnownGoodPath(): string {
  return `${getStoreFile()}.lkg`
}

function saveLastKnownGood(store: AccountStore): void {
  // Avoid writing plaintext snapshots when store encryption is enabled.
  if (getPassphrase()) {
    return
  }

  const lkgPath = getLastKnownGoodPath()
  try {
    fs.writeFileSync(lkgPath, JSON.stringify(store, null, 2), { mode: 0o600 })
  } catch {
    // ignore
  }
}

function loadLastKnownGood(): AccountStore | null {
  const lkgPath = getLastKnownGoodPath()
  if (!fs.existsSync(lkgPath)) return null
  try {
    const data = fs.readFileSync(lkgPath, 'utf-8')
    const parsed = JSON.parse(data)
    return validateStore(parsed)
  } catch {
    return null
  }
}

async function acquireWriteLock(): Promise<void> {
  if (!writeLock) {
    writeLock = true
    return
  }
  return new Promise((resolve) => {
    writeLockQueue.push(resolve)
  })
}

function releaseWriteLock(): void {
  const next = writeLockQueue.shift()
  if (next) {
    next()
  } else {
    writeLock = false
  }
}

function buildSnapshot(window?: { remaining?: number; limit?: number; resetAt?: number }): RateLimitSnapshot | undefined {
  if (!window) return undefined
  return {
    remaining: window.remaining,
    limit: window.limit,
    resetAt: window.resetAt
  }
}

function buildHistoryEntry(rateLimits?: { fiveHour?: any; weekly?: any }): RateLimitHistoryEntry | null {
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

function appendHistory(
  history: RateLimitHistoryEntry[] | undefined,
  entry: RateLimitHistoryEntry
): RateLimitHistoryEntry[] {
  const next = history ? [...history] : []
  const last = next[next.length - 1]
  const same =
    last &&
    last.fiveHour?.remaining === entry.fiveHour?.remaining &&
    last.weekly?.remaining === entry.weekly?.remaining &&
    last.fiveHour?.resetAt === entry.fiveHour?.resetAt &&
    last.weekly?.resetAt === entry.weekly?.resetAt
  if (!same) {
    next.push(entry)
  }
  if (next.length > 160) {
    return next.slice(next.length - 160)
  }
  return next
}

export function loadStore(): AccountStore {
  storeLocked = false
  lastStoreError = null
  lastStoreEncrypted = false
  ensureDir()
  const file = getStoreFile()
  if (fs.existsSync(file)) {
    try {
      const data = fs.readFileSync(file, 'utf-8')
      const parsed = JSON.parse(data)
      if (isEncryptedFile(parsed)) {
        lastStoreEncrypted = true
        const passphrase = getPassphrase()
        if (!passphrase) {
          storeLocked = true
          lastStoreError = `Store is encrypted. Set ${STORE_ENV_PASSPHRASE} to unlock.`
          return emptyStore()
        }
        try {
          const decrypted = decryptStore(parsed, passphrase)
          const validated = migrateStore(decrypted)
          if (validated) {
            const savedDuringMigration = storeSavedDuringMigration
            storeSavedDuringMigration = false
            if (!savedDuringMigration) saveLastKnownGood(validated)
            return validated
          }
          storeLocked = true
          lastStoreError = 'Store validation failed after decryption.'
          const lkg = loadLastKnownGood()
          if (lkg) {
            console.warn('[multi-auth] Restored from last-known-good snapshot')
            return lkg
          }
          return emptyStore()
        } catch (err) {
          storeLocked = true
          lastStoreError = 'Failed to decrypt store. Check passphrase.'
          console.error('[multi-auth] Failed to decrypt store:', err)
          return emptyStore()
        }
      }
      
      const migrated = migrateStore(parsed)
      if (migrated) {
        const savedDuringMigration = storeSavedDuringMigration
        storeSavedDuringMigration = false
        if (!savedDuringMigration) saveLastKnownGood(migrated)
        return migrated
      }
      
      storeLocked = true
      lastStoreError = 'Store validation failed.'
      console.error('[multi-auth] Store validation failed')
      
      const lkg = loadLastKnownGood()
      if (lkg) {
        console.warn('[multi-auth] Restored from last-known-good snapshot')
        return lkg
      }
      return emptyStore()
    } catch (err) {
      storeLocked = true
      lastStoreError = 'Failed to parse store. Store locked until fixed.'
      console.error('[multi-auth] Failed to parse store:', err)
      
      const lkg = loadLastKnownGood()
      if (lkg) {
        console.warn('[multi-auth] Restored from last-known-good snapshot')
        return lkg
      }
    }
  }
  return emptyStore()
}

export function saveStore(store: AccountStore): void {
  ensureDir()
  if (storeLocked) {
    console.error('[multi-auth] Store locked; refusing to overwrite encrypted file.')
    return
  }

  const file = getStoreFile()
  const passphrase = getPassphrase()
  if (!fs.existsSync(getMetricsStorePath())) {
    for (const [alias, account] of Object.entries(store.accounts)) {
      const metrics = extractAccountMetrics(account)
      // validateAccount supplies usageCount: 0 as a compatibility default for state-only
      // records; do not let unrelated state saves overwrite richer cached telemetry with it.
      if (metrics.usageCount === 0) delete metrics.usageCount
      if (hasMetrics(metrics)) {
        setMetrics(alias, metrics)
      }
    }
  }
  const stateOnlyStore = stripStoreMetrics(store)
  const payload = passphrase ? encryptStore(stateOnlyStore, passphrase) : stateOnlyStore
  const json = JSON.stringify(payload, null, 2)

  try {
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, `${file}.bak`)
      fs.chmodSync(`${file}.bak`, 0o600)
    }
  } catch {
    // ignore backup failures
  }

  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  let fd: number | null = null

  try {
    fd = fs.openSync(tmp, 'w', 0o600)
    fs.writeFileSync(fd, json, { encoding: 'utf-8' })
    try {
      fs.fsyncSync(fd)
    } catch {
      // fsync not supported everywhere; best-effort
    }
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        // ignore
      }
    }
  }

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
    const dirFd = fs.openSync(getStoreDir(), 'r')
    try {
      fs.fsyncSync(dirFd)
    } catch {
      // ignore
    }
    fs.closeSync(dirFd)
  } catch {
    // ignore
  }

  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // ignore
  }

  saveLastKnownGood(stateOnlyStore)
}

function mergeAccountMetrics(account: AccountCredentials): AccountCredentials {
  const metrics = getMetrics(account.alias)
  if (!metrics) return account
  return {
    ...account,
    ...metrics,
    usageCount: metrics.usageCount ?? account.usageCount ?? 0
  }
}

export function loadStoreWithMetrics(): AccountStore {
  const store = loadStore()
  return {
    ...store,
    accounts: Object.fromEntries(
      Object.entries(store.accounts).map(([alias, account]) => [alias, mergeAccountMetrics(account)])
    ) as Record<string, AccountCredentials>
  }
}

export async function withWriteLock<T>(fn: () => T): Promise<T> {
  await acquireWriteLock()
  try {
    return fn()
  } finally {
    releaseWriteLock()
  }
}

export function getStoreDiagnostics(): {
  storeDir: string
  storeFile: string
  locked: boolean
  encrypted: boolean
  error: string | null
} {
  return {
    storeDir: getStoreDir(),
    storeFile: getStoreFile(),
    locked: storeLocked,
    encrypted: lastStoreEncrypted,
    error: lastStoreError
  }
}


export function addAccount(alias: string, creds: Omit<AccountCredentials, 'alias' | 'usageCount'>): AccountStore {
  const store = loadStore()
  const existing = store.accounts[alias]
  if (hasAccountMetricUpdates(creds)) {
    setMetrics(alias, pickAccountMetricUpdates(creds))
  }
  const stateCreds = stripAccountMetrics(creds) as Omit<AccountCredentials, 'alias' | 'usageCount'>
  const next: AccountCredentials = {
    ...(existing ?? {}),
    ...stateCreds,
    alias,
    usageCount: existing?.usageCount ?? 0
  }

  store.accounts[alias] = next
  if (!store.activeAlias) {
    store.activeAlias = alias
  }
  saveStore(store)
  return store
}

export function removeAccount(alias: string): AccountStore {
  const store = loadStore()
  delete store.accounts[alias]
  removeMetrics(alias)
  if (store.activeAlias === alias) {
    const remaining = Object.keys(store.accounts)
    store.activeAlias = remaining[0] || null
  }
  saveStore(store)
  return store
}

export function updateAccount(alias: string, updates: Partial<AccountCredentials>): AccountStore {
  const store = loadStore()
  if (store.accounts[alias]) {
    if (hasAccountMetricUpdates(updates)) {
      setMetrics(alias, pickAccountMetricUpdates(updates))
    }

    const stateUpdates = stripAccountMetrics(updates) as Partial<AccountCredentials>
    if (hasAccountStateUpdates(updates)) {
      const current = store.accounts[alias]
      const next = { ...current, ...stateUpdates }
      store.accounts[alias] = next
      saveStore(store)
    }
  }
  return store
}

export function setActiveAlias(alias: string | null): AccountStore {
  const store = loadStore()
  const now = Date.now()
  const previousAlias = store.activeAlias

  if (alias === null) {
    store.activeAlias = null
  } else if (store.accounts[alias]) {
    if (previousAlias && previousAlias !== alias && store.accounts[previousAlias]) {
      setMetrics(previousAlias, { lastActiveUntil: now })
    }

    store.activeAlias = alias
    setMetrics(alias, { lastSeenAt: now, lastActiveUntil: undefined })

    const aliases = Object.keys(store.accounts)
    const idx = aliases.indexOf(alias)
    if (idx >= 0) {
      store.rotationIndex = idx
    }
    store.lastRotation = now
  }
  saveStore(store)
  return store
}

export function getActiveAccount(): AccountCredentials | null {
  const store = loadStore()
  if (!store.activeAlias) return null
  return store.accounts[store.activeAlias] || null
}

export function listAccounts(): AccountCredentials[] {
  const store = loadStore()
  return Object.values(store.accounts)
}

export function getStorePath(): string {
  return getStoreFile()
}

export function getStoreStatus(): { locked: boolean; encrypted: boolean; error: string | null } {
  const diag = getStoreDiagnostics()
  return { locked: diag.locked, encrypted: diag.encrypted, error: diag.error }
}
