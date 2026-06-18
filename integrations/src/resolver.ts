/**
 * The per-tenant integration resolver (T2 / D2).
 *
 * Builds the `ctx.integration(name)` accessor the worker injects into every
 * `run(input, ctx)`. Given the run's `consumerId` + a provider NAME it returns
 * ONLY that provider's configured client — resolved lazily, the moment a
 * workflow asks for it. It never builds, reads the config of, or exposes any
 * provider other than the one requested: secret blast radius stays to a single
 * provider per call (Codex #5).
 *
 * M1 config source = engine env, keyed by consumer + provider, e.g.
 *   MIPASE_SHOPIFY_TOKEN / MIPASE_SHOPIFY_BASE_URL
 *   MIPASE_ML_CLIENT_ID  / MIPASE_ML_CLIENT_SECRET / ...
 * (the encrypted per-tenant secret store is M-later — see the plan's NOT-in-scope).
 *
 * The concrete clients live in this package's `src/<provider>/` modules; the
 * worker's `provider-config.ts` plugs per-tenant factories into the
 * `providerRegistry` seam below: each provider registers a `factory` that, given
 * a `consumerId`, returns its configured client or throws when that tenant is
 * unconfigured.
 */

import type { IntegrationAccessor, IntegrationFor, IntegrationName } from '@pokta-engine/contract'

/**
 * A provider's factory: given a tenant, return that tenant's configured client.
 * MUST throw (or return null) when the tenant has no config for this provider —
 * the resolver turns either into the canonical "unconfigured" throw the caller
 * fail-softs on (D3). The factory only ever sees the ONE provider's secrets.
 */
export type ProviderFactory<C = unknown> = (consumerId: string) => C | null

/**
 * The registry seam (D2). Provider wiring registers factories by name; the
 * resolver reads ONLY the entry matching the requested name. Kept as a plain
 * map (not a fat config object) so no single value exposes more than one
 * provider's client/secrets.
 */
const providerRegistry = new Map<string, ProviderFactory>()

/**
 * Register (or override) a provider's factory under its NAME. Called once at
 * worker boot by the per-tenant provider wiring. Idempotent per name (last
 * registration wins) so tests can re-register stubs cleanly.
 */
export function registerProvider<C>(name: IntegrationName, factory: ProviderFactory<C>): void {
  providerRegistry.set(name as string, factory as ProviderFactory)
}

/** Test/seam helper — drop a registration (or all of them). */
export function unregisterProvider(name?: IntegrationName): void {
  if (name === undefined) providerRegistry.clear()
  else providerRegistry.delete(name as string)
}

/** True iff a factory is registered under this name (does NOT build a client). */
export function hasProvider(name: IntegrationName): boolean {
  return providerRegistry.has(name as string)
}

/**
 * Build the lazy `ctx.integration` accessor for ONE run, closed over its
 * `consumerId`. Each call resolves exactly the requested provider:
 *   - unregistered provider  → throws (no provider wiring plugged it in)
 *   - registered but the tenant is unconfigured (factory throws or returns null)
 *     → throws the canonical "<provider> not configured for <consumer>"
 *   - configured             → returns that provider's client, nothing else
 *
 * Because lookup is keyed strictly by the requested name, asking for 'shopify'
 * never touches the 'mercado-libre' factory (or its env) — and vice versa.
 */
export function makeIntegrationResolver(consumerId: string): IntegrationAccessor {
  const resolve = <N extends IntegrationName>(name: N) => {
    const factory = providerRegistry.get(name as string)
    if (!factory) {
      throw new Error(
        `Integration '${String(name)}' is not registered (no provider package plugged it in)`,
      )
    }

    let client: unknown
    try {
      client = factory(consumerId)
    } catch (e) {
      // A factory throwing IS the "unconfigured for this tenant" signal — wrap it
      // so the caller sees a uniform message and fail-softs (D3).
      const detail = e instanceof Error ? e.message : String(e)
      throw new Error(`Integration '${String(name)}' not configured for consumer '${consumerId}': ${detail}`)
    }

    if (client === null || client === undefined) {
      throw new Error(`Integration '${String(name)}' not configured for consumer '${consumerId}'`)
    }

    return client as IntegrationFor<N>
  }

  // The generic surface above is implemented untyped internally; the cast to
  // IntegrationAccessor restores the provider→client typing for callers.
  return resolve as unknown as IntegrationAccessor
}
