import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createAuthorizationFlow, loginAccount, refreshToken } from './auth.js'
import { getCodexAuthPath, getCodexAuthStatus, getCodexAuthSummary, resolveAliasForCurrentAuth, syncCodexAuthFile, writeCodexAuthForAlias } from './codex-auth.js'
import { getStoreStatus, listAccounts, loadStore, removeAccount, updateAccount } from './store.js'
import { getRefreshQueueState, startRefreshQueue, stopRefreshQueue } from './refresh-queue.js'
import { getLogPath, logError, logInfo, logWarn, readLogTail } from './logger.js'
import { getForceState, activateForce, clearForce, isForceActive, getRemainingForceTimeMs, formatForceDuration } from './force-mode.js'
import {
  getSettings,
  getRuntimeSettings,
  updateSettings,
  isFeatureEnabled,
  getStickySessionConfig,
  getStickySessionRuntimeSettings,
  updateStickySessionConfig
} from './settings.js'
import { Errors } from './errors.js'
import type { AccountCredentials, RateLimitWindow, LimitsConfidence, RotationSettings, WeightPreset } from './types.js'
import { cleanupStickySessions, getStickySessionsStatus } from './sticky-sessions.js'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 3434
const LOCALHOST_HOST_PATTERN = /^(127\.0\.0\.1|::1|localhost)$/i
const SYNC_INTERVAL_MS = 3000
const SYNC_DEBOUNCE_MS = 600
const ANTIGRAVITY_ACCOUNTS_FILE = path.join(os.homedir(), '.config', 'opencode', 'antigravity-accounts.json')
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const AUTO_LOGIN_TIMEOUT_MS = 6 * 60 * 1000
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const AUTO_LOGIN_SCRIPT_ENV = 'OPENCODE_MULTI_AUTH_AUTO_LOGIN_SCRIPT'
const AUTO_LOGIN_CREDENTIALS_ENV = 'OPENCODE_MULTI_AUTH_AUTO_LOGIN_CREDENTIALS_FILE'
const AUTO_LOGIN_PYTHON_ENV = 'OPENCODE_MULTI_AUTH_AUTO_LOGIN_PYTHON'
const DEFAULT_AUTO_LOGIN_CREDENTIALS_FILE = path.join(os.homedir(), '.config', 'opencode-multi-auth', 'credentials.json')
const DEFAULT_AUTO_LOGIN_VENV_PYTHON = path.join(os.homedir(), '.config', 'opencode-multi-auth', '.venv', 'bin', 'python')
const WEB_DIST_DIR_ENV = 'OPENCODE_MULTI_AUTH_WEB_DIST_DIR'

const STATIC_CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp'
}

type AutoLoginMode = 'manual' | 'auto'

type PendingLoginState = {
  alias: string
  email?: string
  startedAt: number
  url?: string
  mode: AutoLoginMode
  status: 'starting' | 'running' | 'waiting-callback'
  step?: string
  output: string[]
  pid?: number
}

type AutoLoginAccountView = {
  alias: string
  email: string
  enabled: boolean
}

type AutoLoginConfigState = {
  path: string
  scriptPath: string
  pythonPath: string
  configured: boolean
  accounts: AutoLoginAccountView[]
  error?: string
}

type AutoLoginCredentialsAccount = {
  id?: string
  alias?: string
  email: string
  outlook_password?: string
  chatgpt_password?: string
  enabled?: boolean
}

type AutoLoginCredentialsFile = {
  defaults?: {
    chatgpt_password?: string
  }
  accounts?: AutoLoginCredentialsAccount[]
}

type AutoLoginCreateInput = {
  email: string
  password: string
  alias?: string
  chatgptPassword?: string
}

export function isLocalhostHost(host: string): boolean {
  return LOCALHOST_HOST_PATTERN.test(host.trim())
}

const execAsync = promisify(exec)

function getWebDistDir(): string {
  const override = process.env[WEB_DIST_DIR_ENV]?.trim()
  if (override) {
    return path.resolve(override)
  }

  return path.basename(MODULE_DIR) === 'dist'
    ? path.join(MODULE_DIR, 'web')
    : path.resolve(MODULE_DIR, '../dist/web')
}

function isApiRequestPath(requestPath: string): boolean {
  return requestPath === '/api' || requestPath.startsWith('/api/')
}

function getStaticContentType(filePath: string): string {
  return STATIC_CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function shouldServeSpaFallback(requestPath: string): boolean {
  return path.posix.extname(requestPath) === ''
}

function resolveWebAssetPath(requestPath: string): string | null {
  let decodedPath = requestPath
  try {
    decodedPath = decodeURIComponent(requestPath)
  } catch {
    return null
  }

  const normalizedPath = path.posix.normalize(decodedPath)
  const relativePath = normalizedPath.replace(/^\/+/u, '')
  if (relativePath.startsWith('..')) {
    return null
  }

  const segments = relativePath.length > 0 ? relativePath.split('/') : ['index.html']
  return path.join(getWebDistDir(), ...segments)
}

async function serveStaticFile(res: http.ServerResponse, filePath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) {
      return false
    }

    const body = await fs.promises.readFile(filePath)
    res.writeHead(200, { 'Content-Type': getStaticContentType(filePath) })
    res.end(body)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return false
    }
    throw error
  }
}

async function serveSpaRequest(res: http.ServerResponse, requestPath: string): Promise<boolean> {
  const assetPath = resolveWebAssetPath(requestPath)
  if (!assetPath) {
    return false
  }

  if (await serveStaticFile(res, assetPath)) {
    return true
  }

  if (!shouldServeSpaFallback(requestPath)) {
    return false
  }

  return serveStaticFile(res, path.join(getWebDistDir(), 'index.html'))
}

let lastSyncAt = 0
let lastSyncError: string | null = null
let lastSyncAlias: string | null = null
let syncTimer: NodeJS.Timeout | null = null
let pendingLogin: PendingLoginState | null = null
let lastLoginError: string | null = null
let antigravityQuotaState: AntigravityQuotaState = { status: 'idle', scope: 'active' }
let antigravityQuotaInFlight: Promise<AntigravityQuotaState> | null = null
let autoLoginChild: ReturnType<typeof spawn> | null = null

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const data = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data)
  })
  res.end(data)
}

function getSanitizedErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/\s+/g, ' ').trim()
  }

  return String(error).replace(/\s+/g, ' ').trim()
}

function scrubAccount(account: AccountCredentials): Omit<AccountCredentials, 'accessToken' | 'refreshToken' | 'idToken'> {
  const { accessToken, refreshToken, idToken, ...rest } = account
  return rest
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1_000_000) {
        req.destroy()
        const payloadError = new Error('Payload too large') as Error & { code?: string }
        payloadError.code = 'PAYLOAD_TOO_LARGE'
        reject(payloadError)
      }
    })
    req.on('end', () => {
      if (!data) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(data))
      } catch {
        const parseError = new Error('Invalid JSON payload') as Error & { code?: string }
        parseError.code = 'INVALID_JSON'
        reject(parseError)
      }
    })
  })
}

function remainingPercent(window?: RateLimitWindow): number | null {
  if (!window || typeof window.remaining !== 'number' || typeof window.limit !== 'number') return null
  if (window.limit === 0) return null
  return Math.round((window.remaining / window.limit) * 100)
}

function recommendAlias(accounts: AccountCredentials[]): string | null {
  let best: {
    alias: string
    weeklyPercent: number
    weeklyRemaining: number
    fivePercent: number
  } | null = null

  for (const account of accounts) {
    if (account.enabled === false) {
      continue
    }
    const weeklyPercent = remainingPercent(account.rateLimits?.weekly) ?? -1
    const weeklyRemaining = typeof account.rateLimits?.weekly?.remaining === 'number'
      ? account.rateLimits.weekly.remaining
      : -1
    const fivePercent = remainingPercent(account.rateLimits?.fiveHour) ?? -1

    if (weeklyPercent < 0 && weeklyRemaining < 0 && fivePercent < 0) {
      continue
    }

    if (
      !best ||
      weeklyPercent > best.weeklyPercent ||
      (weeklyPercent === best.weeklyPercent && weeklyRemaining > best.weeklyRemaining) ||
      (
        weeklyPercent === best.weeklyPercent &&
        weeklyRemaining === best.weeklyRemaining &&
        fivePercent > best.fivePercent
      )
    ) {
      best = { alias: account.alias, weeklyPercent, weeklyRemaining, fivePercent }
    }
  }
  return best?.alias ?? null
}

function getAutoLoginScriptPath(): string {
  const override = process.env[AUTO_LOGIN_SCRIPT_ENV]
  if (override && override.trim()) return path.resolve(override.trim())
  return path.resolve(MODULE_DIR, '..', 'auto-login', 'auto_login.py')
}

function getAutoLoginCredentialsPath(): string {
  const override = process.env[AUTO_LOGIN_CREDENTIALS_ENV]
  if (override && override.trim()) return path.resolve(override.trim())
  return DEFAULT_AUTO_LOGIN_CREDENTIALS_FILE
}

function getAutoLoginPythonPath(): string {
  const override = process.env[AUTO_LOGIN_PYTHON_ENV]
  if (override && override.trim()) return path.resolve(override.trim())
  if (fs.existsSync(DEFAULT_AUTO_LOGIN_VENV_PYTHON)) {
    return DEFAULT_AUTO_LOGIN_VENV_PYTHON
  }
  return 'python3'
}

function sanitizeAliasSeed(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'account'
}

function ensureAutoLoginCredentialsDir(credentialsPath: string): void {
  const dir = path.dirname(credentialsPath)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(dir, 0o700)
  } catch {
    // Best effort on non-POSIX environments.
  }
}

function readAutoLoginCredentialsFile(credentialsPath = getAutoLoginCredentialsPath()): AutoLoginCredentialsFile {
  if (!fs.existsSync(credentialsPath)) {
    return { accounts: [] }
  }
  const parsed = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8')) as AutoLoginCredentialsFile
  return {
    defaults: parsed && typeof parsed.defaults === 'object' ? parsed.defaults : undefined,
    accounts: Array.isArray(parsed?.accounts) ? parsed.accounts : []
  }
}

function writeAutoLoginCredentialsFile(credentialsPath: string, data: AutoLoginCredentialsFile): void {
  ensureAutoLoginCredentialsDir(credentialsPath)
  fs.writeFileSync(credentialsPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  try {
    fs.chmodSync(credentialsPath, 0o600)
  } catch {
    // Best effort on non-POSIX environments.
  }
}

function upsertAutoLoginCredentials(input: AutoLoginCreateInput): AutoLoginAccountView {
  const email = input.email.trim()
  if (!email) {
    throw new Error('Missing login/email')
  }
  const password = input.password.trim()
  if (!password) {
    throw new Error('Missing password')
  }

  const scriptPath = getAutoLoginScriptPath()
  if (!fs.existsSync(scriptPath)) {
    throw new Error('auto_login.py not found')
  }

  const credentialsPath = getAutoLoginCredentialsPath()
  const file = readAutoLoginCredentialsFile(credentialsPath)
  const accounts = Array.isArray(file.accounts) ? [...file.accounts] : []
  const existingIndex = accounts.findIndex((entry) =>
    typeof entry.email === 'string' && entry.email.toLowerCase() === email.toLowerCase()
  )
  const existing = existingIndex >= 0 ? accounts[existingIndex] : undefined
  const aliasSource =
    input.alias?.trim() ||
    existing?.alias?.trim() ||
    existing?.id?.trim() ||
    email.split('@')[0] ||
    email
  const alias = sanitizeAliasSeed(aliasSource)
  const chatgptPassword =
    input.chatgptPassword?.trim() ||
    existing?.chatgpt_password?.trim() ||
    file.defaults?.chatgpt_password?.trim() ||
    password

  const nextAccount: AutoLoginCredentialsAccount = {
    ...existing,
    id: existing?.id || alias,
    alias,
    email,
    outlook_password: password,
    chatgpt_password: chatgptPassword,
    enabled: true
  }

  if (existingIndex >= 0) {
    accounts[existingIndex] = nextAccount
  } else {
    accounts.push(nextAccount)
  }

  writeAutoLoginCredentialsFile(credentialsPath, {
    ...file,
    accounts
  })

  return {
    alias,
    email,
    enabled: true
  }
}

function loadAutoLoginConfig(): AutoLoginConfigState {
  const pathValue = getAutoLoginCredentialsPath()
  const scriptPath = getAutoLoginScriptPath()
  const result: AutoLoginConfigState = {
    path: pathValue,
    scriptPath,
    pythonPath: getAutoLoginPythonPath(),
    configured: false,
    accounts: []
  }

  if (!fs.existsSync(scriptPath)) {
    return { ...result, error: 'auto_login.py not found' }
  }

  if (!fs.existsSync(pathValue)) {
    return { ...result, error: 'credentials.json not found' }
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(pathValue, 'utf-8')) as { accounts?: Array<Record<string, unknown>> }
    const accounts = Array.isArray(parsed?.accounts) ? parsed.accounts : []
    const view = accounts
      .map((entry) => {
        const email = typeof entry.email === 'string' ? entry.email.trim() : ''
        if (!email) return null
        const aliasSource =
          (typeof entry.alias === 'string' && entry.alias.trim()) ||
          (typeof entry.id === 'string' && entry.id.trim()) ||
          email.split('@')[0]
        return {
          alias: sanitizeAliasSeed(aliasSource),
          email,
          enabled: entry.enabled !== false
        } satisfies AutoLoginAccountView
      })
      .filter((entry): entry is AutoLoginAccountView => Boolean(entry))
      .sort((a, b) => a.email.localeCompare(b.email))

    if (view.length === 0) {
      return { ...result, error: 'No accounts in credentials.json' }
    }

    return {
      ...result,
      configured: true,
      accounts: view
    }
  } catch (err) {
    return { ...result, error: `Failed to parse credentials.json: ${err}` }
  }
}

function findAutoLoginAccount(config: AutoLoginConfigState, selector: string): AutoLoginAccountView | null {
  const normalized = selector.trim().toLowerCase()
  if (!normalized) return null
  return config.accounts.find((account) =>
    account.email.toLowerCase() === normalized || account.alias.toLowerCase() === normalized
  ) || null
}

function resolveAutoLoginAlias(store: ReturnType<typeof loadStore>, account: AutoLoginAccountView): string {
  const existing = Object.values(store.accounts).find((entry) =>
    typeof entry.email === 'string' && entry.email.toLowerCase() === account.email.toLowerCase()
  )
  if (existing) {
    return existing.alias
  }

  const base = sanitizeAliasSeed(account.alias || account.email.split('@')[0])
  let candidate = base
  let index = 1
  while (store.accounts[candidate]) {
    candidate = `${base}-${index}`
    index += 1
  }
  return candidate
}

function setPendingLogin(state: PendingLoginState | null): void {
  pendingLogin = state
}

function updatePendingLogin(patch: Partial<PendingLoginState>): void {
  if (!pendingLogin) return
  pendingLogin = {
    ...pendingLogin,
    ...patch,
    output: patch.output ?? pendingLogin.output
  }
}

function appendPendingLoginOutput(line: string): void {
  const normalized = line
    .replace(/\x1b\[[0-9;]*m/g, '')
    .trim()
  if (!normalized || !pendingLogin) return
  const output = [...pendingLogin.output, normalized].slice(-6)
  updatePendingLogin({
    output,
    step: normalized,
    status: normalized.toLowerCase().includes('callback') ? 'waiting-callback' : 'running'
  })
}

function stopAutoLoginChild(): void {
  if (autoLoginChild && !autoLoginChild.killed) {
    autoLoginChild.kill('SIGTERM')
  }
  autoLoginChild = null
}

function consumeProcessLines(
  stream: NodeJS.ReadableStream | null | undefined,
  onLine: (line: string) => void
): void {
  if (!stream) return
  let buffered = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    buffered += chunk
    let newlineIndex = buffered.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffered.slice(0, newlineIndex).trim()
      buffered = buffered.slice(newlineIndex + 1)
      if (line) onLine(line)
      newlineIndex = buffered.indexOf('\n')
    }
  })
  stream.on('end', () => {
    const line = buffered.trim()
    if (line) onLine(line)
  })
}

function startManualLogin(alias: string): Promise<{ ok: true; url: string }> {
  if (pendingLogin) {
    throw new Error(`Login already in progress for ${pendingLogin.alias}`)
  }

  return createAuthorizationFlow().then((flow) => {
    setPendingLogin({
      alias,
      startedAt: Date.now(),
      url: flow.url,
      mode: 'manual',
      status: 'running',
      step: 'Waiting for browser login...',
      output: []
    })
    lastLoginError = null
    loginAccount(alias, flow, { timeoutMs: LOGIN_TIMEOUT_MS })
      .then(() => {
        logInfo(`Login completed for ${alias}`)
        setPendingLogin(null)
      })
      .catch((err) => {
        lastLoginError = String(err)
        logError(`Login failed for ${alias}: ${err}`)
        setPendingLogin(null)
      })
    return { ok: true as const, url: flow.url }
  })
}

async function startAutoLogin(selector: string, visible = false): Promise<{ ok: true; alias: string; email: string; url: string }> {
  if (pendingLogin) {
    throw new Error(`Login already in progress for ${pendingLogin.alias}`)
  }

  const config = loadAutoLoginConfig()
  if (!config.configured) {
    throw new Error(config.error || 'Auto-login is not configured')
  }

  const selected = findAutoLoginAccount(config, selector)
  if (!selected) {
    throw new Error('Unknown auto-login account')
  }
  if (!selected.enabled) {
    throw new Error('Selected auto-login account is disabled')
  }

  const store = loadStore()
  const alias = resolveAutoLoginAlias(store, selected)
  const flow = await createAuthorizationFlow()

  setPendingLogin({
    alias,
    email: selected.email,
    startedAt: Date.now(),
    url: flow.url,
    mode: 'auto',
    status: 'starting',
    step: 'Launching browser automation (a Chrome window may open)...',
    output: []
  })
  lastLoginError = null

  let loginSettled = false
  const loginPromise = loginAccount(alias, flow, { timeoutMs: AUTO_LOGIN_TIMEOUT_MS })
    .then(() => {
      loginSettled = true
      stopAutoLoginChild()
      logInfo(`Auto-login completed for ${alias} (${selected.email})`)
      setPendingLogin(null)
    })
    .catch((err) => {
      loginSettled = true
      stopAutoLoginChild()
      lastLoginError = String(err)
      logError(`Auto-login failed for ${alias} (${selected.email}): ${err}`)
      setPendingLogin(null)
    })

  autoLoginChild = spawn(
    config.pythonPath,
    [
      '-u',
      config.scriptPath,
      '--email',
      selected.email,
      '--auth-url',
      flow.url,
      '--credentials-file',
      config.path,
      ...(visible ? ['--visible'] : [])
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  updatePendingLogin({
    pid: autoLoginChild.pid ?? undefined,
    status: 'running'
  })

  consumeProcessLines(autoLoginChild.stdout, (line) => {
    appendPendingLoginOutput(line)
  })
  consumeProcessLines(autoLoginChild.stderr, (line) => {
    appendPendingLoginOutput(`[stderr] ${line}`)
  })

  autoLoginChild.on('error', (err) => {
    appendPendingLoginOutput(`Process error: ${err.message}`)
  })

  autoLoginChild.on('exit', (code, signal) => {
    if (!pendingLogin || pendingLogin.mode !== 'auto' || pendingLogin.alias !== alias) {
      autoLoginChild = null
      return
    }
    autoLoginChild = null
    if (loginSettled) {
      return
    }
    if (code === 0) {
      updatePendingLogin({
        status: 'waiting-callback',
        step: 'Browser automation finished. Waiting for local callback...'
      })
      return
    }

    const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`
    appendPendingLoginOutput(`Browser automation exited with ${reason}.`)
    lastLoginError = `Auto-login browser automation exited with ${reason}`
    updatePendingLogin({
      status: 'waiting-callback',
      step: 'Browser automation stopped before callback. Complete login manually or wait for timeout.'
    })
  })

  void loginPromise

  return {
    ok: true,
    alias,
    email: selected.email,
    url: flow.url
  }
}

async function saveAutoLoginAccountAndStart(input: AutoLoginCreateInput): Promise<{ ok: true; alias: string; email: string; url: string }> {
  const account = upsertAutoLoginCredentials(input)
  return startAutoLogin(account.email)
}

function runSync(): void {
  try {
    const result = syncCodexAuthFile()
    const authStatus = getCodexAuthStatus()
    lastSyncAt = Date.now()
    lastSyncError = authStatus.error
    lastSyncAlias = result.alias ?? null
    if (result.updated || result.added) {
      logInfo(`Synced auth.json (${result.alias ?? 'none'})`)
    }
    if (authStatus.error) {
      logError(authStatus.error)
    }
  } catch (err) {
    lastSyncError = String(err)
    logError(`Sync failed: ${lastSyncError}`)
  }
}

type AntigravityAccountView = {
  index: number
  alias?: string
  projectId?: string
  managedProjectId?: string
  addedAt?: number | string
  lastUsed?: number | string
  hasRefreshToken: boolean
  rateLimitResetTimes?: Record<string, number>
}

type AntigravityPromptCredits = {
  available: number
  monthly: number
  usedPercentage: number
  remainingPercentage: number
}

type AntigravityQuotaModel = {
  label: string
  modelId: string
  remainingFraction?: number
  remainingPercentage?: number
  isExhausted: boolean
  resetTime?: number
  timeUntilResetMs?: number
  timeUntilResetFormatted?: string
}

type AntigravityQuotaSnapshot = {
  timestamp: number
  name?: string
  email?: string
  promptCredits?: AntigravityPromptCredits
  models: AntigravityQuotaModel[]
}

type AntigravityQuotaState = {
  status: 'idle' | 'ok' | 'error'
  scope?: 'active' | 'all'
  fetchedAt?: number
  error?: string
  snapshot?: AntigravityQuotaSnapshot
  perAccount?: Record<number, AntigravityQuotaSnapshot>
}

function loadAntigravityAccounts(): {
  path: string
  error?: string
  activeIndex?: number
  readAt?: number
  accounts: AntigravityAccountView[]
} {
  const result = { path: ANTIGRAVITY_ACCOUNTS_FILE, accounts: [] as AntigravityAccountView[], readAt: Date.now() }
  if (!fs.existsSync(ANTIGRAVITY_ACCOUNTS_FILE)) {
    return { ...result, error: 'antigravity-accounts.json not found' }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(ANTIGRAVITY_ACCOUNTS_FILE, 'utf-8')) as any
    const activeIndex = typeof raw?.activeIndex === 'number' ? raw.activeIndex : undefined
    const accounts = Array.isArray(raw?.accounts) ? raw.accounts : []
    const view = accounts.map((acc: any, index: number) => ({
      index,
      alias: acc?.projectId || acc?.managedProjectId,
      projectId: acc?.projectId,
      managedProjectId: acc?.managedProjectId,
      addedAt: acc?.addedAt,
      lastUsed: acc?.lastUsed,
      hasRefreshToken: Boolean(acc?.refreshToken),
      rateLimitResetTimes: acc?.rateLimitResetTimes && typeof acc.rateLimitResetTimes === 'object'
        ? acc.rateLimitResetTimes
        : undefined
    }))
    return { ...result, activeIndex, accounts: view }
  } catch (err) {
    return { ...result, error: `Failed to parse antigravity accounts: ${err}` }
  }
}

function isAntigravityProcessLine(line: string): boolean {
  const lower = line.toLowerCase()
  if (lower.includes('antigravity')) return true
  return /--app_data_dir\s+antigravity\b/i.test(line)
}

function getAntigravityProcessName(): string | null {
  if (process.platform === 'darwin') {
    return `language_server_macos${process.arch === 'arm64' ? '_arm' : ''}`
  }
  if (process.platform === 'linux') {
    return `language_server_linux${process.arch === 'arm64' ? '_arm' : '_x64'}`
  }
  if (process.platform === 'win32') {
    return 'language_server_windows_x64.exe'
  }
  return null
}

async function detectAntigravityProcessInfo(): Promise<{ pid: number; extensionPort: number; csrfToken: string; connectPort: number } | null> {
  const processName = getAntigravityProcessName()
  if (!processName) {
    throw new Error('Unsupported platform for Antigravity quotas')
  }
  if (process.platform === 'win32') {
    throw new Error('Antigravity quota detection is not implemented for Windows yet')
  }

  const cmd = process.platform === 'darwin' ? `pgrep -fl ${processName}` : `pgrep -af ${processName}`
  const { stdout } = await execAsync(cmd)
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const tokenLines = lines.filter((line) => line.includes('--csrf_token'))
  if (tokenLines.length === 0) {
    return null
  }

  const ordered = [
    ...tokenLines.filter(isAntigravityProcessLine),
    ...tokenLines.filter((line) => !isAntigravityProcessLine(line))
  ]

  for (const line of ordered) {
    const parts = line.split(/\s+/)
    const pid = Number(parts[0])
    if (!Number.isFinite(pid)) {
      continue
    }
    const portMatch = line.match(/--extension_server_port[=\s]+(\d+)/)
    const tokenMatch = line.match(/--csrf_token[=\s]+([a-zA-Z0-9\-]+)/)
    if (!tokenMatch) {
      continue
    }
    const extensionPort = portMatch ? Number(portMatch[1]) : 0
    const csrfToken = tokenMatch[1]
    const ports = await listListeningPorts(pid)
    const workingPort = await findWorkingPort(ports, csrfToken)
    const connectPort = workingPort || (extensionPort > 0 ? extensionPort : 0)
    if (!connectPort) {
      return null
    }
    return { pid, extensionPort, csrfToken, connectPort }
  }

  return null
}

async function listListeningPorts(pid: number): Promise<number[]> {
  try {
    const cmd = `lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid}`
    const { stdout } = await execAsync(cmd)
    const ports = new Set<number>()
    const regex = /:(\d+)\s+\(LISTEN\)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(stdout)) !== null) {
      const port = Number(match[1])
      if (Number.isFinite(port)) {
        ports.add(port)
      }
    }
    return Array.from(ports.values()).sort((a, b) => a - b)
  } catch {
    return []
  }
}

function antigravityRequest<T>(port: number, csrfToken: string, pathName: string, body: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathName,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Connect-Protocol-Version': '1',
          'X-Codeium-Csrf-Token': csrfToken
        },
        rejectUnauthorized: false,
        timeout: 5000
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as T)
          } catch {
            reject(new Error('Invalid JSON response'))
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })
    req.write(payload)
    req.end()
  })
}

async function testAntigravityPort(port: number, csrfToken: string): Promise<boolean> {
  try {
    await antigravityRequest<any>(
      port,
      csrfToken,
      '/exa.language_server_pb.LanguageServerService/GetUnleashData',
      { wrapper_data: {} }
    )
    return true
  } catch {
    return false
  }
}

async function findWorkingPort(ports: number[], csrfToken: string): Promise<number | null> {
  for (const port of ports) {
    const ok = await testAntigravityPort(port, csrfToken)
    if (ok) return port
  }
  return null
}

function formatAntigravityDuration(ms: number, resetTime?: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'Ready'
  const mins = Math.ceil(ms / 60000)
  let duration = ''
  if (mins < 60) {
    duration = `${mins}m`
  } else {
    const hours = Math.floor(mins / 60)
    duration = `${hours}h ${mins % 60}m`
  }
  if (!resetTime) return duration
  const resetDate = new Date(resetTime)
  const dateStr = resetDate.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = resetDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${duration} (${dateStr} ${timeStr})`
}

function updateAntigravityActiveIndex(raw: any, index: number): any {
  const next = { ...raw }
  next.activeIndex = index
  if (next.activeIndexByFamily && typeof next.activeIndexByFamily === 'object') {
    next.activeIndexByFamily = { ...next.activeIndexByFamily }
    for (const key of Object.keys(next.activeIndexByFamily)) {
      next.activeIndexByFamily[key] = index
    }
  }
  return next
}

async function refreshAntigravityQuotaAll(): Promise<AntigravityQuotaState> {
  if (antigravityQuotaInFlight) {
    return antigravityQuotaInFlight
  }
  antigravityQuotaInFlight = (async () => {
    let originalRaw = ''
    let parsed: any
    try {
      if (!fs.existsSync(ANTIGRAVITY_ACCOUNTS_FILE)) {
        throw new Error('antigravity-accounts.json not found')
      }
      originalRaw = fs.readFileSync(ANTIGRAVITY_ACCOUNTS_FILE, 'utf-8')
      parsed = JSON.parse(originalRaw)
      const accounts = Array.isArray(parsed?.accounts) ? parsed.accounts : []
      if (accounts.length === 0) {
        throw new Error('No Antigravity accounts available')
      }

      const perAccount: Record<number, AntigravityQuotaSnapshot> = {}
      for (let index = 0; index < accounts.length; index += 1) {
        const next = updateAntigravityActiveIndex(parsed, index)
        fs.writeFileSync(ANTIGRAVITY_ACCOUNTS_FILE, JSON.stringify(next, null, 2))
        await new Promise((resolve) => setTimeout(resolve, 500))
        const snapshot = await fetchAntigravityQuota()
        perAccount[index] = snapshot
      }

      antigravityQuotaState = {
        status: 'ok',
        scope: 'all',
        fetchedAt: Date.now(),
        snapshot: perAccount[parsed.activeIndex ?? 0] || perAccount[0],
        perAccount
      }
    } catch (err) {
      antigravityQuotaState = {
        status: 'error',
        scope: 'all',
        fetchedAt: Date.now(),
        error: String(err),
        perAccount: antigravityQuotaState.perAccount
      }
    } finally {
      if (originalRaw) {
        try {
          fs.writeFileSync(ANTIGRAVITY_ACCOUNTS_FILE, originalRaw)
        } catch (err) {
          logError(`Failed to restore antigravity accounts file: ${err}`)
        }
      }
      antigravityQuotaInFlight = null
    }
    return antigravityQuotaState
  })()
  return antigravityQuotaInFlight
}

function parseAntigravityQuota(data: any): AntigravityQuotaSnapshot {
  const userStatus = data?.userStatus
  const planInfo = userStatus?.planStatus?.planInfo
  const availableCredits = userStatus?.planStatus?.availablePromptCredits
  let promptCredits: AntigravityPromptCredits | undefined

  if (planInfo && availableCredits !== undefined) {
    const monthly = Number(planInfo.monthlyPromptCredits)
    const available = Number(availableCredits)
    if (Number.isFinite(monthly) && monthly > 0) {
      promptCredits = {
        available,
        monthly,
        usedPercentage: ((monthly - available) / monthly) * 100,
        remainingPercentage: (available / monthly) * 100
      }
    }
  }

  const rawModels = userStatus?.cascadeModelConfigData?.clientModelConfigs || []
  const models: AntigravityQuotaModel[] = rawModels
    .filter((model: any) => model?.quotaInfo)
    .map((model: any) => {
      const reset = model.quotaInfo?.resetTime ? new Date(model.quotaInfo.resetTime) : null
      const resetTime = reset ? reset.getTime() : undefined
      const remainingFraction = typeof model.quotaInfo?.remainingFraction === 'number'
        ? model.quotaInfo.remainingFraction
        : undefined
      const remainingPercentage = typeof remainingFraction === 'number'
        ? remainingFraction * 100
        : undefined
      const diff = resetTime ? resetTime - Date.now() : undefined
      const label = model.label || model.modelOrAlias?.model || 'model'
      const modelId = model.modelOrAlias?.model || model.modelOrAlias?.alias || 'unknown'
      return {
        label,
        modelId,
        remainingFraction,
        remainingPercentage,
        isExhausted: remainingFraction === 0,
        resetTime,
        timeUntilResetMs: diff,
        timeUntilResetFormatted: typeof diff === 'number' ? formatAntigravityDuration(diff, resetTime) : undefined
      }
    })

  return {
    timestamp: Date.now(),
    name: userStatus?.name,
    email: userStatus?.email,
    promptCredits,
    models
  }
}

async function fetchAntigravityQuota(): Promise<AntigravityQuotaSnapshot> {
  const info = await detectAntigravityProcessInfo()
  if (!info) {
    throw new Error('Antigravity process not found')
  }

  const data = await antigravityRequest<any>(
    info.connectPort,
    info.csrfToken,
    '/exa.language_server_pb.LanguageServerService/GetUserStatus',
    {
      metadata: {
        ideName: 'antigravity',
        extensionName: 'antigravity',
        locale: 'en'
      }
    }
  )

  return parseAntigravityQuota(data)
}

async function refreshAntigravityQuota(): Promise<AntigravityQuotaState> {
  if (antigravityQuotaInFlight) {
    return antigravityQuotaInFlight
  }
  antigravityQuotaInFlight = (async () => {
    try {
      const snapshot = await fetchAntigravityQuota()
      antigravityQuotaState = {
        status: 'ok',
        scope: 'active',
        fetchedAt: Date.now(),
        snapshot
      }
    } catch (err) {
      antigravityQuotaState = {
        status: 'error',
        scope: 'active',
        fetchedAt: Date.now(),
        error: String(err)
      }
    } finally {
      antigravityQuotaInFlight = null
    }
    return antigravityQuotaState
  })()
  return antigravityQuotaInFlight
}

function scheduleSync(): void {
  if (syncTimer) {
    clearTimeout(syncTimer)
  }
  syncTimer = setTimeout(() => {
    runSync()
  }, SYNC_DEBOUNCE_MS)
}

function startAuthWatcher(): void {
  const authPath = getCodexAuthPath()
  fs.watchFile(authPath, { interval: SYNC_INTERVAL_MS }, () => {
    scheduleSync()
  })
}

export function startWebConsole(options?: { port?: number; host?: string }): http.Server {
  const host = options?.host || DEFAULT_HOST
  const port = options?.port || DEFAULT_PORT

  if (!isLocalhostHost(host)) {
    const err = Errors.localhostOnly(host)
    throw new Error(`${err.code}: ${err.message}`)
  }

  runSync()
  startAuthWatcher()

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${host}:${port}`)
    const path = requestUrl.pathname

    try {

    if (req.method === 'GET' && path === '/api/state') {
      runSync()
      const store = loadStore()
      const rawAccounts = Object.values(store.accounts)
      const accounts = rawAccounts.map(scrubAccount)
      const deviceAlias = resolveAliasForCurrentAuth(store)
      const authSummary = getCodexAuthSummary()
      const storeStatus = getStoreStatus()
      // Phase G: Only load antigravity if feature is enabled
      const settings = getSettings()
      const runtimeSettings = getRuntimeSettings()
      const antigravityEnabled = settings.settings.featureFlags?.antigravityEnabled ?? false
      const antigravity = antigravityEnabled ? loadAntigravityAccounts() : { accounts: [], path: ANTIGRAVITY_ACCOUNTS_FILE }
      const forceState = getForceState()
      const forceActive = isForceActive()
      const autoLogin = loadAutoLoginConfig()
      sendJson(res, 200, {
        authPath: getCodexAuthPath(),
        deviceAlias,
        rotationAlias: store.activeAlias,
        accounts,
        lastSyncAt,
        lastSyncError,
        lastSyncAlias,
        authSummary,
        storeStatus,
        login: pendingLogin,
        lastLoginError,
        // Phase G: Only include antigravity data if feature is enabled
        antigravity: antigravityEnabled ? { ...antigravity, quota: antigravityQuotaState } : { accounts: [], path: ANTIGRAVITY_ACCOUNTS_FILE, quota: { status: 'disabled', scope: 'active' } },
        queue: getRefreshQueueState(),
        recommendedAlias: recommendAlias(rawAccounts),
        logPath: getLogPath(),
        autoLogin,
        rotationStrategy: runtimeSettings.settings.rotationStrategy,
        force: {
          active: forceActive,
          alias: forceState.forcedAlias,
          forcedUntil: forceState.forcedUntil,
          forcedBy: forceState.forcedBy,
          remainingMs: getRemainingForceTimeMs(),
          remainingTime: formatForceDuration(getRemainingForceTimeMs())
        },
        // Phase G: Include feature flags in state
        featureFlags: settings.settings.featureFlags || { antigravityEnabled: false }
      })
      return
    }

    if (req.method === 'GET' && path === '/api/logs') {
      const limitParam = requestUrl.searchParams.get('limit')
      const limit = limitParam ? Number(limitParam) : undefined
      const lines = readLogTail(Number.isFinite(limit) ? limit : undefined)
      sendJson(res, 200, { path: getLogPath(), lines })
      return
    }

    if (req.method === 'POST' && path === '/api/sync') {
      try {
        runSync()
        sendJson(res, 200, { ok: true })
      } catch (err) {
        sendJson(res, 500, { error: String(err) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/auth/start') {
      const body = await readJsonBody(req)
      const alias = typeof body.alias === 'string' ? body.alias.trim() : ''
      if (!alias) {
        sendJson(res, 400, { error: 'Missing alias' })
        return
      }
      if (pendingLogin) {
        sendJson(res, 409, { error: `Login already in progress for ${pendingLogin.alias}` })
        return
      }
      try {
        const result = await startManualLogin(alias)
        sendJson(res, 200, result)
      } catch (err) {
        lastLoginError = String(err)
        sendJson(res, 500, { error: String(err) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/auto-login/start') {
      const body = await readJsonBody(req)
      const selector = typeof body.selector === 'string' ? body.selector.trim() : ''
      if (!selector) {
        sendJson(res, 400, { error: 'Missing selector' })
        return
      }
      try {
        const result = await startAutoLogin(selector, body.visible === true)
        sendJson(res, 200, result)
      } catch (err) {
        lastLoginError = String(err)
        sendJson(res, 500, { error: String(err) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/auto-login/add') {
      const body = await readJsonBody(req)
      const email = typeof body.email === 'string' ? body.email.trim() : ''
      const password = typeof body.password === 'string' ? body.password : ''
      const alias = typeof body.alias === 'string' ? body.alias.trim() : ''
      const chatgptPassword = typeof body.chatgptPassword === 'string' ? body.chatgptPassword : ''
      if (!email) {
        sendJson(res, 400, { error: 'Missing login/email' })
        return
      }
      if (!password.trim()) {
        sendJson(res, 400, { error: 'Missing password' })
        return
      }
      try {
        const result = await saveAutoLoginAccountAndStart({
          email,
          password,
          alias,
          chatgptPassword
        })
        sendJson(res, 200, result)
      } catch (err) {
        lastLoginError = String(err)
        sendJson(res, 500, { error: String(err) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/switch') {
      const body = await readJsonBody(req)
      if (!body.alias) {
        sendJson(res, 400, { error: 'Missing alias' })
        return
      }
      try {
        writeCodexAuthForAlias(body.alias)
        sendJson(res, 200, { ok: true })
      } catch (err) {
        sendJson(res, 400, { error: String(err) })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/remove') {
      const body = await readJsonBody(req)
      if (!body.alias) {
        sendJson(res, 400, { error: 'Missing alias' })
        return
      }
      removeAccount(body.alias)
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && path === '/api/account/meta') {
      const body = await readJsonBody(req)
      if (!body.alias) {
        sendJson(res, 400, { error: 'Missing alias' })
        return
      }
      const tags = typeof body.tags === 'string'
        ? body.tags
          .split(',')
          .map((tag: string) => tag.trim().toLowerCase())
          .filter(Boolean)
        : []
      const uniqueTags = Array.from(new Set(tags))
      const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
      updateAccount(body.alias, {
        tags: uniqueTags.length > 0 ? uniqueTags : undefined,
        notes: notes || undefined
      })
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && path === '/api/token/refresh') {
      const body = await readJsonBody(req)
      const store = loadStore()
      const candidates = Object.values(store.accounts)
      const alias = typeof body.alias === 'string' ? body.alias : undefined
      const targets = alias ? candidates.filter((acc) => acc.alias === alias) : candidates
      if (alias && targets.length === 0) {
        logWarn(`[multi-auth] Refresh requested for unknown alias: ${alias}`)
        sendJson(res, 400, { error: 'Unknown alias' })
        return
      }
      const deviceAlias = resolveAliasForCurrentAuth(store)

      const results: Array<{ alias: string; updated: boolean; error?: string }> = []
      for (const account of targets) {
        if (!account.refreshToken) {
          logWarn(`[multi-auth] Refresh skipped (no refresh token) for ${account.alias}`)
          results.push({ alias: account.alias, updated: false, error: 'No refresh token' })
          continue
        }
        const refreshed = await refreshToken(account.alias)
        if (!refreshed) {
          results.push({ alias: account.alias, updated: false, error: 'Token refresh failed' })
          continue
        }

        if (deviceAlias === account.alias) {
          try {
            writeCodexAuthForAlias(account.alias)
          } catch (err) {
            const errorMessage = getSanitizedErrorMessage(err)
            logError(`[multi-auth] Refreshed token but failed to update auth.json for ${account.alias}: ${errorMessage}`)
            results.push({ alias: account.alias, updated: true, error: `Refreshed, but failed to update auth.json: ${err}` })
            continue
          }
        }

        results.push({ alias: account.alias, updated: true })
      }

      sendJson(res, 200, { ok: true, results })
      return
    }

    if (req.method === 'POST' && path === '/api/limits/refresh') {
      const body = await readJsonBody(req)
      const accounts = listAccounts().filter((acc) => acc.refreshToken && acc.accessToken)
      if (body.alias && !accounts.find((acc) => acc.alias === body.alias)) {
        sendJson(res, 400, { error: 'Unknown alias' })
        return
      }
      const queue = startRefreshQueue(accounts, body.alias)
      sendJson(res, 200, { ok: true, queue })
      return
    }

    if (req.method === 'POST' && path === '/api/limits/stop') {
      stopRefreshQueue()
      sendJson(res, 200, { ok: true })
      return
    }

    // Phase G: Antigravity endpoints - check feature flag
    if (req.method === 'POST' && path === '/api/antigravity/refresh') {
      // Check if antigravity feature is enabled
      if (!isFeatureEnabled('antigravityEnabled')) {
        sendJson(res, 403, { 
          error: 'Antigravity feature is disabled', 
          code: 'FEATURE_DISABLED',
          feature: 'antigravity'
        })
        return
      }
      await refreshAntigravityQuota()
      sendJson(res, 200, { ok: true, quota: antigravityQuotaState })
      return
    }

    if (req.method === 'POST' && path === '/api/antigravity/refresh-all') {
      // Check if antigravity feature is enabled
      if (!isFeatureEnabled('antigravityEnabled')) {
        sendJson(res, 403, { 
          error: 'Antigravity feature is disabled', 
          code: 'FEATURE_DISABLED',
          feature: 'antigravity'
        })
        return
      }
      await refreshAntigravityQuotaAll()
      sendJson(res, 200, { ok: true, quota: antigravityQuotaState })
      return
    }

    // Phase D: Account Lifecycle API Endpoints
    
    // GET /api/accounts - List all accounts with metadata
    if (req.method === 'GET' && path === '/api/accounts') {
      const store = loadStore()
      const accounts = Object.values(store.accounts).map(acc => ({
        alias: acc.alias,
        email: acc.email,
        enabled: acc.enabled !== false, // Defaults to true
        disabledAt: acc.disabledAt,
        disabledBy: acc.disabledBy,
        disableReason: acc.disableReason,
        usageCount: acc.usageCount,
        rateLimits: acc.rateLimits,
        limitsConfidence: acc.limitsConfidence,
        limitStatus: acc.limitStatus,
        limitError: acc.limitError,
        lastLimitProbeAt: acc.lastLimitProbeAt,
        lastLimitErrorAt: acc.lastLimitErrorAt,
        tags: acc.tags,
        notes: acc.notes
      }))
      sendJson(res, 200, { accounts })
      return
    }

    // PUT /api/accounts/:alias/enabled - Enable/disable an account
    if (req.method === 'PUT' && path.startsWith('/api/accounts/') && path.endsWith('/enabled')) {
      const aliasMatch = path.match(/^\/api\/accounts\/([^\/]+)\/enabled$/)
      if (!aliasMatch) {
        sendJson(res, 400, { error: 'Invalid path format' })
        return
      }
      const alias = aliasMatch[1]
      const store = loadStore()
      
      if (!store.accounts[alias]) {
        sendJson(res, 404, { error: 'Unknown alias', code: 'ACCOUNT_NOT_FOUND' })
        return
      }
      
      const body = await readJsonBody(req)
      const enabled = body.enabled === true
      
      // Phase D: Prevent disabling the last enabled account
      if (!enabled) {
        const enabledCount = Object.values(store.accounts).filter(
          acc => acc.alias !== alias && acc.enabled !== false
        ).length
        if (enabledCount === 0) {
          sendJson(res, 409, { 
            error: 'Cannot disable the last enabled account', 
            code: 'LAST_ACCOUNT' 
          })
          return
        }
      }
      
      // Phase D: Double-submit protection - check if already in desired state
      const currentEnabled = store.accounts[alias].enabled !== false
      if (currentEnabled === enabled) {
        sendJson(res, 409, { 
          error: enabled ? 'Account is already enabled' : 'Account is already disabled',
          code: 'ALREADY_IN_STATE'
        })
        return
      }
      
      const updates: Partial<AccountCredentials> = { enabled }
      if (!enabled) {
        updates.disabledAt = Date.now()
        updates.disabledBy = 'dashboard' // Could be expanded to track actor
      } else {
        // Clear disable metadata when enabling
        updates.disabledAt = undefined
        updates.disabledBy = undefined
        updates.disableReason = undefined
      }
      
      updateAccount(alias, updates)
      logInfo(`Account ${alias} ${enabled ? 'enabled' : 'disabled'} via dashboard`)
      sendJson(res, 200, { 
        ok: true, 
        alias,
        enabled,
        disabledAt: updates.disabledAt,
        disabledBy: updates.disabledBy
      })
      return
    }

    // POST /api/accounts/:alias/reauth - Re-authenticate an account
    if (req.method === 'POST' && path.startsWith('/api/accounts/') && path.endsWith('/reauth')) {
      const aliasMatch = path.match(/^\/api\/accounts\/([^\/]+)\/reauth$/)
      if (!aliasMatch) {
        sendJson(res, 400, { error: 'Invalid path format' })
        return
      }
      const alias = aliasMatch[1]
      const store = loadStore()
      
      if (!store.accounts[alias]) {
        sendJson(res, 404, { error: 'Unknown alias', code: 'ACCOUNT_NOT_FOUND' })
        return
      }
      
      // Phase D: Cannot re-auth a disabled account
      if (store.accounts[alias].enabled === false) {
        sendJson(res, 409, { 
          error: 'Cannot re-authenticate a disabled account',
          code: 'ACCOUNT_DISABLED'
        })
        return
      }
      
      // Phase D: Only targeted alias credentials mutate
      // Start OAuth flow for the specific alias
      try {
        if (pendingLogin) {
          sendJson(res, 409, { error: `Login already in progress for ${pendingLogin.alias}` })
          return
        }
        const flow = await createAuthorizationFlow()
        const body = await readJsonBody(req)
        const actor = body.actor || 'dashboard'
        
        loginAccount(alias, flow, { timeoutMs: LOGIN_TIMEOUT_MS })
          .then(() => {
            logInfo(`Re-auth completed for ${alias} by ${actor}`)
            try {
              writeCodexAuthForAlias(alias)
            } catch (err) {
              logError(`Failed to update codex auth for ${alias}: ${getSanitizedErrorMessage(err)}`)
            }
            // Update account metadata
            updateAccount(alias, {
              lastRefresh: new Date().toISOString()
            })
          })
          .catch((err) => {
            logError(`Re-auth failed for ${alias}: ${err}`)
          })
        
        sendJson(res, 200, { 
          ok: true, 
          alias,
          url: flow.url,
          message: 'OAuth flow started. Complete authentication in the browser.'
        })
      } catch (err) {
        sendJson(res, 500, { error: String(err), code: 'AUTH_FLOW_ERROR' })
      }
      return
    }

    // Phase E: Force Mode API endpoints
    // GET /api/force - Get current force state
    if (req.method === 'GET' && path === '/api/force') {
      const forceState = getForceState()
      const active = isForceActive()
      const remainingMs = getRemainingForceTimeMs()
      
      sendJson(res, 200, {
        active,
        alias: forceState.forcedAlias,
        forcedAt: forceState.forcedAlias && forceState.forcedUntil 
          ? forceState.forcedUntil - (24 * 60 * 60 * 1000) 
          : null,
        forcedUntil: forceState.forcedUntil,
        forcedBy: forceState.forcedBy,
        remainingMs,
        remainingTime: formatForceDuration(remainingMs),
        previousRotationStrategy: forceState.previousRotationStrategy
      })
      return
    }

    // POST /api/force - Activate force mode for an alias
    if (req.method === 'POST' && path === '/api/force') {
      const body = await readJsonBody(req)
      const alias = typeof body.alias === 'string' ? body.alias.trim() : ''
      const actor = typeof body.actor === 'string' ? body.actor.trim() : 'api'
      
      if (!alias) {
        sendJson(res, 400, { error: 'Missing alias', code: 'MISSING_ALIAS' })
        return
      }
      
      const result = activateForce(alias, actor)
      
      if (!result.success) {
        const statusCode = result.error?.includes('not found') ? 404 
          : result.error?.includes('disabled') ? 409 
          : 400
        sendJson(res, statusCode, { error: result.error, code: 'FORCE_FAILED' })
        return
      }
      
      logInfo(`Force mode activated for ${alias} by ${actor}`)
      sendJson(res, 200, {
        ok: true,
        alias,
        forcedUntil: result.state?.forcedUntil,
        remainingMs: result.state?.forcedUntil ? result.state.forcedUntil - Date.now() : 0,
        remainingTime: result.state?.forcedUntil 
          ? formatForceDuration(result.state.forcedUntil - Date.now()) 
          : '0m',
        previousRotationStrategy: result.state?.previousRotationStrategy
      })
      return
    }

    // POST /api/force/clear - Deactivate force mode
    if (req.method === 'POST' && path === '/api/force/clear') {
      const result = clearForce()
      
      if (result.success) {
        logInfo('Force mode cleared')
        sendJson(res, 200, {
          ok: true,
          restoredStrategy: result.restoredStrategy
        })
      } else {
        sendJson(res, 500, { error: 'Failed to clear force mode', code: 'CLEAR_FAILED' })
      }
      return
    }

    // Phase F: Settings API Endpoints
    
    // GET /api/settings - Get current settings
    if (req.method === 'GET' && path === '/api/settings') {
      const { getSettingsWithInfo } = await import('./settings.js')
      const info = getSettingsWithInfo()
      sendJson(res, 200, {
        settings: info.settings,
        source: info.source,
        preset: info.preset,
        canReset: info.canReset
      })
      return
    }
    
    // PUT /api/settings - Update settings
    if (req.method === 'PUT' && path === '/api/settings') {
      const body = await readJsonBody(req)
      const { updateSettings } = await import('./settings.js')
      
      const actor = body.actor || 'dashboard'
      const updates: Partial<RotationSettings> = {}
      
      if (body.rotationStrategy) {
        updates.rotationStrategy = body.rotationStrategy
      }
      if (typeof body.criticalThreshold === 'number') {
        updates.criticalThreshold = body.criticalThreshold
      }
      if (typeof body.lowThreshold === 'number') {
        updates.lowThreshold = body.lowThreshold
      }
      if (body.accountWeights) {
        updates.accountWeights = body.accountWeights
      }
      
      // Phase G: Handle feature flags
      if (body.featureFlags && typeof body.featureFlags === 'object') {
        updates.featureFlags = body.featureFlags
      }
      
      const result = updateSettings(updates, actor)
      
      if (result.success) {
        sendJson(res, 200, {
          ok: true,
          settings: result.settings
        })
      } else {
        sendJson(res, 400, {
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: result.errors
        })
      }
      return
    }
    
    // Phase G: GET /api/settings/feature-flags - Get feature flags
    if (req.method === 'GET' && path === '/api/settings/feature-flags') {
      const settings = getSettings()
      sendJson(res, 200, {
        featureFlags: settings.settings.featureFlags || { antigravityEnabled: false }
      })
      return
    }
    
    // Phase G: PUT /api/settings/feature-flags - Update feature flags
    if (req.method === 'PUT' && path === '/api/settings/feature-flags') {
      const body = await readJsonBody(req)
      const { updateSettings } = await import('./settings.js')
      
      const actor = body.actor || 'dashboard'
      const updates: Partial<RotationSettings> = {}
      
      if (body.featureFlags && typeof body.featureFlags === 'object') {
        updates.featureFlags = body.featureFlags
        
        const result = updateSettings(updates, actor)
        
        if (result.success && result.settings) {
          logInfo(`Feature flags updated by ${actor}: ${JSON.stringify(body.featureFlags)}`)
          sendJson(res, 200, {
            ok: true,
            featureFlags: result.settings.featureFlags || { antigravityEnabled: false }
          })
        } else {
          sendJson(res, 400, {
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: result.errors
          })
        }
      } else {
        sendJson(res, 400, {
          error: 'Invalid feature flags',
          code: 'INVALID_FEATURE_FLAGS'
        })
      }
      return
    }

    const isStickySessionsEnabled = (): boolean => isFeatureEnabled('stickySessionsEnabled')
    const sendStickyFeatureDisabled = (): void => {
      sendJson(res, 403, {
        error: 'Sticky sessions feature is disabled',
        code: 'FEATURE_DISABLED',
        feature: 'sticky-sessions'
      })
    }

    if (req.method === 'GET' && path === '/api/sticky-sessions/config') {
      if (!isStickySessionsEnabled()) {
        sendStickyFeatureDisabled()
        return
      }

      const stickyConfig = getStickySessionConfig()
      sendJson(res, 200, stickyConfig.config)
      return
    }

    if (req.method === 'PUT' && path === '/api/sticky-sessions/config') {
      const body = await readJsonBody(req)
      const actor = body.actor || 'dashboard'
      const currentlyEnabled = isStickySessionsEnabled()

      if (!currentlyEnabled && body.enabled !== false) {
        sendStickyFeatureDisabled()
        return
      }

      const result = updateStickySessionConfig({
        enabled: body.enabled,
        identitySources: body.identitySources,
        allowPromptCacheKey: body.allowPromptCacheKey,
        ttlMs: body.ttlMs,
        maxEntries: body.maxEntries,
        maxFileBytes: body.maxFileBytes
      }, actor)

      if (result.success) {
        sendJson(res, 200, result.config)
      } else {
        sendJson(res, 400, {
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: result.errors
        })
      }
      return
    }

    if (req.method === 'GET' && path === '/api/sticky-sessions/status') {
      if (!isStickySessionsEnabled()) {
        sendStickyFeatureDisabled()
        return
      }

      const stickySettings = getStickySessionRuntimeSettings()
      const status = await getStickySessionsStatus({ now: Date.now(), settings: stickySettings })
      sendJson(res, 200, { ok: true, ...status })
      return
    }

    if (req.method === 'POST' && path === '/api/sticky-sessions/cleanup') {
      if (!isStickySessionsEnabled()) {
        sendStickyFeatureDisabled()
        return
      }

      const stickySettings = getStickySessionRuntimeSettings()
      const cleanup = await cleanupStickySessions({ now: Date.now(), settings: stickySettings })
      sendJson(res, 200, { ok: true, ...cleanup })
      return
    }

    // POST /api/settings/reset - Reset to defaults
    if (req.method === 'POST' && path === '/api/settings/reset') {
      const { resetSettings } = await import('./settings.js')
      const body = await readJsonBody(req)
      const actor = body.actor || 'dashboard'
      
      const settings = resetSettings(actor)
      sendJson(res, 200, {
        ok: true,
        settings
      })
      return
    }
    
    // POST /api/settings/preset - Apply a preset
    if (req.method === 'POST' && path === '/api/settings/preset') {
      const body = await readJsonBody(req)
      const { applyPreset } = await import('./settings.js')
      
      const preset = body.preset
      if (!preset || !['balanced', 'conservative', 'aggressive', 'custom'].includes(preset)) {
        sendJson(res, 400, {
          error: 'Invalid preset',
          code: 'INVALID_PRESET',
          validPresets: ['balanced', 'conservative', 'aggressive', 'custom']
        })
        return
      }
      
      const actor = body.actor || 'dashboard'
      const result = applyPreset(preset as WeightPreset, actor)
      
      if (result.success) {
        sendJson(res, 200, {
          ok: true,
          preset,
          settings: result.settings
        })
      } else {
        sendJson(res, 400, {
          error: 'Failed to apply preset',
          code: 'PRESET_ERROR',
          details: result.errors
        })
      }
      return
    }

      if (isApiRequestPath(path)) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
        return
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        if (await serveSpaRequest(res, path)) {
          return
        }
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    } catch (err) {
      if (res.writableEnded) {
        return
      }

      const errorCode = (err as { code?: string })?.code
      if (errorCode === 'INVALID_JSON') {
        sendJson(res, 400, { error: 'Invalid JSON payload', code: 'INVALID_JSON' })
        return
      }
      if (errorCode === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, { error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' })
        return
      }

      const errorMessage = err instanceof Error ? err.message : String(err)
      logError(`Web request failed (${req.method} ${path}): ${errorMessage}`)
      sendJson(res, 500, { error: 'Internal server error', code: 'INTERNAL_ERROR' })
    }
  })

  server.listen(port, host, () => {
    console.log(`[multi-auth] Codex dashboard running at http://${host}:${port}`)
    logInfo(`Codex dashboard running at http://${host}:${port}`)
  })

  return server
}
