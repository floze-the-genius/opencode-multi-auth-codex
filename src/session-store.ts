import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { withFileLock } from './file-lock.js'

/**
 * Disk-backed map from session ID -> account alias for sticky session routing.
 * The in-memory Map is a cache; sessions.json is the source of truth across
 * concurrent OpenCode/plugin processes.
 */

export interface SessionEntry {
  alias: string
  createdAt: number
  lastUsedAt: number
}

type SessionStoreFile = {
  version: 1
  sessions: Record<string, SessionEntry>
}

const STORE_DIR_ENV = 'OPENCODE_MULTI_AUTH_STORE_DIR'
const SESSION_STORE_FILE_ENV = 'OPENCODE_MULTI_AUTH_SESSION_STORE_FILE'
const DEFAULT_STORE_DIR = path.join(os.homedir(), '.config', 'opencode-multi-auth')
const DEFAULT_SESSION_STORE_FILE = 'sessions.json'
const SESSION_STORE_VERSION = 1

const sessions = new Map<string, SessionEntry>()
let pruneTimer: ReturnType<typeof setInterval> | null = null

const PRUNE_INTERVAL_MS = 5 * 60 * 1000 // check every 5 minutes

function getStoreDir(): string {
  const override = process.env[STORE_DIR_ENV]
  if (override && override.trim()) return path.resolve(override.trim())
  return DEFAULT_STORE_DIR
}

function getSessionStoreFile(): string {
  const override = process.env[SESSION_STORE_FILE_ENV]
  if (override && override.trim()) return path.resolve(override.trim())
  return path.join(getStoreDir(), DEFAULT_SESSION_STORE_FILE)
}

function ensureDir(): void {
  const dir = path.dirname(getSessionStoreFile())
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

function validateSessionEntry(entry: any): SessionEntry | null {
  if (!entry || typeof entry !== 'object') return null
  if (typeof entry.alias !== 'string' || !entry.alias) return null
  if (typeof entry.createdAt !== 'number') return null
  if (typeof entry.lastUsedAt !== 'number') return null
  return {
    alias: entry.alias,
    createdAt: entry.createdAt,
    lastUsedAt: entry.lastUsedAt
  }
}

function loadSessionsUnlocked(): Map<string, SessionEntry> {
  ensureDir()
  const file = getSessionStoreFile()
  const next = new Map<string, SessionEntry>()
  if (!fs.existsSync(file)) return next

  try {
    const raw = fs.readFileSync(file, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<SessionStoreFile>
    const rawSessions = parsed.sessions
    if (!rawSessions || typeof rawSessions !== 'object') return next
    for (const [sessionId, entry] of Object.entries(rawSessions)) {
      if (typeof sessionId !== 'string' || !sessionId) continue
      const valid = validateSessionEntry(entry)
      if (valid) next.set(sessionId, valid)
    }
  } catch (err) {
    console.warn('[multi-auth] Failed to load session store; using empty session cache:', err)
  }
  return next
}

function saveSessionsUnlocked(next: Map<string, SessionEntry>): void {
  ensureDir()
  const file = getSessionStoreFile()
  const payload: SessionStoreFile = {
    version: SESSION_STORE_VERSION,
    sessions: Object.fromEntries(next.entries())
  }
  const json = JSON.stringify(payload, null, 2)
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  let fd: number | null = null

  try {
    fd = fs.openSync(tmp, 'w', 0o600)
    fs.writeFileSync(fd, json, { encoding: 'utf-8' })
    try {
      fs.fsyncSync(fd)
    } catch {
      // best-effort
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

  fs.renameSync(tmp, file)
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // ignore
  }
}

function replaceCache(next: Map<string, SessionEntry>): void {
  sessions.clear()
  for (const [sessionId, entry] of next) {
    sessions.set(sessionId, entry)
  }
}

function refreshCache(): void {
  replaceCache(loadSessionsUnlocked())
}

function mutateSessions<T>(fn: (current: Map<string, SessionEntry>) => T): T {
  return withFileLock(getSessionStoreFile(), () => {
    const current = loadSessionsUnlocked()
    const result = fn(current)
    saveSessionsUnlocked(current)
    replaceCache(current)
    return result
  })
}

function startPruneTimer(idleTimeoutMs: number): void {
  if (pruneTimer !== null) return
  pruneTimer = setInterval(() => pruneExpired(idleTimeoutMs), PRUNE_INTERVAL_MS)
  // Don't keep the process alive just for this timer.
  if (pruneTimer.unref) pruneTimer.unref()
}

export function pruneExpired(idleTimeoutMs: number): void {
  mutateSessions((current) => {
    const cutoff = Date.now() - idleTimeoutMs
    for (const [id, entry] of current) {
      if (entry.lastUsedAt < cutoff) {
        current.delete(id)
      }
    }
  })
}

export function getSessionAlias(sessionId: string): string | undefined {
  refreshCache()
  return sessions.get(sessionId)?.alias
}

export function setSessionAlias(sessionId: string, alias: string, idleTimeoutMs: number): void {
  mutateSessions((current) => {
    const now = Date.now()
    const existing = current.get(sessionId)
    current.set(sessionId, {
      alias,
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: now
    })
  })
  startPruneTimer(idleTimeoutMs)
}

export function touchSession(sessionId: string): void {
  mutateSessions((current) => {
    const entry = current.get(sessionId)
    if (entry) {
      entry.lastUsedAt = Date.now()
    }
  })
}

export function clearSession(sessionId: string): void {
  mutateSessions((current) => {
    current.delete(sessionId)
  })
}

export function clearSessionsForAlias(alias: string): void {
  mutateSessions((current) => {
    for (const [id, entry] of current) {
      if (entry.alias === alias) current.delete(id)
    }
  })
}

/** Returns a snapshot suitable for the dashboard API. */
export function listSessions(): Array<SessionEntry & { sessionId: string }> {
  refreshCache()
  return Array.from(sessions.entries()).map(([sessionId, entry]) => ({
    sessionId,
    ...entry
  }))
}

export function sessionCount(): number {
  refreshCache()
  return sessions.size
}

/** Count active sessions per account alias. */
export function sessionCountByAlias(): Record<string, number> {
  refreshCache()
  const counts: Record<string, number> = {}
  for (const entry of sessions.values()) {
    counts[entry.alias] = (counts[entry.alias] ?? 0) + 1
  }
  return counts
}

export function getSessionStorePath(): string {
  return getSessionStoreFile()
}
