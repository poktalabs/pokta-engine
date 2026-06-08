import { z } from 'zod'
import type { ErrorEnvelope } from './errors'

export const runStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed'])
export type RunStatus = z.infer<typeof runStatusSchema>

/**
 * Lazy, per-tenant integration accessor (D2). Given a provider NAME, returns
 * ONLY that provider's configured client — never a fat object exposing every
 * secret. Resolution is scoped to the run's `consumer_id` (env-backed for M1),
 * so a workflow only ever touches the one provider it asks for. THROWS when the
 * requested provider is unconfigured for this tenant; the caller fail-softs
 * (try/catch → IntegrationResult, D3). Narrow secret blast radius (Codex #5).
 *
 * The provider→client typing lives in `IntegrationClients`, which each provider
 * package augments via declaration merging (the registry seam in the worker).
 * Until a provider is registered its name resolves to `unknown`, so callers in
 * later phases get precise types as `packages/shopify` / `packages/mercadolibre`
 * land — without the contract importing those packages.
 */
export interface IntegrationClients {
  // Augmented by provider packages, e.g.:
  //   declare module '@godin-engine/contract' {
  //     interface IntegrationClients { shopify: ShopifyClient }
  //   }
}

export type IntegrationName = keyof IntegrationClients extends never
  ? string
  : keyof IntegrationClients

export type IntegrationFor<N extends IntegrationName> = N extends keyof IntegrationClients
  ? IntegrationClients[N]
  : unknown

export type IntegrationAccessor = <N extends IntegrationName>(name: N) => IntegrationFor<N>

/**
 * Injected into every `run(input, ctx)` — the TS analog of pyme's Args/context
 * injection. The job gets identity + logging + a scratch dir + the lazy
 * per-tenant `integration()` accessor, never the DB or the policy state.
 */
export interface RunContext {
  runId: string
  traceId: string
  logger: {
    info: (msg: string, meta?: unknown) => void
    error: (msg: string, meta?: unknown) => void
  }
  /** Per-run scratch directory for artifacts (e.g. the Astro build output). */
  artifactDir: string
  /**
   * Lazy per-tenant integration accessor (D2). Returns ONLY the requested
   * provider's configured client, scoped to this run's consumer. THROWS when
   * that provider is unconfigured — the caller fail-softs (D3).
   */
  integration: IntegrationAccessor
}

export interface RunResult<O = unknown> {
  runId: string
  status: RunStatus
  output?: O
  error?: ErrorEnvelope
}
