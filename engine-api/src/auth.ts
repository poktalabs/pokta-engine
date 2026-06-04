import type { MiddlewareHandler } from 'hono'
import { EngineError } from '@godin-engine/contract'

/**
 * Consumer auth via X-Service-Key (D-4). SERVICE_KEYS = "consumer:key,consumer:key".
 * If unset, runs in DEV mode (accepts anything) and warns. This is a scaffold-grade
 * gate: it validates the key, not the human behind an approval. TODO: scope keys to
 * allowed consumer_ids and bind approver identities.
 */
export function serviceKeyAuth(): MiddlewareHandler {
  const raw = process.env.SERVICE_KEYS?.trim()
  if (!raw) {
    console.warn('[auth] SERVICE_KEYS unset — running in DEV mode, all requests allowed')
    return async (_c, next) => next()
  }

  const validKeys = new Set(
    raw
      .split(',')
      .map((pair) => pair.split(':')[1]?.trim())
      .filter((k): k is string => Boolean(k)),
  )

  return async (c, next) => {
    const key = c.req.header('X-Service-Key')
    if (!key || !validKeys.has(key)) {
      const err = new EngineError('APPROVAL_DENIED', 'missing or invalid X-Service-Key', false)
      return c.json({ error: err.toEnvelope() }, 401)
    }
    return next()
  }
}
