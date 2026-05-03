import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const DEFAULT_LOCK_STALE_MS = 5_000
const DEFAULT_LOCK_WAIT_MS = 16_000
const DEFAULT_LOCK_POLL_MS = 50
const LOCK_OWNER_FILE = 'owner.json'

type FileLockMetadata = {
  pid: number
  hostname: string
  createdAt: number
  targetFile: string
}

function getEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getLockStaleMs(): number {
  return getEnvInt('OPENCODE_MULTI_AUTH_LOCK_STALE_MS', DEFAULT_LOCK_STALE_MS)
}

function getLockWaitMs(): number {
  return getEnvInt('OPENCODE_MULTI_AUTH_LOCK_WAIT_MS', DEFAULT_LOCK_WAIT_MS)
}

function getLockPollMs(): number {
  return getEnvInt('OPENCODE_MULTI_AUTH_LOCK_POLL_MS', DEFAULT_LOCK_POLL_MS)
}

function sleepSync(ms: number): void {
  if (ms <= 0) return
  const sab = new SharedArrayBuffer(4)
  const view = new Int32Array(sab)
  Atomics.wait(view, 0, 0, ms)
}

function ownerPath(lockPath: string): string {
  return path.join(lockPath, LOCK_OWNER_FILE)
}

function readLockMetadata(lockPath: string): FileLockMetadata | null {
  try {
    const raw = fs.readFileSync(ownerPath(lockPath), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<FileLockMetadata>
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.hostname !== 'string' ||
      typeof parsed.createdAt !== 'number' ||
      typeof parsed.targetFile !== 'string'
    ) {
      return null
    }
    return {
      pid: parsed.pid,
      hostname: parsed.hostname,
      createdAt: parsed.createdAt,
      targetFile: parsed.targetFile
    }
  } catch {
    return null
  }
}

function getLockAgeMs(lockPath: string): number | null {
  const meta = readLockMetadata(lockPath)
  if (meta) return Date.now() - meta.createdAt

  try {
    const stat = fs.statSync(lockPath)
    return Date.now() - stat.mtimeMs
  } catch {
    return null
  }
}

function removeLock(lockPath: string): void {
  try {
    fs.rmSync(lockPath, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

export function acquireFileLock(targetFile: string): () => void {
  const lockPath = `${targetFile}.lock`
  const parent = path.dirname(targetFile)
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 })
  }

  const staleMs = getLockStaleMs()
  const waitMs = getLockWaitMs()
  const pollMs = getLockPollMs()
  const deadline = Date.now() + waitMs

  while (true) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 })
      const owner: FileLockMetadata = {
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: Date.now(),
        targetFile
      }
      fs.writeFileSync(ownerPath(lockPath), JSON.stringify(owner, null, 2), { mode: 0o600 })

      const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
      const signalHandlers: Partial<Record<NodeJS.Signals, () => void>> = {}
      let released = false
      const release = () => {
        if (released) return
        released = true
        removeLock(lockPath)
        process.off('exit', release)
        for (const signal of signals) {
          const handler = signalHandlers[signal]
          if (handler) process.off(signal, handler)
        }
      }

      for (const signal of signals) {
        signalHandlers[signal] = () => {
          release()
          process.kill(process.pid, signal)
        }
      }

      process.once('exit', release)
      for (const signal of signals) {
        process.once(signal, signalHandlers[signal]!)
      }

      return release
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err

      const ageMs = getLockAgeMs(lockPath)
      if (ageMs !== null && ageMs > staleMs) {
        removeLock(lockPath)
        continue
      }

      if (Date.now() >= deadline) {
        const meta = readLockMetadata(lockPath)
        const suffix = meta
          ? ` (owner pid=${meta.pid} host=${meta.hostname} age=${ageMs ?? 'unknown'}ms)`
          : ''
        throw new Error(`[multi-auth] Timed out waiting for file lock after ${waitMs}ms${suffix}`)
      }

      const remaining = deadline - Date.now()
      sleepSync(Math.min(pollMs, Math.max(1, remaining)))
    }
  }
}

export function withFileLock<T>(targetFile: string, fn: () => T): T {
  const release = acquireFileLock(targetFile)
  try {
    return fn()
  } finally {
    release()
  }
}
