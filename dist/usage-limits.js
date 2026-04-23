import { getBlockingRateLimitResetAt, hasMeaningfulRateLimits } from './rate-limits.js';
const DEFAULT_USAGE_BASE_URL = 'https://chatgpt.com/backend-api';
const USAGE_BASE_URL_ENV = 'OPENCODE_MULTI_AUTH_USAGE_BASE_URL';
function getUsageBaseUrl() {
    const override = process.env[USAGE_BASE_URL_ENV]?.trim();
    const baseUrl = override || DEFAULT_USAGE_BASE_URL;
    return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}
function mapWindow(window, now) {
    if (!window)
        return undefined;
    const usedPercent = typeof window.used_percent === 'number' ? window.used_percent : undefined;
    const resetAt = typeof window.reset_at === 'number'
        ? window.reset_at * 1000
        : typeof window.reset_after_seconds === 'number'
            ? now + window.reset_after_seconds * 1000
            : undefined;
    if (usedPercent === undefined && resetAt === undefined) {
        return undefined;
    }
    return {
        limit: 100,
        remaining: typeof usedPercent === 'number' ? Math.max(0, 100 - usedPercent) : undefined,
        resetAt,
        updatedAt: now
    };
}
function pickRateLimitDetails(payload) {
    if (payload.rate_limit)
        return payload.rate_limit;
    const additional = Array.isArray(payload.additional_rate_limits) ? payload.additional_rate_limits : [];
    const preferred = additional.find((entry) => {
        const feature = entry.metered_feature?.trim().toLowerCase();
        const limitName = entry.limit_name?.trim().toLowerCase();
        return feature === 'codex' || limitName === 'codex';
    });
    if (preferred?.rate_limit)
        return preferred.rate_limit;
    return additional.find((entry) => entry.rate_limit)?.rate_limit || null;
}
function parseUsageFailure(rawText) {
    const trimmed = rawText.trim();
    if (!trimmed) {
        return {};
    }
    try {
        const payload = JSON.parse(trimmed);
        const code = (typeof payload?.detail?.code === 'string' && payload.detail.code) ||
            (typeof payload?.error?.code === 'string' && payload.error.code) ||
            undefined;
        const message = (typeof payload?.detail?.message === 'string' && payload.detail.message) ||
            (typeof payload?.detail === 'string' && payload.detail) ||
            (typeof payload?.error?.message === 'string' && payload.error.message) ||
            (typeof payload?.message === 'string' && payload.message) ||
            undefined;
        return { code, message };
    }
    catch {
        return { message: trimmed };
    }
}
export function classifyUsageApiFailure(status, rawText) {
    const { code, message } = parseUsageFailure(rawText);
    const normalized = [code, message, rawText.trim()]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    if (status === 401) {
        return {
            shouldProbeFallback: false,
            authInvalid: true
        };
    }
    // 403 from the Codex usage endpoint is usually a Cloudflare gate, not proof
    // that the OAuth token is invalid. Keep the account eligible and fall back to
    // the probe path.
    if (status === 403) {
        return {
            shouldProbeFallback: true,
            authInvalid: false
        };
    }
    if (status === 402 &&
        (normalized.includes('deactivated_workspace') ||
            normalized.includes('deactivated workspace'))) {
        return {
            shouldProbeFallback: false,
            workspaceDeactivated: true,
            workspaceDeactivatedReason: message || code || rawText.trim() || undefined
        };
    }
    return { shouldProbeFallback: true };
}
export async function fetchUsageRateLimitsForAccount(account) {
    const token = account.accessToken?.trim();
    if (!token) {
        return {
            source: 'usage-api',
            error: 'Missing access token'
        };
    }
    const url = `${getUsageBaseUrl()}/codex/usage`;
    const headers = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'codex_cli_rs/0.122.0 (linux)',
        originator: 'codex_cli_rs'
    };
    if (account.accountId) {
        headers['ChatGPT-Account-Id'] = account.accountId;
    }
    const maxAttempts = 3;
    let res;
    let rawText = '';
    let lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            res = await fetch(url, { method: 'GET', headers });
        }
        catch (err) {
            lastErr = err;
            if (attempt === maxAttempts - 1) {
                return {
                    source: 'usage-api',
                    error: `Usage API request failed: ${err}`
                };
            }
            await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 1500));
            continue;
        }
        try {
            rawText = await res.text();
        }
        catch {
            rawText = '';
        }
        const isCloudflareChallenge = res.status === 403 &&
            rawText.trimStart().slice(0, 16).toLowerCase().includes('<html');
        if (!isCloudflareChallenge || attempt === maxAttempts - 1)
            break;
        await new Promise((resolve) => setTimeout(resolve, 1000 + attempt * 2000));
    }
    if (!res) {
        return {
            source: 'usage-api',
            error: `Usage API request failed: ${lastErr}`
        };
    }
    if (!res.ok) {
        const trimmed = rawText.trim();
        const classification = classifyUsageApiFailure(res.status, rawText);
        return {
            source: 'usage-api',
            error: `Usage API returned ${res.status}${trimmed ? `: ${trimmed.slice(0, 280)}` : ''}`,
            ...classification
        };
    }
    let payload;
    try {
        payload = JSON.parse(rawText);
    }
    catch (err) {
        return {
            source: 'usage-api',
            error: `Usage API returned invalid JSON: ${err}`
        };
    }
    const now = Date.now();
    const details = pickRateLimitDetails(payload);
    const rateLimits = {
        fiveHour: mapWindow(details?.primary_window, now),
        weekly: mapWindow(details?.secondary_window, now)
    };
    if (!hasMeaningfulRateLimits(rateLimits)) {
        return {
            source: 'usage-api',
            planType: payload.plan_type,
            error: 'Usage API response contained no usable rate limit windows'
        };
    }
    const rateLimitedUntil = details?.limit_reached || details?.allowed === false
        ? getBlockingRateLimitResetAt(rateLimits, now)
        : undefined;
    return {
        source: 'usage-api',
        planType: payload.plan_type,
        rateLimits,
        rateLimitedUntil
    };
}
//# sourceMappingURL=usage-limits.js.map