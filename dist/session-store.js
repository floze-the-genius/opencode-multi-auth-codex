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
const pendingFirstTurns = [];
let pruneTimer = null;
const PRUNE_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes
const PENDING_FIRST_TURN_TTL_MS = 60 * 1000;
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
function prunePendingFirstTurns(now = Date.now()) {
    const cutoff = now - PENDING_FIRST_TURN_TTL_MS;
    while (pendingFirstTurns.length > 0 && pendingFirstTurns[0].createdAt < cutoff) {
        pendingFirstTurns.shift();
    }
}
function fingerprintsEqual(a, b) {
    if (!a || !b)
        return false;
    return a.model === b.model &&
        a.project === b.project &&
        a.directory === b.directory &&
        a.inputHash === b.inputHash;
}
export function recordPendingFirstTurnAlias(alias, fingerprint) {
    prunePendingFirstTurns();
    if (fingerprint) {
        const existingIndex = pendingFirstTurns.findIndex((entry) => fingerprintsEqual(entry.fingerprint, fingerprint));
        if (existingIndex >= 0) {
            pendingFirstTurns.splice(existingIndex, 1);
        }
    }
    pendingFirstTurns.push({ alias, createdAt: Date.now(), fingerprint });
}
export function consumePendingFirstTurnAlias(fingerprint) {
    prunePendingFirstTurns();
    if (fingerprint) {
        const matchIndex = pendingFirstTurns.findIndex((entry) => fingerprintsEqual(entry.fingerprint, fingerprint));
        if (matchIndex >= 0) {
            const [entry] = pendingFirstTurns.splice(matchIndex, 1);
            return entry.alias;
        }
    }
    if (pendingFirstTurns.length === 1) {
        return pendingFirstTurns.shift()?.alias;
    }
    return undefined;
}
export function clearPendingFirstTurnAliases() {
    pendingFirstTurns.length = 0;
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