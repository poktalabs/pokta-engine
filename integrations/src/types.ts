/**
 * The integration-registry types — the integration analog of the workflow
 * registry's `WorkflowManifest` / `WorkflowModule` (packages/workflows).
 *
 * Each integration sub-module under `src/<provider>/` exposes an
 * {@link IntegrationModule}: a static {@link IntegrationDescriptor} (the
 * provider's identity + which env secrets it needs) plus a `create(config)`
 * factory that builds its client. `src/index.ts` collects every module into a
 * `Map<id, module>` and exposes `getIntegration` / `listIntegrations`, exactly
 * mirroring `getWorkflow` / `listManifests`.
 */

/** Static identity of one integration. `id` is the provider key `ctx.integration(id)` uses. */
export interface IntegrationDescriptor {
  /** Provider key (e.g. 'shopify', 'mercado-libre'). Used by the resolver + ctx.integration. */
  id: string
  /** Human label for surfacing the integration in UIs / catalogs. */
  displayName: string
  /** Coarse grouping (e.g. 'crm', 'email', 'commerce', 'marketplace'). */
  category: string
  /** Env var names this integration reads its secrets from (documentation/discovery). */
  secretKeys: string[]
}

/**
 * One integration as a registry entry: its descriptor + the factory that builds
 * its client. `C` is the client type; `Config` the per-call config shape. The
 * registry stores these untyped (`IntegrationModule`) — typed access is via the
 * re-exported `create*` factories in `index.ts`.
 */
export interface IntegrationModule<C = unknown, Config = unknown> {
  descriptor: IntegrationDescriptor
  create: (config: Config) => C
}
