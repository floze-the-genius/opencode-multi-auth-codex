import MultiAuthPlugin from '../../src/index.js'

describe('runtime model injection', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.OPENCODE_MULTI_AUTH_CODEX_LATEST_MODEL
    delete process.env.OPENCODE_MULTI_AUTH_INJECT_MODELS
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('injects GPT-5.5 and fast mode by default', async () => {
    const hooks = await MultiAuthPlugin({
      client: {},
      $: (() => ({ nothrow: () => ({ catch: () => undefined }) })) as any,
      serverUrl: new URL('http://localhost:3000'),
      project: { id: 'test' },
      directory: '/tmp'
    } as any)
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
        limit: { context: 1050000, input: 922000, output: 128000 }
      })
    )
    expect(config.provider.openai.models['gpt-5.5-fast']).toBeDefined()
    expect(config.provider.openai.whitelist).toContain('gpt-5.5')
    expect(config.provider.openai.whitelist).toContain('gpt-5.5-fast')
  })
})
