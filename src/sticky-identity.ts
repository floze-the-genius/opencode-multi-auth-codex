import { hashStickyIdentity } from './sticky-sessions.js'
import type { ResolvedStickyIdentity, StickyIdentitySource } from './types.js'

export type ResolveStickyIdentityOptions = {
  headers: Headers
  body?: {
    metadata?: {
      session_id?: unknown
      conversation_id?: unknown
    }
    session_id?: unknown
    conversation_id?: unknown
    prompt_cache_key?: unknown
  }
  allowPromptCacheKey: boolean
  identitySources: StickyIdentitySource[]
}

function normalizeStickyIdentityValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function resolveStickyIdentitySource(
  source: StickyIdentitySource,
  value: unknown,
  allowPromptCacheKey: boolean
): ResolvedStickyIdentity | null {
  if (source === 'body:prompt_cache_key' && !allowPromptCacheKey) return null

  const canonical = normalizeStickyIdentityValue(value)
  if (!canonical) return null

  return {
    source,
    canonical,
    hash: hashStickyIdentity(canonical)
  }
}

export function resolveStickyIdentity(options: ResolveStickyIdentityOptions): ResolvedStickyIdentity | null {
  const body = options.body
  const bodyMetadata = body?.metadata

  for (const source of options.identitySources) {
    const value = (() => {
      switch (source) {
        case 'header:x-session-affinity':
          return options.headers.get('x-session-affinity')
        case 'header:session-id':
          return options.headers.get('session-id')
        case 'header:session_id':
          return options.headers.get('session_id')
        case 'header:conversation_id':
          return options.headers.get('conversation_id')
        case 'body:metadata.session_id':
          return bodyMetadata?.session_id
        case 'body:metadata.conversation_id':
          return bodyMetadata?.conversation_id
        case 'body:prompt_cache_key':
          return body?.prompt_cache_key
      }
    })()
    const resolved = resolveStickyIdentitySource(source, value, options.allowPromptCacheKey)
    if (resolved) return resolved
  }

  return null
}
