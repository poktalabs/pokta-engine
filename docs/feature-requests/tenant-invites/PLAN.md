# Tenant Invites — Email-Preauthorized First-Login Provisioning — Implementation Plan

> Preload a tenant's users by **verified email** so that, on their FIRST Privy login, their DID is
> automatically bound to the indicated tenant and their workspace + workflows appear. Email is the trust anchor;
> a login URL is NEVER authorization. Reviewed via `/plan-eng-review` + Codex outside-voice (2026-06-11); the
> review reshaped the data model (DB-as-source-of-truth seed, global-unique email, a real members table, claim
> throttling). Decisions D1–D9 locked in §1.

---

## 0. Mission
Today a Privy login whose DID is in no tenant resolves to `TENANT_UNKNOWN` → the SPA shows ACCESS-DENIED. This
feature adds a **preauthorized-email** layer: an operator seeds a list of emails per tenant into a DB table;
on first login the engine reads the user's **Privy-verified** email, matches it against the table, and (if
matched + unclaimed) **binds their DID into that tenant** and records the claim. Later logins resolve straight
through the membership store and never call Privy again. The client (Mi Pase) supplied an email list; this makes
"preload them, they log in, it just works" real and secure.

## 1. Locked decisions (D1–D5 with the user; D6–D9 from the review)
1. **D1 — Storage: a DB table `engine_tenant_invites`.** Durable + auditable (`claimed_by_did`/`claimed_at`).
2. **D2 — Auth gate: Privy-VERIFIED email only.** Match ONLY emails Privy verified (email-OTP login address +
   provider-verified OAuth emails), lowercased/trimmed. Self-asserted/unverified email NEVER matches.
3. **D3 — `/mi-pase` is UX ONLY (revised by review).** A cosmetic branded login screen, selected PRE-AUTH from
   the URL path (login renders before the router — Codex). It passes **nothing** into the claim and is not a
   trust input. (The earlier "tenant hint into claim" idea is DROPPED — see D8.)
4. **D4 — Binding UX: transparent auto-provision.** After login, the SPA auto-calls `POST /v1/tenants/claim`
   (no button); success → refetch `/v1/tenants/me` → workspace. The user sees a brief "setting up your
   workspace" state instead of an access-denied flash.
5. **D5 — Collision: one-time claim, ops reset.** First verified DID to match an invite wins (`claimed`). A
   different DID with the same verified email is DENIED (no rebind); rebinding is a DB ops action (§7 reset).
6. **D6 — Claim abuse: rate-limit + negative cache.** `POST /v1/tenants/claim` is throttled per-DID (reuse the
   `engine_quota_ledger` pattern) AND a "no match" result is cached per-DID so repeat logins don't re-hit Privy.
   Bounds `getUser(did)` to ~once per real user and closes the token-mint flood vector.
7. **D7 — Env is a ONE-TIME bootstrap; the DB is the source of truth (user).** `${secretPrefix}_INVITE_EMAILS`
   seeds the table **insert-only** (`ON CONFLICT DO NOTHING`): a re-deploy never updates, never revokes, never
   treats env-absence as a signal. After bootstrap, invites are managed in the DB (admin API deferred §9; SQL/
   ops script now). **Deprovisioning is a DB op** (§7), never an env side effect — this dissolves the "env
   removal looks like deprovision but isn't" footgun (Codex).
8. **D8 — Drop the tenant hint; global-unique active email (Codex).** A **partial unique index on `email` WHERE
   `status != 'revoked'`** makes one verified email map to exactly ONE tenant, so the email alone determines the
   tenant — no hint, no confused-deputy surface. A multi-row match (should be impossible under the index) fails
   closed.
9. **D9 — Build `engine_tenant_members` NOW (user, over Codex-deferred).** Replace the `engine_tenants.members[]`
   array with a real `(tenant_id, did)` table with **`UNIQUE(did)`** — global DID uniqueness structurally
   prevents a DID landing in two tenants (which would make `resolveTenant` fail closed and lock out a real
   user). Done as a **separate behavior-preserving refactor wave BEFORE the feature** (§7 Wave 0) so we never do
   structural + behavioral change at once.

## 2. Security posture (non-negotiable)
- **Verified-email-only**, fetched SERVER-SIDE via `@privy-io/server-auth` `getUser(did)` (`PRIVY_APP_SECRET`
  is on engine-api). A `getUser` throw / no verified email → `[]` → no match (fail closed). Extract ONLY
  Privy-verified addresses; pin the exact extraction against the SDK `User` type during build.
- **Fail closed + anti-enumeration with IDENTICAL ENVELOPE BODIES (Codex).** Every no-match / collision /
  revoked / inactive-tenant path returns the SAME `TENANT_UNKNOWN` envelope — same code AND same `message`
  (`EngineError.toEnvelope()` exposes `message`, `errors.ts:57`). Tests assert exact envelope equality.
- **Inactive-tenant gate before mutation (Codex).** The FK proves a tenant exists, not that it is `active`.
  Binding into a `pending`/`disabled` tenant must fail BEFORE marking claimed or inserting a member.
- **Atomic claim.** Marking the invite `claimed` AND inserting the member row happen in ONE transaction; a crash
  between them must not lock a user out or leave the invite re-claimable.
- **Email normalization (Codex):** lowercase + trim ONLY (no Gmail dot/plus collapsing — not globally safe). A
  DB `CHECK (email = lower(email))` so ops SQL cannot insert mixed-case/space variants.
- **Tight allowlist (Codex):** `invites.ts` is added to `check:scoped`'s allowlist, but a targeted grep test
  asserts it touches ONLY `engine_tenant_invites` (+ the one `engine_tenant_members` write) — the broad
  allowlist must not hide a raw read of another `engine_*` table.

## 3. Wave 0 — members-table refactor (`feat/tenant-members-table`, behavior-preserving)
Make the change easy before making the easy change. This wave introduces the membership store with NO new
feature behavior; the ★ auth/tenancy regressions prove nothing changed.
- **`engine_tenant_members` (NEW):** `(tenant_id text references engine_tenants(tenant_id) on delete cascade,
  did text not null, source text, created_at timestamptz default now(), PK(tenant_id, did),
  UNIQUE(did))`. The `UNIQUE(did)` is the structural guard (D9). Migration `0005_*`.
- **Data migration:** `insert into engine_tenant_members(tenant_id, did) select tenant_id, unnest(members) ...`
  from the existing `engine_tenants` rows (dedupe).
- **Rewire (`tenants.ts`, allowlisted):** `findTenantByMember(did)` queries the table (by `did`, unique →
  at most one tenant); `addTenantMember(tenantId, did)` / `removeTenantMember(tenantId, did)` write it;
  `seedTenants` member union (`${secretPrefix}_MEMBER_DIDS`) inserts into the table insert-only. **Deprecate +
  drop** the `engine_tenants.members[]` column (and `tenants_members_idx`).
- **★ Regressions stay green:** `privy-split-brain.test.ts`, `isolation.test.ts`, `tenants.test.ts`,
  `tenant-seed.test.ts`, `tenants-me.test.ts` — update fixtures to the table, assert identical resolution
  behavior. No behavior change is the whole point.
- **(Fold) `/v1/tenants/me` split-brain guard (Codex):** apply the same non-empty-`consumer.id`-disagreement
  guard the data routes use (`app.ts` `scopedTenantId`) so a post-claim `/tenants/me` can't succeed while later
  scoped calls fail.

## 4. Wave 1 — invites backend (`feat/tenant-invites-backend`, after Wave 0 merges)
- **`engine_tenant_invites` (NEW):** `(tenant_id text references engine_tenants(tenant_id) on delete cascade,
  email text not null check (email = lower(email)), status inviteStatus not null default 'pending',
  claimed_by_did text null, claimed_at timestamptz null, created_at, updated_at, PK(tenant_id, email))` +
  **partial unique index `on (email) where status != 'revoked'`** (D8). `inviteStatus =
  pgEnum('invite_status', ['pending','claimed','revoked'])`. Migration `0006_*`.
- **Seed (insert-only bootstrap, D7)** in `seed-tenants.ts`: parse `${secretPrefix}_INVITE_EMAILS` (lowercase/
  trim/validate shape), `insert ... on conflict (tenant_id, email) do nothing`. NEVER updates/revokes existing
  rows. Pure `parseInviteEmails` + `validateInviteEmails` exported for tests; `seedTenantInvites()` from
  `main()`.
- **Privy email seam (NEW `privy-user.ts`, injectable like `verifyPrivyToken`):** `resolvePrivyEmails(did) →
  string[]` of Privy-VERIFIED, lowercased emails; default uses `getUser(did)`; throw/none → `[]`.
- **`invites.ts` (NEW; ADD to `check:scoped` allowlist + a targeted same-table-only grep test):**
  - `findInviteForEmails(emails) → invite | undefined` — by the global-unique email (D8); multi-match → fail
    closed (treat as no match).
  - `claimInvite({ email, did }) → { ok, tenantId } | 'collision' | 'inactive' | 'not-found'` — ONE
    transaction: re-read the invite under lock; reject if tenant not `active` (D2/Codex); if `claimed` by THIS
    did → ok (idempotent); if `claimed` by another → `collision`; else mark `claimed` (+`claimed_by_did/at`)
    AND `addTenantMember(tenantId, did)` (the `UNIQUE(did)` makes cross-tenant double-bind structurally
    impossible — catch the constraint violation → `collision`).
- **`POST /v1/tenants/claim` (NEW, `app.ts`)** — Privy-bearer only (service-mode → reject). Flow: throttle +
  negative-cache (D6) → DID already a member → return its `TenantView` (no Privy call) → else
  `resolvePrivyEmails(did)` → `findInviteForEmails` → `claimInvite` → ok → freshly-resolved `TenantView`; any
  failure → the SINGLE generic `TENANT_UNKNOWN` envelope. No raw db in `app.ts` (goes through `invites.ts`/
  `tenants.ts`). Log failures/collisions SERVER-SIDE (ops observability) without leaking to the client.
- **Contract:** reuse `TenantView` as the success body; reuse `TENANT_UNKNOWN`. (No `ClaimRequest` body needed —
  D8 dropped the hint.)
- **Ops deprovision/reset script (`tsx`, DB-driven, D5/D7):** `revoke + remove member` for a (tenant,email):
  set invite `revoked` AND `removeTenantMember` in one tx. This is the real deprovision path; env never does it.

## 5. Wave 2 — SPA (`feat/tenant-invites-spa`, after Wave 1 deploys)
- **Transparent auto-provision in `TenantProvider`:** on `/v1/tenants/me` → `TENANT_UNKNOWN`, fire
  `POST /v1/tenants/claim` ONCE (single-flight); success → invalidate + refetch → `ready`; failure/404 →
  `access-denied` (unchanged terminal). New transient `provisioning` status renders "setting up your workspace".
- **★ CRITICAL no-loop regression (mandatory, no-ask):** a persistent `TENANT_UNKNOWN` must fire claim AT MOST
  once (no loop); a `401 UNAUTHENTICATED` still routes to re-auth/logout and NEVER to claim. Pinned by a test
  mirroring `reauth.test.tsx`.
- **Branded `/mi-pase` login (UX only, D3):** a Mi-Pase-branded `LoginScreen` variant selected PRE-AUTH from
  `window.location` (login renders before the router — Codex). No claim input, no `TenantProvider` coupling.
- **Graceful degradation:** `/claim` absent/404 → current access-denied screen (never white-screen).

## 6. Test matrix (adds the review's gaps)
```
WAVE 0 (node)  ★ findTenantByMember/addTenantMember/seed resolve via engine_tenant_members identically;
  UNIQUE(did) rejects a cross-tenant second bind; data migration moves existing members[]; split-brain guard on
  /tenants/me. ALL existing auth/tenancy ★ regressions green (behavior-preserving).
WAVE 1 (node, hermetic — mock db + injected Privy email seam)
  seed insert-only: new email inserts; existing row UNTOUCHED on re-seed (no update/revoke)  ★ D7
  resolvePrivyEmails: verified-only; getUser throw/none → [] (fail closed); multi-email matches any invited
  findInviteForEmails: global-unique match; multi-row → fail closed
  claimInvite: pending→claimed binds member (one tx); same-did re-claim no-op; other-did → collision  ★
    inactive tenant → rejected BEFORE mutation  ★ ; crash-between-writes leaves consistent state (atomicity)
  POST /claim: match → TenantView; already-member → TenantView no Privy call; over rate-limit → throttled  ★ D6
    no-match/collision/revoked/inactive → IDENTICAL TENANT_UNKNOWN envelope (assert exact equality)  ★ Codex
    unauth → 401; service-mode → rejected
  invites.ts touches ONLY engine_tenant_invites(+member write) — targeted grep test  ★ Codex ; check:scoped green
WAVE 2 (jsdom, live-path fetch stub)
  TENANT_UNKNOWN → claim once → success refetch → workspace (provisioning state)
  claim fails/404 → access-denied (no white-screen)
  ★ CRITICAL: persistent TENANT_UNKNOWN fires claim ONCE (no loop); 401 → re-auth, NEVER claim
  /mi-pase renders branded login pre-auth; no claim input
REGRESS ★ login-gate / reauth / access-denied / tenant-provider / privy-split-brain / isolation stay green
```

## 7. Orchestration (three gated ultracode workflows — P5b pattern)
```
WAVE 0 — members table (feat/tenant-members-table): engine_tenant_members + UNIQUE(did) + data migration →
  rewire findTenantByMember/addTenantMember/seed → drop members[] column → /tenants/me split-brain guard.
  Tests prove identical behavior. PR base main. >>> MERGE + DEPLOY (migrate) before Wave 1. <<<
WAVE 1 — invites backend (feat/tenant-invites-backend): invite table + partial-unique index + insert-only seed →
  privy email seam → invites.ts (find/claim, one tx, inactive gate) → POST /v1/tenants/claim (throttle+neg-cache,
  identical-envelope anti-enum) → ops deprovision script. Adversarial panel: email-spoof/unverified, cross-tenant
  claim, collision rebind, envelope-leak, rate-limit bypass, 401↔claim, allowlist over-broad. PR base main.
  >>> MERGE + DEPLOY + SMOKE-PROBE POST /v1/tenants/claim (401 exists) before Wave 2. <<<
WAVE 2 — SPA (feat/tenant-invites-spa): TenantProvider auto-provision (single-flight, no-loop) → branded
  /mi-pase pre-auth → graceful 404 degrade. Panel: claim-loop / masked-401 / white-screen. PR base main.
```

## 8. Required-output sections
**What already exists (reused, not rebuilt):** membership resolution (`findTenantByMember`/`resolveTenant`),
env-seeded additive members (`envMemberDids` + union), the idempotent env→table seed pattern
(`engine_tenant_integrations`), the injectable Privy verify seam (`auth.ts`), the quota-ledger throttle pattern
(`engine_quota_ledger`, reused for D6), the SPA access-denied/`TenantProvider` flow, `EmptyState`/`ErrorState`.

**NOT in scope (deferred, §9):** admin API for invite CRUD; identity-token email fetch (scale upgrade over
`getUser(did)`); invite expiry / self-serve resend UI; member roster surface; multi-email-per-person policy
beyond "match any verified". Distribution: N/A (no new artifact).

**Failure modes / critical gaps:** atomic-claim crash (→ one tx + test), getUser flood (→ D6 throttle + test),
cross-tenant DID dup (→ D9 UNIQUE + test), claim loop (→ ★ no-loop test). All now have a test AND handling; no
silent critical gap remains.

**Parallelization:** Wave 0 → Wave 1 → Wave 2 are strictly sequential (each depends on the prior's schema +
deploy). WITHIN Wave 1, the seed, privy-seam, and contract changes are independent of `app.ts` until the route
ties them together — minor; not worth separate worktrees. Sequential implementation.

## 9. Explicitly deferred
Admin API (invite CRUD + deprovision UI); identity-token email path (Privy's scale-recommended alternative to
`getUser(did)`); invite expiry + resend/revoke UI; real member identity (name/email/role) beyond DIDs; the
member-roster Settings panel.

## Wave 3 (planned follow-up) — admin invite-management endpoint
Replaces env-seeding + manual SQL as the way to manage the invite list after bootstrap (D7: env is a
one-time bootstrap, the DB is the source of truth). Small, operator-gated, reuses Wave 1 logic.
- **Gate:** `operatorAuth()` (the existing `X-Operator-Key === OPERATOR_KEY` middleware used by `/demo`,
  `/dashboard`, `/console`; fail-closed when `OPERATOR_KEY` unset → 404). NOT a `/v1` tenant route — it is a
  cross-tenant operator surface by design, so its DB module is allowlisted like the other operator surfaces.
- **Routes:**
  - `POST /admin/tenants/:tenantId/invites` `{ email }` → upsert a `pending` invite (lowercase/validate via the
    existing `parseInviteEmails`/`validateInviteEmails`; a `revoked` row for that email reactivates to `pending`).
  - `DELETE /admin/tenants/:tenantId/invites/:email` → deprovision: set the invite `revoked` AND
    `removeTenantMember(tenantId, claimed_by_did)` in one tx (reuse `deprovision-invite.ts` logic).
  - `GET /admin/tenants/:tenantId/invites` → list rows (`pending`/`claimed`/`revoked`) for ops visibility.
- **DB access:** add `addInvite` / `revokeInvite` / `listInvites` to `invites.ts` (already allowlisted + grep-
  pinned to `engine_tenant_invites`); the routes call those + `removeTenantMember`. No new raw db in `app.ts`.
- **Tests:** operator-gate fail-closed (no/!`OPERATOR_KEY` → 404; wrong key → 404); add → row pending; list;
  delete → invite revoked + member removed; reactivate a revoked email. No secret leakage.
- **Why deferred from the core flow:** the env bootstrap + the auto-provision claim (Waves 1–2) deliver the
  client outcome ("preload emails, they log in, it works"); the admin API is operational convenience layered on
  top, kept off the critical path so it doesn't expand the auth-sensitive waves.

## Implementation Tasks
Synthesized from the review. Wave 0 = members table, Wave 1 = invites backend, Wave 2 = SPA, Wave 3 = admin API.
- [ ] **T1 (P1)** — db/engine-api — `engine_tenant_members` table + `UNIQUE(did)` + data migration; rewire
  `findTenantByMember`/`addTenantMember`/`removeTenantMember`/seed; drop `members[]`. Verify: ★ auth regressions green; cross-tenant bind rejected.
- [ ] **T2 (P1)** — engine-api — `/v1/tenants/me` split-brain guard (parity with data routes). Verify: privy-split-brain ★.
- [ ] **T3 (P1)** — db — `engine_tenant_invites` + partial-unique-on-email + `lower(email)` CHECK + migration. Verify: index rejects dup active email.
- [ ] **T4 (P1)** — engine-api — insert-only seed (`MIPASE_INVITE_EMAILS`, `ON CONFLICT DO NOTHING`, never revoke). Verify: re-seed leaves existing rows untouched.
- [ ] **T5 (P1)** — engine-api — `privy-user.ts` `resolvePrivyEmails` (verified-only, injectable, throw→[]). Verify: unit + fail-closed.
- [ ] **T6 (P1)** — engine-api — `invites.ts` find/claim (one tx, inactive gate, collision) + targeted allowlist grep. Verify: atomicity + collision + check:scoped.
- [ ] **T7 (P1)** — engine-api — `POST /v1/tenants/claim` (throttle+neg-cache, identical-envelope anti-enum, idempotent member). Verify: envelope-equality + rate-limit tests.
- [ ] **T8 (P1)** — engine-api — ops deprovision/reset script (revoke + removeTenantMember, one tx). Verify: removes access.
- [ ] **T9 (P1)** — web — `TenantProvider` auto-provision (single-flight, provisioning state) + ★ no-loop/401 regression. Verify: live-path jsdom.
- [ ] **T10 (P2)** — web — branded `/mi-pase` pre-auth login (UX only). Verify: renders, no claim input.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Outside Voice | `/codex` (codex exec) | Independent 2nd opinion | 1 | issues_found | 11 findings → reshaped data model (DB-as-truth, global-unique email, members table, identical envelopes, throttle) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean (reshaped) | 1 arch fork (claim abuse) decided; 6 test gaps added; 1 critical gap (atomicity) closed; 0 unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not run (data/auth; new UI = branded login + provisioning state) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **CODEX:** read `auth.ts`/`scoped-db.ts`/`app.ts`/`AppProviders.tsx`/`App.tsx`/`errors.ts` and surfaced 5 gaps the eng pass missed: ops-reset/env-removal don't touch `members[]` (no real deprovision); no cross-tenant DID uniqueness; duplicate email across tenants; `/mi-pase` hint collides with the pre-router login mount; anti-enumeration needs identical envelope BODIES not just codes. All folded.
- **CROSS-MODEL:** consensus on the `getUser(did)` throttle (both flagged independently → D6). Tension on the member store (Codex: build the table now; eng pass: array+guard) — user chose Codex's table (D9), sequenced as a behavior-preserving Wave 0. Tension on the hint (user originally wanted it; Codex showed it's avoidable + architecturally broken) — user accepted dropping it (D8).
- **DECISIONS:** D6 claim throttle+neg-cache · D7 env = one-time bootstrap, DB is source of truth (insert-only seed; deprovision is a DB op) · D8 drop hint, global-unique active email, `/mi-pase` UX-only · D9 build `engine_tenant_members` now (UNIQUE(did)) as a pre-feature refactor wave.
- **VERDICT:** ENG CLEARED (reshaped) — buildable as three gated waves (members table → invites backend → SPA). Auth-spine blast radius isolated into Wave 0; every review gap has a test + handling.

NO UNRESOLVED DECISIONS
