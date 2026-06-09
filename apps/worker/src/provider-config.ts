/**
 * Env-backed per-tenant provider wiring (M1, plan T9 / D2 / D9).
 *
 * The integration resolver (`integration-resolver.ts`) is a pure registry seam:
 * it holds provider FACTORIES keyed by name and, on `ctx.integration(name)`,
 * calls the one matching factory with the run's `consumerId`. It deliberately
 * reads NO config itself. THIS module is where the config actually comes from —
 * for M1 that source is the engine env, keyed by consumer + provider (the
 * encrypted per-tenant secret store is M-later; see the plan's NOT-in-scope).
 *
 * Importing this module (which the worker does at boot) registers:
 *   - `shopify`       → per-tenant Shopify Admin client (dev store for mi-pase, D9)
 *   - `mercado-libre` → per-tenant ML MX catalog client (+ OAuth refresh creds)
 *
 * Each factory throws when the requested tenant is unconfigured; the resolver
 * turns that into the canonical "not configured for <consumer>" throw and the
 * workflow fail-softs (D3). A factory only ever reads the ONE provider's env —
 * narrow secret blast radius (Codex #5): asking for `shopify` never reads any
 * `*_ML_*` var, and vice versa.
 *
 * Required env (documented in `.env.example`):
 *   MIPASE_SHOPIFY_BASE_URL      MIPASE_SHOPIFY_ACCESS_TOKEN
 *   MIPASE_ML_ACCESS_TOKEN       MIPASE_ML_REFRESH_TOKEN (opt)
 *   MIPASE_ML_CLIENT_ID (opt)    MIPASE_ML_CLIENT_SECRET (opt)
 *   MIPASE_ML_REDIRECT_URI (opt)
 *
 * Adding a second tenant = add its env prefix to `ENV_PREFIX` below. Nothing
 * else changes — the resolver, contract, and workflows are tenant-agnostic.
 */

import {
  createShopifyClient,
  type ShopifyConfig,
  createMercadoLibreClient,
  type MercadoLibreConfig,
  registerProvider,
} from '@godin-engine/integrations'
// The tenant registry is the SOURCE OF TRUTH for a tenant's env secret-prefix now
// (PR2 T7). The worker imports the SAME registry accessor the engine-api uses
// (apps/engine-api/src/tenants.ts) — each process keeps its own ~60s TTL cache.
import { getTenant, isActive } from '../../engine-api/src/tenants'

// The `IntegrationClients` declaration-merge (D2) lives in the integrations
// package now (it OWNS the type registry); importing from there pulls the merge
// in, so `ctx.integration('shopify')` / ('mercado-libre') stay precisely typed.

/**
 * Per-run secret-prefix cache, populated from the tenant registry by
 * `loadTenantSecrets(consumerId)` BEFORE a run touches any provider. The provider
 * factories below are synchronous (the resolver seam is sync), so the async
 * registry read happens once, up front, in the worker's `handle()`; the factory
 * then reads the resolved prefix from here. A consumer with no resolved prefix
 * (unconfigured / disabled / unknown tenant) leaves no entry → the factory throws
 * → the workflow fail-softs (D3), exactly as the old missing-env path did.
 */
const secretPrefixByConsumer = new Map<string, string>()

/**
 * The env-var prefix charset (mirrors seed-tenants.ts SECRET_PREFIX_RE + the
 * schema column comment). The worker re-asserts it on READ before trusting a
 * registry prefix to index `process.env`: even though the seed path validates
 * this and the DB now enforces UNIQUE, an out-of-band INSERT/UPDATE could still
 * write a malformed/foreign prefix. A bad prefix is REFUSED (no env read) rather
 * than used to reach into another namespace's secrets.
 */
const SECRET_PREFIX_RE = /^[A-Z][A-Z0-9_]*$/

/** Outcome of resolving a run's tenant from the registry (the split-brain guard). */
export interface TenantSecretsResult {
  /** The tenant row exists in the registry. */
  exists: boolean
  /** The tenant is `status==='active'` (only then may it cause side effects). */
  active: boolean
  /** This tenant's env secret-prefix, when set in the registry (else null). */
  prefix: string | null
}

/**
 * loadTenantSecrets(consumerId) — resolve a run's tenant from the registry and
 * cache its `secret_prefix` for the synchronous provider factories. This is also
 * the worker's SPLIT-BRAIN GUARD (T7): a run row may outlive a tenant being
 * disabled/deleted between enqueue and execution, so we re-validate here, right
 * before side effects. Returns the resolution so the caller can refuse to run an
 * unresolvable/non-active tenant. NEVER throws — fail-soft is the caller's call.
 */
export async function loadTenantSecrets(consumerId: string): Promise<TenantSecretsResult> {
  // forceFresh: this read GATES irreversible provider side effects, so it must NOT
  // be served from the positive ~60s TTL cache. A tenant disabled <TTL before this
  // run executes would otherwise still resolve 'active' and the side effect would
  // proceed under a now-disabled tenant. Reading the live PK row here is the real
  // split-brain guard (the previous cached read only re-validated a stale snapshot).
  const row = await getTenant(consumerId, undefined, { forceFresh: true })
  if (!row) {
    secretPrefixByConsumer.delete(consumerId)
    return { exists: false, active: false, prefix: null }
  }
  const active = isActive(row)
  const rawPrefix = row.secretPrefix ?? null
  // Re-assert the charset on the value we are about to use to index process.env. A
  // malformed/foreign prefix (only reachable via an out-of-band write) is treated
  // as "no prefix" — the factory then throws and the workflow fail-softs, rather
  // than the prefix being used to read another env namespace's secrets.
  const prefix = rawPrefix && SECRET_PREFIX_RE.test(rawPrefix) ? rawPrefix : null
  if (active && prefix) secretPrefixByConsumer.set(consumerId, prefix)
  else secretPrefixByConsumer.delete(consumerId)
  return { exists: true, active, prefix }
}

/** Test seam — clear the resolved-prefix cache between cases. */
export function __resetProviderConfig(): void {
  secretPrefixByConsumer.clear()
}

function prefixFor(consumerId: string): string | null {
  return secretPrefixByConsumer.get(consumerId) ?? null
}

function readEnv(name: string): string | undefined {
  const v = process.env[name]
  return v && v.length > 0 ? v : undefined
}

/** Read ONLY this tenant's Shopify env into a config (or throw if unconfigured). */
function shopifyConfigFor(consumerId: string): ShopifyConfig {
  const prefix = prefixFor(consumerId)
  if (!prefix) throw new Error(`no registry secret_prefix resolved for consumer '${consumerId}' (Shopify)`)
  const baseUrl = readEnv(`${prefix}_SHOPIFY_BASE_URL`)
  const accessToken = readEnv(`${prefix}_SHOPIFY_ACCESS_TOKEN`)
  if (!baseUrl || !accessToken) {
    throw new Error(
      `Shopify env missing for '${consumerId}' (need ${prefix}_SHOPIFY_BASE_URL + ${prefix}_SHOPIFY_ACCESS_TOKEN)`,
    )
  }
  return { baseUrl, accessToken }
}

/** Read ONLY this tenant's Mercado Libre env into a config (or throw). */
function mercadoLibreConfigFor(consumerId: string): MercadoLibreConfig {
  const prefix = prefixFor(consumerId)
  if (!prefix) throw new Error(`no registry secret_prefix resolved for consumer '${consumerId}' (Mercado Libre)`)
  const accessToken = readEnv(`${prefix}_ML_ACCESS_TOKEN`)
  if (!accessToken) {
    throw new Error(`Mercado Libre env missing for '${consumerId}' (need ${prefix}_ML_ACCESS_TOKEN)`)
  }
  const refreshToken = readEnv(`${prefix}_ML_REFRESH_TOKEN`)
  const clientId = readEnv(`${prefix}_ML_CLIENT_ID`)
  const clientSecret = readEnv(`${prefix}_ML_CLIENT_SECRET`)
  const redirectUri = readEnv(`${prefix}_ML_REDIRECT_URI`)
  // OAuth (for the 401 → refresh → retry path) is OPTIONAL — only wired when both
  // app creds are present. Absent => the client simply can't refresh (fail-soft).
  const oauth =
    clientId && clientSecret ? { clientId, clientSecret, redirectUri } : undefined
  return { accessToken, refreshToken, oauth }
}

/**
 * Register both M1 provider factories with the resolver. Idempotent (last
 * registration wins), so it is safe to call more than once. Importing this
 * module runs it automatically at worker boot.
 */
export function registerEngineProviders(): void {
  registerProvider('shopify', (consumerId: string) => createShopifyClient(shopifyConfigFor(consumerId)))
  registerProvider('mercado-libre', (consumerId: string) =>
    createMercadoLibreClient(mercadoLibreConfigFor(consumerId)),
  )
}

// Side-effect on import: wire the factories. The worker imports this module for
// exactly this effect (see worker/src/index.ts).
registerEngineProviders()
