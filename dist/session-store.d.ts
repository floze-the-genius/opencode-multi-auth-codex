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
    alias: string;
    createdAt: number;
    lastUsedAt: number;
}
export interface PendingFirstTurnFingerprint {
    model?: string;
    project?: string;
    directory?: string;
    inputHash?: string;
}
export declare function pruneExpired(idleTimeoutMs: number): void;
export declare function getSessionAlias(sessionId: string): string | undefined;
export declare function recordPendingFirstTurnAlias(alias: string, fingerprint?: PendingFirstTurnFingerprint): void;
export declare function consumePendingFirstTurnAlias(fingerprint?: PendingFirstTurnFingerprint): string | undefined;
export declare function clearPendingFirstTurnAliases(): void;
export declare function setSessionAlias(sessionId: string, alias: string, idleTimeoutMs: number): void;
export declare function touchSession(sessionId: string): void;
export declare function clearSession(sessionId: string): void;
export declare function clearSessionsForAlias(alias: string): void;
/** Returns a snapshot suitable for the dashboard API. */
export declare function listSessions(): Array<SessionEntry & {
    sessionId: string;
}>;
export declare function sessionCount(): number;
/** Count active sessions per account alias. */
export declare function sessionCountByAlias(): Record<string, number>;
//# sourceMappingURL=session-store.d.ts.map