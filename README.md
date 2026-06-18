# godin-engine v0.1

Agent orchestration engine — a control plane that launches jobs in parallel and
manages their lifecycle. The engine owns **State, Governance, Observability**; the
work runs extracted-out in a per-workflow runtime. Part of **godin-stack**; the
shared engine for zeta-godin, godinez-ai, nubia.

Architecture (the decision record) lives one level up:
`../../docs/architecture/godin-engine-v1.md`. Read it before changing anything —
references below in the form `D-N` and `§N` point at it.

## Layout

```
apps/engine-api/     # Hono control plane: runs + approvals routes, policy enforced pre-dispatch
apps/worker/         # pg-boss consumer: runs jobs in parallel, writes lifecycle, opens approval gates
apps/web/            # Vite/React tenant workspace SPA (source lands with the M2 merge)
packages/contract/   # Zod RunResult, error envelope, policy + manifest types (shared truth)
packages/db/         # Drizzle schema (engine_runs, engine_quota_ledger, engine_approvals) + client
packages/queue/      # pg-boss wrapper (single 'workflow.run' queue)
packages/workflows/  # the workflow registry (D-9): discovered, never imported by name
packages/{llm,notion,resend,shopify,mercadolibre}/   # fail-soft integration adapters
```

Monorepo: `apps/*` = deployable services, `packages/*` = shared libraries.
pnpm + Railway filter by package name (`@pokta-engine/*`), so directory layout is
free to change. Build/typecheck run through **turbo**; tests through root vitest.
Each app carries its own `.env.example` / `.env.local`.

## Hard rules (enforced by the structure)

- The control plane never runs job code; the worker never enforces governance.
- `run(input, ctx)` is pure + synchronous — no policy, no DB, no human (D-8).
- The worker is the only writer of post-enqueue run status.
- Engine code never imports a workflow by name — only the aggregate `@pokta-engine/workflows` registry.
- Approval = two chained runs joined by a first-class `engine_approvals` gate (D-8).

## Setup

```bash
pnpm install
cp .env.example .env          # point DATABASE_URL at your Postgres
pnpm db:push                  # create the three tables (or: pnpm db:generate && pnpm db:migrate)
pnpm typecheck
```

Run the two processes (separate terminals):

```bash
pnpm dev:api      # http://localhost:8787
pnpm dev:worker
```

## Smoke test (proves both policy types — spike §6 steps 8-10)

```bash
# quota: first call enqueues, second same-day call 429s
curl -s localhost:8787/v1/workflows/echo/runs \
  -H 'content-type: application/json' \
  -d '{"consumer_id":"godinez-studio","input":{"message":"hi"}}'

# approval: draft run succeeds and opens a pending gate
curl -s localhost:8787/v1/workflows/echo-draft/runs \
  -H 'content-type: application/json' \
  -d '{"consumer_id":"poktacare","input":{"topic":"care plan"}}'

curl -s 'localhost:8787/v1/approvals?state=pending'      # find the approvalId
curl -s localhost:8787/v1/approvals/<approvalId>/approve \
  -H 'content-type: application/json' -d '{"decided_by":"dr.alice"}'
# → dispatches echo-send with the drafted artifact

curl -s 'localhost:8787/v1/workflows/echo-send/runs' -d '{}'   # → 403 APPROVAL_REQUIRED
```

## Known scaffold gaps (intentional, see ADR)

- **Transactional enqueue (D-5).** Quota check + run insert are one Postgres txn;
  the `boss.send` happens just after commit (pg-boss v10 sends on its own
  connection). The crash window between commit and send is covered by the reaper
  (spike step 14, not yet built). Hardening: transactional outbox / pg-boss
  same-connection insert.
- **Auth (D-4).** `X-Service-Key` is validated against an allowlist; keys aren't yet
  scoped to consumer_ids and the human behind an approval isn't authenticated
  (engine records `decided_by`, consumer asserts it).
- **Real runtimes (D-3).** All three sample workflows run in-process. The
  `runtime` field is declared but not yet dispatched to `sandbox` (e2b/Docker) or
  `agent` (Hermes/pi) — that's spike steps 11-12.
- **Reaper (step 14)** and **SSE run stream** (`GET /v1/runs/:id/stream`) not built.
```
