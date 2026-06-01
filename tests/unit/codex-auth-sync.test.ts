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
  const codexAuth = await import('../../src/codex-auth.js')
  return { store, codexAuth }
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
    const { store, codexAuth } = await loadSandboxModules(sandboxRoot)
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
    expect(account.lastSeenAt).toEqual(expect.any(Number))
  })

  it('updates stored credentials when auth.json has newer tokens', async () => {
    const { store, codexAuth } = await loadSandboxModules(sandboxRoot)
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
  })
})
