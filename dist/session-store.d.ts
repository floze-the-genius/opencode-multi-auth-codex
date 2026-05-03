/**
 * Disk-backed map from session ID -> account alias for sticky session routing.
 * The in-memory Map is a cache; sessions.json is the source of truth across
 * concurrent OpenCode/plugin processes.
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
export declare function getSessionStorePath(): string;
//# sourceMappingURL=session-store.d.ts.map