# BRIEF — F3: Operator dashboard

- **TICK:** TASK-003
- **Branch:** `feat/operator-dashboard` (from `feat/foundation-demo-integrations`)
- **PR into:** `feat/foundation-demo-integrations`
- **Lane:** C

## Goal

A main-operator `/dashboard` (new surface, separate from `/demo` — D4) with four
read-only views: **Runs**, **Approvals**, **Workflows-as-nodes**, and
**Integrations + outcome registry**. The Phase 0 shell is already mounted; build
out the views.

## Independence

You can build now against the **frozen seam** (`IntegrationResult`) — you don't
need F1/F2 merged to develop. You only need them for *real* outcome data at demo
time (soft dependency). Code against the interface; render gracefully when a run
has no `crmResult`/`sendResult` yet.

## Files you own (touch these)

- `engine-api/src/dashboard.ts` — add read-only JSON endpoints + the view assembly.
- `engine-api/src/dashboard-page.ts` — build out the four views (shell is in place).
- `engine-api/src/dashboard.test.ts` (new) — one endpoint shape test.

## Do NOT touch

- ❌ `engine-api/src/demo.ts` / `demo-page.ts` — that's the storytelling console, a separate surface (D4).
- ❌ `packages/contract/*` — `IntegrationResult` seam is frozen; node graph is **derived**, not declared (D5).
- ❌ `packages/notion/*`, `packages/resend/*`, `proposal-step/*`, `send-step/*` — other lanes.
- ❌ Any **write** to the database — the dashboard observes, never mutates.

## Data sources (all read-only, all already exist)

- **Runs:** `engine_runs` (status, workflowId, consumerId, timing). See `GET /v1/runs` for the query shape.
- **Approvals:** `engine_approvals` (state, approver, decidedBy). See `GET /v1/approvals`.
- **Node graph:** derive from `listManifests()` + each manifest's `policy[]` +
  the `parentRunId` chain. The chain is `call-intake → [gate] → proposal-step →
  [gate] → send-step`. Annotate which step uses which integration with a ~5-line
  static map in `dashboard.ts` (`proposal-step → Notion`, `send-step → Resend`) —
  D5, no manifest change.
- **Outcome registry:** scan `engine_runs.output` for `crmResult` / `sendResult`
  (`IntegrationResult`). **No new table** (D1). List CRM rows created (with Notion
  url) and emails sent (with Resend messageId).

## Critical rendering rule (fail-soft, D3)

A run can be `status:'succeeded'` while its outcome is `status:'failed'`. Render
these **distinctly** — green run, red outcome, with the error and a clear "retry"
affordance. A failed send on a succeeded run is the exact case the operator needs
to catch.

## Rules

- Read-only. No writes, ever.
- New `/dashboard*` files only. Don't grow the demo monolith.
- Derive the graph from real data; only the integration labels are static.
- Handle missing/partial output (mid-flight runs) without crashing.

## Tests (D6)

- One integration test: the dashboard data endpoint returns runs + approvals +
  derived graph + outcomes in the expected shape. (Skip pixel/render tests.)

## Acceptance

- Operator can watch a demo run flow through both gates in real time.
- Each workflow shows its steps + policies (the node graph) and which integration each step uses.
- Outcome registry lists CRM rows created (Notion url) and emails sent (Resend id).
- A succeeded-run-with-failed-outcome renders distinctly.
- `pnpm typecheck && pnpm test` green.

When done: write `REPORT.md` here (views shipped, endpoint shapes, how to verify, follow-ups).
