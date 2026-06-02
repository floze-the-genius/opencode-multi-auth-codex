export function extractErrorMessage(payload: any, fallbackText: string = ''): string {
  if (!payload || typeof payload !== 'object') {
    return fallbackText
  }

  const detailMessage = typeof payload?.detail?.message === 'string'
    ? payload.detail.message
    : typeof payload?.detail === 'string'
      ? payload.detail
      : ''

  const errorMessage = typeof payload?.error?.message === 'string'
    ? payload.error.message
    : ''

  const topLevelMessage = typeof payload?.message === 'string'
    ? payload.message
    : ''

  return detailMessage || errorMessage || topLevelMessage || fallbackText
}

function extractErrorCode(payload: any): string {
  if (!payload || typeof payload !== 'object') return ''

  return (
    (typeof payload?.detail?.code === 'string' && payload.detail.code) ||
    (typeof payload?.error?.code === 'string' && payload.error.code) ||
    (typeof payload?.code === 'string' && payload.code) ||
    ''
  )
}

export function isCyberPolicyError(payload: any, fallbackText: string = ''): boolean {
  const code = extractErrorCode(payload).toLowerCase()
  const text = `${extractErrorMessage(payload, fallbackText)} ${fallbackText}`.toLowerCase()

  return code === 'cyber_policy' || text.includes('cyber_policy')
}
