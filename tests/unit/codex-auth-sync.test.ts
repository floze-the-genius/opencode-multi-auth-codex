import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
// @ts-ignore - ESM Jest globals are available at runtime in the test environment.
import { jest } from '@jest/globals'

const originalEnv = process.env

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
}

function authClaims(iat: number, exp: number): Record<string, unknown> {
  return {
    iat,
    exp,
    email: 'alpha@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct-alpha',
      chatgpt_account_user_id: 'acct-user-alpha',
      user_id: 'user-alpha',
      chatgpt_plan_type: 'plus'
    }
  }
}

function authClaimsFor(alias: string, iat: number, exp: number): Record<string, unknown> {
  return {
    iat,
    exp,
    email: `${alias}@example.com`,
    'https://api.openai.com/auth': {
      chatgpt_account_id: `acct-${alias}`,
      chatgpt_account_user_id: `acct-user-${alias}`,
      user_id: `user-${alias}`,
      chatgpt_plan_type: 'plus'
    }
  }
}

function writeAuthFile(sandboxRoot: string, alias: string, issuedAt = 200): { accessToken: string; idToken: string } {
  const accessToken = jwt(authClaimsFor(alias, issuedAt, issuedAt + 1_000))
  const idToken = jwt(authClaimsFor(alias, issuedAt, issuedAt + 1_000))
  fs.writeFileSync(
    path.join(sandboxRoot, 'auth.json'),
    JSON.stringify({
      OPENAI_API_KEY: null,
      tokens: {
        access_token: accessToken,
        refresh_token: `refresh-${alias}`,
        id_token: idToken,
        account_id: `acct-${alias}`
      },
      last_refresh: '2026-01-01T00:00:00.000Z'
    })
  )
  return { accessToken, idToken }
}

async function loadSandboxModules(sandboxRoot: string) {
  jest.resetModules()
  process.env = {
    ...originalEnv,
    OPENCODE_MULTI_AUTH_STORE_DIR: sandboxRoot,
    OPENCODE_MULTI_AUTH_STORE_FILE: path.join(sandboxRoot, 'accounts.json'),
    OPENCODE_MULTI_AUTH_CODEX_AUTH_FILE: path.join(sandboxRoot, 'auth.json'),
    CODEX_SOFT_LOG_PATH: path.join(sandboxRoot, 'codex-soft.log')
  }

  const store = await import('../../src/store.js')
  const metricsStore = await import('../../src/metrics-store.js')
  const codexAuth = await import('../../src/codex-auth.js')
  return { store, metricsStore, codexAuth }
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

describe('syncCodexAuthFile token freshness', () => {
  let sandboxRoot: string

  beforeEach(() => {
    sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-codex-auth-sync-'))
  })

  afterEach(() => {
    process.env = originalEnv
    fs.rmSync(sandboxRoot, { recursive: true, force: true })
    jest.resetModules()
  })

  it('does not overwrite newer stored credentials with older auth.json tokens', async () => {
    const { store, metricsStore, codexAuth } = await loadSandboxModules(sandboxRoot)
    const storedAccessToken = jwt(authClaims(200, 1_200))
    const authAccessToken = jwt(authClaims(100, 1_100))

    store.addAccount('alpha', {
      accessToken: storedAccessToken,
      refreshToken: 'stored-refresh-token',
      idToken: 'stored-id-token',
      expiresAt: 1_200_000,
      email: 'alpha@example.com',
      source: 'opencode'
    })
    fs.writeFileSync(
      path.join(sandboxRoot, 'auth.json'),
      JSON.stringify({
        OPENAI_API_KEY: null,
        tokens: {
          access_token: authAccessToken,
          refresh_token: 'older-auth-refresh-token',
          id_token: 'older-auth-id-token',
          account_id: 'acct-alpha'
        },
        last_refresh: '2026-01-01T00:00:00.000Z'
      })
    )

    const result = codexAuth.syncCodexAuthFile()
    const account = store.loadStore().accounts.alpha

    expect(result).toEqual(expect.objectContaining({ alias: 'alpha', updated: true, added: false }))
    expect(account.accessToken).toBe(storedAccessToken)
    expect(account.refreshToken).toBe('stored-refresh-token')
    expect(account.idToken).toBe('stored-id-token')
    expect(account.expiresAt).toBe(1_200_000)
    expect(readJson(path.join(sandboxRoot, 'accounts.json')).accounts.alpha).not.toHaveProperty('lastSeenAt')
    expect(metricsStore.getMetrics('alpha')).toEqual(expect.objectContaining({
      lastSeenAt: expect.any(Number),
      lastRefresh: '2026-01-01T00:00:00.000Z'
    }))
  })

  it('updates stored credentials when auth.json has newer tokens', async () => {
    const { store, metricsStore, codexAuth } = await loadSandboxModules(sandboxRoot)
    const storedAccessToken = jwt(authClaims(100, 1_100))
    const authAccessToken = jwt(authClaims(200, 1_200))

    store.addAccount('alpha', {
      accessToken: storedAccessToken,
      refreshToken: 'stored-refresh-token',
      idToken: 'stored-id-token',
      expiresAt: 1_100_000,
      email: 'alpha@example.com',
      source: 'opencode'
    })
    fs.writeFileSync(
      path.join(sandboxRoot, 'auth.json'),
      JSON.stringify({
        OPENAI_API_KEY: null,
        tokens: {
          access_token: authAccessToken,
          refresh_token: 'newer-auth-refresh-token',
          id_token: 'newer-auth-id-token',
          account_id: 'acct-alpha'
        },
        last_refresh: '2026-01-01T00:00:00.000Z'
      })
    )

    const result = codexAuth.syncCodexAuthFile()
    const account = store.loadStore().accounts.alpha

    expect(result).toEqual(expect.objectContaining({ alias: 'alpha', updated: true, added: false }))
    expect(account.accessToken).toBe(authAccessToken)
    expect(account.refreshToken).toBe('newer-auth-refresh-token')
    expect(account.idToken).toBe('newer-auth-id-token')
    expect(account.expiresAt).toBe(1_200_000)
    expect(readJson(path.join(sandboxRoot, 'accounts.json')).accounts.alpha).not.toHaveProperty('lastRefresh')
    expect(metricsStore.getMetrics('alpha')).toEqual(expect.objectContaining({
      lastSeenAt: expect.any(Number),
      lastRefresh: '2026-01-01T00:00:00.000Z'
    }))
  })

  it('keeps writeCodexAuthForAlias sync telemetry in metrics only', async () => {
    const { store, metricsStore, codexAuth } = await loadSandboxModules(sandboxRoot)
    const storedAccessToken = jwt(authClaims(300, 1_300))
    store.addAccount('alpha', {
      accessToken: storedAccessToken,
      refreshToken: 'stored-refresh-token',
      idToken: 'stored-id-token',
      accountId: 'acct-alpha',
      expiresAt: 1_300_000,
      email: 'alpha@example.com',
      source: 'opencode'
    })

    codexAuth.writeCodexAuthForAlias('alpha')

    const persistedAccount = readJson(path.join(sandboxRoot, 'accounts.json')).accounts.alpha
    expect(persistedAccount.source).toBe('codex')
    expect(persistedAccount).not.toHaveProperty('lastRefresh')
    expect(persistedAccount).not.toHaveProperty('lastSeenAt')
    expect(metricsStore.getMetrics('alpha')).toEqual(expect.objectContaining({
      lastRefresh: expect.any(String),
      lastSeenAt: expect.any(Number)
    }))
  })

  it('reports matched Codex auth without mutating the store', async () => {
    const { store, codexAuth } = await loadSandboxModules(sandboxRoot)
    const { accessToken, idToken } = writeAuthFile(sandboxRoot, 'alpha')
    store.addAccount('alpha', {
      accessToken,
      refreshToken: 'refresh-alpha',
      idToken,
      accountId: 'acct-alpha',
      accountUserId: 'acct-user-alpha',
      userId: 'user-alpha',
      expiresAt: 1_200_000,
      email: 'alpha@example.com',
      source: 'opencode'
    })
    const beforeStore = fs.readFileSync(path.join(sandboxRoot, 'accounts.json'), 'utf8')

    const state = codexAuth.getCodexActiveState()

    expect(state).toEqual(expect.objectContaining({
      status: 'matched',
      alias: 'alpha',
      email: 'alpha@example.com',
      accountId: 'acct-alpha',
      accountUserId: 'acct-user-alpha',
      userId: 'user-alpha',
      hasAccessToken: true,
      hasRefreshToken: true,
      hasIdToken: true
    }))
    expect(fs.readFileSync(path.join(sandboxRoot, 'accounts.json'), 'utf8')).toBe(beforeStore)
  })

  it('reports unknown Codex auth without adding a store account', async () => {
    const { store, codexAuth } = await loadSandboxModules(sandboxRoot)
    store.addAccount('alpha', {
      accessToken: jwt(authClaimsFor('alpha', 100, 1_100)),
      refreshToken: 'refresh-alpha',
      expiresAt: 1_100_000,
      email: 'alpha@example.com',
      source: 'opencode'
    })
    writeAuthFile(sandboxRoot, 'gamma')
    const beforeStore = readJson(path.join(sandboxRoot, 'accounts.json'))

    const state = codexAuth.getCodexActiveState()

    expect(state).toEqual(expect.objectContaining({
      status: 'unknown',
      alias: null,
      email: 'gamma@example.com',
      accountId: 'acct-gamma',
      hasAccessToken: true,
      hasRefreshToken: true,
      hasIdToken: true
    }))
    expect(readJson(path.join(sandboxRoot, 'accounts.json'))).toEqual(beforeStore)
  })

  it('reports missing Codex auth for absent or empty auth.json without mutating the store', async () => {
    const { store, codexAuth } = await loadSandboxModules(sandboxRoot)
    store.addAccount('alpha', {
      accessToken: jwt(authClaimsFor('alpha', 100, 1_100)),
      refreshToken: 'refresh-alpha',
      expiresAt: 1_100_000,
      email: 'alpha@example.com',
      source: 'opencode'
    })
    const beforeStore = readJson(path.join(sandboxRoot, 'accounts.json'))

    expect(codexAuth.getCodexActiveState()).toEqual(expect.objectContaining({
      status: 'missing',
      alias: null,
      hasAccessToken: false,
      hasRefreshToken: false,
      hasIdToken: false
    }))

    fs.writeFileSync(path.join(sandboxRoot, 'auth.json'), '   ')
    expect(codexAuth.getCodexActiveState()).toEqual(expect.objectContaining({
      status: 'missing',
      alias: null,
      hasAccessToken: false,
      hasRefreshToken: false,
      hasIdToken: false
    }))
    expect(readJson(path.join(sandboxRoot, 'accounts.json'))).toEqual(beforeStore)
  })

  it('reports malformed Codex auth as an error without mutating the store', async () => {
    const { store, codexAuth } = await loadSandboxModules(sandboxRoot)
    store.addAccount('alpha', {
      accessToken: jwt(authClaimsFor('alpha', 100, 1_100)),
      refreshToken: 'refresh-alpha',
      expiresAt: 1_100_000,
      email: 'alpha@example.com',
      source: 'opencode'
    })
    fs.writeFileSync(path.join(sandboxRoot, 'auth.json'), '{not-json')
    const beforeStore = readJson(path.join(sandboxRoot, 'accounts.json'))

    const state = codexAuth.getCodexActiveState()

    expect(state).toEqual(expect.objectContaining({
      status: 'error',
      alias: null,
      hasAccessToken: false,
      hasRefreshToken: false,
      hasIdToken: false,
      error: 'Failed to parse codex auth.json'
    }))
    expect(readJson(path.join(sandboxRoot, 'accounts.json'))).toEqual(beforeStore)
  })
})
