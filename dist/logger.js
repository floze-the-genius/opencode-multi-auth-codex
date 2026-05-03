import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getRuntimeSettings } from './settings.js';
const DEFAULT_LOG_DIR = path.join(os.homedir(), '.config', 'opencode-multi-auth', 'logs');
const LOG_FILE = process.env.CODEX_SOFT_LOG_PATH || path.join(DEFAULT_LOG_DIR, 'codex-soft.log');
const MAX_LOG_LINES = 400;
const MAX_DEBUG_BYTES = 20 * 1024;
const REDACT_KEYS = new Set([
    'authorization',
    'cookie',
    'x-api-key',
    'api-key',
    'accessToken',
    'refreshToken',
    'idToken',
    'token',
    'secret',
    'password',
    'passwd'
]);
function ensureDir() {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
}
function sanitize(message) {
    return message
        .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[jwt]')
        .replace(/\bsk-[A-Za-z0-9]{10,}\b/g, '[token]');
}
function isDebugEnabledFromEnv() {
    const value = process.env.OPENCODE_MULTI_AUTH_DEBUG;
    return value === '1' || value?.toLowerCase?.() === 'true';
}
export function isDebugEnvOverrideActive() {
    return isDebugEnabledFromEnv();
}
export function isDebugEnabled() {
    if (isDebugEnabledFromEnv())
        return true;
    try {
        return getRuntimeSettings().settings.debug === true;
    }
    catch {
        return false;
    }
}
function capText(text, maxBytes = MAX_DEBUG_BYTES) {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes <= maxBytes) {
        return { text, truncated: false, bytes };
    }
    const capped = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
    return { text: capped, truncated: true, bytes };
}
function normalizeDebugValue(value, depth = 0) {
    if (value === null || value === undefined)
        return value;
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return value;
    if (typeof value === 'bigint')
        return value.toString();
    if (typeof value === 'function')
        return '[function]';
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            code: value.code,
            stack: value.stack
        };
    }
    if (depth > 6)
        return '[depth-limit]';
    if (Array.isArray(value)) {
        return value.slice(0, 50).map((item) => normalizeDebugValue(item, depth + 1));
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            if (REDACT_KEYS.has(key.toLowerCase())) {
                out[key] = '[redacted]';
                continue;
            }
            out[key] = normalizeDebugValue(item, depth + 1);
        }
        return out;
    }
    return String(value);
}
export function formatDebugValue(value) {
    try {
        return JSON.stringify(normalizeDebugValue(value)) || 'null';
    }
    catch {
        return String(value);
    }
}
function append(level, message) {
    try {
        ensureDir();
        const line = `${new Date().toISOString()} [${level}] ${sanitize(message)}\n`;
        fs.appendFileSync(LOG_FILE, line, { encoding: 'utf-8', mode: 0o600 });
    }
    catch {
        // Ignore log write failures
    }
}
export function logInfo(message) {
    append('info', message);
}
export function logWarn(message) {
    append('warn', message);
}
export function logError(message) {
    append('error', message);
}
export function logDebug(message, enabled) {
    if (enabled === false)
        return;
    if (enabled !== true && !isDebugEnabled())
        return;
    append('debug', message);
}
export function logDebugValue(label, value, enabled) {
    if (enabled === false)
        return;
    if (enabled !== true && !isDebugEnabled())
        return;
    const serialized = formatDebugValue(value);
    const capped = capText(serialized);
    const suffix = capped.truncated ? ` [truncated to ${MAX_DEBUG_BYTES} bytes from ${capped.bytes}]` : '';
    append('debug', `${label}: ${sanitize(capped.text)}${suffix}`);
}
export function getLogPath() {
    return LOG_FILE;
}
export function readLogTail(maxLines = MAX_LOG_LINES) {
    try {
        if (!fs.existsSync(LOG_FILE))
            return [];
        const data = fs.readFileSync(LOG_FILE, 'utf-8');
        const lines = data.split('\n').filter(Boolean);
        return lines.slice(Math.max(0, lines.length - maxLines));
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=logger.js.map