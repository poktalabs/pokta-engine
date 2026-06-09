# P5b — Workspace Real-Data Wiring (Honest Read Models) — Implementation Plan

> Build spec for replacing the SPA's mock fixtures with REAL, tenant-scoped backend data — but ONLY
> where the backend can honestly produce it. The auth + tenancy spine is live (PR2/PR2b/#13/#15): Privy
> login → `/tenants/me` → `/mi-pase/...`. P5b makes the *data* real without fabricating anything.
> Reviewed via `/plan-eng-review` + Codex outside-voice (2026-06-09); the review caught that the mock
> fixtures are **aspirational** (shapes the DB can't yet feed), so this plan was re-scoped around honest
> read models. Decisions D1–D5 locked in §3.

---

## 0. Mission

After a real login the workspace renders **hardcoded mock fixtures** (`MOCK_WORKFLOWS`, `MOCK_RUN_DETAIL`,
`MOCK_BATCH_ROWS`, `getMockSettings()`, …) — it looks like a demo because it is one. P5b wires every surface
**that real backend data can feed** to a real, server-scoped read model, and reshapes those UIs to render
the real data with honest empty states. Surfaces whose mock data was **invented** (rich reports, an
integration catalog, a member roster) have **no honest source today** — they are explicitly DEFERRED to a
later milestone that first builds their backing, and render a clean "not connected / no data yet" state in
the meantime. **No fabricated data ships in production.**

Backend then frontend, two waves (PR2→PR2b proven). New reads fail closed and scope to the authed tenant
via `scoped-db` (never raw `db.select()` in `app.ts` — that trips `check:scoped`). The JWT is the only
tenant authority; remaining `?tenant=` client params are dropped.

## 1. Repo + environment (ground truth)

- **Repo:** `/Users/mel/workspaces/poktalabs/projects/godinez-ai/godin-engine/code/godin-engine-v0.1`
- **Branches:** `feat/p5b-backend` then `feat/p5b-spa` off `origin/main`. **Wave 2 must not merge until Wave 1
  is DEPLOYED and smoke-probed** (D3) — else the prod SPA calls endpoints that don't exist.
- **Stack:** pnpm 10.26.1, Node 22, strict TS, turbo, root vitest 2.1.8 (node + jsdom projects; the web
  project pins `VITE_USE_MOCKS=true`). Hono, drizzle-orm, `@tanstack/react-query`.
- **Commit identity:** `git -c user.name="troopdegen" -c user.email="mel@innvertir.com"`; trailer
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Verify:** `pnpm typecheck` · `pnpm test` · `pnpm check:scoped` · `pnpm build`.
- **GREEN BAR:** every backend test file passes in node + the jsdom web suite passes (post-#15: ~488/54).
  Add tests; never weaken the auth/tenancy ★ regressions. Squash-merge PRs (branch-protected `main`).

## 2. Surface disposition (the re-scope)

| Surface | Real data exists? | P5b action |
|---|---|---|
| **Approvals** | ✅ `/v1/approvals` + approve/reject (real, scoped) | **WIRE.** Real list + real decisions; delete `MOCK_BATCH_ROWS`/`MOCK_VINO_APPROVALS` + the fake `mockDecision`. |
| **Runs** | ✅ `/v1/runs/:id` (real, scoped) | **WIRE.** `use-run-detail` hook; re-run → `POST /v1/workflows/:id/runs`; delete `MOCK_RUN_DETAIL*`. |
| **Workflows** | ⚠️ manifests exist but the page renders a *customer family* view | **WIRE via a view-model endpoint** (below). `pricing-draft`+`pricing-apply-{confident,flagged}`+approvals compose one "Daily Pricing" card; raw `/v1/workflows` does not feed the UI. |
| **Settings — profile** | ✅ from the tenant row (`TenantView`) | **WIRE.** Read from the existing `TenantProvider`/`/tenants/me` (name/currency/locale/branding/status) — no new endpoint. |
| **Integrations** | ✅ via a NEW `engine_tenant_integrations` connection table (non-secret config) | **WIRE.** `GET /v1/integrations` reads the table (scoped) → honest **enabled/pending/disabled** status (ops-asserted enablement, NOT live-verified connectivity); secrets stay worker-only (→KMS). Reconcile mock catalog ids → real registry ids; rewrite `IntegrationCard`. |
| **Reports** | ❌ no source (`engine_runs.output` opaque; `engine_approvals` lifecycle-only; mock needs prose/charts) | **DEFER.** Honest "no reports yet" empty state; delete the mock production import. |
| **Settings — roster / integration-status** | ❌ `members[]` is bare DIDs (no name/email/role/lastActiveAt) | **DEFER.** Honest "members coming soon" panel; do NOT render DIDs as fake emails. |

## 3. Locked decisions (from the review)

1. **D1 — Integrations status source: a `engine_tenant_integrations` connection table (NOT env-derived).**
   The flat `MIPASE_SHOPIFY_*`/`MIPASE_ML_*` worker env vars are a stopgap; the intended model separates
   **non-secret connection config** (which integrations a tenant has enabled — readable by engine-api AND the
   worker) from **secret material** (worker-only → KMS later). P5b adds the table as the non-secret config
   truth so `GET /v1/integrations` reports honest **enabled/pending/disabled** status **without any secret on
   engine-api**. Status is ops-asserted ENABLEMENT (a row marked `enabled` when ops configured it), NOT
   live-verified connectivity — engine-api can't prove the worker holds working creds, so the UI says
   "Enabled/Configured", never "Connected/Live" (Codex adversarial pass). A worker health-probe to upgrade to
   true "connected" is a future enhancement. Mock catalog ids (`mercadolibre`, `coppel`, …) are reconciled to
   the real registry (`notion`/`resend`/`shopify`/`mercado-libre`); only real integrations appear. Secrets are
   NOT in this table; `secret_ref` is DROPPED from P5b and returns with the KMS migration (§9).
2. **D2 — Reports: DEFER rich reports.** `engine_runs`/`engine_approvals` cannot honestly produce the mock's
   "Daily pricing impact" prose + charts without parsing workflow outputs or a report-materialization table.
   P5b ships an honest empty state. (Operational counts could come later via scoped aggregate helpers.)
3. **D3 — Two waves + deploy gate.** Backend wave merges + DEPLOYS + is smoke-probed (each new endpoint
   responds) BEFORE the SPA wave merges. The SPA also degrades gracefully (error/empty state) if an endpoint
   is missing, so a deploy-order slip never white-screens the app.
4. **D4 — Settings read-only, real fields only.** Profile derives from the tenant row (`TenantView`) — no
   `PATCH`, no fabricated `plan`/roster. The contract exposes only DB-owned fields.
5. **D5 — Mock fixtures stay TEST-only.** Move/guard so NO production page imports a `MOCK_*` value or a mock
   side-effect; a grep guard (`check:no-mock-render`) targets production value/side-effect imports from
   `pages/`/`features/` (type-only imports that move to the contract are fine). Fixtures live under
   `apps/web/src/test/fixtures` (or stay in `mocks/` consumed only by the test mock-registry).
6. **Honest read models (Codex pt.15).** Compose customer view models SERVER-SIDE from scoped helpers; the
   SPA renders what's real, not mock DTOs lifted wholesale.

## 4. Backend (Wave 1 — `feat/p5b-backend`)

Mostly NEW: one workspace view-model endpoint; the rest already exist. Everything via `scoped-db` helpers.

- **`GET /v1/workspace/workflows`** → `WorkflowCard[]` (NEW contract type). Server-composed, scoped to the
  tenant: for each allow-listed workflow (and the mi-pase "Daily Pricing" family folded into one card),
  derive `{ id, displayName, trigger, lastRun: {status, at} | null, pendingApprovals: number, hasDetail }`
  from `listManifests()` (allow-listed) + the tenant's recent `engine_runs` + pending `engine_approvals`.
  **Family mapping (Codex #9):** the card `id` is the **dispatchable parent** (`pricing-draft`); a documented
  map in **engine-api** (NOT the pure workflow registry) rolls `pricing-apply-{confident,flagged}` + their
  approvals into the parent card. `GET /v1/workflows/:id/runs` accepts the engine workflow id and returns
  `SKILL_NOT_FOUND` for ids outside the tenant's allow-list (anti-enumeration, matches the dispatch gate).
  **One composed query, no N+1 (Codex #10):** add a scoped aggregate to `scoped-db.ts` that fetches the
  tenant's recent runs + pending approvals ONCE (approvals via the existing `sourceRunId` join) and folds
  cards in memory — do NOT loop manifests calling `listRuns`/`listApprovals` per family. No raw-select in `app.ts`.
- **`GET /v1/workflows/:id/runs`** → `RunListItem[]` (reuse). Scoped per-workflow (or per-family) run history
  for the detail page. Scoped helper, optional `?status=`.
- **`engine_tenant_integrations` table (NEW) + `GET /v1/integrations`.**
  - **Honest status (Codex #1):** the table records OPS ENABLEMENT, not verified live connectivity (engine-api
    cannot check worker creds without holding secrets). So the enum is **`integrationConnectionStatus =
    pgEnum('enabled'|'pending'|'disabled')`** and the UI says "Enabled/Configured", never "Connected/Live".
    (A future worker health-probe could upgrade to true "connected" — out of P5b.)
  - **Schema:** `(tenant_id text references engine_tenants(tenant_id) on delete cascade, integration_id text,
    status integrationConnectionStatus not null, connected_at timestamptz null, created_at, updated_at,
    PK(tenant_id, integration_id))`. **FK + cascade** so a removed tenant doesn't orphan rows (Codex #5).
    **`secret_ref` is DROPPED from P5b** (speculative — nobody reads it; the worker still uses `secretPrefix`
    + env). It returns with the KMS migration (§9) (Codex #7).
  - **Seed (env-driven, idempotent — Codex #6):** `MIPASE_INTEGRATIONS=shopify:enabled,mercado-libre:pending`.
    Exact rules: `integration_id` MUST exist in `listIntegrations()` (reject otherwise); upsert per id;
    `connected_at` set ONCE on first entering `enabled`, preserved across re-seeds, left as-is on
    pending/disabled; an id REMOVED from the env → row set `disabled` (never deleted — keep the audit row).
  - **Read (Codex #8):** `GET /v1/integrations` → `{ integrations: IntegrationStatus[] }` via a NEW
    **`forConsumer(...).listTenantIntegrations()` helper in `scoped-db.ts`** (NOT `tenants.ts`, which is
    allowlisted — hiding a per-tenant read there weakens the grep gate). Rows for the authed tenant, enriched
    with the registry descriptor (displayName/category). Fail closed; `check:scoped` stays green with no
    allowlist change.
  - **Deprecate `TenantView.integrations` (Codex #4):** `toTenantView()` returns ALL registry ids for every
    tenant today — wrong once the table exists. Remove it from `TenantView` (the SPA reads `/v1/integrations`
    now), and update the contract + the engine tests that assert non-empty registry ids.
- **Reuse as-is:** `GET /v1/approvals`, `POST /v1/approvals/:id/{approve,reject}`, `GET /v1/runs/:id`,
  `POST /v1/workflows/:id/runs`, `GET /v1/tenants/me` (Settings profile).
- **Contract:** add `WorkflowCard` (+ `WorkspaceWorkflowsResponse`) and `IntegrationStatus`
  (+ `IntegrationListResponse`) — `IntegrationStatus = { id, displayName, category, status:
  'enabled'|'pending'|'disabled', detail? }`, ids from the real registry. **The SPA `IntegrationCard` must be
  rewritten to this honest shape (Codex #2):** delete the mock-only `riskTier`/`report`/`readOnly`/`provider`
  fields + the `estimated`/`not-yet-live` statuses + the risk/report/feed UI — render only registry-derived,
  enablement-truthful fields. Reuse `ApprovalView`, `RunDetail`, `RunListItem`, `TenantView` (minus
  `integrations`). **Reconcile ids** before anything moves into the contract (`mercado-libre` not
  `mercadolibre`; `pricing-draft`/`pricing-apply-*` not `mipase.daily-pricing`). Do NOT add the invented
  `ReportDetail`/roster types — Reports + the member roster stay deferred.

## 5. SPA (Wave 2 — `feat/p5b-spa`, after Wave 1 deploys)

- **Workflows list** (`WorkflowsList.tsx`): new `use-workflows` query → `GET /v1/workspace/workflows`; render
  `WorkflowCard[]`; **delete `MOCK_WORKFLOWS` + `useWorkflowsList()`**.
- **Workflow detail** (`DailyPricingDetail.tsx`): fetch the family's real runs (`/v1/workflows/:id/runs` +
  `/v1/runs/:id`); derive display state from run status/output; **delete `MOCK_DAILY_PRICING_BY_STATE`**.
- **Approvals** (`Approvals.tsx`): query `GET /v1/approvals`; real `POST …/approve|reject` (parse
  `ApproveResponse`/`RejectResponse`; surface `APPROVAL_DENIED`/partial-failure by `error.code`); **delete
  the `MOCK_*` arrays + `mockDecision`**.
- **Run detail** (`RunDetail.tsx`): `use-run-detail` → `GET /v1/runs/:id`; wire re-run; **delete `MOCK_RUN_DETAIL*`**.
- **Settings** (`settings/index.tsx`): profile panel from `TenantProvider`/`TenantView` (real); roster +
  integration-status panels → honest empty/"coming soon"; **delete `getMockSettings()` production use**.
- **Integrations** (`Integrations.tsx`, `IntegrationCard.tsx`): wire to the real `GET /v1/integrations` (it
  already calls `apiFetch` — **drop `?tenant=`**, bind to the `IntegrationStatus` contract type, render
  enabled/pending/disabled from real rows). **Rewrite `IntegrationCard`** to the honest shape (delete the
  mock `riskTier`/`report`/`readOnly` UI per Codex #2); **delete the mock catalog import**. Empty tenant →
  "no integrations enabled yet".
- **Reports** (`ReportsPage.tsx`, `ReportDetailPage.tsx`, `use-reports.ts`): replace the body with a shared
  **`ComingSoon`/`EmptyState`** ("no reports yet"); **drop the `?tenant=` calls and the mock production
  imports**. (Keep the route so the nav/roadmap stays visible — D2 answer; Reports stays deferred per §9.)
- **Guard:** add `check:no-mock-render` (grep) forbidding production **value/side-effect** imports of `@/mocks/*`
  in `pages/`/`features/`; move fixtures to `test/fixtures` if needed. Type-only imports that moved to the
  contract are allowed.

## 6. Test coverage (backend node + SPA jsdom; wired surfaces use the LIVE-path split, NOT the mock registry)
```
BACKEND
  GET /v1/workspace/workflows: composes the right card(s) for a seeded run/approval set; tenant A sees only
    its data; cross-tenant → empty (ISOLATION ★); unauth → 401; pending/disabled tenant → fail closed
  GET /v1/workflows/:id/runs: scoped per workflow/family; cross-tenant → empty
  check:scoped stays OK (new reads go through scoped-db helpers, no raw select in app.ts)
CONTRACT  WorkflowCard exported + typecheck; ids match the real registry/manifests (no mock-id drift)
SPA (live-path)
  Workflows: renders WorkflowCard from the real endpoint (loading/error/empty/loaded); NO MOCK_* import
  Approvals: real list + approve/reject fire; APPROVAL_DENIED + partial-failure surfaced; NO MOCK_* import
  Run detail: renders from /v1/runs/:id; re-run dispatches; NO MOCK_* import
  Settings: profile from TenantView; roster shows the empty state (no fake rows)
  Integrations: renders real /v1/integrations rows (enabled/pending/disabled); empty tenant → "none enabled";
    NO ?tenant= sent; NO mock catalog import; IntegrationCard has no risk/report/feed fields
  Reports: render ComingSoon; assert NO /v1/reports network call + no mock import
INTEGRATIONS-BE  GET /v1/integrations: only the authed tenant's rows; cross-tenant → empty (ISOLATION ★);
    no secret value in any response; seed rejects a non-registry integration_id; check:scoped green
REGRESS ★ auth/tenancy spine (login-gate / tenant-provider / reauth / access-denied) stays green
GUARD    check:no-mock-render: no production page imports a MOCK_* value/side-effect
```

## 7. Orchestration (two ultracode workflows)
```
WAVE 1 — P5b-backend (feat/p5b-backend)
  Spine (serial): WorkflowCard contract (+ id reconciliation) → scoped-db workspaceWorkflowCards() +
  per-workflow runs helper → GET /v1/workspace/workflows → GET /v1/workflows/:id/runs (scoped, fail-closed) →
  typecheck green after each → commit. Parallel endpoint tests + serial integrator (full suite + check:scoped).
  Adversarial ISOLATION panel (cross-tenant compose, raw-select escape, family-map leaking another tenant) →
  harden. PR base main: "P5b-backend: workspace workflow view-model + per-workflow runs".
  >>> MERGE, DEPLOY engine-api, SMOKE-PROBE the two new endpoints before Wave 2. <<<

WAVE 2 — P5b-spa (feat/p5b-spa)
  Spine (serial): use-workflows / use-run-detail hooks → wire Workflows + Run detail + Approvals to real →
  Settings profile real + roster/integrations empty states → Integrations/Reports ComingSoon + drop ?tenant=
  → delete all MOCK_* production imports + add check:no-mock-render. Parallel per-surface jsdom (live-path)
  tests + serial integrator. Panel: any surviving mock render / client-trusted tenant / unhandled
  error+empty state / white-screen when an endpoint 404s → harden. PR base main: "P5b-spa: wire workspace to
  real read models, honest empty states for deferred".
```

## 8. Constraints / definition of done
- No production page renders or imports a `MOCK_*` value; wired surfaces show real tenant-scoped data; deferred
  surfaces show honest empty states (never fabricated rows or DIDs-as-emails).
- Every new read scopes via `scoped-db` + fails closed; `check:scoped` + `check:no-mock-render` green; no secrets.
- `pnpm typecheck` / `pnpm test` (node + jsdom) / `pnpm check:scoped` / `pnpm build` green; ★ auth regressions green.
- Wave 1 deployed + smoke-probed before Wave 2 merges; the SPA degrades gracefully if an endpoint is absent.
- Both PRs merged, CI green.

## 9. Explicitly DEFERRED (out of P5b — needs its own backed milestone)
- **Worker secret loading from the connection table** → P5b adds `engine_tenant_integrations` for STATUS
  (engine-api) only; migrating the worker to load secrets via the row's `secret_ref` (env→KMS) is a follow-up.
  The worker keeps reading its flat env creds for now.
- **Reports** → a report-materialization table or per-workflow output adapters, then `GET /v1/reports(+/:id)`
  + the `Report*` contract + real charts/metrics.
- **Member roster** → real member identity beyond Privy DIDs (name/email/role/last-active), then the Settings
  roster panel + `WorkspaceMember` contract.
- **Real pricing execution** (live Shopify/MercadoLibre vs simulated) → the WORKER needs `MIPASE_SHOPIFY_*` /
  `MIPASE_ML_*` creds; ops/integration step, separate from P5b.

---

## Implementation Tasks
Synthesized from the review. Wave 1 = backend, Wave 2 = SPA (gated on Wave 1 deploy).

- [ ] **T1 (P1)** — contract — Add `WorkflowCard` (+`WorkspaceWorkflowsResponse`); reconcile mock ids → real registry/manifest ids (`mercado-libre`, `pricing-*`). Files: `packages/contract/src`. Verify: typecheck + id-match test.
- [ ] **T2 (P1)** — engine-api — `scoped-db` `workspaceWorkflowCards()` + per-workflow runs helper (scoped, no raw select). Files: `apps/engine-api/src/scoped-db.ts`. Verify: ISOLATION ★ + `check:scoped`.
- [ ] **T3 (P1)** — db — `engine_tenant_integrations` table (schema + migration) + idempotent env-driven seed (`MIPASE_INTEGRATIONS`); validate `integration_id` ∈ registry. Files: `packages/db/src/schema.ts`, `apps/engine-api/src/seed-tenants.ts`. Verify: migration applies + seed test.
- [ ] **T4 (P1)** — engine-api — `GET /v1/workspace/workflows` + `GET /v1/workflows/:id/runs` + `GET /v1/integrations` (all scoped via scoped-db helpers, fail-closed; integrations enriched with registry descriptor, no secrets). Files: `apps/engine-api/src/app.ts`, `scoped-db.ts`. Verify: compose-correctness + cross-tenant-empty + no-secret-leak tests.
- [ ] **T5 (P1)** — web — `use-workflows` + `use-run-detail`; wire Workflows/Run-detail/Approvals/Integrations to real; delete `MOCK_*`. Files: `apps/web/src/pages/{workflows,runs,Approvals,integrations}*`. Verify: live-path jsdom tests.
- [ ] **T6 (P1)** — web — Settings profile from `TenantView`; roster empty state; Reports `ComingSoon`; drop `?tenant=`. Files: `apps/web/src/pages/{settings,reports}/*`. Verify: empty-state + no-network tests.
- [ ] **T7 (P1)** — web — `check:no-mock-render` guard (production value/side-effect imports); move fixtures to `test/fixtures`. Files: `scripts/`, `apps/web/src/test/fixtures/`. Verify: guard fails on a planted import.
- [ ] **T8 (P2)** — ops — deploy gate: Wave 1 deployed + smoke-probe the new endpoints (`/v1/workspace/workflows`, `/v1/workflows/:id/runs`, `/v1/integrations`) before Wave 2 merges. Verify: `curl` 401 (exists) not 404 (missing).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Outside Voice | `/codex` (codex exec) | Independent 2nd opinion | 2 | issues_found | pass 1: 15 findings → re-scope; pass 2 (adversarial, post-update): 10 findings → honest-status + card rewrite, all folded |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean (scope reduced) | 15 issues; 5 decisions force-decided (2 by user); 0 unresolved; 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not run (data wiring; new UI = empty states) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **CODEX (pass 1):** read `app.ts`/`schema.ts`/`provider-config.ts`/`integrations/*`/SPA mocks and proved the mock fixtures are aspirational — integration secrets live on the worker (not engine-api), there's no connection table, `engine_runs.output` is opaque, `engine_approvals` has no `consumer_id`, `members[]` is bare DIDs, and mock ids (`mercadolibre`, `mipase.daily-pricing`) don't match the real registry/manifests. Forced the honest-read-models re-scope.
- **CODEX (pass 2, adversarial — post-Integrations-update):** 10 findings, all folded: (1) "connected" is dishonest → status enum is `enabled/pending/disabled`, UI never says "Connected/Live"; (2) the SPA `IntegrationCard` and the new contract are different products → rewrite the card, drop mock `riskTier`/`report`/`readOnly`; (3) stale test-matrix "ComingSoon" line fixed; (4) deprecate `TenantView.integrations` (returns all registry ids today); (5) add FK `on delete cascade` + the enum export; (6) seed idempotency spec (`connected_at` once, removed-from-env → disabled not deleted); (7) drop speculative `secret_ref` (returns with KMS); (8) read via a NEW `scoped-db` helper, not allowlisted `tenants.ts`; (9) family-map id = dispatchable parent, lives in engine-api, anti-enumeration on `:id/runs`; (10) one composed scoped query, no N+1.
- **CROSS-MODEL:** consensus — Codex deepened the eng-review's own findings (engine-api can't see worker creds, approvals join via `sourceRunId`, no composite indexes). Both agree on honest read models + server-side view composition.
- **DECISIONS:** D1 Integrations → **wire via a new `engine_tenant_integrations` connection table** (non-secret config; secrets stay worker→KMS) · D2 Reports → **defer** (no honest source) · D3 → two waves + deploy gate · D4 → Settings read-only, real fields only · D5 → guard production mock imports. **User-decided:** P5b direction = honest read models + defer invented surfaces; deferred tabs = honest empty states; Integrations folded in on the connection table (durable infra over an interim env map).
- **SECRETS ARCHITECTURE (user-stated):** the flat `MIPASE_*` worker env vars are a stopgap; the model splits non-secret connection config (the table — readable by engine-api + worker) from secret material (worker-only → KMS). Engine-api never holds integration secrets.
- **UNRESOLVED:** 0.
- **VERDICT:** ENG CLEARED (scope reduced) — P5b is now buildable + honest. Wire Approvals/Runs/Workflows-as-family to real read models; defer Integrations/Reports/roster to backed milestones (§9). Run as two gated ultracode workflows (backend → deploy → SPA).
