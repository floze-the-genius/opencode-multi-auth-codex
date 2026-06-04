import {
  generateModelVariants,
  getDefaultModels
} from '../../src/models.js'

describe('model defaults', () => {
  it('exposes GPT-5.5 reasoning and fast variants', () => {
    const models = getDefaultModels()

    expect(models['gpt-5.5']).toEqual(
      expect.objectContaining({
        name: 'gpt-5.5 (OAuth)',
        limit: { context: 1050000, input: 922000, output: 128000 },
        options: expect.objectContaining({
          reasoningEffort: 'medium'
        })
      })
    )
    expect(models['gpt-5.5-none']).toBeDefined()
    expect(models['gpt-5.5-low']).toBeDefined()
    expect(models['gpt-5.5-medium']).toBeDefined()
    expect(models['gpt-5.5-high']).toBeDefined()
    expect(models['gpt-5.5-xhigh']).toBeDefined()
    expect(models['gpt-5.5-fast']).toEqual(
      expect.objectContaining({
        limit: { context: 1050000, input: 922000, output: 128000 },
        options: expect.objectContaining({
          service_tier: 'priority'
        })
      })
    )
  })

  it('builds fast variants for discovered GPT-5.5 models', () => {
    const models = generateModelVariants([
      {
        id: 'gpt-5.5',
        object: 'model',
        created: 0,
        owned_by: 'openai'
      }
    ])

    expect(models['gpt-5.5']?.limit.context).toBe(1050000)
    expect(models['gpt-5.5']?.limit.input).toBe(922000)
    expect(models['gpt-5.5-fast']?.options.service_tier).toBe('priority')
    expect(models['gpt-5.5-medium']?.limit.context).toBe(1050000)
  })
})
