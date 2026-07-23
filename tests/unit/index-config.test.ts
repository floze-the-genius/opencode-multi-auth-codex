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

  it('injects GPT-5.6 family models with nested variants by default', async () => {
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

    for (const modelID of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      expect(config.provider.openai.models[modelID]).toEqual(
        expect.objectContaining({
          limit: { context: 1_050_000, input: 922_000, output: 128_000 },
          variants: expect.objectContaining({
            max: expect.objectContaining({ reasoningEffort: 'xhigh' }),
            fast: expect.objectContaining({ serviceTier: 'priority' })
          })
        })
      )
      expect(config.provider.openai.whitelist).toContain(modelID)
      expect(config.provider.openai.models[`${modelID}-max`]).toBeUndefined()
    }
    expect(config.provider.openai.models['gpt-5.3-codex-spark']?.variants.xhigh).toBeDefined()
  })

  it('preserves user model options and variants while backfilling defaults', async () => {
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
          models: {
            'gpt-5.6-sol': {
              name: 'Custom Sol',
              options: { textVerbosity: 'high' },
              variants: { high: { reasoningEffort: 'high', textVerbosity: 'high' } }
            }
          },
          whitelist: []
        }
      }
    } as any

    await hooks.config?.(config)

    expect(config.provider.openai.models['gpt-5.6-sol']).toEqual(
      expect.objectContaining({
        name: 'Custom Sol',
        options: expect.objectContaining({ textVerbosity: 'high' }),
        variants: expect.objectContaining({
          max: expect.objectContaining({ reasoningEffort: 'xhigh' }),
          high: expect.objectContaining({ textVerbosity: 'high' })
        })
      })
    )
  })
})
