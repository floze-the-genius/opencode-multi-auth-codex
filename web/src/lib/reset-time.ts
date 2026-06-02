/**
 * Format a reset timestamp into a human-friendly string.
 *
 * Returns a relative time (e.g. "in 2h 15m") plus the exact local date/time
 * when space permits.  If the timestamp is missing or in the past, returns
 * a safe fallback.
 */
export function formatResetTime(resetAt: number | undefined): string {
  if (typeof resetAt !== 'number' || !Number.isFinite(resetAt)) {
    return 'Reset unavailable'
  }

  const now = Date.now()
  const diff = resetAt - now

  if (diff <= 0) {
    return 'Resets now'
  }

  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  const remainingMins = mins % 60
  const remainingHours = hours % 24

  let relative = ''
  if (days > 0) {
    relative = `${days}d ${remainingHours}h`
  } else if (hours > 0) {
    relative = `${hours}h ${remainingMins}m`
  } else {
    relative = `${mins}m`
  }

  const exact = new Date(resetAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  return `in ${relative} · ${exact}`
}

/**
 * Compact reset-time label for dense UIs (tables, small cards).
 */
export function formatResetTimeCompact(resetAt: number | undefined): string {
  if (typeof resetAt !== 'number' || !Number.isFinite(resetAt)) {
    return '—'
  }

  const now = Date.now()
  const diff = resetAt - now

  if (diff <= 0) {
    return 'now'
  }

  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  const remainingMins = mins % 60
  const remainingHours = hours % 24

  if (days > 0) {
    return `${days}d ${remainingHours}h`
  }
  if (hours > 0) {
    return `${hours}h ${remainingMins}m`
  }
  return `${mins}m`
}
