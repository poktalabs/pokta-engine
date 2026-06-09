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
 * The concrete clients come from `packages/shopify` + `packages/mercadolibre`,
 * which land in a LATER phase (T3/T4). Until then they plug into the
 * `providerRegistry` seam below: each provider package registers a `factory`
 * that, given a `consumerId`, returns its configured client or throws when that
 * tenant is unconfigured. This file therefore compiles with zero provider
 * packages present, and gains them without edits as they register themselves.
 */

import type { IntegrationAccessor, IntegrationFor, IntegrationName } from '@godin-engine/contract'

/**
 * A provider's factory: given a tenant, return that tenant's configured client.
 * MUST throw (or return null) when the tenant has no config for this provider —
 * the resolver turns either into the canonical "unconfigured" throw the caller
 * fail-softs on (D3). The factory only ever sees the ONE provider's secrets.
 */
export type ProviderFactory<C = unknown> = (consumerId: string) => C | null

/**
 * The registry seam (D2). Provider packages register themselves by name; the
 * resolver reads ONLY the entry matching the requested name. Kept as a plain
 * map (not a fat config object) so no single value exposes more than one
 * provider's client/secrets.
 */
const providerRegistry = new Map<string, ProviderFactory>()

/**
 * Register (or override) a provider's factory under its NAME. Called once at
 * worker boot by each provider package's plug-in. Idempotent per name (last
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
 *   - unregistered provider  → throws (no package plugged it in)
 *   - registered but the tenant is unconfigured (factory throws or returns null)
 *     → throws the canonical "<provider> not configured for <consumer>"
 *   - configured             → returns that provider's client, nothing else
 *
 * Because lookup is keyed strictly by the requested name, asking for 'shopify'
 * never touches the 'mercadolibre' factory (or its env) — and vice versa.
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
