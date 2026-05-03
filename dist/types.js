// Phase C: Calculate limits confidence based on probe timestamps
export function calculateLimitsConfidence(lastProbeAt, lastErrorAt, limitStatus) {
    const now = Date.now();
    const FRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes
    // If we have an error more recent than last success, show error
    if (lastErrorAt && (!lastProbeAt || lastErrorAt > lastProbeAt)) {
        // If we have some successful data, show stale with error
        if (lastProbeAt && now - lastProbeAt < STALE_THRESHOLD_MS) {
            return 'error';
        }
    }
    // No successful probe ever
    if (!lastProbeAt) {
        return 'unknown';
    }
    const ageMs = now - lastProbeAt;
    if (ageMs < FRESH_THRESHOLD_MS) {
        return 'fresh';
    }
    else if (ageMs < STALE_THRESHOLD_MS) {
        return 'stale';
    }
    else {
        // Data is too old, treat as unknown
        return 'unknown';
    }
}
export const DEFAULT_CONFIG = {
    rotationStrategy: 'round-robin',
    autoRefreshTokens: true,
    rateLimitCooldownMs: 5 * 60 * 1000, // 5 minutes
    modelUnsupportedCooldownMs: 30 * 60 * 1000, // 30 minutes
    workspaceDeactivatedCooldownMs: 30 * 60 * 1000, // 30 minutes
    modelFilter: /^gpt-5/
};
// Phase G: Default feature flags
export const DEFAULT_FEATURE_FLAGS = {
    antigravityEnabled: false
};
// Phase F: Default settings
export const DEFAULT_ROTATION_SETTINGS = {
    rotationStrategy: 'round-robin',
    debug: false,
    criticalThreshold: 10,
    lowThreshold: 30,
    accountWeights: {},
    stickySessionRouting: true,
    sessionIdleTimeoutMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    sessionStickyFallback: 'fail',
    featureFlags: { ...DEFAULT_FEATURE_FLAGS }
};
// Phase F: Preset configurations
export const WEIGHTED_PRESETS = {
    balanced: {
        name: 'balanced',
        description: 'Equal distribution across all accounts',
        defaultWeights: {}, // Calculated dynamically as 1/n
        thresholds: { critical: 10, low: 30 }
    },
    conservative: {
        name: 'conservative',
        description: 'Prefer accounts with higher remaining limits',
        defaultWeights: {}, // Calculated based on limit health
        thresholds: { critical: 20, low: 40 }
    },
    aggressive: {
        name: 'aggressive',
        description: 'Maximize throughput, accept higher risk',
        defaultWeights: {}, // Favor accounts with high usage
        thresholds: { critical: 5, low: 20 }
    },
    custom: {
        name: 'custom',
        description: 'User-defined weights and thresholds',
        defaultWeights: {},
        thresholds: { critical: 10, low: 30 }
    }
};
export function validateSettings(settings) {
    const errors = [];
    // Validate thresholds are in 0-100 range
    if (settings.criticalThreshold !== undefined) {
        if (settings.criticalThreshold < 0 || settings.criticalThreshold > 100) {
            errors.push({
                field: 'criticalThreshold',
                message: 'Critical threshold must be between 0 and 100',
                constraint: '0 <= criticalThreshold <= 100'
            });
        }
    }
    if (settings.lowThreshold !== undefined) {
        if (settings.lowThreshold < 0 || settings.lowThreshold > 100) {
            errors.push({
                field: 'lowThreshold',
                message: 'Low threshold must be between 0 and 100',
                constraint: '0 <= lowThreshold <= 100'
            });
        }
    }
    // Validate critical < low
    if (settings.criticalThreshold !== undefined && settings.lowThreshold !== undefined) {
        if (settings.criticalThreshold >= settings.lowThreshold) {
            errors.push({
                field: 'thresholds',
                message: 'Critical threshold must be less than low threshold',
                constraint: 'criticalThreshold < lowThreshold'
            });
        }
    }
    // Validate weights are in (0, 1] range
    if (settings.accountWeights) {
        for (const [alias, weight] of Object.entries(settings.accountWeights)) {
            if (weight <= 0 || weight > 1) {
                errors.push({
                    field: `accountWeights.${alias}`,
                    message: `Weight for ${alias} must be between 0 and 1`,
                    constraint: '0 < weight <= 1'
                });
            }
        }
        // Validate weights sum to approximately 1
        const totalWeight = Object.values(settings.accountWeights).reduce((sum, w) => sum + w, 0);
        if (totalWeight > 0 && Math.abs(totalWeight - 1) > 0.01) {
            errors.push({
                field: 'accountWeights',
                message: 'Total weights must sum to 1.0',
                constraint: 'sum(weights) ≈ 1.0'
            });
        }
    }
    if (settings.sessionStickyFallback !== undefined &&
        settings.sessionStickyFallback !== 'rotate' &&
        settings.sessionStickyFallback !== 'fail') {
        errors.push({
            field: 'sessionStickyFallback',
            message: 'Session sticky fallback must be rotate or fail',
            constraint: "sessionStickyFallback in ['rotate', 'fail']"
        });
    }
    return errors;
}
//# sourceMappingURL=types.js.map