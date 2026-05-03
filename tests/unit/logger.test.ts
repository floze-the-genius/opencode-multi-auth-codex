import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

describe('logger debug output', () => {
  const originalEnv = process.env
  const logPath = path.join(os.tmpdir(), `oma-test-logger-${Date.now()}.log`)

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CODEX_SOFT_LOG_PATH: logPath,
      OPENCODE_MULTI_AUTH_DEBUG: '1'
    }
    if (fs.existsSync(logPath)) {
      fs.rmSync(logPath)
    }
  })

  afterEach(() => {
    process.env = originalEnv
    if (fs.existsSync(logPath)) {
      fs.rmSync(logPath)
    }
  })

  it('caps debug payload previews at 20 KB', async () => {
    const { logDebugValue } = await import('../../src/logger.js')
    logDebugValue('request.payload', { body: 'a'.repeat(50 * 1024) })

    const data = fs.readFileSync(logPath, 'utf8')
    expect(data).toContain('[truncated to 20480 bytes')
  })
})
