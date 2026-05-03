import { getStoreDiagnostics, loadStore, saveStore, updateAccount } from './store.js';
import { ensureValidToken } from './auth.js';
import { decodeJwtPayload, getPlanTypeFromClaims } from './codex-auth.js';
import { isForceActive, checkAndAutoClearForce, getForceState, clearForce } from './force-mode.js';
import { getRuntimeSettings, calculateWeightedSelection } from './settings.js';
import { getSessionAlias, setSessionAlias, clearSession } from './session-store.js';
import { logDebug } from './logger.js';
const HEALTH_HYSTERESIS_MS = 10_000;
const RECENT_FAILURE_WINDOW_MS = 60_000;
function shuffled(input) {
    const a = [...input];
    for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function normalizePlanType(value) {
    const normalized = value?.trim().toLowerCase();
    return normalized ? normalized : undefined;
}
function getAccountPlanType(acc) {
    const persisted = normalizePlanType(acc.planType);
    if (persisted)
        return persisted;
    const idClaims = acc.idToken ? decodeJwtPayload(acc.idToken) : null;
    const accessClaims = acc.accessToken ? decodeJwtPayload(acc.accessToken) : null;
    return normalizePlanType(getPlanTypeFromClaims(idClaims) || getPlanTypeFromClaims(accessClaims));
}
function isProAccount(acc) {
    return getAccountPlanType(acc) === 'pro';
}
function isSparkModel(model) {
    return typeof model === 'string' && model.startsWith('gpt-5.3-codex-spark');
}
function getPreferredPools(store, availableAliases, selection) {
    const proAliases = availableAliases.filter((alias) => isProAccount(store.accounts[alias]));
    const nonProAliases = availableAliases.filter((alias) => !isProAccount(store.accounts[alias]));
    if (isSparkModel(selection?.model)) {
        return {
            primaryAliases: proAliases,
            fallbackAliases: []
        };
    }
    if (proAliases.length > 0) {
        return {
            primaryAliases: proAliases,
            fallbackAliases: nonProAliases
        };
    }
    return {
        primaryAliases: availableAliases,
        fallbackAliases: []
    };
}
function evaluateAccountHealth(acc, now) {
    const wasRateLimited = !!(acc.rateLimitedUntil && acc.rateLimitedUntil > now - HEALTH_HYSTERESIS_MS);
    const wasModelUnsupported = !!(acc.modelUnsupportedUntil && acc.modelUnsupportedUntil > now - HEALTH_HYSTERESIS_MS);
    const wasWorkspaceDeactivated = !!(acc.workspaceDeactivatedUntil && acc.workspaceDeactivatedUntil > now - HEALTH_HYSTERESIS_MS);
    // Phase D: Check if account is disabled
    const isDisabled = acc.enabled === false;
    const currentlyBlocked = !!(acc.rateLimitedUntil && acc.rateLimitedUntil > now) ||
        !!(acc.modelUnsupportedUntil && acc.modelUnsupportedUntil > now) ||
        !!(acc.workspaceDeactivatedUntil && acc.workspaceDeactivatedUntil > now) ||
        !!acc.authInvalid ||
        isDisabled; // Phase D: Exclude disabled accounts
    const isInProbation = !currentlyBlocked && (wasRateLimited || wasModelUnsupported || wasWorkspaceDeactivated);
    let recentFailures = 0;
    if (acc.lastLimitErrorAt && acc.lastLimitErrorAt > now - RECENT_FAILURE_WINDOW_MS) {
        recentFailures++;
    }
    if (acc.authInvalidatedAt && acc.authInvalidatedAt > now - RECENT_FAILURE_WINDOW_MS) {
        recentFailures++;
    }
    let priority = 100;
    if (isInProbation)
        priority -= 30;
    if (recentFailures > 0)
        priority -= recentFailures * 10;
    if (acc.usageCount === 0)
        priority -= 5;
    if (currentlyBlocked)
        priority = 0;
    // Phase D: Disabled accounts get lowest priority
    if (isDisabled)
        priority = -1;
    return {
        alias: acc.alias,
        isHealthy: !currentlyBlocked && !acc.authInvalid && !isDisabled,
        isInProbation,
        recentFailures,
        priority
    };
}
export async function getNextAccount(config, selection) {
    // Phase E: Check and auto-clear expired/invalid force state
    const autoClear = checkAndAutoClearForce();
    if (autoClear.wasCleared) {
        logDebug(`[multi-auth] Force mode auto-cleared: ${autoClear.reason}`);
    }
    // Phase E: Check if force mode is active
    const forceActive = isForceActive();
    const forceState = getForceState();
    let store = loadStore();
    const aliases = Object.keys(store.accounts);
    if (aliases.length === 0) {
        const diag = getStoreDiagnostics();
        const extra = diag.error ? ` (${diag.error})` : '';
        console.error(`[multi-auth] No accounts configured. Run: opencode-multi-auth add <alias>${extra}`);
        logDebug(`[multi-auth] store file: ${diag.storeFile}`);
        return null;
    }
    const now = Date.now();
    // Phase E: If force mode is active, never fall back to another alias.
    if (forceActive && forceState.forcedAlias) {
        const forcedAlias = forceState.forcedAlias;
        const forcedAccount = store.accounts[forcedAlias];
        if (forcedAccount) {
            const health = evaluateAccountHealth(forcedAccount, now);
            if (health.isHealthy) {
                const token = await ensureValidToken(forcedAlias);
                if (token) {
                    store = updateAccount(forcedAlias, {
                        usageCount: (forcedAccount.usageCount || 0) + 1,
                        lastUsed: now,
                        limitError: undefined
                    });
                    store.activeAlias = forcedAlias;
                    store.lastRotation = now;
                    saveStore(store);
                    console.log(`[multi-auth] Force mode: using ${forcedAlias}`);
                    return {
                        account: store.accounts[forcedAlias],
                        token,
                        forceState: {
                            active: true,
                            alias: forcedAlias,
                            remainingMs: forceState.forcedUntil ? forceState.forcedUntil - now : 0
                        }
                    };
                }
                else {
                    console.warn(`[multi-auth] Force mode: ${forcedAlias} token unavailable; refusing fallback`);
                    return null;
                }
            }
            else {
                console.warn(`[multi-auth] Force mode: ${forcedAlias} currently blocked; refusing fallback`);
                return null;
            }
        }
        else {
            // Forced account no longer exists - clear force and proceed normally.
            console.warn(`[multi-auth] Force mode: ${forcedAlias} not found, clearing force`);
            clearForce();
        }
    }
    // --- Sticky session routing ---
    const runtimeSettingsForSession = getRuntimeSettings();
    const sessionSettings = runtimeSettingsForSession.settings;
    const sessionId = selection?.sessionId;
    if (sessionId &&
        (sessionSettings.stickySessionRouting ?? true)) {
        const idleTimeoutMs = sessionSettings.sessionIdleTimeoutMs ?? 60 * 60 * 1000;
        const pinnedAlias = getSessionAlias(sessionId);
        if (pinnedAlias) {
            const pinnedAccount = store.accounts[pinnedAlias];
            if (pinnedAccount) {
                const pinnedHealth = evaluateAccountHealth(pinnedAccount, now);
                if (pinnedHealth.isHealthy) {
                    const token = await ensureValidToken(pinnedAlias);
                    if (token) {
                        store = updateAccount(pinnedAlias, {
                            usageCount: (pinnedAccount.usageCount || 0) + 1,
                            lastUsed: now,
                            limitError: undefined
                        });
                        store.activeAlias = pinnedAlias;
                        store.lastRotation = now;
                        saveStore(store);
                        setSessionAlias(sessionId, pinnedAlias, idleTimeoutMs);
                        logDebug(`[multi-auth] Session ${sessionId}: reusing pinned account ${pinnedAlias}`);
                        const currentForceState = getForceState();
                        return {
                            account: store.accounts[pinnedAlias],
                            token,
                            forceState: {
                                active: isForceActive(),
                                alias: currentForceState.forcedAlias,
                                remainingMs: currentForceState.forcedUntil ? currentForceState.forcedUntil - now : 0
                            }
                        };
                    }
                }
                // Pinned account is unhealthy.
                const fallback = sessionSettings.sessionStickyFallback ?? 'fail';
                if (fallback === 'fail') {
                    console.warn(`[multi-auth] Session ${sessionId}: pinned account ${pinnedAlias} is unavailable and sessionStickyFallback=fail`);
                    return null;
                }
                // fallback === 'rotate': evict the mapping and fall through to normal rotation.
                console.warn(`[multi-auth] Session ${sessionId}: pinned account ${pinnedAlias} unavailable; falling back to rotation`);
                clearSession(sessionId);
            }
            else {
                // Account was deleted; clean up stale mapping.
                clearSession(sessionId);
            }
        }
        // No existing mapping → fall through; after selection we'll record one.
    }
    // --- End sticky session routing ---
    const healthMap = new Map();
    for (const alias of aliases) {
        const acc = store.accounts[alias];
        healthMap.set(alias, evaluateAccountHealth(acc, now));
    }
    const availableAliases = aliases.filter(alias => {
        const health = healthMap.get(alias);
        return health?.isHealthy === true;
    });
    if (availableAliases.length === 0) {
        console.warn('[multi-auth] No available accounts (rate-limited or invalidated).');
        return null;
    }
    const tokenFailureCooldownMs = (() => {
        const raw = process.env.OPENCODE_MULTI_AUTH_TOKEN_FAILURE_COOLDOWN_MS;
        const parsed = raw ? Number(raw) : NaN;
        if (Number.isFinite(parsed) && parsed > 0)
            return parsed;
        return 60_000;
    })();
    const runtimeSettings = getRuntimeSettings();
    const rotationStrategy = runtimeSettings.settings.rotationStrategy || config.rotationStrategy;
    const buildCandidates = (candidateAliases) => {
        switch (rotationStrategy) {
            case 'least-used': {
                const sorted = [...candidateAliases].sort((a, b) => {
                    const aa = store.accounts[a];
                    const bb = store.accounts[b];
                    const healthA = healthMap.get(a);
                    const healthB = healthMap.get(b);
                    const priorityDiff = (healthB?.priority || 0) - (healthA?.priority || 0);
                    if (priorityDiff !== 0)
                        return priorityDiff;
                    const usageDiff = (aa?.usageCount || 0) - (bb?.usageCount || 0);
                    if (usageDiff !== 0)
                        return usageDiff;
                    const lastDiff = (aa?.lastUsed || 0) - (bb?.lastUsed || 0);
                    if (lastDiff !== 0)
                        return lastDiff;
                    return a.localeCompare(b);
                });
                return { aliases: sorted };
            }
            case 'random': {
                const sorted = [...candidateAliases].sort((a, b) => {
                    const healthA = healthMap.get(a);
                    const healthB = healthMap.get(b);
                    return (healthB?.priority || 0) - (healthA?.priority || 0);
                });
                const topPriority = sorted.slice(0, Math.ceil(sorted.length / 2));
                return { aliases: shuffled(topPriority.length > 0 ? topPriority : sorted) };
            }
            // Phase F: Weighted round-robin
            case 'weighted-round-robin': {
                const weights = runtimeSettings.settings.accountWeights;
                // Filter to healthy accounts with weights
                const weightedAliases = candidateAliases.filter(alias => (weights[alias] || 0) > 0);
                if (weightedAliases.length === 0) {
                    // Fallback to round-robin if no weights defined
                    const sorted = [...candidateAliases].sort((a, b) => {
                        const healthA = healthMap.get(a);
                        const healthB = healthMap.get(b);
                        return (healthB?.priority || 0) - (healthA?.priority || 0);
                    });
                    const start = store.rotationIndex % sorted.length;
                    const rr = sorted.map((_, i) => sorted[(start + i) % sorted.length]);
                    const nextIndex = (selected) => {
                        const idx = sorted.indexOf(selected);
                        if (idx < 0)
                            return store.rotationIndex;
                        return (idx + 1) % sorted.length;
                    };
                    return { aliases: rr, nextIndex };
                }
                // Use weighted selection
                const selected = calculateWeightedSelection(weightedAliases, weights);
                if (!selected) {
                    // Fallback to round-robin
                    const sorted = [...candidateAliases].sort((a, b) => {
                        const healthA = healthMap.get(a);
                        const healthB = healthMap.get(b);
                        return (healthB?.priority || 0) - (healthA?.priority || 0);
                    });
                    const start = store.rotationIndex % sorted.length;
                    const rr = sorted.map((_, i) => sorted[(start + i) % sorted.length]);
                    return { aliases: rr };
                }
                return { aliases: [selected] };
            }
            case 'use-up': {
                // Always use the lowest-indexed available account by drain order.
                // Once an account is exhausted (rate-limited) it drops out of
                // candidateAliases, and the next one in order takes over.
                const explicit = runtimeSettings.settings.useUpOrder ?? [];
                const storeOrder = Object.keys(store.accounts);
                const sorted = [...candidateAliases].sort((a, b) => {
                    let ia = explicit.indexOf(a);
                    let ib = explicit.indexOf(b);
                    // Aliases not in the explicit list are appended after it,
                    // ordered by store insertion order.
                    if (ia === -1)
                        ia = explicit.length + storeOrder.indexOf(a);
                    if (ib === -1)
                        ib = explicit.length + storeOrder.indexOf(b);
                    return ia - ib;
                });
                return { aliases: sorted };
            }
            case 'round-robin':
            default: {
                const sorted = [...candidateAliases].sort((a, b) => {
                    const healthA = healthMap.get(a);
                    const healthB = healthMap.get(b);
                    return (healthB?.priority || 0) - (healthA?.priority || 0);
                });
                const start = store.rotationIndex % sorted.length;
                const rr = sorted.map((_, i) => sorted[(start + i) % sorted.length]);
                const nextIndex = (selected) => {
                    const idx = sorted.indexOf(selected);
                    if (idx < 0)
                        return store.rotationIndex;
                    return (idx + 1) % sorted.length;
                };
                return { aliases: rr, nextIndex };
            }
        }
    };
    const { primaryAliases, fallbackAliases } = getPreferredPools(store, availableAliases, selection);
    const primary = buildCandidates(primaryAliases);
    const fallback = fallbackAliases.length > 0 ? buildCandidates(fallbackAliases) : { aliases: [] };
    const candidates = [...primary.aliases, ...fallback.aliases];
    for (const candidate of candidates) {
        const token = await ensureValidToken(candidate);
        if (!token) {
            store = updateAccount(candidate, {
                rateLimitedUntil: now + tokenFailureCooldownMs,
                limitError: '[multi-auth] Token unavailable (refresh failed?)',
                lastLimitErrorAt: now
            });
            continue;
        }
        store = updateAccount(candidate, {
            usageCount: (store.accounts[candidate]?.usageCount || 0) + 1,
            lastUsed: now,
            limitError: undefined
        });
        store.activeAlias = candidate;
        store.lastRotation = now;
        const nextIndex = primary.aliases.includes(candidate) ? primary.nextIndex : fallback.nextIndex;
        if (nextIndex) {
            store.rotationIndex = nextIndex(candidate);
        }
        saveStore(store);
        // Record session→account mapping for subsequent turns.
        if (sessionId && (sessionSettings.stickySessionRouting ?? true)) {
            const idleTimeoutMs = sessionSettings.sessionIdleTimeoutMs ?? 60 * 60 * 1000;
            setSessionAlias(sessionId, candidate, idleTimeoutMs);
            logDebug(`[multi-auth] Session ${sessionId}: pinned to account ${candidate}`);
        }
        const currentForceState = getForceState();
        return {
            account: store.accounts[candidate],
            token,
            forceState: {
                active: isForceActive(),
                alias: currentForceState.forcedAlias,
                remainingMs: currentForceState.forcedUntil ? currentForceState.forcedUntil - now : 0
            }
        };
    }
    console.error('[multi-auth] No available accounts (token refresh failed on all candidates).');
    return null;
}
export function markRateLimited(alias, rateLimitedUntil) {
    const now = Date.now();
    const safeUntil = Math.max(rateLimitedUntil, now + 1000);
    const seconds = Math.max(1, Math.ceil((safeUntil - now) / 1000));
    updateAccount(alias, {
        rateLimitedUntil: safeUntil
    });
    console.warn(`[multi-auth] Account ${alias} marked rate-limited for ${seconds}s`);
}
export function clearRateLimit(alias) {
    updateAccount(alias, {
        rateLimitedUntil: undefined
    });
}
export function markModelUnsupported(alias, cooldownMs, info) {
    updateAccount(alias, {
        modelUnsupportedUntil: Date.now() + cooldownMs,
        modelUnsupportedAt: Date.now(),
        modelUnsupportedModel: info?.model,
        modelUnsupportedError: info?.error
    });
    const extra = info?.model ? ` (model=${info.model})` : '';
    console.warn(`[multi-auth] Account ${alias} marked model-unsupported for ${cooldownMs / 1000}s${extra}`);
}
export function clearModelUnsupported(alias) {
    updateAccount(alias, {
        modelUnsupportedUntil: undefined,
        modelUnsupportedAt: undefined,
        modelUnsupportedModel: undefined,
        modelUnsupportedError: undefined
    });
}
export function markWorkspaceDeactivated(alias, cooldownMs, info) {
    updateAccount(alias, {
        workspaceDeactivatedUntil: Date.now() + cooldownMs,
        workspaceDeactivatedAt: Date.now(),
        workspaceDeactivatedError: info?.error
    });
    console.warn(`[multi-auth] Account ${alias} marked workspace-deactivated for ${cooldownMs / 1000}s`);
}
export function clearWorkspaceDeactivated(alias) {
    updateAccount(alias, {
        workspaceDeactivatedUntil: undefined,
        workspaceDeactivatedAt: undefined,
        workspaceDeactivatedError: undefined
    });
}
export function markAuthInvalid(alias) {
    updateAccount(alias, {
        authInvalid: true,
        authInvalidatedAt: Date.now()
    });
    console.warn(`[multi-auth] Account ${alias} marked invalidated`);
}
export function clearAuthInvalid(alias) {
    updateAccount(alias, {
        authInvalid: false,
        authInvalidatedAt: undefined
    });
}
export { clearSessionsForAlias } from './session-store.js';
export { listSessions, sessionCount, sessionCountByAlias, pruneExpired } from './session-store.js';
//# sourceMappingURL=rotation.js.map