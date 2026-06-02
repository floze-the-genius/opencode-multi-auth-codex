/**
 * Determine whether an account is effectively enabled.
 *
 * The backend store defaults `enabled` to `undefined` when the field is
 * absent, which means "active / not explicitly disabled".  The frontend
 * must treat `undefined` the same as `true`, and only consider an account
 * disabled when `enabled === false`.
 */
export function isAccountEnabled(account: { enabled?: boolean }): boolean {
  return account.enabled !== false
}
