import {
  GPT_5_6_MODELS,
  REASONING_LEVELS,
  generateModelVariants,
  getDefaultModels
} from '../../src/models.js'

describe('model defaults', () => {
  it('exposes GPT-5.6 family reasoning, max, and fast as OpenCode variants', () => {
    const models = getDefaultModels()

    expect(REASONING_LEVELS).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
    for (const modelID of GPT_5_6_MODELS) {
      const model = models[modelID]
      expect(model).toEqual(
        expect.objectContaining({
          name: `${modelID} (OAuth)`,
          reasoning: true,
          limit: { context: 1_050_000, input: 922_000, output: 128_000 },
          options: expect.objectContaining({ reasoningEffort: 'medium' })
        })
      )
      expect(Object.keys(model.variants)).toEqual(
        expect.arrayContaining([...REASONING_LEVELS, 'fast'])
      )
      expect(model.variants.max.reasoningEffort).toBe('xhigh')
      expect(model.variants.fast.serviceTier).toBe('priority')
      expect(models[`${modelID}-max`]).toBeUndefined()
      expect(models[`${modelID}-fast`]).toBeUndefined()
    }
  })

  it('builds nested variants for discovered GPT-5.6 family models', () => {
    const models = generateModelVariants([
      {
        id: 'gpt-5.6-terra',
        object: 'model',
        created: 0,
        owned_by: 'openai'
      }
    ])

    expect(Object.keys(models)).toEqual(['gpt-5.6-terra'])
    expect(models['gpt-5.6-terra']?.limit.context).toBe(1_050_000)
    expect(models['gpt-5.6-terra']?.limit.input).toBe(922_000)
    expect(models['gpt-5.6-terra']?.variants.max.reasoningEffort).toBe('xhigh')
    expect(models['gpt-5.6-terra']?.variants.fast.serviceTier).toBe('priority')
  })
})
