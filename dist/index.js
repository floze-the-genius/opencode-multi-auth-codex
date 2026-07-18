import fs from 'node:fs';
import { syncAuthFromOpenCode } from './auth-sync.js';
import { createAuthorizationFlow, loginAccount } from './auth.js';
import { extractRateLimitUpdate, getBlockingRateLimitResetAt, mergeRateLimits, parseRateLimitResetFromError, parseRetryAfterHeader } from './rate-limits.js';
import { getNextAccount, markAuthInvalid, markModelUnsupported, markRateLimited, markWorkspaceDeactivated } from './rotation.js';
import { getDefaultModels } from './models.js';
import { getForceState, isForceActive } from './force-mode.js';
import { getRuntimeSettings } from './settings.js';
import { listAccounts, updateAccount, loadStore } from './store.js';
import { DEFAULT_CONFIG } from './types.js';
import { Errors } from './errors.js';
import { isDebugEnabled, logDebug, logDebugValue } from './logger.js';
const PROVIDER_ID = 'openai';
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api';
const REDIRECT_PORT = 1455;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;
const URL_PATHS = {
    RESPONSES: '/responses',
    CODEX_RESPONSES: '/codex/responses'
};
const OPENAI_HEADERS = {
    BETA: 'OpenAI-Beta',
    ACCOUNT_ID: 'chatgpt-account-id',
    ORIGINATOR: 'originator',
    SESSION_ID: 'session_id',
    CONVERSATION_ID: 'conversation_id'
};
const OPENAI_HEADER_VALUES = {
    BETA_RESPONSES: 'responses=experimental',
    ORIGINATOR_CODEX: 'codex_cli_rs'
};
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';
const DEFAULT_LATEST_CODEX_MODEL = 'gpt-5.5';
let pluginConfig = { ...DEFAULT_CONFIG };
function configure(config) {
    pluginConfig = { ...pluginConfig, ...config };
}
function decodeJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3)
            return null;
        const payload = parts[1];
        const decoded = Buffer.from(payload, 'base64').toString('utf-8');
        return JSON.parse(decoded);
    }
    catch {
        return null;
    }
}
function extractRequestUrl(input) {
    if (typeof input === 'string')
        return input;
    if (input instanceof URL)
        return input.toString();
    return input.url;
}
function getRequestHeader(input, init, name) {
    const lowerName = name.toLowerCase();
    const headers = init?.headers;
    if (headers instanceof Headers) {
        const value = headers.get(name) || headers.get(lowerName);
        if (value)
            return value;
    }
    else if (Array.isArray(headers)) {
        for (const [key, value] of headers) {
            if (key.toLowerCase() === lowerName)
                return value;
        }
    }
    else if (headers && typeof headers === 'object') {
        const record = headers;
        for (const [key, value] of Object.entries(record)) {
            if (key.toLowerCase() !== lowerName)
                continue;
            if (Array.isArray(value))
                return value[0];
            return value;
        }
    }
    if (input instanceof Request) {
        const value = input.headers.get(name) || input.headers.get(lowerName);
        if (value)
            return value;
    }
    return undefined;
}
function rewriteUrlForCodex(url) {
    return url.replace(URL_PATHS.RESPONSES, URL_PATHS.CODEX_RESPONSES);
}
function extractPathAndSearch(url) {
    // OpenCode sometimes passes relative paths (e.g. "/chat/completions") or even
    // malformed strings when provider base_url is missing (e.g. "undefined/...").
    // We only need the path+query and then we force the ChatGPT backend base URL.
    try {
        const u = new URL(url);
        return `${u.pathname}${u.search}`;
    }
    catch {
        // best-effort fallback
    }
    const trimmed = String(url || '').trim();
    if (trimmed.startsWith('/'))
        return trimmed;
    const firstSlash = trimmed.indexOf('/');
    if (firstSlash >= 0)
        return trimmed.slice(firstSlash);
    return trimmed;
}
function toCodexBackendUrl(originalUrl) {
    const pathAndSearch = extractPathAndSearch(originalUrl);
    // Map OpenAI v1 endpoints to ChatGPT Codex endpoints.
    let mapped = pathAndSearch;
    if (mapped.includes(URL_PATHS.RESPONSES)) {
        mapped = mapped.replace(URL_PATHS.RESPONSES, URL_PATHS.CODEX_RESPONSES);
    }
    else if (mapped.includes('/chat/completions')) {
        mapped = mapped.replace('/chat/completions', '/codex/chat/completions');
    }
    return new URL(mapped, CODEX_BASE_URL).toString();
}
function filterInput(input) {
    if (!Array.isArray(input))
        return input;
    return input
        .filter((item) => item?.type !== 'item_reference')
        .map((item) => {
        if (item && typeof item === 'object' && 'id' in item) {
            const { id, ...rest } = item;
            return rest;
        }
        return item;
    });
}
function normalizeModel(model, debugEnabled) {
    if (!model)
        return 'gpt-5.1';
    const modelId = model.includes('/') ? model.split('/').pop() : model;
    const baseModel = modelId.replace(/-(?:fast|none|minimal|low|medium|high|xhigh)$/, '');
    // OpenCode may lag behind the ChatGPT Codex model allowlist. Route known older
    // Codex selections to the latest backend model when users opt in.
    const preferLatestRaw = process.env.OPENCODE_MULTI_AUTH_PREFER_CODEX_LATEST;
    const preferLatest = preferLatestRaw === '1' || preferLatestRaw === 'true';
    if (preferLatest &&
        (baseModel === 'gpt-5.4' ||
            baseModel === 'gpt-5.3-codex' ||
            baseModel === 'gpt-5.2-codex' ||
            baseModel === 'gpt-5-codex')) {
        const latestModel = (process.env.OPENCODE_MULTI_AUTH_CODEX_LATEST_MODEL || DEFAULT_LATEST_CODEX_MODEL).trim();
        logDebug(`[multi-auth] model map: ${baseModel} -> ${latestModel}`, debugEnabled);
        return latestModel;
    }
    return baseModel;
}
function isSparkModel(model) {
    return typeof model === 'string' && model.startsWith('gpt-5.3-codex-spark');
}
function supportsFastMode(model) {
    return model === 'gpt-5.5' || model === 'gpt-5.4';
}
function ensureContentType(headers) {
    const responseHeaders = new Headers(headers);
    if (!responseHeaders.has('content-type')) {
        responseHeaders.set('content-type', 'text/event-stream; charset=utf-8');
    }
    return responseHeaders;
}
function extractErrorMessage(payload, fallbackText = '') {
    if (!payload || typeof payload !== 'object') {
        return fallbackText;
    }
    const detailMessage = typeof payload?.detail?.message === 'string'
        ? payload.detail.message
        : typeof payload?.detail === 'string'
            ? payload.detail
            : '';
    const errorMessage = typeof payload?.error?.message === 'string'
        ? payload.error.message
        : '';
    const topLevelMessage = typeof payload?.message === 'string'
        ? payload.message
        : '';
    return detailMessage || errorMessage || topLevelMessage || fallbackText;
}
function extractErrorCode(payload) {
    if (!payload || typeof payload !== 'object')
        return '';
    return ((typeof payload?.detail?.code === 'string' && payload.detail.code) ||
        (typeof payload?.error?.code === 'string' && payload.error.code) ||
        (typeof payload?.code === 'string' && payload.code) ||
        '');
}
export function isCyberPolicyError(payload, fallbackText = '') {
    const code = extractErrorCode(payload).toLowerCase();
    const text = `${extractErrorMessage(payload, fallbackText)} ${fallbackText}`.toLowerCase();
    return code === 'cyber_policy' || text.includes('cyber_policy');
}
function resolveRateLimitedUntil(rateLimits, headers, errorText, fallbackCooldownMs, now = Date.now()) {
    const retryAfterUntil = parseRetryAfterHeader(headers.get('retry-after'), now) || 0;
    const windowResetUntil = getBlockingRateLimitResetAt(rateLimits, now, {
        conservativeWhenRemainingUnknown: true
    }) || 0;
    const messageResetUntil = parseRateLimitResetFromError(errorText, now) || 0;
    const fallbackUntil = now + fallbackCooldownMs;
    return Math.max(fallbackUntil, retryAfterUntil, windowResetUntil, messageResetUntil);
}
function parseSseStream(sseText) {
    const lines = sseText.split('\n');
    for (const line of lines) {
        if (!line.startsWith('data: '))
            continue;
        try {
            const data = JSON.parse(line.substring(6));
            if (data?.type === 'response.done' || data?.type === 'response.completed') {
                return data.response;
            }
        }
        catch {
            // ignore malformed chunks
        }
    }
    return null;
}
async function convertSseToJson(response, headers) {
    if (!response.body) {
        throw new Error('[multi-auth] Response has no body');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        fullText += decoder.decode(value, { stream: true });
    }
    const finalResponse = parseSseStream(fullText);
    if (!finalResponse) {
        return new Response(fullText, {
            status: response.status,
            statusText: response.statusText,
            headers
        });
    }
    const jsonHeaders = new Headers(headers);
    jsonHeaders.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(finalResponse), {
        status: response.status,
        statusText: response.statusText,
        headers: jsonHeaders
    });
}
/**
 * Multi-account OAuth plugin for OpenCode
 *
 * Rotates between multiple ChatGPT Plus/Pro accounts for rate limit resilience.
 */
const MultiAuthPlugin = async ({ client, $, serverUrl, project, directory }) => {
    const terminalNotifierPath = (() => {
        const candidates = [
            '/opt/homebrew/bin/terminal-notifier',
            '/usr/local/bin/terminal-notifier'
        ];
        for (const c of candidates) {
            try {
                if (fs.existsSync(c))
                    return c;
            }
            catch {
                // ignore
            }
        }
        return null;
    })();
    const notifyEnabledRaw = process.env.OPENCODE_MULTI_AUTH_NOTIFY;
    const notifyEnabled = notifyEnabledRaw === '1' || notifyEnabledRaw === 'true';
    const notifySound = (process.env.OPENCODE_MULTI_AUTH_NOTIFY_SOUND || '/System/Library/Sounds/Glass.aiff').trim();
    const lastStatusBySession = new Map();
    const lastNotifiedAtByKey = new Map();
    const lastRetryAttemptBySession = new Map();
    const escapeAppleScriptString = (value) => {
        return String(value)
            .replaceAll('\\', '\\\\')
            .replaceAll('"', '\"')
            .replaceAll(String.fromCharCode(10), '\n');
    };
    let didWarnTerminalNotifier = false;
    const notifyMac = (title, message, clickUrl) => {
        if (!notifyEnabled)
            return;
        if (process.platform !== 'darwin')
            return;
        const macOpenRaw = process.env.OPENCODE_MULTI_AUTH_NOTIFY_MAC_OPEN;
        const macOpenEnabled = macOpenRaw !== '0' && macOpenRaw !== 'false';
        // Best effort: clickable notifications require terminal-notifier.
        if (macOpenEnabled && clickUrl && terminalNotifierPath) {
            try {
                $ `${terminalNotifierPath} -title ${title} -message ${message} -open ${clickUrl}`
                    .nothrow()
                    .catch(() => { });
            }
            catch {
                // ignore
            }
        }
        else {
            if (macOpenEnabled && clickUrl && !terminalNotifierPath && !didWarnTerminalNotifier) {
                didWarnTerminalNotifier = true;
                logDebug('[multi-auth] mac click-to-open requires terminal-notifier (brew install terminal-notifier)');
            }
            try {
                const osascript = '/usr/bin/osascript';
                const safeTitle = escapeAppleScriptString(title);
                const safeMessage = escapeAppleScriptString(message);
                const script = `display notification "${safeMessage}" with title "${safeTitle}"`;
                // Fire-and-forget: never block OpenCode event processing.
                $ `${osascript} -e ${script}`.nothrow().catch(() => { });
            }
            catch {
                // ignore
            }
        }
        if (!notifySound)
            return;
        try {
            const afplay = '/usr/bin/afplay';
            $ `${afplay} ${notifySound}`.nothrow().catch(() => { });
        }
        catch {
            // ignore
        }
    };
    const ntfyUrl = (process.env.OPENCODE_MULTI_AUTH_NOTIFY_NTFY_URL || '').trim();
    const ntfyToken = (process.env.OPENCODE_MULTI_AUTH_NOTIFY_NTFY_TOKEN || '').trim();
    const notifyUiBaseUrl = (process.env.OPENCODE_MULTI_AUTH_NOTIFY_UI_BASE_URL || '').trim();
    const getSessionUrl = (sessionID) => {
        const base = (notifyUiBaseUrl || serverUrl?.origin || '').replace(/\/$/, '');
        if (!base)
            return '';
        return `${base}/session/${sessionID}`;
    };
    const projectLabel = (project?.name || project?.id || '').trim() || 'OpenCode';
    const sessionMetaCache = new Map();
    const formatTitle = (kind) => {
        if (kind === 'error')
            return `OpenCode - ${projectLabel} - Error`;
        if (kind === 'retry')
            return `OpenCode - ${projectLabel} - Retrying`;
        return `OpenCode - ${projectLabel}`;
    };
    const formatBody = (kind, sessionID, detail) => {
        const meta = sessionMetaCache.get(sessionID) || {};
        const titleLine = meta.title ? `Task: ${meta.title}` : '';
        const url = getSessionUrl(sessionID);
        if (kind === 'idle') {
            return [titleLine, `Session finished: ${sessionID}`, detail || '', url].filter(Boolean).join('\n');
        }
        if (kind === 'retry') {
            return [titleLine, `Retrying: ${sessionID}`, detail || '', url].filter(Boolean).join('\n');
        }
        return [titleLine, `Error: ${sessionID}`, detail || '', url].filter(Boolean).join('\n');
    };
    const notifyMacRich = (kind, sessionID, detail) => {
        const body = formatBody(kind, sessionID, detail);
        notifyMac(formatTitle(kind), body, getSessionUrl(sessionID) || undefined);
    };
    const notifyNtfyRich = async (kind, sessionID, detail) => {
        if (!notifyEnabled)
            return;
        if (!ntfyUrl)
            return;
        const sessionUrl = getSessionUrl(sessionID);
        const title = formatTitle(kind);
        const body = formatBody(kind, sessionID, detail);
        // ntfy priority: 1=min, 3=default, 5=max
        const priority = kind === 'error' ? '5' : kind === 'retry' ? '4' : '3';
        const headers = {
            'Content-Type': 'text/plain; charset=utf-8',
            'Title': title,
            'Priority': priority
        };
        if (sessionUrl)
            headers['Click'] = sessionUrl;
        if (ntfyToken)
            headers['Authorization'] = `Bearer ${ntfyToken}`;
        try {
            await fetch(ntfyUrl, { method: 'POST', headers, body });
        }
        catch {
            // ignore
        }
    };
    const shouldThrottle = (key, minMs) => {
        const last = lastNotifiedAtByKey.get(key) || 0;
        const now = Date.now();
        if (now - last < minMs)
            return true;
        lastNotifiedAtByKey.set(key, now);
        return false;
    };
    const formatRetryDetail = (status) => {
        const attempt = typeof status?.attempt === 'number' ? status.attempt : undefined;
        const message = typeof status?.message === 'string' ? status.message : '';
        const next = typeof status?.next === 'number' ? status.next : undefined;
        const parts = [];
        if (typeof attempt === 'number')
            parts.push(`Attempt: ${attempt}`);
        // OpenCode has emitted both "seconds-until-next" and "epoch ms" variants over time.
        if (typeof next === 'number') {
            const seconds = next > 1e12 ? Math.max(0, Math.round((next - Date.now()) / 1000)) : Math.max(0, Math.round(next));
            parts.push(`Next in: ${seconds}s`);
        }
        if (message)
            parts.push(message);
        return parts.join(' | ');
    };
    const formatErrorDetail = (err) => {
        if (!err || typeof err !== 'object')
            return '';
        const name = typeof err.name === 'string' ? err.name : '';
        const code = typeof err.code === 'string' ? err.code : '';
        const message = (typeof err.message === 'string' && err.message) ||
            (typeof err.error?.message === 'string' && err.error.message) ||
            '';
        return [name, code, message].filter(Boolean).join(': ');
    };
    const notifyRich = async (kind, sessionID, detail) => {
        try {
            notifyMacRich(kind, sessionID, detail);
        }
        catch {
            // ignore
        }
        try {
            await notifyNtfyRich(kind, sessionID, detail);
        }
        catch {
            // ignore
        }
    };
    return {
        event: async ({ event }) => {
            if (!notifyEnabled)
                return;
            if (!event || !('type' in event))
                return;
            if (event.type === 'session.created' || event.type === 'session.updated') {
                const info = event.properties?.info;
                const id = info?.id;
                if (id) {
                    sessionMetaCache.set(id, { title: info?.title });
                }
                return;
            }
            if (event.type === 'session.status') {
                const sessionID = event.properties?.sessionID;
                const status = event.properties?.status;
                const statusType = status?.type;
                if (!sessionID || !statusType)
                    return;
                lastStatusBySession.set(sessionID, statusType);
                if (statusType === 'retry') {
                    const attempt = typeof status?.attempt === 'number' ? status.attempt : undefined;
                    const prevAttempt = lastRetryAttemptBySession.get(sessionID);
                    if (typeof attempt === 'number') {
                        if (prevAttempt === attempt && shouldThrottle(`retry:${sessionID}:${attempt}`, 5000)) {
                            return;
                        }
                        lastRetryAttemptBySession.set(sessionID, attempt);
                    }
                    const key = `retry:${sessionID}:${typeof attempt === 'number' ? attempt : 'na'}`;
                    if (shouldThrottle(key, 2000))
                        return;
                    void notifyRich('retry', sessionID, formatRetryDetail(status));
                }
                return;
            }
            if (event.type === 'session.error') {
                const sessionID = event.properties?.sessionID;
                const id = sessionID || 'unknown';
                const err = event.properties?.error;
                const detail = formatErrorDetail(err);
                const key = `error:${id}:${detail}`;
                if (shouldThrottle(key, 2000))
                    return;
                void notifyRich('error', id, detail);
                return;
            }
            if (event.type === 'session.idle') {
                const sessionID = event.properties?.sessionID;
                if (!sessionID)
                    return;
                const prev = lastStatusBySession.get(sessionID);
                if (prev === 'busy' || prev === 'retry') {
                    if (shouldThrottle(`idle:${sessionID}`, 2000))
                        return;
                    void notifyRich('idle', sessionID);
                }
                lastStatusBySession.set(sessionID, 'idle');
            }
        },
        config: async (config) => {
            const injectModelsRaw = process.env.OPENCODE_MULTI_AUTH_INJECT_MODELS;
            const injectModels = injectModelsRaw !== '0' && injectModelsRaw !== 'false';
            if (!injectModels)
                return;
            const latestModel = (process.env.OPENCODE_MULTI_AUTH_CODEX_LATEST_MODEL || DEFAULT_LATEST_CODEX_MODEL).trim();
            try {
                const openai = config.provider?.[PROVIDER_ID] || null;
                if (!openai || typeof openai !== 'object')
                    return;
                openai.models ||= {};
                openai.whitelist ||= [];
                const defaultModels = getDefaultModels();
                const injectedModelIds = [latestModel];
                if (supportsFastMode(latestModel) && defaultModels[`${latestModel}-fast`]) {
                    injectedModelIds.push(`${latestModel}-fast`);
                }
                for (const sparkVariant of [
                    'gpt-5.3-codex-spark-low',
                    'gpt-5.3-codex-spark-medium',
                    'gpt-5.3-codex-spark-high',
                    'gpt-5.3-codex-spark-xhigh'
                ]) {
                    if (defaultModels[sparkVariant]) {
                        injectedModelIds.push(sparkVariant);
                    }
                }
                for (const modelID of injectedModelIds) {
                    const model = defaultModels[modelID];
                    if (!model || openai.models[modelID])
                        continue;
                    openai.models[modelID] = model;
                }
                for (const modelID of injectedModelIds) {
                    if (!openai.whitelist.includes(modelID)) {
                        openai.whitelist.unshift(modelID);
                    }
                }
                logDebug(`[multi-auth] injected runtime models: ${injectedModelIds.join(', ')}`);
            }
            catch (err) {
                logDebugValue('[multi-auth] config injection failed', err);
            }
        },
        auth: {
            provider: PROVIDER_ID,
            /**
             * Loader configures the SDK with multi-account rotation
             */
            async loader(getAuth, provider) {
                await syncAuthFromOpenCode(getAuth);
                const accounts = listAccounts();
                if (accounts.length === 0) {
                    console.log('[multi-auth] No accounts configured. Run: opencode-multi-auth add <alias>');
                    return {};
                }
                const customFetch = async (input, init) => {
                    await syncAuthFromOpenCode(getAuth);
                    const debugLogging = isDebugEnabled();
                    let body = {};
                    try {
                        body = init?.body ? JSON.parse(init.body) : {};
                    }
                    catch {
                        body = {};
                    }
                    const normalizedModel = normalizeModel(body.model, debugLogging);
                    const sessionAffinity = getRequestHeader(input, init, 'x-session-affinity')?.trim() || undefined;
                    const promptCacheKey = typeof body?.prompt_cache_key === 'string' && body.prompt_cache_key.trim()
                        ? body.prompt_cache_key.trim()
                        : undefined;
                    const routeSessionId = sessionAffinity || promptCacheKey;
                    const routeSessionSource = sessionAffinity
                        ? 'x-session-affinity'
                        : promptCacheKey
                            ? 'prompt_cache_key'
                            : 'none';
                    if (debugLogging) {
                        /*
                          logDebugValue('[multi-auth] request.body', {
                            method: init?.method || 'POST',
                            url: extractRequestUrl(input),
                            model: body.model,
                            normalizedModel,
                            stream: body?.stream === true,
                            sessionId: body?.prompt_cache_key,
                            body
                          }, debugLogging)
                      */
                    }
                    const store = loadStore();
                    const forceState = getForceState();
                    const forcePinned = isForceActive() && !!forceState.forcedAlias;
                    const eligibleCount = Object.values(store.accounts).filter(acc => {
                        const now = Date.now();
                        return (!acc.rateLimitedUntil || acc.rateLimitedUntil < now) &&
                            (!acc.modelUnsupportedUntil || acc.modelUnsupportedUntil < now) &&
                            (!acc.workspaceDeactivatedUntil || acc.workspaceDeactivatedUntil < now) &&
                            !acc.authInvalid &&
                            acc.enabled !== false;
                    }).length;
                    logDebug(`[multi-auth] routing start model=${normalizedModel} eligible=${eligibleCount} forcePinned=${forcePinned}`, debugLogging);
                    logDebug(`[multi-auth] routeSessionSource=${routeSessionSource} routeSessionId=${routeSessionId || 'none'} backendCacheKey=${promptCacheKey || 'none'}`, debugLogging);
                    const maxAttempts = forcePinned ? 1 : Math.max(1, eligibleCount);
                    const triedAliases = new Set();
                    let attempt = 0;
                    while (attempt < maxAttempts) {
                        attempt++;
                        const settings = getRuntimeSettings();
                        const effectiveConfig = {
                            ...pluginConfig,
                            rotationStrategy: settings.settings.rotationStrategy
                        };
                        const rotation = await getNextAccount(effectiveConfig, {
                            model: normalizedModel,
                            sessionId: routeSessionId
                        });
                        if (!rotation) {
                            if (forcePinned && forceState.forcedAlias) {
                                const forced = loadStore().accounts[forceState.forcedAlias];
                                const now = Date.now();
                                if (forced?.rateLimitedUntil && forced.rateLimitedUntil > now) {
                                    return new Response(JSON.stringify({
                                        error: {
                                            code: 'RATE_LIMITED',
                                            message: `Forced account '${forced.alias}' is rate-limited until ${new Date(forced.rateLimitedUntil).toISOString()}`,
                                            details: { alias: forced.alias, rateLimitedUntil: forced.rateLimitedUntil }
                                        }
                                    }), { status: 429, headers: { 'Content-Type': 'application/json' } });
                                }
                            }
                            return new Response(JSON.stringify({
                                error: Errors.noEligibleAccounts('No available accounts after filtering')
                            }), { status: 503, headers: { 'Content-Type': 'application/json' } });
                        }
                        const { account, token } = rotation;
                        logDebug(`[multi-auth] routing selected alias=${account.alias} strategy=${effectiveConfig.rotationStrategy} attempt=${attempt}/${maxAttempts}`, debugLogging);
                        if (triedAliases.has(account.alias)) {
                            logDebug(`[multi-auth] routing skipped duplicate alias=${account.alias}`, debugLogging);
                            continue;
                        }
                        triedAliases.add(account.alias);
                        const decoded = decodeJWT(token);
                        const accountId = decoded?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
                        if (!accountId) {
                            logDebug(`[multi-auth] token parse failed alias=${account.alias}`, debugLogging);
                            return new Response(JSON.stringify({
                                error: {
                                    code: 'TOKEN_PARSE_ERROR',
                                    message: '[multi-auth] Failed to extract accountId from token'
                                }
                            }), { status: 401, headers: { 'Content-Type': 'application/json' } });
                        }
                        const originalUrl = extractRequestUrl(input);
                        const url = toCodexBackendUrl(originalUrl);
                        const isStreaming = body?.stream === true;
                        const fastMode = /-fast$/.test(body.model || '');
                        const supportedFastMode = fastMode && supportsFastMode(normalizedModel);
                        const reasoningMatch = body.model?.match(/-(none|low|medium|high|xhigh)$/);
                        const payload = {
                            ...body,
                            model: normalizedModel,
                            store: false
                        };
                        // logDebugValue('[multi-auth] payload.before', payload, debugLogging)
                        if (payload.truncation === undefined) {
                            const truncationRaw = (process.env.OPENCODE_MULTI_AUTH_TRUNCATION || '').trim();
                            if (truncationRaw && truncationRaw !== 'disabled' && truncationRaw !== 'false' && truncationRaw !== '0') {
                                payload.truncation = truncationRaw;
                            }
                        }
                        if (payload.input) {
                            payload.input = filterInput(payload.input);
                        }
                        if (reasoningMatch?.[1]) {
                            payload.reasoning = {
                                ...(payload.reasoning || {}),
                                effort: reasoningMatch[1]
                            };
                            if (!isSparkModel(normalizedModel)) {
                                payload.reasoning.summary = payload.reasoning?.summary || 'auto';
                            }
                        }
                        if (isSparkModel(normalizedModel) && payload.reasoning?.summary !== undefined) {
                            delete payload.reasoning.summary;
                        }
                        if (supportedFastMode) {
                            payload.service_tier = payload.service_tier || 'priority';
                            logDebug(`[multi-auth] fast mode enabled: ${normalizedModel} + service_tier=priority`, debugLogging);
                        }
                        else if (fastMode) {
                            logDebug(`[multi-auth] fast mode ignored for unsupported model: ${normalizedModel}`, debugLogging);
                        }
                        if (payload.service_tier === 'priority') {
                            logDebug(`[multi-auth] priority service tier requested for ${normalizedModel}`, debugLogging);
                        }
                        delete payload.reasoning_effort;
                        logDebugValue('[multi-auth] payload.after', payload, debugLogging);
                        try {
                            const headers = new Headers(init?.headers || {});
                            headers.delete('x-api-key');
                            headers.set('Content-Type', 'application/json');
                            headers.set('Authorization', `Bearer ${token}`);
                            headers.set(OPENAI_HEADERS.ACCOUNT_ID, accountId);
                            headers.set(OPENAI_HEADERS.BETA, OPENAI_HEADER_VALUES.BETA_RESPONSES);
                            headers.set(OPENAI_HEADERS.ORIGINATOR, OPENAI_HEADER_VALUES.ORIGINATOR_CODEX);
                            const cacheKey = payload?.prompt_cache_key;
                            if (cacheKey) {
                                headers.set(OPENAI_HEADERS.CONVERSATION_ID, cacheKey);
                                headers.set(OPENAI_HEADERS.SESSION_ID, cacheKey);
                            }
                            else {
                                headers.delete(OPENAI_HEADERS.CONVERSATION_ID);
                                headers.delete(OPENAI_HEADERS.SESSION_ID);
                            }
                            headers.set('accept', 'text/event-stream');
                            const sendPayload = async (requestPayload) => {
                                logDebugValue('[multi-auth] upstream.request', {
                                    url,
                                    method: init?.method || 'POST',
                                    headers: {
                                        accountId,
                                        contentType: 'application/json',
                                        beta: OPENAI_HEADER_VALUES.BETA_RESPONSES,
                                        originator: OPENAI_HEADER_VALUES.ORIGINATOR_CODEX,
                                        cacheKey: payload?.prompt_cache_key
                                    },
                                    requestPayload
                                }, debugLogging);
                                return fetch(url, {
                                    method: init?.method || 'POST',
                                    headers,
                                    body: JSON.stringify(requestPayload)
                                });
                            };
                            const applyLimitUpdate = (response) => {
                                const limitUpdate = extractRateLimitUpdate(response.headers);
                                const mergedRateLimits = limitUpdate
                                    ? mergeRateLimits(account.rateLimits, limitUpdate)
                                    : account.rateLimits;
                                if (limitUpdate) {
                                    const blockingResetAt = getBlockingRateLimitResetAt(mergedRateLimits);
                                    logDebug(`[multi-auth] rate limit update alias=${account.alias} blockingResetAt=${blockingResetAt || 'none'}`, debugLogging);
                                    updateAccount(account.alias, {
                                        rateLimits: mergedRateLimits,
                                        rateLimitedUntil: blockingResetAt
                                    });
                                }
                                return mergedRateLimits;
                            };
                            let res = await sendPayload(payload);
                            let mergedRateLimits = applyLimitUpdate(res);
                            if (res.status === 400 && payload.service_tier === 'priority') {
                                const errorData = await res.clone().json().catch(() => ({}));
                                const errorText = await res.clone().text().catch(() => '');
                                if (isCyberPolicyError(errorData, errorText)) {
                                    logDebug('[multi-auth] cyber_policy on priority tier; retrying once without service_tier', debugLogging);
                                    const standardTierPayload = { ...payload };
                                    delete standardTierPayload.service_tier;
                                    res = await sendPayload(standardTierPayload);
                                    mergedRateLimits = applyLimitUpdate(res);
                                }
                            }
                            if (res.status === 401 || res.status === 403) {
                                const errorData = await res.clone().json().catch(() => ({}));
                                const message = errorData?.error?.message || '';
                                if (message.toLowerCase().includes('invalidated') || res.status === 401) {
                                    logDebug(`[multi-auth] auth invalidated alias=${account.alias} status=${res.status}`, debugLogging);
                                    markAuthInvalid(account.alias);
                                }
                                if (attempt < maxAttempts) {
                                    continue;
                                }
                                return new Response(JSON.stringify({
                                    error: Errors.maxRetriesExceeded(attempt, Array.from(triedAliases))
                                }), { status: res.status, headers: { 'Content-Type': 'application/json' } });
                            }
                            if (res.status === 429) {
                                const errorData = await res.clone().json().catch(() => ({}));
                                const errorText = extractErrorMessage(errorData);
                                const rateLimitedUntil = resolveRateLimitedUntil(mergedRateLimits, res.headers, errorText, pluginConfig.rateLimitCooldownMs);
                                logDebug(`[multi-auth] rate limited alias=${account.alias} until=${rateLimitedUntil}`, debugLogging);
                                markRateLimited(account.alias, rateLimitedUntil);
                                if (attempt < maxAttempts) {
                                    continue;
                                }
                                return new Response(JSON.stringify({
                                    error: Errors.maxRetriesExceeded(attempt, Array.from(triedAliases))
                                }), { status: 429, headers: { 'Content-Type': 'application/json' } });
                            }
                            if (res.status === 402) {
                                const errorData = await res.clone().json().catch(() => null);
                                const errorText = await res.clone().text().catch(() => '');
                                const code = (typeof errorData?.detail?.code === 'string' && errorData.detail.code) ||
                                    (typeof errorData?.error?.code === 'string' && errorData.error.code) ||
                                    '';
                                const message = (typeof errorData?.detail?.message === 'string' && errorData.detail.message) ||
                                    (typeof errorData?.detail === 'string' && errorData.detail) ||
                                    (typeof errorData?.error?.message === 'string' && errorData.error.message) ||
                                    (typeof errorData?.message === 'string' && errorData.message) ||
                                    errorText ||
                                    '';
                                const isDeactivatedWorkspace = code === 'deactivated_workspace' ||
                                    message.toLowerCase().includes('deactivated_workspace') ||
                                    message.toLowerCase().includes('deactivated workspace');
                                if (isDeactivatedWorkspace) {
                                    logDebug(`[multi-auth] workspace deactivated alias=${account.alias} until=${Date.now() + pluginConfig.workspaceDeactivatedCooldownMs}`, debugLogging);
                                    markWorkspaceDeactivated(account.alias, pluginConfig.workspaceDeactivatedCooldownMs, {
                                        error: message || code
                                    });
                                    if (attempt < maxAttempts) {
                                        continue;
                                    }
                                    return new Response(JSON.stringify({
                                        error: Errors.maxRetriesExceeded(attempt, Array.from(triedAliases))
                                    }), { status: 402, headers: { 'Content-Type': 'application/json' } });
                                }
                            }
                            if (res.status === 400) {
                                const errorData = await res.clone().json().catch(() => ({}));
                                const message = (typeof errorData?.detail === 'string' && errorData.detail) ||
                                    (typeof errorData?.error?.message === 'string' && errorData.error.message) ||
                                    (typeof errorData?.message === 'string' && errorData.message) ||
                                    '';
                                const isModelUnsupported = typeof message === 'string' &&
                                    message.toLowerCase().includes('model is not supported') &&
                                    message.toLowerCase().includes('chatgpt account');
                                if (isModelUnsupported) {
                                    logDebug(`[multi-auth] model unsupported alias=${account.alias} model=${normalizedModel}`, debugLogging);
                                    markModelUnsupported(account.alias, pluginConfig.modelUnsupportedCooldownMs, {
                                        model: normalizedModel,
                                        error: message
                                    });
                                    if (attempt < maxAttempts) {
                                        continue;
                                    }
                                    return new Response(JSON.stringify({
                                        error: Errors.maxRetriesExceeded(attempt, Array.from(triedAliases))
                                    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
                                }
                            }
                            if (!res.ok) {
                                logDebug(`[multi-auth] upstream response not ok alias=${account.alias} status=${res.status}`, debugLogging);
                                return res;
                            }
                            const responseHeaders = ensureContentType(res.headers);
                            if (!isStreaming && responseHeaders.get('content-type')?.includes('text/event-stream')) {
                                logDebug(`[multi-auth] converting SSE to JSON alias=${account.alias}`, debugLogging);
                                return await convertSseToJson(res, responseHeaders);
                            }
                            logDebug(`[multi-auth] upstream response ok alias=${account.alias} status=${res.status}`, debugLogging);
                            return res;
                        }
                        catch (err) {
                            logDebugValue('[multi-auth] request failed', err, debugLogging);
                            return new Response(JSON.stringify({ error: { code: 'REQUEST_FAILED', message: `[multi-auth] Request failed: ${err}` } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
                        }
                    }
                    return new Response(JSON.stringify({
                        error: Errors.maxRetriesExceeded(attempt, Array.from(triedAliases))
                    }), { status: 503, headers: { 'Content-Type': 'application/json' } });
                };
                // Return SDK configuration with custom fetch for rotation
                return {
                    apiKey: 'chatgpt-oauth',
                    baseURL: CODEX_BASE_URL,
                    fetch: customFetch
                };
            },
            methods: [
                {
                    label: 'ChatGPT OAuth (Multi-Account)',
                    type: 'oauth',
                    prompts: [
                        {
                            type: 'text',
                            key: 'alias',
                            message: 'Account alias (e.g., personal, work)',
                            placeholder: 'personal'
                        }
                    ],
                    /**
                     * OAuth flow - opens browser for ChatGPT login
                     */
                    authorize: async (inputs) => {
                        const alias = inputs?.alias || `account-${Date.now()}`;
                        const flow = await createAuthorizationFlow();
                        return {
                            url: flow.url,
                            method: 'auto',
                            instructions: `Login with your ChatGPT Plus/Pro account for "${alias}"`,
                            callback: async () => {
                                try {
                                    const account = await loginAccount(alias, flow);
                                    return {
                                        type: 'success',
                                        provider: PROVIDER_ID,
                                        refresh: account.refreshToken,
                                        access: account.accessToken,
                                        expires: account.expiresAt
                                    };
                                }
                                catch {
                                    return { type: 'failed' };
                                }
                            }
                        };
                    }
                },
                {
                    label: 'Skip (use existing accounts)',
                    type: 'api'
                }
            ]
        }
    };
};
export default MultiAuthPlugin;
//# sourceMappingURL=index.js.map