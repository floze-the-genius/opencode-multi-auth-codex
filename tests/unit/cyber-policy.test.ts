import { isCyberPolicyError } from '../../src/index.js'

describe('cyber policy errors', () => {
  it('detects OpenAI cyber_policy error codes', () => {
    expect(
      isCyberPolicyError({
        error: {
          type: 'invalid_request',
          code: 'cyber_policy',
          message: 'This content was flagged for possible cybersecurity risk.'
        }
      })
    ).toBe(true)
  })

  it('detects cyber_policy in raw fallback text', () => {
    expect(isCyberPolicyError({}, '{"error":{"code":"cyber_policy"}}')).toBe(true)
  })

  it('does not classify regular invalid requests as cyber policy', () => {
    expect(
      isCyberPolicyError({
        error: {
          type: 'invalid_request',
          code: 'invalid_request',
          message: 'Missing required field.'
        }
      })
    ).toBe(false)
  })
})
