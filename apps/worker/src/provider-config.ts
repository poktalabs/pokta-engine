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

// The `IntegrationClients` declaration-merge (D2) lives in the integrations
// package now (it OWNS the type registry); importing from there pulls the merge
// in, so `ctx.integration('shopify')` / ('mercado-libre') stay precisely typed.

/** consumerId → its engine-env variable prefix. Add a row to onboard a tenant. */
const ENV_PREFIX: Record<string, string> = {
  'mi-pase': 'MIPASE',
}

function prefixFor(consumerId: string): string | null {
  return ENV_PREFIX[consumerId] ?? null
}

function readEnv(name: string): string | undefined {
  const v = process.env[name]
  return v && v.length > 0 ? v : undefined
}

/** Read ONLY this tenant's Shopify env into a config (or throw if unconfigured). */
function shopifyConfigFor(consumerId: string): ShopifyConfig {
  const prefix = prefixFor(consumerId)
  if (!prefix) throw new Error(`no Shopify env prefix mapped for consumer '${consumerId}'`)
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
  if (!prefix) throw new Error(`no Mercado Libre env prefix mapped for consumer '${consumerId}'`)
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
