import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { withFileLock } from './file-lock.js';
const STORE_DIR_ENV = 'OPENCODE_MULTI_AUTH_STORE_DIR';
const SESSION_STORE_FILE_ENV = 'OPENCODE_MULTI_AUTH_SESSION_STORE_FILE';
const DEFAULT_STORE_DIR = path.join(os.homedir(), '.config', 'opencode-multi-auth');
const DEFAULT_SESSION_STORE_FILE = 'sessions.json';
const SESSION_STORE_VERSION = 1;
const sessions = new Map();
let pruneTimer = null;
const PRUNE_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes
function getStoreDir() {
    const override = process.env[STORE_DIR_ENV];
    if (override && override.trim())
        return path.resolve(override.trim());
    return DEFAULT_STORE_DIR;
}
function getSessionStoreFile() {
    const override = process.env[SESSION_STORE_FILE_ENV];
    if (override && override.trim())
        return path.resolve(override.trim());
    return path.join(getStoreDir(), DEFAULT_SESSION_STORE_FILE);
}
function ensureDir() {
    const dir = path.dirname(getSessionStoreFile());
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
}
function validateSessionEntry(entry) {
    if (!entry || typeof entry !== 'object')
        return null;
    if (typeof entry.alias !== 'string' || !entry.alias)
        return null;
    if (typeof entry.createdAt !== 'number')
        return null;
    if (typeof entry.lastUsedAt !== 'number')
        return null;
    return {
        alias: entry.alias,
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt
    };
}
function loadSessionsUnlocked() {
    ensureDir();
    const file = getSessionStoreFile();
    const next = new Map();
    if (!fs.existsSync(file))
        return next;
    try {
        const raw = fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw);
        const rawSessions = parsed.sessions;
        if (!rawSessions || typeof rawSessions !== 'object')
            return next;
        for (const [sessionId, entry] of Object.entries(rawSessions)) {
            if (typeof sessionId !== 'string' || !sessionId)
                continue;
            const valid = validateSessionEntry(entry);
            if (valid)
                next.set(sessionId, valid);
        }
    }
    catch (err) {
        console.warn('[multi-auth] Failed to load session store; using empty session cache:', err);
    }
    return next;
}
function saveSessionsUnlocked(next) {
    ensureDir();
    const file = getSessionStoreFile();
    const payload = {
        version: SESSION_STORE_VERSION,
        sessions: Object.fromEntries(next.entries())
    };
    const json = JSON.stringify(payload, null, 2);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    let fd = null;
    try {
        fd = fs.openSync(tmp, 'w', 0o600);
        fs.writeFileSync(fd, json, { encoding: 'utf-8' });
        try {
            fs.fsyncSync(fd);
        }
        catch {
            // best-effort
        }
    }
    finally {
        if (fd !== null) {
            try {
                fs.closeSync(fd);
            }
            catch {
                // ignore
            }
        }
    }
    fs.renameSync(tmp, file);
    try {
        fs.chmodSync(file, 0o600);
    }
    catch {
        // ignore
    }
}
function replaceCache(next) {
    sessions.clear();
    for (const [sessionId, entry] of next) {
        sessions.set(sessionId, entry);
    }
}
function refreshCache() {
    replaceCache(loadSessionsUnlocked());
}
function mutateSessions(fn) {
    return withFileLock(getSessionStoreFile(), () => {
        const current = loadSessionsUnlocked();
        const result = fn(current);
        saveSessionsUnlocked(current);
        replaceCache(current);
        return result;
    });
}
function startPruneTimer(idleTimeoutMs) {
    if (pruneTimer !== null)
        return;
    pruneTimer = setInterval(() => pruneExpired(idleTimeoutMs), PRUNE_INTERVAL_MS);
    // Don't keep the process alive just for this timer.
    if (pruneTimer.unref)
        pruneTimer.unref();
}
export function pruneExpired(idleTimeoutMs) {
    mutateSessions((current) => {
        const cutoff = Date.now() - idleTimeoutMs;
        for (const [id, entry] of current) {
            if (entry.lastUsedAt < cutoff) {
                current.delete(id);
            }
        }
    });
}
export function getSessionAlias(sessionId) {
    refreshCache();
    return sessions.get(sessionId)?.alias;
}
export function setSessionAlias(sessionId, alias, idleTimeoutMs) {
    mutateSessions((current) => {
        const now = Date.now();
        const existing = current.get(sessionId);
        current.set(sessionId, {
            alias,
            createdAt: existing?.createdAt ?? now,
            lastUsedAt: now
        });
    });
    startPruneTimer(idleTimeoutMs);
}
export function touchSession(sessionId) {
    mutateSessions((current) => {
        const entry = current.get(sessionId);
        if (entry) {
            entry.lastUsedAt = Date.now();
        }
    });
}
export function clearSession(sessionId) {
    mutateSessions((current) => {
        current.delete(sessionId);
    });
}
export function clearSessionsForAlias(alias) {
    mutateSessions((current) => {
        for (const [id, entry] of current) {
            if (entry.alias === alias)
                current.delete(id);
        }
    });
}
/** Returns a snapshot suitable for the dashboard API. */
export function listSessions() {
    refreshCache();
    return Array.from(sessions.entries()).map(([sessionId, entry]) => ({
        sessionId,
        ...entry
    }));
}
export function sessionCount() {
    refreshCache();
    return sessions.size;
}
/** Count active sessions per account alias. */
export function sessionCountByAlias() {
    refreshCache();
    const counts = {};
    for (const entry of sessions.values()) {
        counts[entry.alias] = (counts[entry.alias] ?? 0) + 1;
    }
    return counts;
}
export function getSessionStorePath() {
    return getSessionStoreFile();
}
//# sourceMappingURL=session-store.js.map