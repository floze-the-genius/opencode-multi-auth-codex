import type { AccountCredentials, AccountCredits, AccountRateLimits } from './types.js';
export interface UsageRateLimitFetchResult {
    rateLimits?: AccountRateLimits;
    planType?: string;
    credits?: AccountCredits;
    rateLimitedUntil?: number;
    error?: string;
    shouldProbeFallback?: boolean;
    authInvalid?: boolean;
    workspaceDeactivated?: boolean;
    workspaceDeactivatedReason?: string;
    source: 'usage-api';
}
interface UsageApiFailureClassification {
    shouldProbeFallback: boolean;
    authInvalid?: boolean;
    workspaceDeactivated?: boolean;
    workspaceDeactivatedReason?: string;
}
export declare function classifyUsageApiFailure(status: number, rawText: string): UsageApiFailureClassification;
export declare function fetchUsageRateLimitsForAccount(account: AccountCredentials): Promise<UsageRateLimitFetchResult>;
export {};
//# sourceMappingURL=usage-limits.d.ts.map