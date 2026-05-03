/**
 * In-memory map from session ID → account alias for sticky session routing.
 *
 * Each Codex conversation is keyed by OpenCode's `x-session-affinity` header
 * when available, with `prompt_cache_key` as a fallback. Pinning every request
 * in a session to the same account keeps account-scoped response state valid
 * across turns.
 *
 * The map lives in memory only – a process restart clears it, which is fine
 * because the upstream context window would also be gone.
 */
export interface SessionEntry {
    alias: string;
    createdAt: number;
    lastUsedAt: number;
}
export declare function pruneExpired(idleTimeoutMs: number): void;
export declare function getSessionAlias(sessionId: string): string | undefined;
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