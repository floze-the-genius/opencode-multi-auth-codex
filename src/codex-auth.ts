import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { addAccount, loadStore, updateAccount } from './store.js'
import { logInfo } from './logger.js'
import type { AccountCredentials } from './types.js'

export interface CodexAuthTokens {
  id_token?: string
  access_token?: string
  refresh_token?: string
  account_id?: string
}

export interface CodexAuthFile {
  OPENAI_API_KEY?: string | null
  tokens?: CodexAuthTokens
  last_refresh?: string
}

const CODEX_AUTH_FILE_ENV = 'OPENCODE_MULTI_AUTH_CODEX_AUTH_FILE'

function getCodexAuthFilePath(): string {
  const override = process.env[CODEX_AUTH_FILE_ENV]
  if (override && override.trim()) return path.resolve(override.trim())
  const CODEX_DIR = path.join(os.homedir(), '.codex')
  return path.join(CODEX_DIR, 'auth.json')
}

const CODEX_DIR = path.join(os.homedir(), '.codex')
const CODEX_AUTH_FILE = getCodexAuthFilePath()

let lastFingerprint: string | null = null
let lastAuthError: string | null = null

export function getCodexAuthPath(): string {
  return CODEX_AUTH_FILE
}

export interface CodexAuthSummary {
  email?: string
  accountId?: string
  accountUserId?: string
  userId?: string
  planType?: string
  expiresAt?: number
  lastRefresh?: string
  hasAccessToken: boolean
  hasRefreshToken: boolean
  hasIdToken: boolean
}

function ensureDir(): void {
  if (!fs.existsSync(CODEX_DIR)) {
    fs.mkdirSync(CODEX_DIR, { recursive: true, mode: 0o700 })
  }
}

export function loadCodexAuthFile(): CodexAuthFile | null {
  lastAuthError = null
  if (!fs.existsSync(CODEX_AUTH_FILE)) return null
  try {
    const raw = fs.readFileSync(CODEX_AUTH_FILE, 'utf-8')
    return JSON.parse(raw) as CodexAuthFile
  } catch (err) {
    lastAuthError = 'Failed to parse codex auth.json'
    console.error('[multi-auth] Failed to parse codex auth.json:', err)
    return null
  }
}

export function writeCodexAuthFile(auth: CodexAuthFile): void {
  ensureDir()
  fs.writeFileSync(CODEX_AUTH_FILE, JSON.stringify(auth, null, 2), {
    mode: 0o600
  })
}

function normalizeTokens(auth: any): { accessToken?: string; refreshToken?: string; idToken?: string; accountId?: string; lastRefresh?: string } | null {
  if (!auth || typeof auth !== 'object') return null

  const tokens = (auth.tokens && typeof auth.tokens === 'object') ? auth.tokens : auth

  const accessToken =
    tokens.access_token ??
    tokens.accessToken ??
    tokens.access ??
    auth.access_token ??
    auth.accessToken ??
    auth.access

  const refreshToken =
    tokens.refresh_token ??
    tokens.refreshToken ??
    tokens.refresh ??
    auth.refresh_token ??
    auth.refreshToken ??
    auth.refresh

  const idToken =
    tokens.id_token ??
    tokens.idToken ??
    tokens.id ??
    auth.id_token ??
    auth.idToken ??
    auth.id

  const accountId =
    tokens.account_id ??
    tokens.accountId ??
    auth.account_id ??
    auth.accountId

  const lastRefresh = auth.last_refresh ?? auth.lastRefresh

  const result: { accessToken?: string; refreshToken?: string; idToken?: string; accountId?: string; lastRefresh?: string } = {
    accessToken: typeof accessToken === 'string' ? accessToken : undefined,
    refreshToken: typeof refreshToken === 'string' ? refreshToken : undefined,
    idToken: typeof idToken === 'string' ? idToken : undefined,
    accountId: typeof accountId === 'string' ? accountId : undefined,
    lastRefresh: typeof lastRefresh === 'string' ? lastRefresh : undefined
  }

  if (!result.accessToken && !result.refreshToken && !result.idToken && !result.accountId) {
    return null
  }
  return result
}

export function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')
    const decoded = Buffer.from(padded, 'base64').toString('utf-8')
    return JSON.parse(decoded) as Record<string, any>
  } catch {
    return null
  }
}

export function getEmailFromClaims(claims: Record<string, any> | null): string | undefined {
  if (!claims) return undefined
  if (typeof claims.email === 'string') return claims.email
  const profile = claims['https://api.openai.com/profile'] as { email?: string } | undefined
  if (profile?.email) return profile.email
  return undefined
}

export function getAccountIdFromClaims(claims: Record<string, any> | null): string | undefined {
  if (!claims) return undefined
  const auth = claims['https://api.openai.com/auth'] as { chatgpt_account_id?: string } | undefined
  return auth?.chatgpt_account_id
}

function getAccountUserIdFromClaims(claims: Record<string, any> | null): string | undefined {
  if (!claims) return undefined
  const auth = claims['https://api.openai.com/auth'] as { chatgpt_account_user_id?: string } | undefined
  if (typeof auth?.chatgpt_account_user_id === 'string') return auth.chatgpt_account_user_id
  return undefined
}

function getUserIdFromClaims(claims: Record<string, any> | null): string | undefined {
  if (!claims) return undefined
  const auth = claims['https://api.openai.com/auth'] as { user_id?: string; chatgpt_user_id?: string } | undefined
  if (typeof auth?.user_id === 'string') return auth.user_id
  if (typeof auth?.chatgpt_user_id === 'string') return auth.chatgpt_user_id
  return undefined
}

export function getPlanTypeFromClaims(claims: Record<string, any> | null): string | undefined {
  if (!claims) return undefined
  const auth = claims['https://api.openai.com/auth'] as { chatgpt_plan_type?: string } | undefined
  return typeof auth?.chatgpt_plan_type === 'string' ? auth.chatgpt_plan_type : undefined
}

export function getExpiryFromClaims(claims: Record<string, any> | null): number | undefined {
  if (!claims) return undefined
  const exp = claims.exp
  if (typeof exp === 'number') return exp * 1000
  return undefined
}

function getIssuedAtFromClaims(claims: Record<string, any> | null): number | undefined {
  if (!claims) return undefined
  return typeof claims.iat === 'number' ? claims.iat : undefined
}

function hasNewerStoredToken(
  existing: AccountCredentials,
  authAccessClaims: Record<string, any> | null,
  authExpiresAt: number
): boolean {
  const storedAccessClaims = decodeJwtPayload(existing.accessToken)
  const storedIssuedAt = getIssuedAtFromClaims(storedAccessClaims)
  const authIssuedAt = getIssuedAtFromClaims(authAccessClaims)
  if (typeof storedIssuedAt === 'number' && typeof authIssuedAt === 'number') {
    return storedIssuedAt > authIssuedAt
  }

  return existing.expiresAt > authExpiresAt
}

function fingerprintTokens(tokens: CodexAuthTokens): string {
  return `${tokens.access_token || ''}:${tokens.refresh_token || ''}:${tokens.id_token || ''}`
}

function buildAlias(email: string | undefined, accountId: string | undefined, store: ReturnType<typeof loadStore>): string {
  const base = email?.split('@')[0] || accountId?.slice(0, 8) || `account-${Date.now()}`
  const existing = new Set(Object.keys(store.accounts))
  let candidate = base || `account-${Date.now()}`
  let suffix = 1
  while (existing.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

function findMatchingAlias(
  tokens: CodexAuthTokens | { access_token?: string; refresh_token?: string; id_token?: string },
  accountId: string | undefined,
  accountUserId: string | undefined,
  userId: string | undefined,
  email: string | undefined,
  store: ReturnType<typeof loadStore>
): string | null {
  for (const account of Object.values(store.accounts)) {
    const existingAccountUserId =
      account.accountUserId ||
      getAccountUserIdFromClaims(decodeJwtPayload(account.accessToken)) ||
      (account.idToken ? getAccountUserIdFromClaims(decodeJwtPayload(account.idToken)) : undefined)
    if (accountUserId) {
      if (existingAccountUserId === accountUserId) return account.alias
      continue
    }

    const existingUserId =
      account.userId ||
      getUserIdFromClaims(decodeJwtPayload(account.accessToken)) ||
      (account.idToken ? getUserIdFromClaims(decodeJwtPayload(account.idToken)) : undefined)
    if (userId && existingUserId === userId) return account.alias

    if (tokens.access_token && account.accessToken === tokens.access_token) return account.alias
    if (tokens.refresh_token && account.refreshToken === tokens.refresh_token) return account.alias
    if (tokens.id_token && account.idToken === tokens.id_token) return account.alias
    if (email && account.email === email) return account.alias
    if (!userId && accountId && account.accountId === accountId) return account.alias
  }
  return null
}

export function getCodexAuthSummary(): CodexAuthSummary {
  const auth = loadCodexAuthFile()
  const normalized = normalizeTokens(auth)
  const access = normalized?.accessToken
  const refresh = normalized?.refreshToken
  const idToken = normalized?.idToken
  const accessClaims = access ? decodeJwtPayload(access) : null
  const idClaims = idToken ? decodeJwtPayload(idToken) : null
  const email = getEmailFromClaims(idClaims) || getEmailFromClaims(accessClaims)
  const accountId = normalized?.accountId || getAccountIdFromClaims(idClaims) || getAccountIdFromClaims(accessClaims)
  const accountUserId = getAccountUserIdFromClaims(accessClaims) || getAccountUserIdFromClaims(idClaims)
  const userId = getUserIdFromClaims(accessClaims) || getUserIdFromClaims(idClaims)
  const planType = getPlanTypeFromClaims(accessClaims) || getPlanTypeFromClaims(idClaims)
  const expiresAt = getExpiryFromClaims(accessClaims) || getExpiryFromClaims(idClaims)
  return {
    email,
    accountId,
    accountUserId,
    userId,
    planType,
    expiresAt,
    lastRefresh: normalized?.lastRefresh,
    hasAccessToken: Boolean(access),
    hasRefreshToken: Boolean(refresh),
    hasIdToken: Boolean(idToken)
  }
}

export function resolveAliasForCurrentAuth(store?: ReturnType<typeof loadStore>): string | null {
  const auth = loadCodexAuthFile()
  const normalized = normalizeTokens(auth)
  if (!normalized) return null
  const accessClaims = normalized.accessToken ? decodeJwtPayload(normalized.accessToken) : null
  const idClaims = normalized.idToken ? decodeJwtPayload(normalized.idToken) : null
  const email = getEmailFromClaims(idClaims) || getEmailFromClaims(accessClaims)
  const accountId = normalized.accountId || getAccountIdFromClaims(idClaims) || getAccountIdFromClaims(accessClaims)
  const accountUserId = getAccountUserIdFromClaims(accessClaims) || getAccountUserIdFromClaims(idClaims)
  const userId = getUserIdFromClaims(accessClaims) || getUserIdFromClaims(idClaims)
  const targetStore = store ?? loadStore()
  return findMatchingAlias(
    {
      access_token: normalized.accessToken,
      refresh_token: normalized.refreshToken,
      id_token: normalized.idToken
    },
    accountId,
    accountUserId,
    userId,
    email,
    targetStore
  )
}

export function syncCodexAuthFile(): {
  alias: string | null
  added: boolean
  updated: boolean
  authEmail?: string
  authAccountId?: string
} {
  const auth = loadCodexAuthFile()
  const normalized = normalizeTokens(auth)
  if (!normalized?.accessToken || !normalized.refreshToken) {
    lastAuthError = 'Missing access_token/refresh_token in auth.json'
    const accessClaims = normalized?.accessToken ? decodeJwtPayload(normalized.accessToken) : null
    const idClaims = normalized?.idToken ? decodeJwtPayload(normalized.idToken) : null
    const email = getEmailFromClaims(idClaims) || getEmailFromClaims(accessClaims)
    const accountId = normalized?.accountId || getAccountIdFromClaims(idClaims) || getAccountIdFromClaims(accessClaims)
    return {
      alias: null,
      added: false,
      updated: false,
      authEmail: email,
      authAccountId: accountId
    }
  }

  const tokens: CodexAuthTokens = {
    access_token: normalized.accessToken,
    refresh_token: normalized.refreshToken,
    id_token: normalized.idToken,
    account_id: normalized.accountId
  }
  const fingerprint = fingerprintTokens(tokens)

  const accessClaims = decodeJwtPayload(normalized.accessToken)
  const idClaims = normalized.idToken ? decodeJwtPayload(normalized.idToken) : null
  const email = getEmailFromClaims(idClaims) || getEmailFromClaims(accessClaims)
  const accountId = normalized.accountId || getAccountIdFromClaims(idClaims) || getAccountIdFromClaims(accessClaims)
  const accountUserId = getAccountUserIdFromClaims(accessClaims) || getAccountUserIdFromClaims(idClaims)
  const userId = getUserIdFromClaims(accessClaims) || getUserIdFromClaims(idClaims)
  const planType = getPlanTypeFromClaims(idClaims) || getPlanTypeFromClaims(accessClaims)
  const expiresAt = getExpiryFromClaims(accessClaims) || getExpiryFromClaims(idClaims) || Date.now()

  const store = loadStore()
  const now = Date.now()
  const alias = findMatchingAlias(tokens, accountId, accountUserId, userId, email, store)
  if (lastFingerprint === fingerprint && alias) {
    return { alias, added: false, updated: false, authEmail: email, authAccountId: accountId }
  }
  lastFingerprint = fingerprint
  const update: Partial<AccountCredentials> = {
    accessToken: normalized.accessToken,
    refreshToken: normalized.refreshToken,
    accountId,
    accountUserId,
    userId,
    planType,
    expiresAt,
    email,
    lastRefresh: normalized.lastRefresh,
    lastSeenAt: now,
    source: 'codex'
  }
  if (normalized.idToken) {
    update.idToken = normalized.idToken
  }

  if (alias) {
    const existing = store.accounts[alias]
    if (existing && hasNewerStoredToken(existing, accessClaims, expiresAt)) {
      const metadataUpdate = { ...update }
      delete metadataUpdate.accessToken
      delete metadataUpdate.refreshToken
      delete metadataUpdate.expiresAt
      delete metadataUpdate.idToken
      logInfo(`Skipped stale auth.json token overwrite for ${alias}`)
      updateAccount(alias, metadataUpdate)
    } else {
      updateAccount(alias, update)
    }
    return { alias, added: false, updated: true, authEmail: email, authAccountId: accountId }
  }

  const newAlias = buildAlias(email, accountId, store)
  addAccount(newAlias, update as Omit<AccountCredentials, 'alias' | 'usageCount'>)
  return { alias: newAlias, added: true, updated: true, authEmail: email, authAccountId: accountId }
}

export function getCodexAuthStatus(): { error: string | null } {
  return { error: lastAuthError }
}

export function writeCodexAuthForAlias(alias: string): void {
  const store = loadStore()
  const account = store.accounts[alias]

  if (!account) {
    throw new Error(`Unknown alias: ${alias}`)
  }
  if (!account.accessToken || !account.refreshToken) {
    throw new Error('Missing token data for alias')
  }

  const current = loadCodexAuthFile()
  const baseTokens: Record<string, any> = {
    access_token: account.accessToken,
    refresh_token: account.refreshToken
  }
  if (account.idToken) {
    baseTokens.id_token = account.idToken
  }
  if (account.accountId) {
    baseTokens.account_id = account.accountId
  }
  const auth: CodexAuthFile = {
    OPENAI_API_KEY: current?.OPENAI_API_KEY ?? null,
    tokens: baseTokens as CodexAuthTokens,
    last_refresh: new Date().toISOString()
  }

  writeCodexAuthFile(auth)
  updateAccount(alias, {
    lastRefresh: auth.last_refresh,
    lastSeenAt: Date.now(),
    source: 'codex'
  })
}
