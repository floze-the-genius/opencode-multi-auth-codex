import { getBlockingRateLimitResetAt, isRateLimitErrorText, mergeRateLimits, parseRateLimitResetFromError } from './rate-limits.js';
import { markAuthInvalid, markWorkspaceDeactivated } from './rotation.js';
import { loadStore, updateAccount } from './store.js';
import { probeRateLimitsForAccount } from './probe-limits.js';
import { logError, logInfo } from './logger.js';
import { DEFAULT_CONFIG, calculateLimitsConfidence } from './types.js';
import { fetchUsageRateLimitsForAccount } from './usage-limits.js';
const DEFAULT_LIMIT_REFRESH_DEPENDENCIES = {
    updateAccount,
    logError,
    logInfo,
    fetchUsageRateLimitsForAccount,
    probeRateLimitsForAccount,
    markAuthInvalid,
    markWorkspaceDeactivated
};
export async function refreshRateLimitsForAccount(account, dependencies = DEFAULT_LIMIT_REFRESH_DEPENDENCIES) {
    dependencies.updateAccount(account.alias, { limitStatus: 'running', limitError: undefined });
    dependencies.logInfo(`Refreshing limits for ${account.alias}`);
    const usage = await dependencies.fetchUsageRateLimitsForAccount(account);
    if (usage.rateLimits) {
        const now = Date.now();
        const updates = {
            rateLimits: mergeRateLimits(account.rateLimits, usage.rateLimits),
            limitStatus: 'success',
            limitError: undefined,
            lastLimitProbeAt: now,
            limitsConfidence: calculateLimitsConfidence(now, account.lastLimitErrorAt, 'success'),
            authInvalid: false,
            authInvalidatedAt: undefined
        };
        if (usage.planType) {
            updates.planType = usage.planType;
        }
        if (typeof usage.rateLimitedUntil === 'number' && usage.rateLimitedUntil > now) {
            updates.rateLimitedUntil = usage.rateLimitedUntil;
        }
        dependencies.updateAccount(account.alias, updates);
        dependencies.logInfo(`Limits refreshed for ${account.alias} via usage API`);
        return { alias: account.alias, updated: true };
    }
    if (usage.error) {
        if (usage.shouldProbeFallback === false) {
            const now = Date.now();
            if (usage.authInvalid) {
                dependencies.markAuthInvalid(account.alias);
            }
            if (usage.workspaceDeactivated) {
                dependencies.markWorkspaceDeactivated(account.alias, DEFAULT_CONFIG.workspaceDeactivatedCooldownMs, { error: usage.workspaceDeactivatedReason || usage.error });
            }
            dependencies.updateAccount(account.alias, {
                limitStatus: 'error',
                limitError: usage.error,
                lastLimitErrorAt: now,
                limitsConfidence: calculateLimitsConfidence(account.lastLimitProbeAt, now, 'error')
            });
            dependencies.logInfo(`Skipping limits probe for ${account.alias}: ${usage.error}`);
            return {
                alias: account.alias,
                updated: false,
                error: usage.error
            };
        }
        dependencies.logInfo(`Usage API limits lookup failed for ${account.alias}, falling back to probe: ${usage.error}`);
    }
    const probe = await dependencies.probeRateLimitsForAccount(account);
    if (!probe.isAuthoritative || !probe.rateLimits) {
        const now = Date.now();
        const errorText = usage.error || probe.error || 'Probe failed';
        dependencies.logError(`Limit refresh failed for ${account.alias}: ${errorText}`);
        const likelyRateLimit = isRateLimitErrorText(errorText);
        const parsedResetAt = parseRateLimitResetFromError(errorText, now);
        const fallbackResetAt = likelyRateLimit
            ? getBlockingRateLimitResetAt(account.rateLimits, now, {
                conservativeWhenRemainingUnknown: true
            })
            : undefined;
        const rateLimitedUntil = parsedResetAt ?? fallbackResetAt;
        const updates = {
            limitStatus: 'error',
            limitError: errorText,
            lastLimitErrorAt: now,
            limitsConfidence: calculateLimitsConfidence(account.lastLimitProbeAt, now, 'error')
        };
        if (typeof rateLimitedUntil === 'number' && rateLimitedUntil > now) {
            updates.rateLimitedUntil = rateLimitedUntil;
        }
        dependencies.updateAccount(account.alias, updates);
        return {
            alias: account.alias,
            updated: false,
            error: errorText
        };
    }
    const now = Date.now();
    const mergedRateLimits = mergeRateLimits(account.rateLimits, probe.rateLimits);
    const blockingResetAt = getBlockingRateLimitResetAt(mergedRateLimits, now);
    dependencies.updateAccount(account.alias, {
        rateLimits: mergedRateLimits,
        limitStatus: 'success',
        limitError: undefined,
        lastLimitProbeAt: now,
        limitsConfidence: calculateLimitsConfidence(now, account.lastLimitErrorAt, 'success'),
        rateLimitedUntil: blockingResetAt,
        authInvalid: false,
        authInvalidatedAt: undefined
    });
    dependencies.logInfo(`Limits refreshed for ${account.alias} using model ${probe.probeModel || 'unknown'}, effort ${probe.probeEffort || 'default'}`);
    return { alias: account.alias, updated: true };
}
export async function refreshRateLimits(accounts, alias) {
    if (alias) {
        const account = accounts.find((acc) => acc.alias === alias);
        if (!account) {
            return [{ alias, updated: false, error: 'Unknown alias' }];
        }
        return [await refreshRateLimitsForAccount(account)];
    }
    const store = loadStore();
    const results = [];
    for (const account of accounts) {
        results.push(await refreshRateLimitsForAccount(account));
    }
    if (results.length === 0 && !store.activeAlias) {
        return [{ alias: 'active', updated: false, error: 'No accounts configured' }];
    }
    return results;
}
//# sourceMappingURL=limits-refresh.js.map