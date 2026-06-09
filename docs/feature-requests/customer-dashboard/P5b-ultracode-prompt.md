# P5b — ultracode kickoff prompts

Paste these into a CLEAN session to run P5b. The plan is self-contained at
`docs/feature-requests/customer-dashboard/P5b-IMPLEMENTATION-PLAN.md`. Two gated waves:
**Wave 1 (backend) → merge + deploy + smoke-probe → Wave 2 (SPA)**.

Repo: `/Users/mel/workspaces/poktalabs/projects/godinez-ai/godin-engine/code/godin-engine-v0.1`
Commit identity: `git -c user.name="troopdegen" -c user.email="mel@innvertir.com"`
Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## WAVE 1 — backend (run now)

```
ultracode - execute P5b WAVE 1 (backend) per the implementation plan:
docs/feature-requests/customer-dashboard/P5b-IMPLEMENTATION-PLAN.md
(repo: /Users/mel/workspaces/poktalabs/projects/godinez-ai/godin-engine/code/godin-engine-v0.1)

Read that plan IN FULL first — it is self-contained (two-wave structure, locked decisions D1–D5,
the engine_tenant_integrations schema, the workflow view-model endpoint, the §6 test matrix, and the
§7 orchestration). Build ONLY Wave 1 (feat/p5b-backend); Wave 2 (SPA) is gated on Wave 1 deploying.

- Branch feat/p5b-backend off origin/main. Fold the untracked plan doc into the setup commit.
- PHASE 1 SPINE (strictly serial, one agent): WorkflowCard + IntegrationStatus contract (real registry/
  manifest ids, drop TenantView.integrations) → engine_tenant_integrations table (FK on delete cascade,
  status enum enabled|pending|disabled, env-driven idempotent seed, no secret_ref) → scoped-db helpers
  (workspaceWorkflowCards one-composed-query + listTenantIntegrations) → GET /v1/workspace/workflows +
  GET /v1/workflows/:id/runs + GET /v1/integrations. typecheck green after each; commit.
- PHASE 2 TESTS (parallel disjoint files) → serial integrator (full suite + typecheck + check:scoped).
- PHASE 3 adversarial ISOLATION panel (cross-tenant reads, secret leakage, raw-select escape, family-map
  cross-tenant) → serial harden. commit.
- PHASE 4 push + open PR (base main) titled "P5b-backend: workspace read models + integrations connection
  table". Report the PR URL.

Hold the green bar: the ~488 existing tests stay green (pricing-chain integration skips without PG) + new
tests; auth/tenancy ★ regressions stay green; pnpm check:scoped stays OK; engine-api status is honest
("enabled", never "connected"). Commit each phase with git -c user.name="troopdegen"
-c user.email="mel@innvertir.com". STOP at the PR — do NOT start Wave 2 (SPA); it runs after Wave 1
deploys + I smoke-probe the new endpoints. If any phase can't reach green, STOP and report.
```

### Between waves (ops gate — do this after Wave 1 merges)
1. Merge the Wave 1 PR (squash). engine-api auto-redeploys (runs `db:migrate` + `db:seed`).
2. Set `MIPASE_INTEGRATIONS` on the engine-api Railway service (e.g. `shopify:enabled,mercado-libre:pending`) + redeploy so the seed populates `engine_tenant_integrations`.
3. **Smoke-probe** the new endpoints (expect 401 = exists, NOT 404 = missing):
   ```
   API=https://godin-engineengine-api-production.up.railway.app
   curl -s -o /dev/null -w "%{http_code}\n" $API/v1/workspace/workflows
   curl -s -o /dev/null -w "%{http_code}\n" $API/v1/integrations
   ```
   Only proceed to Wave 2 once both return 401.

---

## WAVE 2 — SPA (run AFTER Wave 1 is merged + deployed + smoke-probed)

```
ultracode - execute P5b WAVE 2 (SPA) per the implementation plan:
docs/feature-requests/customer-dashboard/P5b-IMPLEMENTATION-PLAN.md
(repo: /Users/mel/workspaces/poktalabs/projects/godinez-ai/godin-engine/code/godin-engine-v0.1)

PRECONDITION: Wave 1 (P5b-backend) is MERGED to main and its endpoints are live (GET /v1/workspace/workflows,
/v1/workflows/:id/runs, /v1/integrations return 401 not 404). If not, STOP.

Read the plan IN FULL first. Build Wave 2 (feat/p5b-spa) off origin/main per §5 + §7.

- Branch feat/p5b-spa off origin/main.
- PHASE 1 SPINE (strictly serial): use-workflows + use-run-detail hooks → wire Workflows / Run-detail /
  Approvals / Integrations to the real endpoints (delete every MOCK_* production import) → rewrite
  IntegrationCard to the honest IntegrationStatus shape (no riskTier/report/readOnly) → Settings profile from
  TenantView + roster empty state + Reports ComingSoon → drop ?tenant= → add the check:no-mock-render guard +
  move fixtures to test/fixtures. typecheck green after each; commit.
- PHASE 2 TESTS (parallel disjoint web test files, LIVE-path split not the mock registry) → serial integrator
  (full suite node+jsdom + typecheck + check:scoped + check:no-mock-render + web build).
- PHASE 3 adversarial panel (surviving mock render, client-trusted tenant, unhandled error/empty state,
  white-screen when an endpoint 404s) → serial harden. commit.
- PHASE 4 push + open PR (base main) titled "P5b-spa: wire workspace to real read models, honest empty states".
  Report the PR URL.

Hold the green bar: all backend test files stay green in node + new jsdom web tests; auth/tenancy ★
regressions stay green; check:scoped + check:no-mock-render OK; no production page imports a MOCK_* value;
deferred surfaces show honest empty states (never fabricated rows or DIDs-as-emails). Commit each phase with
git -c user.name="troopdegen" -c user.email="mel@innvertir.com". If any phase can't reach green, STOP and report.
```

### After Wave 2
Merge → web rebuilds → log in at the SPA: Workflows/Approvals/Runs/Integrations show real mi-pase data;
Reports + the member roster show honest empty states. Real pricing execution still needs worker integration
creds (separate ops step, §9).
