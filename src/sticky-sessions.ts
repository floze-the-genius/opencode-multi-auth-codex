import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getStorePath, withWriteLock } from './store.js'
import type { StickySessionSettings as StickySessionPolicy } from './types.js'

export type StickySessionSettings = StickySessionPolicy

export type StickySessionEntry = {
  alias: string
  createdAt: number
  lastUsedAt: number
}

export type StickySessionsFile = {
  version: 1
  updatedAt: number
  entries: Record<string, StickySessionEntry>
}

export type StickySessionCleanupResult = {
  before: number
  after: number
  removed: number
  prunedAt: number
}

export type StickySessionStatus = StickySessionCleanupResult & {
  path: string
  exists: boolean
  entries: number
  sizeBytes: number
  updatedAt: number | null
  ttlMs: number
  maxEntries: number
  maxFileBytes: number
}

const STICKY_SIDE_CAR_FILE = 'sticky-sessions.json'
const STICKY_SIDE_CAR_VERSION = 1

type LoadStickySessionsOptions = {
  now: number
  settings: StickySessionSettings
}

type UpsertStickyAssignmentOptions = LoadStickySessionsOptions & {
  canonicalIdentity: string
  alias: string
}

type GetStickyAssignmentOptions = LoadStickySessionsOptions & {
  stickyHash: string
}

function createEmptyStickySessions(now: number): StickySessionsFile {
  return {
    version: STICKY_SIDE_CAR_VERSION,
    updatedAt: now,
    entries: {}
  }
}

function getStickySessionsPath(): string {
  return path.join(path.dirname(getStorePath()), STICKY_SIDE_CAR_FILE)
}

export function getStickySessionsFilePath(): string {
  return getStickySessionsPath()
}

function ensureStoreDir(): void {
  fs.mkdirSync(path.dirname(getStickySessionsPath()), { recursive: true, mode: 0o700 })
}

function normalizeStickyIdentity(value: string): string {
  return value.trim().toLowerCase()
}

export function hashStickyIdentity(canonicalIdentity: string): string {
  const normalized = normalizeStickyIdentity(canonicalIdentity)
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex')
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function sanitizeStickyEntry(value: unknown): StickySessionEntry | null {
  if (!value || typeof value !== 'object') return null

  const entry = value as Record<string, unknown>
  if (typeof entry.alias !== 'string' || entry.alias.trim().length === 0) return null
  if (!isFiniteTimestamp(entry.createdAt) || !isFiniteTimestamp(entry.lastUsedAt)) return null
  if (entry.lastUsedAt < entry.createdAt) return null

  return {
    alias: entry.alias,
    createdAt: entry.createdAt,
    lastUsedAt: entry.lastUsedAt
  }
}

function sanitizeStickySessions(value: unknown, now: number, settings: StickySessionSettings): StickySessionsFile {
  const fallback = createEmptyStickySessions(now)
  if (!value || typeof value !== 'object') return fallback

  const file = value as Record<string, unknown>
  if (file.version !== STICKY_SIDE_CAR_VERSION) return fallback

  const entries: Record<string, StickySessionEntry> = {}
  const rawEntries = file.entries
  if (rawEntries && typeof rawEntries === 'object') {
    for (const [key, rawEntry] of Object.entries(rawEntries)) {
      const sanitized = sanitizeStickyEntry(rawEntry)
      if (sanitized) {
        entries[key] = sanitized
      }
    }
  }

  return pruneStickySessions(
    {
      version: STICKY_SIDE_CAR_VERSION,
      updatedAt: isFiniteTimestamp(file.updatedAt) ? file.updatedAt : now,
      entries
    },
    now,
    settings
  )
}

export function pruneStickySessions(
  file: StickySessionsFile,
  now: number,
  settings: StickySessionSettings
): StickySessionsFile {
  const ttlMs = Math.max(0, settings.ttlMs)
  const maxEntries = Math.max(0, settings.maxEntries)
  const maxFileBytes = Math.max(0, settings.maxFileBytes)

  let entries = Object.entries(file.entries)
    .filter(([, entry]) => now - entry.lastUsedAt <= ttlMs)
    .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)

  while (entries.length > maxEntries) {
    entries.shift()
  }

  let next = materializeStickySessions(entries, now)
  while (entries.length > 0 && Buffer.byteLength(JSON.stringify(next), 'utf8') > maxFileBytes) {
    entries.shift()
    next = materializeStickySessions(entries, now)
  }

  if (entries.length === 0 && Buffer.byteLength(JSON.stringify(next), 'utf8') > maxFileBytes) {
    return createEmptyStickySessions(now)
  }

  return next
}

function materializeStickySessions(
  sortedEntries: Array<[string, StickySessionEntry]>,
  now: number
): StickySessionsFile {
  return {
    version: STICKY_SIDE_CAR_VERSION,
    updatedAt: now,
    entries: Object.fromEntries(sortedEntries)
  }
}

function readStickySessionsFromDisk(now: number, settings: StickySessionSettings): StickySessionsFile {
  ensureStoreDir()
  const sidecarPath = getStickySessionsPath()
  if (!fs.existsSync(sidecarPath)) {
    return createEmptyStickySessions(now)
  }

  try {
    const raw = fs.readFileSync(sidecarPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return sanitizeStickySessions(parsed, now, settings)
  } catch {
    return createEmptyStickySessions(now)
  }
}

function readStickySessionsSnapshot(now: number): StickySessionsFile {
  ensureStoreDir()
  const sidecarPath = getStickySessionsPath()
  if (!fs.existsSync(sidecarPath)) {
    return createEmptyStickySessions(now)
  }

  try {
    const raw = fs.readFileSync(sidecarPath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.version !== STICKY_SIDE_CAR_VERSION) {
      return createEmptyStickySessions(now)
    }

    const entries: Record<string, StickySessionEntry> = {}
    if (parsed.entries && typeof parsed.entries === 'object') {
      for (const [key, value] of Object.entries(parsed.entries)) {
        const sanitized = sanitizeStickyEntry(value)
        if (sanitized) {
          entries[key] = sanitized
        }
      }
    }

    return {
      version: STICKY_SIDE_CAR_VERSION,
      updatedAt: isFiniteTimestamp(parsed.updatedAt) ? parsed.updatedAt : now,
      entries
    }
  } catch {
    return createEmptyStickySessions(now)
  }
}

export async function getStickyAssignment(
  options: GetStickyAssignmentOptions
): Promise<StickySessionEntry | null> {
  return withWriteLock(() => {
    const sidecarPath = getStickySessionsPath()
    if (!fs.existsSync(sidecarPath)) {
      return null
    }

    const loaded = readStickySessionsFromDisk(options.now, options.settings)
    writeStickySessionsToDisk(loaded)
    return loaded.entries[options.stickyHash] ?? null
  })
}

function writeStickySessionsToDisk(file: StickySessionsFile): void {
  ensureStoreDir()
  const sidecarPath = getStickySessionsPath()
  const json = JSON.stringify(file, null, 2)
  const tmpPath = `${sidecarPath}.tmp-${process.pid}-${Date.now()}`
  let fd: number | null = null

  try {
    fd = fs.openSync(tmpPath, 'w', 0o600)
    fs.writeFileSync(fd, json, { encoding: 'utf8' })
    try {
      fs.fsyncSync(fd)
    } catch {
      // best effort
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
    fs.renameSync(tmpPath, sidecarPath)
  } catch (error: any) {
    if (error?.code === 'EPERM' || error?.code === 'EEXIST') {
      try {
        fs.unlinkSync(sidecarPath)
      } catch {
        // ignore
      }
      fs.renameSync(tmpPath, sidecarPath)
    } else {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        // ignore
      }
      throw error
    }
  }

  try {
    const dirFd = fs.openSync(path.dirname(sidecarPath), 'r')
    try {
      fs.fsyncSync(dirFd)
    } catch {
      // best effort
    }
    fs.closeSync(dirFd)
  } catch {
    // ignore
  }

  try {
    fs.chmodSync(sidecarPath, 0o600)
  } catch {
    // ignore
  }
}

export async function loadStickySessions(options: LoadStickySessionsOptions): Promise<StickySessionsFile> {
  return withWriteLock(() => {
    const loaded = readStickySessionsFromDisk(options.now, options.settings)
    const sidecarPath = getStickySessionsPath()
    if (fs.existsSync(sidecarPath)) {
      writeStickySessionsToDisk(loaded)
    }
    return loaded
  })
}

export async function upsertStickyAssignment(
  options: UpsertStickyAssignmentOptions
): Promise<StickySessionsFile> {
  return withWriteLock(() => {
    const normalizedIdentity = normalizeStickyIdentity(options.canonicalIdentity)
    if (!normalizedIdentity) {
      throw new Error('Sticky canonical identity must not be empty')
    }

    const loaded = readStickySessionsFromDisk(options.now, options.settings)
    const stickyKey = hashStickyIdentity(normalizedIdentity)
    const existing = loaded.entries[stickyKey]

    loaded.entries[stickyKey] = {
      alias: options.alias,
      createdAt: existing?.createdAt ?? options.now,
      lastUsedAt: options.now
    }

    const pruned = pruneStickySessions(loaded, options.now, options.settings)
    writeStickySessionsToDisk(pruned)
    return pruned
  })
}

export async function removeStickyAssignment(
  options: LoadStickySessionsOptions & { stickyHash: string }
): Promise<StickySessionsFile> {
  return withWriteLock(() => {
    const loaded = readStickySessionsSnapshot(options.now)

    if (!(options.stickyHash in loaded.entries)) {
      return loaded
    }

    delete loaded.entries[options.stickyHash]
    const pruned = pruneStickySessions(loaded, options.now, options.settings)
    writeStickySessionsToDisk(pruned)
    return pruned
  })
}

export async function cleanupStickySessions(options: LoadStickySessionsOptions): Promise<StickySessionCleanupResult> {
  return withWriteLock(() => {
    const loaded = readStickySessionsSnapshot(options.now)
    const before = Object.keys(loaded.entries).length
    const pruned = pruneStickySessions(loaded, options.now, options.settings)
    writeStickySessionsToDisk(pruned)

    const after = Object.keys(pruned.entries).length
    return {
      before,
      after,
      removed: before - after,
      prunedAt: options.now
    }
  })
}

export async function getStickySessionsStatus(options: LoadStickySessionsOptions): Promise<StickySessionStatus> {
  return withWriteLock(() => {
    const sidecarPath = getStickySessionsPath()
    const beforeSnapshot = readStickySessionsSnapshot(options.now)
    const before = Object.keys(beforeSnapshot.entries).length
    const loaded = readStickySessionsFromDisk(options.now, options.settings)
    const after = Object.keys(loaded.entries).length

    if (fs.existsSync(sidecarPath)) {
      writeStickySessionsToDisk(loaded)
    }

    const exists = fs.existsSync(sidecarPath)
    const sizeBytes = exists ? fs.statSync(sidecarPath).size : 0
    return {
      path: sidecarPath,
      exists,
      entries: after,
      sizeBytes,
      updatedAt: exists ? loaded.updatedAt : null,
      ttlMs: options.settings.ttlMs,
      maxEntries: options.settings.maxEntries,
      maxFileBytes: options.settings.maxFileBytes,
      before,
      after,
      removed: before - after,
      prunedAt: options.now
    }
  })
}
