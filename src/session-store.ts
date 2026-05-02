/**
 * In-memory map from session ID → account alias for sticky session routing.
 *
 * Each Codex conversation is keyed by its `prompt_cache_key` (forwarded to the
 * backend as `session_id` / `conversation_id`).  Pinning every request in a
 * session to the same account lets the backend's KV cache and reasoning state
 * remain valid across turns.
 *
 * The map lives in memory only – a process restart clears it, which is fine
 * because the upstream context window would also be gone.
 */

export interface SessionEntry {
  alias: string
  createdAt: number
  lastUsedAt: number
}

const sessions = new Map<string, SessionEntry>()
let pruneTimer: ReturnType<typeof setInterval> | null = null

const PRUNE_INTERVAL_MS = 5 * 60 * 1000 // check every 5 minutes

function startPruneTimer(idleTimeoutMs: number): void {
  if (pruneTimer !== null) return
  pruneTimer = setInterval(() => pruneExpired(idleTimeoutMs), PRUNE_INTERVAL_MS)
  // Don't keep the process alive just for this timer.
  if (pruneTimer.unref) pruneTimer.unref()
}

export function pruneExpired(idleTimeoutMs: number): void {
  const cutoff = Date.now() - idleTimeoutMs
  for (const [id, entry] of sessions) {
    if (entry.lastUsedAt < cutoff) {
      sessions.delete(id)
    }
  }
}

export function getSessionAlias(sessionId: string): string | undefined {
  return sessions.get(sessionId)?.alias
}

export function setSessionAlias(sessionId: string, alias: string, idleTimeoutMs: number): void {
  const now = Date.now()
  const existing = sessions.get(sessionId)
  sessions.set(sessionId, {
    alias,
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: now
  })
  startPruneTimer(idleTimeoutMs)
}

export function touchSession(sessionId: string): void {
  const entry = sessions.get(sessionId)
  if (entry) {
    entry.lastUsedAt = Date.now()
  }
}

export function clearSession(sessionId: string): void {
  sessions.delete(sessionId)
}

export function clearSessionsForAlias(alias: string): void {
  for (const [id, entry] of sessions) {
    if (entry.alias === alias) sessions.delete(id)
  }
}

/** Returns a snapshot suitable for the dashboard API. */
export function listSessions(): Array<SessionEntry & { sessionId: string }> {
  return Array.from(sessions.entries()).map(([sessionId, entry]) => ({
    sessionId,
    ...entry
  }))
}

export function sessionCount(): number {
  return sessions.size
}

/** Count active sessions per account alias. */
export function sessionCountByAlias(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of sessions.values()) {
    counts[entry.alias] = (counts[entry.alias] ?? 0) + 1
  }
  return counts
}
