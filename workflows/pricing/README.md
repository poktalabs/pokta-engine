# Mi Pase daily-pricing chain (M1)

The validated Mi Pase daily-pricing pipeline, rewired into godin-engine. One
operator trigger fans out into a draft + two independent apply children. Runs
**via `/v1` only** (no UI in M1) and writes to the Shopify **dev store** (D9).

## The chain

```
POST /v1/workflows/pricing-draft/runs   (operator; consumer_id=mi-pase; input={scope?,limit?})
      │
      ▼
pricing-draft                            runtime: agent · timeoutMs ~20min
  ├─ ctx.integration('shopify').getCatalog()           ┐ paced external IO
  ├─ ctx.integration('mercadolibre').search(per SKU)   ┘
  ├─ match → 8-branch price → classify  (pure brain in lib/, 54-test parity)
  ├─ upsert desired rows → engine_workflow_state(status=pending)
  └─ output = { summary, confident[], flagged[] }   (full detail in state, not output)
      │
   on SUCCESS the worker fans out TWO independent children (plan D1 + gate semantics):
      ├─ onComplete ─────────────────────► pricing-apply-confident   (AUTO, NO gate)
      │                                       applies confident[] straight through
      └─ approval policy (role:owner) ────► engine_approvals(pending, artifact=flagged[])
                                              │
                                     [Dalia: POST /v1/approvals/:id/approve]
                                              ▼
                                       pricing-apply-flagged          (human-gated)
                                              applies the reviewed flagged[] subset
```

`pricing-apply-confident` and `pricing-apply-flagged` share **one** `run()` impl
(`pricing-apply/index.ts`), registered under two ids. The id binds which subset of
the parent's output to apply (`confident[]` vs `flagged[]`) via `selectSkus`. Each
apply run is per-SKU resumable: checkpoint before + after every write, skip if
`|new − lastApplied| < 1%` (anti-thrash), a single-SKU failure is recorded (never
thrown) and a re-run retries **only** rows not already `applied` (D7).

## Reachability (who can POST what)

| Workflow                   | Reachable via                         | Public `POST /v1/...`? |
|----------------------------|---------------------------------------|------------------------|
| `pricing-draft`            | operator trigger                      | **yes**                |
| `pricing-apply-confident`  | draft `onComplete` (auto child)       | no — `gatedTargets()`  |
| `pricing-apply-flagged`    | draft `onApprove` (approval gate)     | no — `gatedTargets()`  |

The control plane (`engine-api`) refuses a direct POST to any id in
`gatedTargets()` (workflows registry) — the union of every `onApprove` target and
every `onComplete` target. `approvalTargets()` stays narrower (approval-only) for
callers that specifically mean "gated by a human approval".

## Registration

All three are registered in `workflows/src/index.ts` (the only place that names
workflows). `engine-api` + `worker` import the aggregate registry, never an
individual workflow.

## Per-tenant config (M1 — env-backed, D2)

The worker's resolver (`worker/src/integration-resolver.ts`) hands each `run()` a
lazy `ctx.integration(name)` that returns ONLY the requested provider's client,
scoped to the run's `consumer_id`. The env-backed factories are wired in
`worker/src/provider-config.ts`, keyed by the consumer's prefix (`mi-pase` →
`MIPASE_*`). Required env (see `.env.example`):

```
MIPASE_SHOPIFY_BASE_URL        # dev store admin API base incl. /admin/api/<ver>
MIPASE_SHOPIFY_ACCESS_TOKEN
MIPASE_ML_ACCESS_TOKEN         # required
MIPASE_ML_REFRESH_TOKEN        # optional — enables 401 → refresh → retry-once
MIPASE_ML_CLIENT_ID            # optional (OAuth refresh)
MIPASE_ML_CLIENT_SECRET        # optional (OAuth refresh)
MIPASE_ML_REDIRECT_URI         # optional
```

Asking for one provider never reads the other's env (narrow secret blast radius,
Codex #5). A missing/unconfigured provider throws; the workflow fail-softs (D3):
an ML miss → empty competitor price → the SKU is flagged.

Onboard a second tenant by adding its prefix to `ENV_PREFIX` in
`provider-config.ts` — nothing else changes (resolver, contract, and workflows
are tenant-agnostic).

## Layout

```
pricing/
  lib/                 validated pure brain (ported verbatim) + its parity tests
  pricing-draft/       manifest + run (fetch → match → price → classify)
  pricing-apply/       manifest (2 ids) + shared run (per-SKU resumable apply)
  README.md            (this file)
```

See `docs/feature-requests/customer-dashboard/M1-engine-plan.md` for the full plan
(decisions D1–D9, task breakdown, failure modes).
