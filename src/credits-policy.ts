import { loadStore } from './store.js'
import { hasUsableCredits, type AccountCredentials } from './types.js'

const CREDIT_ACCOUNT_ALIASES_ENV = 'OPENCODE_MULTI_AUTH_CREDIT_ACCOUNT_ALIASES'

export function parseCreditAccountAliases(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined

  const value = raw.trim()
  if (!value) return undefined

  const normalized = value.toLowerCase()
  if (normalized === 'all' || value === '*') return ['*']
  if (normalized === 'none' || normalized === 'off' || normalized === 'false' || normalized === '0') return []

  return value
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean)
}

export function getCreditAccountAliases(): string[] | undefined {
  const envValue = process.env[CREDIT_ACCOUNT_ALIASES_ENV]
  if (envValue !== undefined) {
    return parseCreditAccountAliases(envValue)
  }

  const store = loadStore()
  return Array.isArray(store.settings?.creditAccountAliases)
    ? store.settings.creditAccountAliases
    : undefined
}

export function isCreditsAllowedForAlias(
  alias: string,
  creditAccountAliases: string[] | undefined = getCreditAccountAliases()
): boolean {
  if (!Array.isArray(creditAccountAliases)) return true
  if (creditAccountAliases.includes('*')) return true
  return creditAccountAliases.includes(alias)
}

export function hasUsableAllowedCredits(
  account: AccountCredentials,
  creditAccountAliases: string[] | undefined = getCreditAccountAliases()
): boolean {
  return isCreditsAllowedForAlias(account.alias, creditAccountAliases) && hasUsableCredits(account.credits)
}
