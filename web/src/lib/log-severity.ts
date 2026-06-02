/**
 * Infer log severity from message text when the structured level is unknown.
 * This is a conservative heuristic — it looks for clear error/warning indicators
 * and defaults to info when uncertain.
 */
export function inferLogSeverity(message: string): 'error' | 'warn' | 'info' | 'debug' {
  const lower = message.toLowerCase()

  // Error indicators
  if (
    lower.includes('error') ||
    lower.includes('exception') ||
    lower.includes('failed') ||
    lower.includes('failure') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('timeout') ||
    lower.includes('crash') ||
    lower.includes('fatal') ||
    lower.includes('invalid token') ||
    lower.includes('auth invalid') ||
    lower.includes('rate limit exceeded') ||
    lower.includes('quota exceeded')
  ) {
    return 'error'
  }

  // Warning indicators
  if (
    lower.includes('warn') ||
    lower.includes('stale') ||
    lower.includes('deprecated') ||
    lower.includes('retry') ||
    lower.includes('fallback') ||
    lower.includes('slow') ||
    lower.includes('high usage') ||
    lower.includes('approaching limit')
  ) {
    return 'warn'
  }

  // Debug indicators
  if (
    lower.includes('debug') ||
    lower.includes('trace') ||
    lower.includes('verbose') ||
    lower.includes('probe') ||
    lower.includes('probing') ||
    lower.includes('ping')
  ) {
    return 'debug'
  }

  return 'info'
}
