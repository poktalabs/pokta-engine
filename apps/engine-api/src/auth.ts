import type { Context, MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { PrivyClient } from '@privy-io/server-auth'
import { EngineError } from '@pokta-engine/contract'

/**
 * Dual-mode consumer auth → `c.set('consumer', Consumer)` (M1.5 / D-4 hardened).
 *
 * Two credentials are accepted, both FAIL CLOSED (401 on any problem):
 *
 *   MACHINE  — header `X-Service-Key`. SERVICE_KEYS = "consumer:key,consumer:key".
 *              The consumerId is KEPT (the old gate threw it away). A matching key
 *              authenticates as that exact tenant.
 *
 *   BROWSER  — header `Authorization: Bearer <privyJwt>`. Verified with
 *              @privy-io/server-auth (NEVER hand-rolled JWT crypto). The verified
 *              Privy userId (DID) is the identity. The TENANT is resolved ONLY from
 *              membership (the `engine_tenant_members` table via resolveTenant →
 *              findTenantByMember) — the optional PRIVY_TENANT_MAP env is a legacy
 *              deploy seam, NOT a scope key: it merely seeds `consumer.id`, which
 *              the route layer asserts-agrees-or-rejects against the resolved tenant
 *              (PR2b B1(b)). A principal that maps to no tenant is STILL
 *              authenticated (consumer.id = '' ); the dispatch tenant-check
 *              (resolveTenant) is what rejects it with TENANT_UNKNOWN.
 *
 * There is NO "SERVICE_KEYS unset → allow all" dev bypass anymore: no credential
 * (or a bad one) is always 401 UNAUTHENTICATED.
 */

export type ConsumerMode = 'service' | 'privy'

export interface Consumer {
  /** The tenant id used for ALL row scoping. '' when a Privy principal maps to no tenant. */
  id: string
  /** Stable principal string recorded as decided_by: 'service:<id>' or the Privy DID. */
  identity: string
  mode: ConsumerMode
}

/** Result of verifying a Privy bearer token. Mirrors @privy-io AuthTokenClaims (subset). */
export interface PrivyVerifiedClaims {
  userId: string
  appId: string
}

/** Injectable verification seam — tests pass a local verifier so no network/JWKS is hit. */
export type VerifyPrivyToken = (token: string) => Promise<PrivyVerifiedClaims>

export interface AuthOptions {
  /** Override the Privy verifier (tests). Defaults to the real @privy-io/server-auth call. */
  verifyPrivyToken?: VerifyPrivyToken
}

declare module 'hono' {
  interface ContextVariableMap {
    consumer: Consumer
  }
}

/** Parse SERVICE_KEYS="consumer:key,consumer:key" into Map<key, consumerId>. */
function parseServiceKeys(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!raw?.trim()) return map
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf(':')
    if (idx <= 0) continue
    const consumerId = pair.slice(0, idx).trim()
    const key = pair.slice(idx + 1).trim()
    if (consumerId && key) map.set(key, consumerId)
  }
  return map
}

/** Parse PRIVY_TENANT_MAP="did:privy:xxx=mi-pase,did:privy:yyy=other" into Map<did, tenant>. */
function parsePrivyTenantMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!raw?.trim()) return map
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=')
    if (idx <= 0) continue
    const did = pair.slice(0, idx).trim()
    const tenant = pair.slice(idx + 1).trim()
    if (did && tenant) map.set(did, tenant)
  }
  return map
}

/**
 * Build the default Privy verifier from env. PRIVY_VERIFICATION_KEY (a PEM) makes
 * verification fully OFFLINE; when absent the SDK fetches Privy's JWKS for
 * PRIVY_APP_ID. PRIVY_APP_ID is the JWT audience. Returns null when Privy is not
 * configured (no APP_ID/SECRET) — bearer auth then always 401s.
 */
function buildDefaultPrivyVerifier(): VerifyPrivyToken | null {
  const appId = process.env.PRIVY_APP_ID?.trim()
  const appSecret = process.env.PRIVY_APP_SECRET?.trim()
  if (!appId || !appSecret) return null
  const verificationKey = process.env.PRIVY_VERIFICATION_KEY?.trim() || undefined
  const client = new PrivyClient(appId, appSecret)
  return async (token: string) => {
    const claims = await client.verifyAuthToken(token, verificationKey)
    return { userId: claims.userId, appId: claims.appId }
  }
}

function unauth(c: Context, message: string) {
  const err = new EngineError('UNAUTHENTICATED', message, false)
  return c.json({ error: err.toEnvelope() }, err.httpStatus as ContentfulStatusCode)
}

/**
 * The single auth middleware. Resolves a Consumer from X-Service-Key OR a Privy
 * bearer token and stores it under c.set('consumer'). Anything missing/invalid →
 * 401 UNAUTHENTICATED. Apply via app.use('/v1/*', consumerAuth()).
 */
export function consumerAuth(opts: AuthOptions = {}): MiddlewareHandler {
  const serviceKeys = parseServiceKeys(process.env.SERVICE_KEYS)
  const tenantMap = parsePrivyTenantMap(process.env.PRIVY_TENANT_MAP)
  // Resolve the verifier lazily-once; the override (tests) wins over env config.
  const verifyPrivyToken = opts.verifyPrivyToken ?? buildDefaultPrivyVerifier()

  return async (c, next) => {
    // ── MACHINE: X-Service-Key ────────────────────────────────────────────────
    const serviceKey = c.req.header('X-Service-Key')
    if (serviceKey) {
      const consumerId = serviceKeys.get(serviceKey)
      if (!consumerId) return unauth(c, 'invalid X-Service-Key')
      c.set('consumer', {
        id: consumerId,
        identity: `service:${consumerId}`,
        mode: 'service',
      })
      return next()
    }

    // ── BROWSER: Authorization: Bearer <privyJwt> ─────────────────────────────
    const authz = c.req.header('Authorization')
    if (authz?.startsWith('Bearer ')) {
      const token = authz.slice('Bearer '.length).trim()
      if (!token) return unauth(c, 'empty bearer token')
      if (!verifyPrivyToken) return unauth(c, 'Privy verification not configured')
      let claims: PrivyVerifiedClaims
      try {
        claims = await verifyPrivyToken(token)
      } catch {
        // expired / wrong-audience / bad-signature / unreachable JWKS → fail closed.
        return unauth(c, 'invalid or expired bearer token')
      }
      // PRIVY_TENANT_MAP posture (PR2b B1(b), assert-agreement-or-reject):
      // For a Privy principal the SOLE tenant authority is `members[]`, resolved
      // downstream by resolveTenant → findTenantByMember(identity). This legacy env
      // map is NOT trusted to scope data; it is kept ONLY as a fast deploy seam and
      // is reconciled at the route layer — app.ts fails closed (TENANT_UNKNOWN) when
      // a NON-EMPTY consumer.id disagrees with the membership-resolved tenant
      // (confused-deputy guard; pinned by privy-split-brain.test.ts). Unset map →
      // consumer.id='' → the route scopes purely off the resolved tenant. We
      // therefore carry the mapped id (or '') for the guard, never as a scope key.
      const tenantId = tenantMap.get(claims.userId) ?? ''
      c.set('consumer', {
        id: tenantId,
        identity: claims.userId,
        mode: 'privy',
      })
      return next()
    }

    // ── No credential at all ──────────────────────────────────────────────────
    return unauth(c, 'missing X-Service-Key or Bearer token')
  }
}

/** Backwards-compat alias. Prefer consumerAuth(). */
export const serviceKeyAuth = consumerAuth

/** Exposed for app composition / tests: the consumers known via SERVICE_KEYS. */
export function knownServiceConsumers(raw = process.env.SERVICE_KEYS): Set<string> {
  return new Set(parseServiceKeys(raw).values())
}
