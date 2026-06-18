# PR2 — Tier-2 Tenancy Runtime (BACKEND) — Implementation Plan

> Self-contained build spec for an ultracode multi-agent workflow run on a clean context.
> Rationale + the eng-review decision trail live in `PR2-tenancy-runtime-plan.md` (same dir).
> This file has everything needed to BUILD; you should not need to rediscover anything.

---

## 0. Mission

Make a real `engine_tenants` registry the source of truth for tenancy, so the engine knows who
each tenant is, enforces per-tenant workflow access, resolves per-tenant secrets from the registry,
and exposes an authed `GET /v1/tenants/me`. **Backend only.** The SPA Privy live-wiring is a
separate follow-up (PR2b) and is explicitly OUT of scope here.

This is security/data-path work. Build it like PR1: a strictly serial security spine, then parallel
disjoint tests, then an adversarial isolation panel, then the PR. Fail closed; never weaken a test.

## 1. Repo + environment (ground truth)

- **Repo (cd here for every command):** `/Users/mel/workspaces/poktalabs/projects/godinez-ai/godin-engine/code/godin-engine-v0.1`
- **Branch:** create `feat/m2-tenancy-runtime` off `origin/main` (currently `5777593`). Do NOT base on any SPA branch.
- **Stack:** pnpm 10.26.1, Node 22, strict TS, Hono, drizzle-orm, **turbo** (build/typecheck), root **vitest** (tests). Monorepo: `apps/{engine-api,worker,web}`, `packages/{contract,db,queue,llm,workflows}`, `integrations/` (`@pokta-engine/integrations`).
- **Commit identity (every commit):** `git -c user.name="troopdegen" -c user.email="mel@innvertir.com"`. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Verify commands:** `pnpm typecheck` (turbo) · `pnpm test` (vitest, root) · `pnpm check:scoped` (tenant-isolation grep gate) · `pnpm build` (turbo) · `pnpm --filter @pokta-engine/db db:generate` (drizzle migration from schema).
- **GREEN BAR:** baseline is **331 tests / 38 files** passing; the worker `pricing-chain.integration.test.ts` SKIPS without a dev Postgres (that skip is expected/green). PR2 must keep all 331 green and ADD tests; never drop the count. `main` is branch-protected (requires the `test` check) — land via squash-merge PR.

## 2. What already exists (REUSE — do not rebuild)

- **`apps/engine-api/src/auth.ts`** — dual-mode auth middleware. Resolves `X-Service-Key` OR Privy `Bearer` JWT (verified via `@privy-io/server-auth`: iss/aud/sig/expiry — already done) into `c.set('consumer', Consumer)`. `Consumer = { id: string; identity: string; mode: 'service'|'privy' }`. Privy path maps DID→tenant via `PRIVY_TENANT_MAP` env (the stub PR2 replaces with `members[]`). Service path: `consumer.id` IS the tenant id. Fail-closed.
- **`apps/engine-api/src/scoped-db.ts`** — `forConsumer(db, consumerId)` is the ONLY /v1 path to `engine_runs`/`engine_approvals`/`engine_workflow_state` (cross-tenant → 404). Contains **`resolveTenant(consumerId, knownConsumers)` at ~line 224** — currently a stub accepting `'mi-pase'` + SERVICE_KEYS consumers. **PR2 swaps this body for the registry.** Keep the seam + signature shape.
- **`apps/engine-api/src/app.ts`** — `buildApp()`. Dispatch route `POST /v1/workflows/:id/runs` (~line 79) already: gets `consumer` from ctx, calls `resolveTenant` (~:81) → `TENANT_UNKNOWN` if not ok, then `getWorkflow(id)`, `gatedTargets` check, body.consumer_id mismatch guard, `forConsumer(db, consumer.id).dispatchRun(...)`. **T6 allow-list gate slots in right after `getWorkflow`.** Also where `GET /v1/tenants/me` is added. `knownServiceConsumers()` from `./auth` gives SERVICE_KEYS consumer ids.
- **`packages/contract/src/`** — `EngineError` with codes incl. `TENANT_UNKNOWN`(403), `SKILL_NOT_FOUND`(404), `UNAUTHENTICATED`(401), `ARGS_INVALID`(400). `index.ts` re-exports. **T2 adds `TenantView` here.**
- **`packages/db/src/schema.ts`** — drizzle schema (`engineRuns` has `consumerId`; `engineApprovals` has NO consumer_id — scoped via sourceRunId; `engineQuotaLedger`, `engineWorkflowState`). Uses `pgTable`, `pgEnum`, `text`, `jsonb`, `timestamp`, `index`, etc. **T1 adds `engineTenants`.**
- **`packages/db/`** migrations: `drizzle/` dir, 2 existing (`0000_*`, `0001_*`). `pnpm --filter @pokta-engine/db db:generate` produces the next SQL from the schema. Railway runs `db:migrate` as engine-api `preDeployCommand`.
- **`packages/workflows/src/index.ts`** — PURE registry: `getWorkflow(id)`, `listManifests()`, `gatedTargets()`. NO DB/tenant knowledge. **Keep it pure — do NOT make it consumer-aware.** Filter in engine-api.
- **`integrations/` (`@pokta-engine/integrations`)** — `getIntegration`/`listIntegrations` (each integration has a descriptor: id, displayName, category, secretKeys). TenantView's `integrations` list is validated/enriched against `listIntegrations()`.
- **`apps/worker/src/provider-config.ts`** — per-tenant env wiring. Has `ENV_PREFIX: Record<string,string> = {'mi-pase':'MIPASE'}`. Reads `MIPASE_SHOPIFY_*` / `MIPASE_ML_*`. Registers shopify+ML factories. **T7 replaces the hardcoded `ENV_PREFIX[consumerId]` lookup with `tenant.secret_prefix` from the registry.**
- **`scripts/check-scoped-db.sh`** (`pnpm check:scoped`) — CI grep gate forbidding raw `engine_*` selects in the /v1 surface outside `scoped-db.ts`. Extend its allowlist if the new tenant-registry module does raw tenant-table reads (engine_tenants is NOT an engine_runs-class table, but keep the gate honest).
- Test convention: `apps/engine-api/src/<name>.test.ts`, mock `@pokta-engine/db` (+ `@pokta-engine/queue`) — see `apps/engine-api/src/{auth,isolation,scoped-db,m1-regression}.test.ts` for the canonical mocking pattern (db client throws without DATABASE_URL on import, so always mock it).

## 3. Locked decisions (from eng review + Codex outside voice)

1. **Canonical tenant id = `mi-pase`** (hyphen). `engine_tenants.tenant_id == consumer_id`. (SPA `mipase→mi-pase` rename is PR2b, not here.)
2. **Shared tenant-registry module with ~60s in-process TTL cache**, used by engine-api AND worker (each process caches independently). Cache miss = one indexed row read.
3. **Workflow allow-list enforced in engine-api** (registry stays pure): one helper filters `listManifests()` + gates dispatch POST → `SKILL_NOT_FOUND` when not in `tenant.allowed_workflows`.
5. **Shared `TenantView` in `@pokta-engine/contract`** = the `GET /v1/tenants/me` response: typed `branding` (not raw jsonb) + the **allow-list-filtered** `allowedWorkflows` + `integrations`.
- **Membership = `members text[]` of allowed Privy DIDs on the tenant row.** `resolveTenant` for a Privy principal (`mode==='privy'`) finds the tenant whose `members[]` contains `consumer.identity` (the DID): none → `TENANT_UNKNOWN`; multiple → reject as ambiguous (`TENANT_UNKNOWN`). Service principal (`mode==='service'`): `consumer.id` is the tenant id directly. Both paths then check the tenant exists + `status==='active'`.
- **Anti-enumeration:** disallowed/cross-tenant workflow → `SKILL_NOT_FOUND` (matches PR1's 404 posture). Document in code.

## 4. `engine_tenants` schema (T1)

```ts
export const tenantStatus = pgEnum('tenant_status', ['active', 'pending', 'disabled'])

export const engineTenants = pgTable('engine_tenants', {
  tenantId:         text('tenant_id').primaryKey(),            // == consumer_id, e.g. 'mi-pase'
  name:             text('name').notNull(),
  status:           tenantStatus('status').notNull().default('active'),
  currency:         text('currency').notNull(),               // ISO 4217 — DISPLAY only
  locale:           text('locale').notNull(),                 // es-MX | en — DISPLAY only
  branding:         jsonb('branding').notNull(),              // typed vs TenantView.branding
  allowedWorkflows: text('allowed_workflows').array().notNull().default(sql`'{}'`),
  members:          text('members').array().notNull().default(sql`'{}'`), // allowed Privy DIDs
  secretPrefix:     text('secret_prefix'),                    // ops-owned; ^[A-Z][A-Z0-9_]*$ + UNIQUE
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [ index('tenants_members_idx').on(t.members) ])   // GIN if drizzle supports; else btree
```

**Seed:** `mi-pase` → `status:'active'`, `name:'Mi Pase'`, `currency:'MXN'`, `locale:'es-MX'`, `branding:{name:'Mi Pase', badge:'Shopify test store'}`, `allowedWorkflows:['pricing-draft','pricing-apply-confident','pricing-apply-flagged']` (the real M1 workflow ids — verify against `listManifests()`), `secretPrefix:'MIPASE'`, `members:[]` (DIDs added in PR2b). `vino` → `status:'pending'` (NOT active — no real creds until PR3), `currency:'USD'`, `locale:'en'`, `branding:{name:'Vino Design Build'}`, `allowedWorkflows:['call-intake','proposal-step','send-step']`, `secretPrefix:'VINO'`, `members:[]`.

**Validation on seed/save:** every `allowedWorkflows` id must exist in `listManifests()`; `secretPrefix` must match `^[A-Z][A-Z0-9_]*$` and be unique across tenants.

## 5. Tasks (acceptance criteria per task)

- **T1 db schema + migration** — add `engineTenants` + `tenantStatus` enum to `packages/db/src/schema.ts`; run `pnpm --filter @pokta-engine/db db:generate` to emit `drizzle/0002_*.sql`. ✅ migration generated + applies; schema typechecks.
- **T2 contract `TenantView`** — `packages/contract/src/` (new file + export from `index.ts`): `{ id, name, status, currency, locale, branding: {name: string; badge?: string}, allowedWorkflows: string[], integrations: string[] }`. ✅ typecheck.
- **T3 tenant-registry module** — new `apps/engine-api/src/tenants.ts` (importable by the worker too, OR a shared accessor): `getTenant(id): Promise<TenantRow | undefined>` with a ~60s TTL cache; `findTenantByMember(did)`; `toTenantView(row, allowedWorkflowsFiltered)`. Status-aware helpers. ✅ cache hit/miss/expiry + membership lookup unit-tested.
- **T4 resolveTenant swap** — `apps/engine-api/src/scoped-db.ts`: registry-backed. service mode → `getTenant(consumer.id)`; privy mode → `findTenantByMember(consumer.identity)`; reject empty/unknown/non-active → not-ok (`TENANT_UNKNOWN`). Keep the existing call sites working. ✅ RESOLVE tests.
- **T5 allow-list helper** — `apps/engine-api/src/app.ts`: filter `listManifests()` by `tenant.allowedWorkflows` for any list surface; gate dispatch POST after `getWorkflow` → `SKILL_NOT_FOUND` if the workflow id ∉ `tenant.allowedWorkflows`. ✅ ALLOW-LIST tests.
- **T6 `GET /v1/tenants/me`** — `apps/engine-api/src/app.ts`: authed; resolves the tenant from ctx, returns `TenantView` (allowedWorkflows already filtered to the tenant's set; integrations validated vs `listIntegrations()`). Disabled tenant → 403; unknown → `TENANT_UNKNOWN`; unauth → 401 (auth middleware already enforces). ✅ TENANTS/ME tests.
- **T7 worker secret_prefix** — `apps/worker/src/provider-config.ts`: replace `ENV_PREFIX[consumerId]` with `tenant.secret_prefix` from the registry (worker imports the registry/getTenant); re-validate the run's tenant is resolvable+active before side effects (split-brain guard). Keep the fail-soft IntegrationResult behavior. ✅ SECRET_PREFIX tests.
- **T8 seed + validation** — seed mi-pase(active)/vino(pending); enforce allowedWorkflows∈manifests + secretPrefix charset/uniqueness (a seed script or idempotent insert; runnable on deploy). ✅ SEED tests.
- **T9 tests** — see §6.

## 6. Test matrix (all backend; mock db/queue; no real PG needed)

```
REGISTRY       getTenant cache hit / miss / TTL-expiry; unknown id → undefined; findTenantByMember(did)
RESOLVE        service consumer → tenant ok; privy DID in members[] → tenant ok;
               DID in no members[] → not-ok; DID in 2 tenants → not-ok (ambiguous);
               status pending/disabled → not-ok; empty id → not-ok
ALLOW-LIST     mi-pase POST pricing-draft → queued; mi-pase POST 'call-intake' (vino's) → SKILL_NOT_FOUND;
               vino POST 'pricing-draft' → SKILL_NOT_FOUND; listManifests filtered per tenant
TENANTS/ME     authed mi-pase → TenantView (typed branding, filtered allowedWorkflows, integrations);
               unauthenticated → 401; disabled/pending tenant → 403; unknown principal → TENANT_UNKNOWN
SECRET_PREFIX  worker resolves 'MIPASE' from registry (not ENV_PREFIX); bad prefix rejected on save
SEED           allowedWorkflows validated vs manifest ids; secret_prefix uniqueness + charset enforced
ISOLATION ★    service-key tenant A cannot read/dispatch as B (PR1 isolation suite stays green post-swap)
REGRESSION ★   mi-pase M1 pricing chain still green after resolveTenant→registry + allow-list gate (CRITICAL)
```

★ = mandatory regression. The existing `apps/engine-api/src/{isolation,m1-regression}.test.ts` must stay green; extend them if the registry swap changes their setup (e.g. mock `getTenant` to return mi-pase active).

## 7. Orchestration (how to run the ultracode workflow)

Mirror PR1's proven structure. Serial where it touches the shared security/data path; parallel only for disjoint test files and read-only skeptics.

```
PHASE 1 — SPINE (STRICTLY SERIAL, one agent, all production code)
  T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8, leaving `pnpm typecheck` green after each.
  (One agent owns the whole backend path — schema, contract, registry, resolveTenant, app.ts, worker,
   seed — because they share types + the auth/dispatch path. Tight ownership = low merge risk.)
  After the spine: `pnpm test` must still be 331 green (pre-existing) + typecheck clean. Commit the spine.

PHASE 2 — TESTS (PARALLEL: each agent writes ONE disjoint test file; no installs, no git, no non-test edits)
  (a) registry + resolveTenant unit  → tenants.test.ts            (REGISTRY + RESOLVE blocks)
  (b) allow-list isolation           → allow-list.test.ts         (ALLOW-LIST block)
  (c) GET /v1/tenants/me             → tenants-me.test.ts         (TENANTS/ME block)
  (d) worker secret_prefix + seed    → provider-config + seed tests (SECRET_PREFIX + SEED blocks)
  (e) M1 REGRESSION ★ + PR1 ISOLATION ★ — extend/verify the existing suites stay green post-swap
  Then a SERIAL integrator: run full `pnpm test` + `pnpm typecheck` + `pnpm check:scoped`, fix failures
  (fix the source if a test exposed a real bug; never weaken a security assertion), commit.

PHASE 3 — ADVERSARIAL ISOLATION PANEL (PARALLEL, 3 read-only skeptics; default to "found a hole")
  Hunt the diff (`git diff origin/main...HEAD`) for: (1) a Privy DID resolving to the WRONG or MULTIPLE
  tenants, or membership not actually enforced; (2) a workflow allow-list bypass, a disallowed/cross-tenant
  POST that still dispatches, or status (pending/disabled) not enforced at resolveTenant/tenants-me;
  (3) a secret_prefix injection (a tenant row pointing at another tenant's/foreign env), a stale-cache
  authz hole, or a raw engine_* read that escaped scoped-db. Then a SERIAL harden pass fixes confirmed
  holes, extends `scripts/check-scoped-db.sh` if needed, re-runs the full suite, commits.

PHASE 4 — push `feat/m2-tenancy-runtime`; open PR (base `main`) titled
  "PR2: Tier-2 tenancy runtime (backend)". Body = T1–T9 summary + the test matrix + the membership/
  allow-list/secret_prefix decisions + "engine_tenants is now the single source of truth; SPA Privy
  wiring follows in PR2b." Report the PR URL.
```

## 8. Constraints / definition of done

- Do **NOT** touch `apps/web/**` (that's PR2b). Do not weaken or delete any existing test. No secrets in code/commits (`.env.local` is gitignored; never read it into a file). Each phase commits with the identity in §1.
- **Done when:** `pnpm typecheck` clean · `pnpm test` all-green (331 prior + new, pricing-chain still skips) · `pnpm check:scoped` OK · `pnpm build` clean · ISOLATION ★ + M1 REGRESSION ★ green · PR open against `main` with CI green.
- If any phase can't reach green or the M1 regression breaks, STOP and report — do not stack broken commits.
