/**
 * Inject the run record's `consumerId` into the workflow input (pricing fix).
 *
 * `consumerId` is RUN METADATA (the run record's tenant column), not a client-
 * supplied input field. Workflows like `pricing-draft` / `pricing-apply` read
 * `input.consumerId` to scope per-SKU state and thread it into their fan-out
 * children. The control plane dispatch stores ONLY the request body as `input`
 * (no consumerId) and the tenant on the `consumer_id` column — so without this the
 * workflow sees `input.consumerId === undefined` and fails closed ("consumerId is
 * required (resolved from the run record)").
 *
 * Resolving it in the worker fixes every run uniformly: the API-dispatched parent
 * AND each fan-out child (whose `consumer_id` is forced to the parent's tenant by
 * `dispatchChildRun`). The run's tenant ALWAYS wins over any value already present
 * in `input` — a defense against a client-supplied `consumer_id` in the dispatch
 * body smuggling another tenant's id into the workflow.
 *
 * A non-object input (none today; all manifests use object Zod schemas) is passed
 * through untouched.
 */
export function withConsumerId(input: unknown, consumerId: string): unknown {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return { ...(input as Record<string, unknown>), consumerId }
  }
  return input
}
