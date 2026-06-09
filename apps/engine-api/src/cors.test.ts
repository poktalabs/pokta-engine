import { describe, expect, it, vi } from 'vitest'

// Hermetic: the @godin-engine/db client throws on import without DATABASE_URL, and
// pg-boss must not connect. The CORS middleware runs BEFORE any db/queue access
// (preflight short-circuits; a real GET 401s in auth before touching the db), so a
// minimal stub is enough to import ./app.
vi.mock('@godin-engine/queue', () => ({ getBoss: async () => ({ send: async () => undefined }), QUEUE: 'workflow.run' }))
vi.mock('@godin-engine/db', () => ({ db: {}, schema: {} }))

import { buildApp, parseCorsOrigins } from './app'

/**
 * Browser CORS on the /v1 data plane. The SPA calls the engine cross-origin in
 * prod; without these headers the browser blocks the Privy login before it reaches
 * /v1/tenants/me. CORS is mounted BEFORE consumerAuth, so the unauthenticated
 * OPTIONS preflight must be answered (not 401'd), and only allow-listed origins get
 * an Access-Control-Allow-Origin. Fail-closed: an empty allowlist allows no origin.
 */

const WEB = 'https://godin-engineweb-production.up.railway.app'
const EVIL = 'https://attacker.example'

function appWith(origins: string[]) {
  // No auth verifier configured → /v1 GETs 401, but preflight + CORS headers are
  // set by the cors middleware that runs first, which is what we assert here.
  return buildApp({ corsOrigins: origins })
}

describe('CORS — /v1 preflight + headers', () => {
  it('answers the OPTIONS preflight for an allowed origin (not 401) with ACAO', async () => {
    const app = appWith([WEB])
    const res = await app.request('/v1/tenants/me', {
      method: 'OPTIONS',
      headers: {
        Origin: WEB,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    })
    expect(res.status).not.toBe(401)
    expect(res.status).toBeLessThan(300)
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB)
    expect((res.headers.get('access-control-allow-headers') ?? '').toLowerCase()).toContain('authorization')
  })

  it('echoes ACAO on an actual GET from an allowed origin', async () => {
    const app = appWith([WEB])
    const res = await app.request('/v1/tenants/me', { method: 'GET', headers: { Origin: WEB } })
    // 401 (no auth) is fine — the CORS header must still be present so the browser
    // exposes the response to the SPA instead of swallowing it.
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB)
  })

  it('does NOT emit ACAO for a disallowed origin', async () => {
    const app = appWith([WEB])
    const res = await app.request('/v1/tenants/me', { method: 'GET', headers: { Origin: EVIL } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('fail-closed: an empty allowlist emits ACAO for no origin', async () => {
    const app = appWith([])
    const res = await app.request('/v1/tenants/me', { method: 'GET', headers: { Origin: WEB } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('parseCorsOrigins splits, trims, and drops blanks', () => {
    expect(parseCorsOrigins(` ${WEB} , ,https://b.example `)).toEqual([WEB, 'https://b.example'])
    expect(parseCorsOrigins('')).toEqual([])
    expect(parseCorsOrigins(undefined)).toEqual([])
  })
})
