/**
 * In-process NEGATIVE cache for the tenant-claim path (Wave 1 / D6). A DID that just
 * FAILED to match any invite (no verified email, no invite, collision, inactive,
 * revoked) is remembered for a short TTL so a repeat login short-circuits to the
 * identical TENANT_UNKNOWN WITHOUT calling Privy `getUser` again. This bounds the
 * getUser flood vector together with the per-DID claim throttle.
 *
 * Process-local + TTL-bounded by design: it is a best-effort optimization, never an
 * authz decision (a positive claim never consults it). A multi-instance deploy just
 * means each instance learns the miss independently — acceptable for a flood guard.
 */

const DEFAULT_TTL_MS = 10 * 60_000 // ~10 minutes

const cache = new Map<string, number>() // did → expiresAt (epoch ms)

/** Injectable clock so TTL tests are deterministic (defaults to Date.now). */
let now: () => number = () => Date.now()

/** Reset the cache (and optionally the clock). FOR TESTS ONLY. */
export function __resetClaimNegCache(clock?: () => number): void {
  cache.clear()
  now = clock ?? (() => Date.now())
}

/** True iff this DID has a live negative-cache entry (a recent no-match). */
export function isClaimNegCached(did: string): boolean {
  const expiresAt = cache.get(did)
  if (expiresAt === undefined) return false
  if (expiresAt <= now()) {
    cache.delete(did)
    return false
  }
  return true
}

/** Remember a DID's no-match for ~`ttlMs` so the next login skips Privy. */
export function rememberClaimMiss(did: string, ttlMs: number = DEFAULT_TTL_MS): void {
  if (!did) return
  cache.set(did, now() + ttlMs)
}
