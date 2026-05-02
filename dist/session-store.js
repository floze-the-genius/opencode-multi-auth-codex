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
const sessions = new Map();
let pruneTimer = null;
const PRUNE_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes
function startPruneTimer(idleTimeoutMs) {
    if (pruneTimer !== null)
        return;
    pruneTimer = setInterval(() => pruneExpired(idleTimeoutMs), PRUNE_INTERVAL_MS);
    // Don't keep the process alive just for this timer.
    if (pruneTimer.unref)
        pruneTimer.unref();
}
export function pruneExpired(idleTimeoutMs) {
    const cutoff = Date.now() - idleTimeoutMs;
    for (const [id, entry] of sessions) {
        if (entry.lastUsedAt < cutoff) {
            sessions.delete(id);
        }
    }
}
export function getSessionAlias(sessionId) {
    return sessions.get(sessionId)?.alias;
}
export function setSessionAlias(sessionId, alias, idleTimeoutMs) {
    const now = Date.now();
    const existing = sessions.get(sessionId);
    sessions.set(sessionId, {
        alias,
        createdAt: existing?.createdAt ?? now,
        lastUsedAt: now
    });
    startPruneTimer(idleTimeoutMs);
}
export function touchSession(sessionId) {
    const entry = sessions.get(sessionId);
    if (entry) {
        entry.lastUsedAt = Date.now();
    }
}
export function clearSession(sessionId) {
    sessions.delete(sessionId);
}
export function clearSessionsForAlias(alias) {
    for (const [id, entry] of sessions) {
        if (entry.alias === alias)
            sessions.delete(id);
    }
}
/** Returns a snapshot suitable for the dashboard API. */
export function listSessions() {
    return Array.from(sessions.entries()).map(([sessionId, entry]) => ({
        sessionId,
        ...entry
    }));
}
export function sessionCount() {
    return sessions.size;
}
/** Count active sessions per account alias. */
export function sessionCountByAlias() {
    const counts = {};
    for (const entry of sessions.values()) {
        counts[entry.alias] = (counts[entry.alias] ?? 0) + 1;
    }
    return counts;
}
//# sourceMappingURL=session-store.js.map