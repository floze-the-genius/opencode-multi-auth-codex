import { type AccountCredentials } from './types.js';
export declare function parseCreditAccountAliases(raw: string | undefined): string[] | undefined;
export declare function getCreditAccountAliases(): string[] | undefined;
export declare function isCreditsAllowedForAlias(alias: string, creditAccountAliases?: string[] | undefined): boolean;
export declare function hasUsableAllowedCredits(account: AccountCredentials, creditAccountAliases?: string[] | undefined): boolean;
//# sourceMappingURL=credits-policy.d.ts.map