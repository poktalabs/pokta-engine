import type { ErrorEnvelope } from './errors'
import type { RunStatus } from './run'

/**
 * Response-view types for the read routes `GET /v1/runs` and `GET /v1/runs/:id`.
 *
 * Both return the raw `engine_runs` Drizzle row serialized to JSON
 * (engine-api/src/index.ts: list → `c.json({ runs: rows })`, detail → `c.json(row)`).
 * Timestamps are ISO 8601 strings after JSON serialization; nullable columns are
 * `| null`. `RunDetail` is structurally the same row as a list item today — kept
 * as a distinct alias so the detail route can diverge (e.g. include logs) later
 * without churning every list consumer.
 *
 * `input` / `output` are opaque per-workflow JSON (`unknown`) — the contract does
 * NOT bake a workflow-specific shape; renderers discriminate on `workflowId`.
 */
export interface RunListItem {
  runId: string
  workflowId: string
  status: RunStatus
  consumerId: string
  /** Per-workflow request body (opaque). */
  input: unknown
  /** Per-workflow result (opaque); null until the run produces output. */
  output?: unknown | null
  /** Present iff the run failed. */
  error?: ErrorEnvelope | null
  traceId: string
  idempotencyKey?: string | null
  /** Set on chained child runs — links back to the draft run. */
  parentRunId?: string | null
  /** ISO 8601. */
  createdAt: string
  /** ISO 8601; null until the worker picks the run up. */
  startedAt?: string | null
  /** ISO 8601; null until the run terminates. */
  finishedAt?: string | null
}

/** `GET /v1/runs/:id` — the raw run row. */
export type RunDetail = RunListItem

/** Response envelope for `GET /v1/runs`. */
export interface RunListResponse {
  runs: RunListItem[]
}
