import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const DEFAULT_LOG_DIR = path.join(os.homedir(), '.config', 'opencode-multi-auth', 'logs')
const LOG_FILE = process.env.CODEX_SOFT_LOG_PATH || path.join(DEFAULT_LOG_DIR, 'codex-soft.log')
const MAX_LOG_LINES = 400

function ensureDir(): void {
  const dir = path.dirname(LOG_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

function sanitize(message: string): string {
  return message
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[jwt]')
    .replace(/\bsk-[A-Za-z0-9]{10,}\b/g, '[token]')
}

function append(level: string, message: string): void {
  try {
    ensureDir()
    const line = `${new Date().toISOString()} [${level}] ${sanitize(message)}\n`
    fs.appendFileSync(LOG_FILE, line, { encoding: 'utf-8', mode: 0o600 })
  } catch {
    // Ignore log write failures
  }
}

export function logInfo(message: string): void {
  append('info', message)
}

export function logWarn(message: string): void {
  append('warn', message)
}

export function logError(message: string): void {
  append('error', message)
}

export function getLogPath(): string {
  return LOG_FILE
}

export interface LogLine {
  time: string
  level: string
  message: string
}

const LOG_LINE_RE = /^(\S+)\s+\[(\w+)\]\s+(.*)$/

function parseLogLine(raw: string): LogLine {
  const match = raw.match(LOG_LINE_RE)
  if (match) {
    return { time: match[1], level: match[2].toLowerCase(), message: match[3] }
  }
  // Fallback: treat entire line as message with unknown level
  return { time: '', level: 'unknown', message: raw }
}

export function readLogTail(maxLines = MAX_LOG_LINES): LogLine[] {
  try {
    if (!fs.existsSync(LOG_FILE)) return []
    const data = fs.readFileSync(LOG_FILE, 'utf-8')
    const rawLines = data.split('\n').filter(Boolean)
    const tail = rawLines.slice(Math.max(0, rawLines.length - maxLines))
    return tail.map(parseLogLine)
  } catch {
    return []
  }
}
