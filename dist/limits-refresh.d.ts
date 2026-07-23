import { markAuthInvalid, markWorkspaceDeactivated } from './rotation.js';
import { updateAccount } from './store.js';
import { probeRateLimitsForAccount } from './probe-limits.js';
import { logError, logInfo } from './logger.js';
import { fetchUsageRateLimitsForAccount } from './usage-limits.js';
import type { AccountCredentials } from './types.js';
export interface LimitRefreshResult {
    alias: string;
    updated: boolean;
    error?: string;
}
export interface LimitRefreshDependencies {
    updateAccount: typeof updateAccount;
    logError: typeof logError;
    logInfo: typeof logInfo;
    fetchUsageRateLimitsForAccount: typeof fetchUsageRateLimitsForAccount;
    probeRateLimitsForAccount: typeof probeRateLimitsForAccount;
    markAuthInvalid: typeof markAuthInvalid;
    markWorkspaceDeactivated: typeof markWorkspaceDeactivated;
}
export declare function refreshRateLimitsForAccount(account: AccountCredentials, dependencies?: LimitRefreshDependencies): Promise<LimitRefreshResult>;
export declare function refreshRateLimits(accounts: AccountCredentials[], alias?: string): Promise<LimitRefreshResult[]>;
//# sourceMappingURL=limits-refresh.d.ts.map