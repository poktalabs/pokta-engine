# PR1 (Tier-1 security rails) — ultracode prompt

**How to run:** clear context, then paste the fenced block below as your message (it starts with
`ultracode`). The orchestrator will author a Workflow that runs the serial security spine first, then
fans out tests + an adversarial isolation panel, then opens the PR.

**Source of truth:** the full plan is `docs/feature-requests/customer-dashboard/MVP-tenancy-decision-and-plan.md`
(PR1 = T1-T4 under "Implementation Tasks"). This prompt is a self-contained restatement.

**Env status (already set):**
- Engine `.env.local` (gitignored) now has `PRIVY_APP_ID` + `PRIVY_APP_SECRET` (server-side JWT verify).
- `web/.env` keeps only the public `VITE_PRIVY_APP_ID` (the secret was removed from there).
- Both documented in root `.env.example`. **Railway engine-api still needs `PRIVY_APP_ID` + `PRIVY_APP_SECRET` set** before any deployed Privy verification works.
- Loader caveat: engine-api/worker read `process.env` directly (no dotenv). Locally, run with `.env.local`
  loaded (your existing run method, or `--env-file-if-exists=.env.local`). The workflow's T1 should ensure
  the dev script loads it so the auth tests can read the Privy vars.

---

```
ultracode execute PR1 (Tier 1 security rails) from docs/feature-requests/customer-dashboard/MVP-tenancy-decision-and-plan.md, in the godin-engine repo at code/godin-engine-v0.1.

BRANCH: create feat/m1.5-tenancy-rails off origin/main (PR1 is backend-only, independently deployable — do NOT base it on the M2 SPA branch feat/m2-workspace-spa). Commit per phase. At the end, push and open a PR with base main.

ENV (already set in .env.local; engine reads process.env directly — no dotenv): PRIVY_APP_ID and PRIVY_APP_SECRET are the server-side Privy verification vars. The browser uses the public VITE_PRIVY_APP_ID. Verify Privy JWTs with @privy-io/server-auth (PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET).verifyAuthToken), or the JWKS endpoint for app PRIVY_APP_ID — never hand-roll. In T1, make the engine-api dev script load .env.local (e.g. tsx --env-file-if-exists=.env.local) so the auth tests can read these; do NOT add --env-file to the `start` script (Railway injects env directly and has no .env.local). Unit-test the JWT path against a test key; real Privy creds are wired via env.

ORCHESTRATION (respect this serial/parallel structure exactly):

PHASE 1 — SECURITY SPINE (STRICTLY SERIAL, one agent, security-critical, no concurrent edits to the auth path). Implement T1→T2→T3 in order, leaving the tree compiling (pnpm typecheck) after each:
  T1 — One Hono auth middleware in engine-api/src/auth.ts resolving EITHER an X-Service-Key (machine: parse "consumer:key" → keep the consumerId, don't discard it like the current auth.ts:20) OR a Privy JWT (browser: verify via PRIVY_APP_ID/PRIVY_APP_SECRET) into a single c.set('consumer', {id, identity, mode}). Fail CLOSED on missing/invalid/expired token or unreachable verification (401). Routes must read ctx, never body.consumer_id, for identity.
  T2 — New engine-api/src/scoped-db.ts exporting forConsumer(db, consumerId): the ONLY path routes use to read/write engine_runs, engine_approvals, engine_workflow_state. Route every query in index.ts (dispatch, GET /v1/runs, GET /v1/runs/:id, GET /v1/approvals, POST approve, POST reject) through it. Cross-tenant access returns 404 (not 403). Bind decided_by to ctx.identity, not a body string (index.ts:154). Structure the dispatch so a consumer with no tenant record can be rejected (TENANT_UNKNOWN) once the engine_tenants registry lands in PR2 — for PR1 accept the existing mi-pase consumer.
  T3 — Lock /demo, /dashboard, /console (currently mounted public pre-/v1-auth at index.ts:34-40): put them behind an operator key/role, or stop serving them. They must NOT be reachable unauthenticated and must NOT expose cross-tenant rollups.
  After T3: pnpm test must still pass (M1 mi-pase regression stays green). Commit the spine.

PHASE 2 — TESTS (PARALLEL: each agent writes ONE disjoint test file; no installs, no git, no edits to non-test files):
  (a) auth tests — no key/JWT→401; valid service-key→consumer; Privy JWT valid/expired/wrong-aud/bad-sig; verification-unreachable→401 (fail-closed).
  (b) cross-tenant ISOLATION — tenant A cannot: GET B's /runs/:id (404), see B in /runs, GET/approve/reject B's approval (404).
  (c) scoped-db UNIT — every accessor injects the consumer filter; a raw unscoped read is unreachable.
  (d) M1 REGRESSION — existing mi-pase chained pricing flow still green end-to-end.
  Then a SERIAL integrator runs the full suite + typecheck, fixes failures, commits.

PHASE 3 — ADVERSARIAL SECURITY PANEL (PARALLEL, 3 independent skeptics): each hunts the diff for a cross-tenant bypass or auth hole (a route reading engine_* outside forConsumer; identity read from the body; a fail-open path; a public surface still leaking). Default to "found a hole" if uncertain. A SERIAL pass fixes any confirmed real hole, adds a CI grep gate forbidding raw engine_* selects outside scoped-db.ts, re-runs the suite, commits.

PHASE 4 — push feat/m1.5-tenancy-rails; open PR (base main) titled "PR1: Tier-1 multi-tenant security rails", body = T1-T4 summary + the test matrix + "makes the engine safe to expose to a client". Report the PR URL.

CONSTRAINTS: pnpm 10.26.1 / Node 22 / strict TS. Do NOT touch web/ (that's PR2). Do NOT weaken any existing M1 test. No secrets in code or commits. Each phase commits with: git -c user.name="troopdegen" -c user.email="mel@innvertir.com", and the trailer: Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>. If any phase fails to compile or the M1 regression breaks, STOP and report rather than stacking broken commits.
```
