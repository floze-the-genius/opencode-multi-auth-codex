import { loadStore } from './store.js';
import { hasUsableCredits } from './types.js';
const CREDIT_ACCOUNT_ALIASES_ENV = 'OPENCODE_MULTI_AUTH_CREDIT_ACCOUNT_ALIASES';
export function parseCreditAccountAliases(raw) {
    if (raw === undefined)
        return undefined;
    const value = raw.trim();
    if (!value)
        return undefined;
    const normalized = value.toLowerCase();
    if (normalized === 'all' || value === '*')
        return ['*'];
    if (normalized === 'none' || normalized === 'off' || normalized === 'false' || normalized === '0')
        return [];
    return value
        .split(',')
        .map((alias) => alias.trim())
        .filter(Boolean);
}
export function getCreditAccountAliases() {
    const envValue = process.env[CREDIT_ACCOUNT_ALIASES_ENV];
    if (envValue !== undefined) {
        return parseCreditAccountAliases(envValue);
    }
    const store = loadStore();
    return Array.isArray(store.settings?.creditAccountAliases)
        ? store.settings.creditAccountAliases
        : undefined;
}
export function isCreditsAllowedForAlias(alias, creditAccountAliases = getCreditAccountAliases()) {
    if (!Array.isArray(creditAccountAliases))
        return true;
    if (creditAccountAliases.includes('*'))
        return true;
    return creditAccountAliases.includes(alias);
}
export function hasUsableAllowedCredits(account, creditAccountAliases = getCreditAccountAliases()) {
    return isCreditsAllowedForAlias(account.alias, creditAccountAliases) && hasUsableCredits(account.credits);
}
//# sourceMappingURL=credits-policy.js.map