// @ts-ignore - ESM Jest globals are available at runtime in the test environment.
import { jest } from '@jest/globals'

async function importPlugin() {
  return (await import('../../src/index.js')).default
}

function pluginInput() {
  return {
    client: {},
    $: (() => ({ nothrow: () => ({ catch: () => undefined }) })) as any,
    serverUrl: new URL('http://localhost:3000'),
    project: { id: 'test' },
    directory: '/tmp'
  } as any
}

describe('runtime model injection', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    jest.restoreAllMocks()
    process.env = { ...originalEnv }
    delete process.env.OPENCODE_MULTI_AUTH_CODEX_LATEST_MODEL
    delete process.env.OPENCODE_MULTI_AUTH_INJECT_MODELS
  })

  afterEach(() => {
    jest.restoreAllMocks()
    process.env = originalEnv
    jest.resetModules()
  })

  it('injects GPT-5.5 and fast mode by default', async () => {
    const MultiAuthPlugin = await importPlugin()
    const hooks = await MultiAuthPlugin(pluginInput())
    const config = {
      provider: {
        openai: {
          models: {},
          whitelist: []
        }
      }
    } as any

    await hooks.config?.(config)

    expect(config.provider.openai.models['gpt-5.5']).toEqual(
      expect.objectContaining({
        limit: { context: 530000, input: 400000, output: 130000 }
      })
    )
    expect(config.provider.openai.models['gpt-5.5-fast']).toBeDefined()
    expect(config.provider.openai.whitelist).toContain('gpt-5.5')
    expect(config.provider.openai.whitelist).toContain('gpt-5.5-fast')
  })

  it('registers metrics shutdown flush hooks from the plugin entry path', async () => {
    const processOnSpy = jest.spyOn(process, 'on')
    const MultiAuthPlugin = await importPlugin()

    await MultiAuthPlugin(pluginInput())

    const hookCalls = processOnSpy.mock.calls.filter((call: any[]) => ['beforeExit', 'SIGINT', 'SIGTERM', 'exit'].includes(call[0]))
    expect(hookCalls.map((call: any[]) => call[0])).toEqual(['beforeExit', 'SIGINT', 'SIGTERM', 'exit'])
    for (const [event, listener] of hookCalls as Array<[NodeJS.Signals | 'beforeExit' | 'exit', (...args: any[]) => void]>) {
      process.removeListener(event, listener)
    }
  })
})
