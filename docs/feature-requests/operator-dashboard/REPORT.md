# REPORT — F3: Operator dashboard

- **TICK:** TASK-003 · **Branch:** `feat/operator-dashboard` → PR into `feat/foundation-demo-integrations`
- **Status:** complete. `pnpm typecheck` and `pnpm test` both green.

## Views shipped (all read-only, at `/dashboard`)

1. **Runs** — `engine_runs` table: workflow, status (color-pilled), consumer, run/parent
   ids, created + finished timestamps. Latest 100, newest first.
2. **Approvals** — `engine_approvals`: onApprove target, state (pending/approved/rejected),
   approver, decidedBy, source + dispatched run ids. Pending gates surface amber; a top
   stat counts them.
3. **Workflows-as-nodes** — the graph is **derived** (not declared): from `listManifests()`
   + each manifest's `policy[]`, laid out in the Vino pipeline order
   `call-intake → [gate] → proposal-step → [gate] → send-step`. An approval policy inserts
   a gate node after its step. Each step shows its runtime and its policies. A **static
   5-line map** (`STEP_INTEGRATIONS` in `dashboard.ts`) annotates `proposal-step → notion`,
   `send-step → resend` — decision D5, no manifest fields added. The endpoint also returns
   the real `parentRunId` chains observed in runs (`graph.chains`).
4. **Integrations + outcome registry** — scans `engine_runs.output` for `crmResult` /
   `sendResult` (`IntegrationResult`), **no new DB table** (D1). Lists CRM rows created
   (Notion `url`) and emails sent (Resend `ref` / messageId).

## Fail-soft rendering (D3)

A run can be `status:'succeeded'` while its outcome is `status:'failed'`. The registry
renders these **distinctly**: the run-status cell stays a green pill, the outcome cell goes
red with the error message and a `↻ retry needed` affordance, and the row is tinted red.
A `failedOutcomes` stat goes red when > 0. Retry itself is intentionally not wired — the
dashboard is read-only; retry is the consumer control plane's job. Mid-flight runs with no
`crmResult`/`sendResult` yet are simply skipped by `buildOutcomes()` — no crash, no row.

## Endpoint shapes

`GET /dashboard` → HTML shell (polls the JSON endpoint every 2.5s, no auth — own surface, D4).

`GET /dashboard/api/overview` → JSON:

```jsonc
{
  "runs": [{ "runId","workflowId","status","consumerId","parentRunId","traceId",
             "createdAt","startedAt","finishedAt" }],
  "approvals": [{ "approvalId","workflowId","state","approver","decidedBy",
                  "sourceRunId","dispatchedRunId","createdAt" }],
  "graph": {
    "elements": [
      { "id","kind":"step","runtime","integration":"notion|resend|null","policies":[{kind,detail}] },
      { "id","kind":"gate","approver","guards" }
    ],
    "chains": [{ "parentRunId","childRunId","childWorkflowId" }]
  },
  "outcomes": {
    "crm":     [{ "provider":"notion","runId","workflowId","runStatus","status","ref","url","error","at" }],
    "emails":  [{ "provider":"resend", ...same shape }],
    "failures":[ /* every outcome with status:'failed' — the D3 catch list */ ]
  },
  "counts": { "runs","runsByStatus":{...},"pendingApprovals","crmCreated","emailsSent","failedOutcomes" }
}
```

## Architecture note

`dashboard.ts` splits a **pure assembler** (`buildOverview(runs, approvals, manifests)`,
plus `deriveGraph` / `buildOutcomes`) from the thin route handler that fetches rows. This
keeps the assembly hermetically testable and keeps the read-only DB queries trivial.

## How to verify locally

1. From repo root: `pnpm install`, then `pnpm dev:api` (needs `DATABASE_URL`; the queue/db
   come up as in the existing demo).
2. Open `http://localhost:8787/dashboard`.
3. In another tab run a pipeline via `/demo` (paste a transcript, approve both gates). The
   dashboard auto-refreshes: runs appear, gates show pending→approved, and once
   `proposal-step` / `send-step` write their `crmResult`/`sendResult` the outcome registry
   fills in (Notion url, Resend id). If an integration fails, that outcome row renders red
   on a green run.

## Test results

`pnpm typecheck` — green (all 9 packages). `pnpm test` — green, 11/11
(`engine-api/src/dashboard.test.ts` adds 7: assembler shape, run-view mapping, derived graph
ordering + integration labels + chains, outcome registry incl. the D3 succeeded-run/
failed-outcome case, mid-flight no-output safety, and the mocked-db `/dashboard/api/overview`
+ `/dashboard` HTML routes). The db layer is mocked (`vi.mock('@godin-engine/db')`) so the
test never touches Postgres.

## Follow-ups / uncertainties

- **Soft dependency on F1/F2:** the outcome registry is coded against the frozen
  `IntegrationResult` seam and renders gracefully with zero outcomes. Real CRM/email rows
  only appear once `proposal-step`/`send-step` actually write `crmResult`/`sendResult` at
  demo time (those lanes).
- **`STEP_INTEGRATIONS` is static** by design (D5). If a future step uses a new integration,
  add one line there — the graph stays derived.
- **No realtime push** — the page polls every 2.5s, matching the demo console's approach.
- Outcome scan keys are exactly `output.crmResult` / `output.sendResult`; if a workflow
  nests them elsewhere the registry won't pick them up (kept aligned with the seam doc).
