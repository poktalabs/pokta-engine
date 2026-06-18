# PR2b — SPA Tenancy Live-Wiring (FRONTEND) — Implementation Plan

> Self-contained build spec for an ultracode multi-agent workflow run on a clean context.
> The backend half (the proven registry runtime) shipped in **PR2** (`PR2-IMPLEMENTATION-PLAN.md`,
> merged as PR #11). Auth model: `auth-model.md`; contract surface: `contract-gaps.md`.
> Reviewed via `/plan-eng-review` + Codex outside-voice (2026-06-09); findings folded in below.
> This file has everything needed to BUILD PR2b; you should not need to rediscover anything.

---

## 0. Mission

Wire the customer-workspace SPA to the **proven PR2 backend** so that:
1. A real **Privy login gates the workspace** (B2B console — no wallet, no wagmi).
2. The browser carries a **Privy JWT and nothing else** — never `X-Service-Key`.
3. The **active tenant comes from `GET /v1/tenants/me`** (server truth), not a client-trusted URL
   segment + hardcoded config. The `/:tenant` segment is **display/deep-link only** (kept, renamed
   `mipase→mi-pase`, redirect-on-mismatch as anti-spoof — per the locked single-tenant seam decision).
4. **401s trigger one clean re-auth** (no retry/re-auth loop), distinct from the two 403 approval codes
   and from `TENANT_UNKNOWN` (also 403, but routed to an access-denied screen).
5. The **`mipase → mi-pase` canonical id rename** lands across routes, config, and mocks.

Plus the enabling pieces: **stand up the SPA test harness** (vitest jsdom project + RTL + a shared
`renderWithProviders`/Privy-mock utility — none exist today) and a **one-task backend delta** (B1:
env-seed Privy member DIDs into `engine_tenants.members[]` + reconcile the leftover `PRIVY_TENANT_MAP`).

**Scope (locked by review):** auth + tenant identity only. `GET /v1/tenants/me` goes real; **all other
workspace surfaces (approvals/runs/workflows/integrations/reports) stay on the mock registry** — real
data-wiring is a later PR (M2 P5b). Do not pull it forward.

This is security/auth work. Build it like PR2: a serial spine (incl. the shared test harness), then
parallel disjoint tests, then an adversarial browser-auth panel, then the PR. The server is the
authorization boundary; the client is never trusted for tenant identity. Fail closed.

## 1. Repo + environment (ground truth)

- **Repo (cd here for every command):** `/Users/mel/workspaces/poktalabs/projects/godinez-ai/godin-engine/code/godin-engine-v0.1`
- **Branch:** create `feat/m2b-spa-tenancy` off **`origin/main` once PR2 (#11) is merged** (so the
  backend registry + the backend test baseline are present). If #11 is not yet merged, base on
  `origin/feat/m2-tenancy-runtime` and rebase onto `main` before opening the PR. Do NOT base on M1.
- **Stack:** pnpm 10.26.1, Node 22, strict TS, **turbo** (build/typecheck), root **vitest 2.1.8** (tests).
  SPA: **React 19, react-router-dom 7.1, @tanstack/react-query 5.64, @privy-io/react-auth (lockfile
  resolves `3.29.2`)**, tailwind 4, sonner. Monorepo: `apps/{engine-api,worker,web}`, `packages/*`.
- **Commit identity (every commit):** `git -c user.name="troopdegen" -c user.email="mel@innvertir.com"`.
  Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Verify commands:** `pnpm typecheck` (turbo) · `pnpm test` (vitest, root) · `pnpm check:scoped`
  (tenant-isolation grep gate) · `pnpm build` (turbo). Web build today is `tsc --noEmit && vite build`.
- **GREEN BAR (reframed per review):** the invariant is **"every existing backend test file still
  executes in the node project and passes"** (the worker `pricing-chain.integration.test.ts` SKIPS its
  body without dev Postgres — expected/green). The post-PR2 reference count is ~418 across ~45 files; the
  node/jsdom split may re-bucket reporting, so assert *file execution + pass*, not a magic integer. Add
  web tests in the jsdom project; never delete or weaken a backend test. `main` is branch-protected
  (requires the `test` check) — land via squash-merge PR.

## 2. What already exists (REUSE — do not rebuild)

### Backend (shipped in PR2 — proven; do NOT modify except B1)
- **`apps/engine-api/src/auth.ts`** — verifies Privy `Bearer` JWT into
  `c.set('consumer', { id, identity, mode:'privy' })`; `identity` is the DID. **⚠ still parses
  `PRIVY_TENANT_MAP` (~line 113) to set `consumer.id`** — a leftover that can disagree with the
  `members[]`-resolved tenant. **B1 reconciles this.**
- **`apps/engine-api/src/scoped-db.ts`** — registry-backed `resolveTenant`: privy mode →
  `findTenantByMember(consumer.identity)` (none→`TENANT_UNKNOWN`, multiple→ambiguous→`TENANT_UNKNOWN`),
  requires `status==='active'`. Works the moment `members[]` contains the DID.
- **`apps/engine-api/src/app.ts`** — `GET /v1/tenants/me` returns a `TenantView`; dispatch is allow-list
  gated; reads scope via `scoped-db.forConsumer` (no client `?tenant=`/`?consumer=` trust on real routes).
- **`apps/engine-api/src/seed-tenants.ts`** — seeds `mi-pase`(active)/`vino`(pending). **⚠ on conflict it
  PRESERVES `members` (~line 127).** B1 must MERGE env DIDs additively, never wipe (see §4).
- **`packages/contract/src` `TenantView`** — `{ id, name, status, currency, locale,
  branding:{name:string; badge?:string}, allowedWorkflows:string[], integrations:string[] }`. Note:
  backend `toTenantView` derives `integrations` from the **live integration registry**, not per-tenant
  demo catalogs — so do NOT wire `TenantView.integrations` into the mocked Integrations grid in PR2b.

### Frontend (scaffolded; stubs to fill — the bulk of PR2b)
- **`apps/web/src/lib/api.ts`** — `apiFetch<T>(path, options)`: calls `await getAuthToken()` and sets
  `Authorization: Bearer <token>` when present; **invariant forbids `X-Service-Key`**; 3-retry exp-backoff
  (network/timeout/server-retryable only — never 4xx), 30s timeout, error-envelope → typed `ApiError`,
  FormData support. **⚠ `VITE_USE_MOCKS==='true'` returns `resolveMock` at ~line 94, BEFORE the token
  lookup — a GLOBAL switch.** PR2b adds a **path-aware live set** so `/v1/tenants/me` hits the network
  even under mocks (W3). `getAuthToken()` (~line 57) is a **module-level stub returning `null`** — W3
  bridges it via a registered getter, NOT by calling a hook there (you cannot call `usePrivy()` in a
  module function).
- **`apps/web/src/providers/`** — nesting in `AppProviders.tsx`:
  `<PrivyAuthProvider> → <QueryProvider> → <LanguageProvider> → <TenantProvider> → <AppRouter/>`.
  `PrivyProvider.tsx` = **passthrough stub** (W1). `QueryProvider.tsx` = real (TanStack; **`queries.retry:1`
  at ~line 15** — W5 adds a 401-exclusion predicate; `MutationCache.onError` → sonner toasts).
  `TenantProvider.tsx` = real but **client-only**: `DEFAULT_TENANT='mipase'`, `type TenantId='mipase'|'vino'`,
  hardcoded `TENANTS` record, tenant from the `/:tenant` segment synced in **`AppShell.tsx` (~line 23,
  below the router)** — so TenantProvider (above the router) CANNOT navigate/validate; the redirect guard
  goes at the router level (W4). `data-tenant={id}` drives per-tenant CSS.
- **`apps/web/src/App.tsx`** — `createBrowserRouter`: `/` → **static** `/${DEFAULT_TENANT}/approvals`
  (~line 31 — W4 makes root derive from the server tenant); `/:tenant` → AppShell + children (`approvals`,
  `workflows`, `workflows/:id`, `runs/:id`, `integrations`, `reports`, `reports/:id`, `settings`);
  `*` → NotFound. **No auth gate today** (W2).
- **`apps/web/src/mocks/`** — registry (NOT MSW): `registerMock`/`resolveMock`, active when
  `VITE_USE_MOCKS==='true'`. **⚠ `mocks/index.ts` imports only `./approvals` (~line 10); runs/workflows/
  integrations/reports are commented out** — those pages call `apiFetch` and will THROW under mock mode
  once reachable post-login. W6 wires the existing fixture modules. Mock handlers scope demo data by
  `?tenant=` — that param STAYS for PR2b (mocked surfaces); do not strip it.
- **`apps/web` env** — `.env.example` checked in (`VITE_PRIVY_APP_ID=cmq5udlfk002z0dl5je0lal19`,
  `VITE_API_URL`, `VITE_USE_MOCKS`); `.env.local` gitignored. Vite proxies `/v1 → :8787`.
- **`apps/web/package.json`** scripts: `dev/build/start/preview/typecheck` — **NO `test`**; **no
  vitest/jsdom/@testing-library** (only `@playwright/test` 1.58). W0 adds the unit harness.

### The 60 `mipase` occurrences (W6 rename targets)
`TenantProvider.tsx` (type `TenantId`, `DEFAULT_TENANT`, `TENANTS` keys/fields, `isTenantId` ≈10); mocks
(`workflows/approvals/approvals.batch/runs/settings/reports/integrations.ts` ≈40 fixture/id strings);
comments in `Approvals/AppShell/WorkflowRow/RunHistoryTable/RunDetailHeader/BatchApprovalRenderer` (≈8).
Route examples `/mipase/approvals`.

## 3. Locked decisions (from `auth-model.md`, PR2 trail, + this review)

1. **Privy JWT only.** SPA carries a Privy access token, nothing else. `X-Service-Key` never in the
   browser — the `api.ts` invariant stays.
2. **Server is the tenant authority.** Active tenant = `GET /v1/tenants/me`. The `/:tenant` segment is
   display + deep-link only. Data is server-scoped regardless of the URL.
3. **`/:tenant` kept + renamed + redirect (anti-spoof, defense-in-depth).** Rename `mipase→mi-pase`. A
   segment ≠ the server tenant id → **router-level guard redirects** to the server tenant's URL. Real
   boundary is server scoping (a forged segment cannot leak another tenant's data); redirect is URL hygiene.
4. **Fail closed on unknown principal.** A DID in no `members[]` → `/tenants/me` 403 `TENANT_UNKNOWN` →
   the SPA renders a **dedicated access-denied screen** (intercepted at the tenant query/gate, NOT the
   generic toast/refetch path), never a default/other tenant.
5. **B2B console.** Real `<PrivyProvider>` with embedded-wallet auto-create disabled, **no wagmi**.
   Config shape is SDK-3.29-specific (`embeddedWallets.ethereum`/`.solana`, not `.createOnLogin`) — W1
   binds to the installed types.
6. **Member DIDs are ops-owned, env-seeded, ADDITIVE.** Seed reads `${secretPrefix}_MEMBER_DIDS` and
   **merges (union, dedupe) into `members[]`; never wipes; empty/unset env = no-op** (preserves the
   existing on-conflict behavior; avoids a deploy-time lockout). No DIDs in source/commits.
7. **401 vs 403 by `error.code`.** `UNAUTHENTICATED`(401) → one silent token refresh + retry; still 401 →
   logout to login screen; never loop (excluded from both `apiFetch` retry and the React Query retry
   predicate). `APPROVAL_REQUIRED`/`APPROVAL_DENIED`(403) → branch on code. `TENANT_UNKNOWN`(403) →
   access-denied screen.
8. **Canonical id `mi-pase`.** Stale `/mipase/*` deep links redirect (or 404) cleanly.
9. **Auth-only data surfaces.** Only `/v1/tenants/me` is live (via the path-aware split). Every other
   surface stays mocked; `?tenant=` stays on mock calls; `TenantView.integrations` is NOT wired into the
   mocked Integrations grid this PR.

## 4. Backend delta (B1 — the only backend change)

Two tightly-coupled auth-path fixes:

**(a) Env-seed member DIDs, additively.** In `apps/engine-api/src/seed-tenants.ts`, for each tenant read
`process.env[`${secretPrefix}_MEMBER_DIDS`]`, split on comma, trim, drop empties, and **union** into the
row's `members` (dedupe). Keep the existing on-conflict member-preservation: env DIDs are ADDED, never
used to wipe. Unset/empty env → no change.

**(b) Reconcile `PRIVY_TENANT_MAP`.** `auth.ts` (~line 113) still parses `PRIVY_TENANT_MAP` to set the
privy `consumer.id`, which can disagree with the `members[]`-resolved tenant (split-brain). Make the
privy path consistent: the tenant is resolved ONLY via `findTenantByMember(identity)`; remove the
`PRIVY_TENANT_MAP`→`consumer.id` mapping (or, if a fast deploy seam is wanted, keep it parsed but assert
it agrees with the resolved tenant and reject on mismatch). Document the chosen posture in code.

**Acceptance:** `MIPASE_MEMBER_DIDS="did:privy:abc,did:privy:def"` → mi-pase `members` gains both
(union, no dupes, existing preserved); unset → `members` unchanged; a seeded DID → `resolveTenant` (privy)
→ mi-pase **active**; a DID in no list → `TENANT_UNKNOWN`. `PRIVY_TENANT_MAP` unset / matching / mismatching
all behave correctly (mismatch never silently mis-scopes). No DID literal in source/commits;
`.env.example` carries a placeholder.

## 5. Tasks (acceptance criteria per task)

- **W0 — SPA test harness + shared utility (FOUNDATION, spine task 1).** (i) Add `vitest.workspace.ts`
  (`defineWorkspace`) with a **node project** (`include: ['**/*.test.ts']`, `exclude: ['**/node_modules/**',
  '**/dist/**', 'apps/web/**']`, `environment:'node'` — every existing backend test file still runs here)
  and a **jsdom project** (`apps/web/**/*.test.{ts,tsx}`, `environment:'jsdom'`, setup file). Keep the
  existing `vitest.config.ts` semantics inside the node project. Add devDeps (`jsdom`,
  `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`) + a `test` script
  to `apps/web/package.json`. (ii) Build the **shared test utility** `apps/web/src/test/`:
  `renderWithProviders` (wraps the real provider tree with a fresh QueryClient), a **Privy mock**
  (authenticated/unauthenticated/ready states + `getAccessToken`), a **mock-registry reset** between tests,
  and a **path-aware fetch helper** (drive `/tenants/me` live vs registry for mocked paths). ✅ `pnpm test`
  runs all backend files in node + ≥1 jsdom smoke test; `renderWithProviders` renders a trivial component.
- **B1 — env-seed members (additive) + PRIVY_TENANT_MAP reconcile.** Per §4. ✅ §4 acceptance.
- **W1 — real PrivyProvider.** Fill `PrivyProvider.tsx` with `@privy-io/react-auth` `<PrivyProvider
  appId={import.meta.env.VITE_PRIVY_APP_ID} config={…}>`, B2B (no auto-wallet, no wagmi). Bind `config` to
  the **installed 3.29 types** (`embeddedWallets.ethereum`/`.solana` createOnLogin off — verify against
  `node_modules/@privy-io/react-auth` types; do not guess). Stays outermost. ✅ renders; token readable below.
- **W2 — login gate (inside `<PrivyProvider>`, above `QueryProvider`).** In `PrivyAuthProvider`, render
  `<PrivyProvider><AuthGate>{children}</AuthGate></PrivyProvider>`. `AuthGate` uses Privy `ready`
  (loading state) / `authenticated` (login screen vs pass-through). Gating above QueryProvider guarantees
  **no query mounts before auth**. ✅ LOGIN-GATE tests.
- **W3 — getAuthToken bridge + path-aware live split.** Add a module-level token-getter registry in/near
  `api.ts` (e.g. `setAuthTokenGetter(fn)` / `getAuthToken()` calls the registered fn); a small component
  under `<PrivyProvider>` registers `getAccessToken` on mount. Do NOT touch the Bearer header block. Add a
  `LIVE_PATHS` set (contains `/v1/tenants/me`) so `apiFetch` bypasses `resolveMock` for live paths even
  when `VITE_USE_MOCKS==='true'`. ✅ TOKEN tests (a live-path request carries `Authorization: Bearer`, never
  `X-Service-Key`; mocked paths still resolve via registry).
- **W4 — TenantProvider ← `/v1/tenants/me` + router-level tenant guard + server-driven root.** TenantProvider
  fetches `/v1/tenants/me` (cached React Query, `staleTime`; import `TenantView` from `@pokta-engine/contract`)
  and exposes server branding/currency/locale/`allowedWorkflows`; **delete the hardcoded `TENANTS` record**.
  Root `/` redirect derives from the server tenant id (wait for `/tenants/me`), not a static default. Add a
  **router-level guard under `/:tenant`** (in/around `AppShell`) that redirects when the segment ≠ the
  server tenant id, and intercepts a `TENANT_UNKNOWN` (403) tenant-query error into the **access-denied
  screen**. ✅ TENANT-FETCH + SPOOF ★ + ISOLATION ★ tests.
- **W5 — 401 classification + loop suppression (Query + apiFetch).** Add a React Query `retry` predicate
  that does NOT retry when `error instanceof ApiError && error.code==='UNAUTHENTICATED'`; on 401, run a
  **single-flight** token refresh + one retry, then logout to the login screen if still 401. 401 ≠ the two
  403 approval codes ≠ `TENANT_UNKNOWN`. ✅ 401-LOOP ★ tests.
- **W6 — `mipase → mi-pase` rename + wire mock fixtures.** Rename across `TenantId`, `DEFAULT_TENANT`,
  `TENANTS`/`isTenantId`, route segments, any localStorage key, all mock fixtures/comments. **Uncomment/
  wire the existing fixture modules in `mocks/index.ts`** so every reachable page resolves under mock mode.
  Stale `/mipase/*` redirects or 404s cleanly. ✅ RENAME tests; no hyphenless `mipase` in app code paths.
- **W7 — tests.** See §6.

## 6. Test matrix (SPA jsdom via `renderWithProviders` + Privy mock unless marked (B); mock registry for
non-live paths; `/tenants/me` driven through the path-aware helper; no real PG)

```
HARNESS       renderWithProviders mounts a component in jsdom and renders; all existing backend test
              files still execute in the node project and pass
LOGIN-GATE    Privy not ready → loading; unauthenticated → login screen with NO query mounted/fired
              (assert at the query/getAuthToken layer, not the network — mocks bypass network); authed → workspace
TOKEN         a LIVE_PATH request (/v1/tenants/me) carries `Authorization: Bearer <jwt>` and NEVER an
              X-Service-Key header (assert absent); mocked paths still resolve via the registry
TENANT-FETCH  TenantProvider hydrates from GET /v1/tenants/me (TenantView); branding/currency/locale/
              allowedWorkflows come from the server payload; the hardcoded TENANTS record is gone
SPOOF ★       URL /:tenant ≠ server tenant id → router guard redirects to the server tenant; a hand-edited
              segment never surfaces another tenant's data (server scoping holds even pre-redirect)
401-LOOP ★    a 401 (UNAUTHENTICATED) → ONE silent refresh + retry; still 401 → logout (no loop); the
              React Query retry predicate does NOT retry UNAUTHENTICATED; 401 distinguished from the
              two 403 approval codes AND from TENANT_UNKNOWN by error.code
ISOLATION ★   a Privy DID in NO members[] → /tenants/me 403 TENANT_UNKNOWN → dedicated access-denied
              screen (intercepted at the tenant query/gate), never a default/other tenant
RENAME        no hyphenless 'mipase' in app code paths; routes/config/mocks use 'mi-pase'; a /mipase/*
              deep link redirects or 404s cleanly; every reachable page resolves under mock mode (fixtures wired)
SEED-DID (B)  members[] gains env DIDs additively (union, dedupe, existing preserved); empty env = no-op;
              seeded DID → resolveTenant → mi-pase active; PRIVY_TENANT_MAP unset/match/mismatch all correct
```

★ = mandatory security regression: **SPOOF**, **401-LOOP**, **ISOLATION**. Backend isolation + M1
regression suites stay green in the node project — do not weaken them to fit the jsdom split.

## 7. Orchestration (how to run the ultracode workflow)

Mirror PR2; SPA-shaped. The spine owns the shared test harness so Phase 2 writers don't each re-invent
(and conflict on) `renderWithProviders` / the Privy mock / the path-aware fetch.

```
PHASE 1 — SPINE (STRICTLY SERIAL, one agent, all production code + shared test harness)
  W0 (vitest workspace + renderWithProviders/Privy-mock/path-aware-fetch/registry-reset) → B1 (seed+auth)
  → W1 (Privy) → W2 (gate) → W3 (token bridge + LIVE_PATHS) → W4 (tenant fetch + router guard + root) →
  W5 (401) → W6 (rename + wire fixtures). `pnpm typecheck` green after each; a jsdom smoke test green; all
  backend test files still pass in node. One agent owns the provider/auth/query/router path (tightly
  coupled) + the harness = low merge risk. Commit the spine.

PHASE 2 — TESTS (PARALLEL: each agent writes ONE disjoint web test file, importing the spine's
            renderWithProviders + Privy mock; no installs, no git, no non-test edits)
  (a) login-gate + token        → login-gate.test.tsx        (LOGIN-GATE + TOKEN)
  (b) tenant fetch + spoof ★     → tenant-provider.test.tsx   (TENANT-FETCH + SPOOF ★)
  (c) 401 loop ★                 → reauth.test.tsx            (401-LOOP ★)
  (d) isolation ★ + rename       → access-denied.test.tsx + tenant-rename.test.tsx (ISOLATION ★ + RENAME)
  (e) B1 seed + PRIVY_TENANT_MAP → extend seed-tenants test   (SEED-DID (B), node project)
  Then a SERIAL integrator: full `pnpm test` (node backend + jsdom web) + `pnpm typecheck` +
  `pnpm check:scoped` + web build (`tsc --noEmit && vite build`); fix source if a test exposed a real bug
  (never weaken a security assertion); commit.

PHASE 3 — ADVERSARIAL PANEL (PARALLEL, 3 read-only skeptics; default to "found a hole")
  `git diff origin/main...HEAD` for: (1) Privy token / machine secret leaking — an X-Service-Key header,
  the JWT logged/persisted, a LIVE_PATH widened, or a /v1 call before auth; (2) tenant spoofing — a
  hand-edited /:tenant or stale state deciding rendered data instead of the server, root redirect trusting
  a static default, or access-denied falling back to a default tenant; (3) a 401 re-auth/retry loop, 401
  vs 403 (TENANT_UNKNOWN/approval) mis-classification, or a members[]-wipe / PRIVY_TENANT_MAP split-brain
  in B1. Then a SERIAL harden pass fixes confirmed holes, adds regression tests, re-runs the full suite, commits.

PHASE 4 — push `feat/m2b-spa-tenancy`; open PR (base `main`) titled
  "PR2b: SPA tenancy live-wiring (Privy + /tenants/me)". Body = W0–W7 + B1 summary + the §6 test matrix +
  the Privy-JWT-only / server-is-tenant-authority / fail-closed / auth-only-surfaces decisions + "the SPA
  now derives tenancy from the PR2 backend; engine_tenants stays the single source of truth." Report the PR URL.
```

## 8. Constraints / definition of done

- Do **NOT** modify the PR2 backend except **B1** (member-DID seeding + `PRIVY_TENANT_MAP` reconcile). Do
  not weaken or delete any existing test. **No secrets in code/commits** — Privy DIDs and app secrets are
  env-only (`.env.example` carries placeholders, never real DIDs).
- The root vitest **must run both projects** (node backend + jsdom web) under a single `pnpm test`; the
  jsdom project must not flip backend tests' environment, and the node project must exclude `apps/web`.
- **Done when:** `pnpm typecheck` clean · `pnpm test` all-green (every backend test file passes in node +
  new web tests in jsdom; pricing-chain still skips) · `pnpm check:scoped` OK · `pnpm build` clean ·
  SPOOF ★ + 401-LOOP ★ + ISOLATION ★ green · PR open against `main` with CI green.
- If any phase can't reach green or a ★ regression breaks, **STOP and report** — do not stack broken commits.

## 9. Open items to confirm at build time (small; not blockers)

- **Privy 3.29 `config` exact shape** — W1 binds to the installed `@privy-io/react-auth@3.29.2` types
  (`embeddedWallets.ethereum`/`.solana` createOnLogin off, no wagmi); the *intent* is locked.
- **`PRIVY_TENANT_MAP` posture** — §4(b) prefers removing the map→`consumer.id` path; if ops wants to keep
  it as a seam, keep it parsed but assert-agreement-or-reject. The build agent picks the cleaner of the two
  that keeps the privy path single-source (`members[]`).
- **`members[]` semantics** — locked to ADDITIVE/never-wipe (decision §3.6). If a future PR needs DID
  removal, that's an explicit env-authoritative change, flagged separately.

---

## Test coverage map (from eng review)

```
CODE PATHS (PR2b)                                       USER FLOWS
[+] auth bridge (api.ts + PrivyProvider)                [+] First login
  ├── setAuthTokenGetter / getAuthToken                   ├── [PLAN ★★★] ready→login→authed — login-gate.test.tsx
  │   ├── [PLAN] registered getter returns token          ├── [PLAN ★★★] Bearer on /tenants/me — login-gate.test.tsx
  │   └── [PLAN] null before registration → no header     └── [PLAN ★★] no query mounts pre-auth — login-gate.test.tsx
  └── LIVE_PATHS split (/tenants/me live vs mock)       [+] Tenant resolution
[+] TenantProvider + router guard                        ├── [PLAN ★★★] hydrate from /tenants/me — tenant-provider.test.tsx
  ├── fetch /tenants/me (cached query)                    ├── [PLAN ★★★] spoof /:tenant → redirect — tenant-provider.test.tsx
  │   ├── [PLAN ★★★] success → TenantView                 └── [PLAN ★★★] TENANT_UNKNOWN → access-denied — access-denied.test.tsx
  │   ├── [PLAN ★★★] 403 TENANT_UNKNOWN → access-denied [+] Session expiry
  │   └── [PLAN ★★] segment≠server → redirect             ├── [PLAN ★★★] 401→refresh→retry ok — reauth.test.tsx
[+] 401 handling (QueryProvider + apiFetch)              └── [PLAN ★★★] 401→refresh→still 401→logout — reauth.test.tsx
  ├── retry predicate excludes UNAUTHENTICATED          [+] Rename / mock reachability
  └── single-flight refresh → retry → logout             ├── [PLAN ★★] no hyphenless mipase — tenant-rename.test.tsx
[+] B1 seed (engine, node project)                       └── [PLAN ★★] every page resolves under mocks — tenant-rename.test.tsx
  ├── [PLAN ★★★] env DIDs union, no wipe, empty=no-op
  └── [PLAN ★★★] PRIVY_TENANT_MAP unset/match/mismatch

COVERAGE: every PR2b code path has a planned test. 3 ★ security regressions (SPOOF, 401-LOOP, ISOLATION).
QUALITY: ★★★ on all auth/tenant/security paths; ★★ on rename/reachability. No GAP left unplanned.
```

**Failure modes (each has a planned test + error handling + a visible state — no silent-failure critical gaps):**
- Privy SDK init slow → `ready=false` loading state (not a login flash). Test: LOGIN-GATE.
- Token expired mid-session → 401 → single refresh+retry, else logout. Test: 401-LOOP ★. Visible: re-login.
- DID not provisioned → 403 `TENANT_UNKNOWN` → access-denied screen. Test: ISOLATION ★. Visible: access-denied.
- Forged `/:tenant` segment → router guard redirect; data server-scoped regardless. Test: SPOOF ★.
- Empty `MIPASE_MEMBER_DIDS` on deploy → no-op (members preserved), NOT a wipe→lockout. Test: SEED-DID (B).
- Reachable page with no mock fixture → would throw; W6 wires fixtures. Test: RENAME (reachability).

## Implementation Tasks
Synthesized from this review's findings (Codex outside-voice + eng review). All P1 items are folded into
§5 of the plan; this list is the autoplan-aggregatable view.

- [ ] **T1 (P1, human ~3h / CC ~20min)** — web-auth — Bridge `getAuthToken` via a module-level registered getter (not a hook). Files: `apps/web/src/lib/api.ts`, `providers/PrivyProvider.tsx`. Verify: TOKEN test.
- [ ] **T2 (P1, human ~2h / CC ~15min)** — web-auth — Path-aware `LIVE_PATHS` split so `/tenants/me` is live under `VITE_USE_MOCKS`. Files: `lib/api.ts`. Verify: TOKEN test.
- [ ] **T3 (P1, human ~2h / CC ~15min)** — web-auth — 401 retry predicate in QueryProvider + single-flight reauth/logout. Files: `providers/QueryProvider.tsx`, `lib/api.ts`. Verify: 401-LOOP ★.
- [ ] **T4 (P1, human ~3h / CC ~20min)** — web-router — Router-level `/:tenant` guard: validate + redirect + access-denied interception. Files: `App.tsx`, `components/shell/AppShell.tsx`, `providers/TenantProvider.tsx`. Verify: SPOOF ★ + ISOLATION ★.
- [ ] **T5 (P1, human ~30min / CC ~5min)** — web-router — Root `/` redirect derives from server tenant, not static `DEFAULT_TENANT`. Files: `App.tsx`. Verify: TENANT-FETCH.
- [ ] **T6 (P1, human ~2h / CC ~20min)** — engine-auth — B1: additive member-DID merge + `PRIVY_TENANT_MAP` reconcile. Files: `seed-tenants.ts`, `auth.ts`. Verify: SEED-DID (B).
- [ ] **T7 (P1, human ~2h / CC ~20min)** — web-test — `vitest.workspace.ts` node+jsdom split + shared `renderWithProviders`/Privy-mock/path-aware-fetch. Files: `vitest.workspace.ts`, `apps/web/src/test/`, `apps/web/package.json`. Verify: HARNESS.
- [ ] **T8 (P2, human ~1h / CC ~10min)** — web-mocks — Wire commented fixture modules so reachable pages resolve. Files: `mocks/index.ts`. Verify: RENAME (reachability).
- [ ] **T9 (P1, human ~1h / CC ~10min)** — web-privy — Bind PrivyProvider config to installed 3.29.2 types. Files: `providers/PrivyProvider.tsx`. Verify: typecheck + W1.

## Worktree parallelization strategy

PR2b's production code is a **tightly-coupled provider/auth/query/router change** — the spine is
**sequential, no worktree parallelization** (W0→B1→W1→…→W6 share the provider tree + token flow).
The only safe parallelism is **after** the spine: Phase 2 test writers on disjoint files importing the
shared `renderWithProviders`. B1 (engine, node project) is the one independent lane and may run alongside
the SPA spine if isolated, but the plan keeps it in-spine for one-owner simplicity.

| Lane | Modules | Depends on |
|------|---------|-----------|
| Spine | `apps/web/{lib,providers,components,mocks}`, `App.tsx`, `vitest.workspace.ts`, `apps/engine-api` (B1) | — |
| Tests (×5 parallel) | `apps/web/src/**/*.test.tsx`, `seed-tenants` test | Spine |
| Harden | confirmed-hole fixes | Tests |

Execution: Spine (serial) → 5 test writers (parallel) → integrator (serial) → panel (parallel) → harden
(serial) → PR. This is exactly the §7 orchestration.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run (scope locked in PR2 trail) |
| Outside Voice | `/codex` (codex exec) | Independent 2nd opinion | 1 | issues_found | ~18 code-grounded findings, all folded into plan v2 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 18 issues raised + resolved; 2 scope forks decided (keep `/:tenant`, auth-only surfaces); 0 unresolved; 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not run (auth wiring, minimal new UI: login + access-denied) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **CODEX:** read the lockfile + `seed-tenants.ts`/`auth.ts`/`QueryProvider`/`AppShell`/`mocks/index.ts`; surfaced the non-buildable token bridge, the global-mock auth bypass, the Privy 3.29 config shape, the TanStack-Query 401 loop, the router-vs-TenantProvider navigation gap, the static-default tenant leak, the seed members-preserve vs env-wipe conflict, the lingering `PRIVY_TENANT_MAP`, and the over-orchestration of parallel test agents. All adopted.
- **CROSS-MODEL:** no tension — Codex deepened the eng-review findings rather than contradicting them; consensus on every point. Both agree the spine must own the shared test harness.
- **UNRESOLVED:** 0.
- **VERDICT:** ENG CLEARED (outside-voice consensus) — PR2b ready to run as one ultracode workflow. One ops judgment call flagged (B1 members additive-vs-authoritative; defaulted to additive/never-wipe, user can override).
