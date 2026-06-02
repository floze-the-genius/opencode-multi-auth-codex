import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

type StickySessionSettings = {
  ttlMs: number
  maxEntries: number
  maxFileBytes: number
}

type StickySessionEntry = {
  alias: string
  createdAt: number
  lastUsedAt: number
}

type StickySessionsFile = {
  version: 1
  updatedAt: number
  entries: Record<string, StickySessionEntry>
}

const DEFAULT_SETTINGS: StickySessionSettings = {
  ttlMs: 60_000,
  maxEntries: 2,
  maxFileBytes: 512
}

async function loadStickyModule(): Promise<any> {
  return import('../../src/sticky-sessions.js')
}

function createTestContext() {
  const previousEnv = process.env
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-sticky-sidecar-'))
  const storeFile = path.join(storeDir, 'accounts.json')
  const sidecarFile = path.join(storeDir, 'sticky-sessions.json')

  process.env = {
    ...previousEnv,
    OPENCODE_MULTI_AUTH_STORE_DIR: storeDir,
    OPENCODE_MULTI_AUTH_STORE_FILE: storeFile
  }

  return {
    storeDir,
    storeFile,
    sidecarFile,
    restore() {
      process.env = previousEnv
      fs.rmSync(storeDir, { recursive: true, force: true })
    }
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

function readSidecar(filePath: string): StickySessionsFile {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as StickySessionsFile
}

describe('Sticky session sidecar persistence contract', () => {
  it('persists a versioned sidecar with minimal sticky metadata only', async () => {
    const ctx = createTestContext()

    try {
      const { upsertStickyAssignment } = await loadStickyModule()

      await upsertStickyAssignment({
        canonicalIdentity: '  Session-123  ',
        alias: 'alpha',
        now: 1_700_000_000_000,
        settings: DEFAULT_SETTINGS
      })

      const persisted = readSidecar(ctx.sidecarFile)
      const [hashedKey, entry] = Object.entries(persisted.entries)[0] ?? []

      expect(persisted.version).toBe(1)
      expect(persisted.updatedAt).toBe(1_700_000_000_000)
      expect(Object.keys(persisted.entries)).toHaveLength(1)
      expect(hashedKey).toMatch(/^[a-f0-9]{64}$/)
      expect(entry).toEqual({
        alias: 'alpha',
        createdAt: 1_700_000_000_000,
        lastUsedAt: 1_700_000_000_000
      })

      const serialized = JSON.stringify(persisted)
      expect(serialized).not.toContain('Session-123')
      expect(serialized).not.toContain('session-123')
      expect((entry as Record<string, unknown>).canonicalIdentity).toBeUndefined()
    } finally {
      ctx.restore()
    }
  })

  it('derives deterministic hashed keys from normalized identities without persisting raw values', async () => {
    const ctx = createTestContext()

    try {
      const { hashStickyIdentity, upsertStickyAssignment } = await loadStickyModule()

      expect(hashStickyIdentity(' Session-123 ')).toBe(hashStickyIdentity('session-123'))

      await upsertStickyAssignment({
        canonicalIdentity: ' Session-123 ',
        alias: 'alpha',
        now: 100,
        settings: DEFAULT_SETTINGS
      })
      await upsertStickyAssignment({
        canonicalIdentity: 'session-123',
        alias: 'beta',
        now: 200,
        settings: DEFAULT_SETTINGS
      })

      const persisted = readSidecar(ctx.sidecarFile)
      const keys = Object.keys(persisted.entries)

      expect(keys).toHaveLength(1)
      expect(keys[0]).toBe(hashStickyIdentity('session-123'))
      expect(persisted.entries[keys[0]]).toEqual({
        alias: 'beta',
        createdAt: 100,
        lastUsedAt: 200
      })
      expect(JSON.stringify(persisted)).not.toContain('session-123')
    } finally {
      ctx.restore()
    }
  })

  it('prunes expired entries first and then evicts least recently used entries to satisfy bounds', async () => {
    const ctx = createTestContext()

    try {
      const { loadStickySessions } = await loadStickyModule()

      writeJson(ctx.sidecarFile, {
        version: 1,
        updatedAt: 50,
        entries: {
          expired: { alias: 'alpha', createdAt: 1, lastUsedAt: 10 },
          oldest: { alias: 'beta', createdAt: 2, lastUsedAt: 40_000 },
          newest: { alias: 'gamma', createdAt: 3, lastUsedAt: 59_500 }
        }
      })

      const loaded = await loadStickySessions({
        now: 60_001,
        settings: { ...DEFAULT_SETTINGS, ttlMs: 20_000, maxEntries: 1, maxFileBytes: 10_000 }
      })

      expect(loaded.entries).toEqual({
        newest: { alias: 'gamma', createdAt: 3, lastUsedAt: 59_500 }
      })
      expect(readSidecar(ctx.sidecarFile).entries).toEqual({
        newest: { alias: 'gamma', createdAt: 3, lastUsedAt: 59_500 }
      })
    } finally {
      ctx.restore()
    }
  })

  it('does not return expired sticky assignments during runtime lookup and self-heals the sidecar', async () => {
    const ctx = createTestContext()

    try {
      const { getStickyAssignment, hashStickyIdentity } = await loadStickyModule()
      const stickyHash = hashStickyIdentity('session-expired-runtime')

      writeJson(ctx.sidecarFile, {
        version: 1,
        updatedAt: 50,
        entries: {
          [stickyHash]: { alias: 'beta', createdAt: 1, lastUsedAt: 10 }
        }
      })

      const loaded = await getStickyAssignment({
        stickyHash,
        now: 60_001,
        settings: { ...DEFAULT_SETTINGS, ttlMs: 20_000, maxEntries: 10, maxFileBytes: 10_000 }
      })

      expect(loaded).toBeNull()
      expect(readSidecar(ctx.sidecarFile).entries).toEqual({})
    } finally {
      ctx.restore()
    }
  })

  it('serializes concurrent updates into a valid sidecar and leaves no temporary files behind', async () => {
    const ctx = createTestContext()

    try {
      const { upsertStickyAssignment } = await loadStickyModule()

      await Promise.all([
        upsertStickyAssignment({ canonicalIdentity: 'session-a', alias: 'alpha', now: 10, settings: DEFAULT_SETTINGS }),
        upsertStickyAssignment({ canonicalIdentity: 'session-b', alias: 'beta', now: 20, settings: DEFAULT_SETTINGS }),
        upsertStickyAssignment({ canonicalIdentity: 'session-c', alias: 'gamma', now: 30, settings: DEFAULT_SETTINGS })
      ])

      const persisted = readSidecar(ctx.sidecarFile)
      const leftovers = fs.readdirSync(ctx.storeDir).filter((name) => name.startsWith('sticky-sessions.json.tmp-'))

      expect(persisted.version).toBe(1)
      expect(() => JSON.parse(fs.readFileSync(ctx.sidecarFile, 'utf8'))).not.toThrow()
      expect(leftovers).toEqual([])

      if (process.platform !== 'win32') {
        expect(fs.statSync(ctx.sidecarFile).mode & 0o777).toBe(0o600)
      }
    } finally {
      ctx.restore()
    }
  })

  it('falls back to an empty sticky view when the sidecar is malformed and does not touch accounts.json', async () => {
    const ctx = createTestContext()

    try {
      const { loadStickySessions } = await loadStickyModule()

      fs.writeFileSync(ctx.sidecarFile, '{not-valid-json', 'utf8')
      writeJson(ctx.storeFile, {
        version: 2,
        accounts: { alpha: { accessToken: 'token', refreshToken: 'refresh', expiresAt: 123, usageCount: 0 } },
        activeAlias: 'alpha',
        rotationIndex: 0,
        lastRotation: 123
      })
      const accountsBefore = fs.readFileSync(ctx.storeFile, 'utf8')

      const loaded = await loadStickySessions({ now: 500, settings: DEFAULT_SETTINGS })

      expect(loaded).toEqual({ version: 1, updatedAt: 500, entries: {} })
      expect(fs.readFileSync(ctx.storeFile, 'utf8')).toBe(accountsBefore)
    } finally {
      ctx.restore()
    }
  })

  it('salvages valid sticky entries and prunes invalid ones during self-healing loads', async () => {
    const ctx = createTestContext()

    try {
      const { loadStickySessions } = await loadStickyModule()

      writeJson(ctx.sidecarFile, {
        version: 1,
        updatedAt: 100,
        entries: {
          validhash: { alias: 'alpha', createdAt: 10, lastUsedAt: 90 },
          missingAlias: { createdAt: 20, lastUsedAt: 80 },
          negativeTime: { alias: 'beta', createdAt: -1, lastUsedAt: 70 }
        }
      })

      const loaded = await loadStickySessions({ now: 150, settings: DEFAULT_SETTINGS })

      expect(loaded.entries).toEqual({
        validhash: { alias: 'alpha', createdAt: 10, lastUsedAt: 90 }
      })
      expect(readSidecar(ctx.sidecarFile).entries).toEqual({
        validhash: { alias: 'alpha', createdAt: 10, lastUsedAt: 90 }
      })
    } finally {
      ctx.restore()
    }
  })
})
