# Admin Roles — Superadmin + Tenant Admins + Self-Service Invite UI — Implementation Plan

> Add a role hierarchy so a platform **superadmin** manages tenant **admins**, and each tenant's admins
> manage their own **team** (invites, capped at 5) — all from the SPA, JWT-authed, no ongoing env management.
> Builds on the tenant-invites machinery (`engine_tenant_invites` / `engine_tenant_members` / claim flow).
> Decisions D1–D7 locked with the user (2026-06-12). Reviewed via `/plan-eng-review` + codex (see report).

---

## 0. Mission
Today invite management is OPERATOR-KEY-gated (`/admin/*`, PR #24) — a machine secret, CLI/ops only, never
the browser (the SPA is JWT-only). The user wants to manage invites from a UI as **superadmin**
(`dev@poktalabs.com`), assign **per-tenant admins** (e.g. Rodrigo + Héctor for Mi Pase), and let those admins
add up to **5** team emails. That needs a per-user **role** dimension authorized by the Privy JWT (not a shared
key), plus a role-adaptive Settings panel. The operator `/admin/*` API stays as the cross-tenant CLI superadmin
path; this adds the self-service, role-gated surface.

## 1. Locked decisions
1. **D1 — Three roles.** Platform **superadmin** (cross-tenant), tenant **admin** (per-tenant), **member**.
2. **D2 — Role-on-invite.** An invite carries the role to grant on claim (`engine_tenant_invites.role`); claim
   binds the member with that role (`engine_tenant_members.role`). Superadmin grants `admin`; a tenant admin can
   only grant `member`.
3. **D3 — Team cap = 5 SEATS per tenant (user: all members count, no exclusions).** Seats =
   `engine_tenant_members` rows (the tenant's people) PLUS `pending` invites (reserved-but-unclaimed seats); a
   `claimed` invite is NOT double-counted (it already has a member row); `revoked` don't count. **A superadmin
   counts ONLY via their member row** in that tenant (dev@poktalabs IS a mi-pase member → counts); a
   platform-only superadmin with no member row does NOT consume every tenant's seat (Codex#11 — seats are read
   from member rows + pending invites, never from `engine_superadmins`). `TEAM_FULL` (409) when seats ≥ 5 at
   INVITE time. **Race-safe via a per-tenant advisory lock** (`pg_advisory_xact_lock` with a fixed namespace key
   + a stable per-tenant key, not a bare `hashtext` that can collide — Codex#9) around count+insert, NOT
   check-then-insert (two concurrent adds at 4 would both insert → 6). **Existing over-cap state is
   GRANDFATHERED** (the env-seeded invites already exceed 5 for mi-pase; the migration never auto-revokes — the
   UI shows the over-cap state and allows revokes while blocked; new adds blocked until under 5).
4. **D4 — ONE superadmin bootstrap, then zero env.** Seed `did:privy:cmq6zcn7y001y0cjm37szqy4b`
   (dev@poktalabs.com) into a platform `engine_superadmins` table ONCE at deploy; thereafter superadmins +
   admins + invites are managed in the UI (DB = source of truth). The per-tenant `MIPASE_INVITE_EMAILS` /
   `MIPASE_MEMBER_DIDS` / `MIPASE_ADMIN_DIDS` env path is RETIRED as the management mechanism.
5. **D5 — JWT + role authz, server-enforced.** Endpoints resolve the caller's identity from the Privy JWT and
   enforce role SERVER-SIDE; the SPA showing/hiding the panel is cosmetic only.
6. **D6 — UI in Settings → Team panel,** role-adaptive (member: none; tenant admin: their team + the 5-cap;
   superadmin: tenants list + admin management + any team). Replaces the deferred "roster coming soon".
7. **D7 — Keep the operator `/admin/*` (PR #24)** as the cross-tenant CLI superadmin path (OPERATOR_KEY). This
   feature is the JWT/role-gated complement, not a replacement.

## 2. Role model + storage
```
engine_superadmins(did text primary key, created_at)         -- platform-level, cross-tenant
engine_tenant_members += role memberRole not null default 'member'   -- 'admin' | 'member'
engine_tenant_invites += role memberRole not null default 'member'   -- role to grant on claim
memberRole = pgEnum('member_role', ['admin','member'])
```
- **isSuperadmin(did)** = row in `engine_superadmins`. Cross-tenant; independent of tenant membership.
- **tenant role** = the caller's `engine_tenant_members.role` in the tenant resolved from their JWT.
- A superadmin who is ALSO a tenant member (dev@poktalabs is a mi-pase member) resolves to that tenant for
  `/tenants/me` AND carries `isSuperadmin`. (A pure-superadmin-with-no-tenant landing page is DEFERRED §9 — the
  current superadmin is a mi-pase member, so `/tenants/me` resolves.)

## 3. Authz resolution (the core)
- `GET /v1/tenants/me` → existing `TenantView` + **`role: 'admin'|'member'`** (caller's role in the resolved
  tenant) + **`isSuperadmin: boolean`**. The SPA adapts off these.
- **`requireTenantAdmin(consumer, tenantId)`** (engine-api helper): pass iff `isSuperadmin(did)` OR (the caller's
  membership resolves to `tenantId` AND their member `role === 'admin'`). Fail → `APPROVAL_DENIED` (403).
- **`requireSuperadmin(consumer)`** → pass iff `isSuperadmin(did)`. Else 403.
- All role reads via allowlisted modules (tenants.ts / a new `roles.ts`); NO raw db in `app.ts`.

## 4. Backend (`feat/admin-roles-backend`)
- **Schema** (§2) + migration `0007`; `engine_superadmins` seeded once (insert-only) with the bootstrap DID.
  Backfill: existing members get `role='member'`; the bootstrap DID's mi-pase membership is NOT auto-admin
  (it's SUPERADMIN platform-wide; tenant-admin is a separate grant) — though superadmin passes
  `requireTenantAdmin` for every tenant anyway.
- **`roles.ts` (NEW, allowlisted, same-table grep-pinned):** `isSuperadmin(did)`, `tenantRoleOf(tenantId, did)`,
  `addSuperadmin`/`removeSuperadmin` (superadmin-managed), and the cap helper `activeTeamCount(tenantId)`.
- **Extend `invites.ts`:** `addInvite(tenantId, email, role, db)` — now takes a role; **enforces the 5-cap
  transactionally** (lock + count active rows; reject `TEAM_FULL` at 5); `claimInvite` grants
  `engine_tenant_members.role = invite.role`. Tenant-admin callers are forced `role='member'` at the route.
- **Endpoints (JWT-authed, role-gated; reuse invites.ts/deprovision). Authorize BEFORE any tenant lookup
  (no 404-vs-403 / timing leak, Codex#12). Only `manage-OTHER-superadmins` stays deferred (§9).**
  - `GET /v1/tenants/:tenantId/invites` — `requireTenantAdmin` → the tenant's team (InviteView[] incl. role).
  - `POST /v1/tenants/:tenantId/invites { email, role? }` — `requireTenantAdmin`. **REJECT, don't coerce
    (Codex#17):** a non-superadmin passing `role:'admin'` gets `APPROVAL_DENIED` (403) — never a silent
    member-invite (silent coercion hides malice/bugs). Only a superadmin may pass `admin`. Records
    `invited_by_did` (minimal audit, Codex#15). Seat cap (D3) → `TEAM_FULL` (409). **`addInvite` for an active
    email in ANOTHER tenant → a GENERIC failure (Codex#6/#18): map the partial-unique 23505 to a clean envelope
    — NEVER leak `duplicate key`, an index/table name, or echo the email.**
  - `DELETE /v1/tenants/:tenantId/invites/:email` — `requireTenantAdmin` → `deprovisionInvite`.
  - `PATCH /v1/tenants/:tenantId/members/:did { role }` — **`requireSuperadmin`** (re-included after Codex#1:
    an already-CLAIMED member like dev@frutero can't be made admin via invite). Promote/demote an existing
    member; **last-admin guard** (can't demote the tenant's only admin). Records the grant.
  - `GET /v1/superadmin/tenants` — `requireSuperadmin` → the tenant list (pick which tenant to manage).
  - **ANTI-ENUM:** every `requireTenantAdmin`/`requireSuperadmin` failure returns the SAME `APPROVAL_DENIED`
    (403) — a tenant-admin probing `:tenantId` for another tenant learns nothing; no raw constraint text in any
    error (Codex#18).
- **Pending-invite immutability (Codex#4):** `addInvite` NEVER `ON CONFLICT DO UPDATE`s an existing invite's
  role/tenant (a `pending` row reactivates from `revoked` only; `pending`→no-op; `claimed`→left). Changing an
  already-pending invite's role = superadmin `DELETE` + re-`POST` as admin (revoke frees the unique index), or
  `PATCH` the member after they claim. No silent mutation path.
- **Contract:** add `MemberRole`, extend `TenantMeResponse` (TenantView + role + isSuperadmin), `InviteView.role`,
  a `TeamView` (`{ invites: InviteView[]; members: MemberView[] }`), `TEAM_FULL` error (→ 409).

## 5. SPA (`feat/admin-roles-spa`, after backend deploys)
- `useTenantContext()` exposes `role` + `isSuperadmin` (from `/tenants/me`).
- **Settings → Team panel** (`settings/TeamPanel.tsx`), role-adaptive, replaces the deferred `MemberRosterPanel`
  placeholder. Editorial language matching the existing Settings panels (serif `section` heading, hairline rules,
  surface card, lucide line icons, NO heavy shadows — see `MemberRosterPanel.tsx`/`ErrorState.tsx`).
  - **member** → NO management UI; one honest line ("You're on the {tenant} team. Contact an admin to manage
    members."). Replaces the "coming soon" shell.
  - **tenant admin** → ONE scannable list (not a card grid), each row = email + a **role pill** (Admin = filled
    violet / Member = outline) + a **status tag** (Active / Pending / Revoked-faint) + a quiet **Revoke** action.
    Member role only.
  - **superadmin** → a quiet **tenant picker** above the panel (`Managing: [Mi Pase ▾]`), the same team view for
    the picked tenant, the **role toggle visible** (can invite as Admin), and a "Platform" tag on their own row.
- **DESIGN DECISIONS (locked, /plan-design-review):**
  1. **Seat cap always visible** in the panel header as `X / 5 seats`. **Over-cap** (mi-pase is 6/5 today, D3
     grandfathered) flips to an **amber-hairline WARNING** (not error-red — it's a managed state, not a failure):
     "Over your 5-seat limit. Revoke a pending invite to add someone."
  2. **Role = pill badge** (Admin filled / Member outline, with TEXT labels not color-only); **status = quiet tag**.
  3. **Revoke is DESTRUCTIVE → a confirm step** ("Revoke access for {email}? They'll lose the workspace.") with
     the email echoed. No accidental one-click removal.
  4. **Add is DISABLED-WITH-REASON at/over cap** (the reason is rendered, `aria-describedby`, not a silent grey
     button): "Team is full (6/5). Revoke an invite to free a seat." The **role toggle renders ONLY for a
     superadmin** — a tenant-admin literally cannot choose Admin (mirrors the server's reject-don't-coerce).
  5. **Self / last-admin guardrails in the UI:** no Revoke on your own row; a demote/revoke the server would 409
     (last admin) is pre-disabled with a tooltip, so the user never hits a raw error.
  6. **Empty state is a feature:** a tenant-admin with no team yet sees a warm line ("It's just you so far —
     invite your team, up to 5.") + the email input focused, NOT "no rows".
  7. **a11y:** disabled-Add reason via `aria-describedby`; the revoke-confirm is keyboard-trappable + Esc-dismiss;
     badges/cap-warning carry icon+text (never color-only); 44px touch targets; the tenant-picker is a native
     select or a labeled combobox.
- New hooks (`use-team`, mutations) → the role-gated endpoints; add the new paths to `LIVE_PATHS`. Optimistic or
  refetch-on-success; surface `TEAM_FULL` / `APPROVAL_DENIED` honestly.
- **Server is the authority:** the panel is cosmetic; every action is re-checked server-side (a member who
  forces the panel open still gets 403).

## 6. Test matrix
```
BACKEND (node, hermetic)
  isSuperadmin / tenantRoleOf resolve correctly; requireTenantAdmin: superadmin passes any tenant, tenant-admin
    only its own, member → 403 ★; requireSuperadmin gates the superadmin routes ★
  addInvite enforces the 5-cap TRANSACTIONALLY (6th → TEAM_FULL; concurrent adds can't exceed 5) ★
  role-on-invite: claim grants the invite's role; tenant-admin POST coerces role→member (can't self-escalate
    to admin) ★ ; superadmin may grant admin
  PATCH member role: last-admin / self-demotion guard; superadmins: can't remove the last superadmin ★
  /tenants/me returns role + isSuperadmin; check:scoped green (roles.ts/invites.ts same-table)
  migration 0007 seeds the ONE superadmin DID; existing members backfilled role=member
SPA (jsdom, live-path)
  Settings Team panel renders per role (member none / admin team+cap / superadmin tenants+admins); add disabled
    at 5/5; revoke; TEAM_FULL + 403 surfaced; a forced-open panel's action still 403s (server authority)
REGRESS ★ auth/tenancy spine + tenant-invites claim/anti-enum stay green
```

## 7. Orchestration (gated waves, P5b pattern)
```
WAVE A — backend (feat/admin-roles-backend): schema+migration(0007)+superadmin seed → roles.ts → invites.ts
  role + 5-cap (transactional) → JWT/role endpoints + /tenants/me role/isSuperadmin → contract. Adversarial
  panel: privilege escalation (member→admin, tenant-admin cross-tenant, role coercion bypass), cap race,
  last-admin/superadmin lockout, raw-select escape, anti-enum. Harden. PR base main.
  >>> MERGE + DEPLOY (migrate 0007 + seed) + SMOKE-PROBE before Wave B. <<<
WAVE B — SPA (feat/admin-roles-spa): role-adaptive Team panel + hooks + LIVE_PATHS. Panel: client-trusted role,
  forced-open action, white-screen. Harden. PR base main.
```

## 8. Security posture (non-negotiable)
- **Server-enforced authz** at EVERY endpoint (UI is cosmetic). Role/superadmin read fresh per request.
- **No privilege escalation:** a tenant-admin POST cannot set `role=admin` (coerced server-side); a tenant-admin
  cannot act on another tenant (`requireTenantAdmin` binds to the resolved tenant); only superadmin is
  cross-tenant + may grant admin.
- **5-cap is race-safe** (transactional lock + count, not check-then-insert) so concurrent adds can't exceed 5.
- **No lockout:** guard removing the last superadmin and demoting the last tenant admin.
- **Anti-enumeration / fail-closed** consistent with tenant-invites; no secret/PII leak beyond the team's own
  emails to that team's admins.
- New DB access in allowlisted `roles.ts`/`invites.ts` only (same-table grep-pinned); no raw db in `app.ts`.
- **Break-glass (Codex#3/#14):** the operator `/admin/*` (OPERATOR_KEY) is the documented recovery path to seed
  or fix a superadmin if the bootstrap DID is wrong / Privy rotates it / the account is lost. It is a PRIVILEGED
  invariant-bypass tool (it can exceed the seat cap + grant roles); the seat cap + role-reject are enforced at
  the JWT-route layer, and the operator path is explicitly documented as the escape hatch (not routed through
  the cap). A migration runbook covers "the seed DID was wrong in prod".
- **`/tenants/me` blast radius (Codex#13, the wire-shape lesson):** add `role` + `isSuperadmin` as ADDITIVE,
  backward-compatible fields on `TenantView` (not a breaking `{ tenant, role, ... }` wrapper) so existing
  consumers are unaffected; update the SPA fixtures to the REAL wire shape (incl. the new fields) per
  [[feedback-test-fixtures-match-wire-format]] — the bug class that bit us on #22.

## 9. Deferred (out of this build)
- **`POST/DELETE /v1/superadmin/superadmins`** (manage OTHER superadmins from the UI) — one superadmin (you) is
  seeded + the operator break-glass adds more if needed; a UI for it is a follow-up (needs the last-superadmin
  lockout guard). (PATCH member promote/demote is NOW IN SCOPE — §4, Codex#1.)
- **Full audit log table** — Wave A records `invited_by_did` + the role-grant actor inline (minimal audit,
  Codex#15); a dedicated immutable audit-log table + viewer is a follow-up.
- **Migration backfill note (in-scope reminder):** Wave A backfills existing `engine_tenant_members` with
  `role='member'` and grandfathers the over-cap mi-pase state (no auto-revoke). dev@poktalabs's MEMBER_DIDS
  membership stays a member row (+ superadmin); NOT auto-promoted to tenant-admin (superadmin power covers it).
- Pure-superadmin (no tenant membership) platform landing/route (current superadmin is a tenant member; the SPA
  routing assumes the superadmin resolves to a tenant via `/tenants/me` — make that assumption explicit, Codex#7).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Outside Voice | `/codex` (codex exec) | Independent 2nd opinion | 1 | issues_found | 18 findings → re-included promote, reject-not-coerce, anti-enum/no-leak, seats=member-rows, break-glass, additive /tenants/me, minimal audit |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean (scope reduced then 1 item re-added) | Step-0 trim (defer promote+superadmin-mgmt); 1 cap-denominator decision; arch hardening folded; 0 unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean (5→9/10) | Team-panel §5 raised 5→9/10: 7 design decisions locked (visible seat cap, amber over-cap warning, role pills, destructive revoke-confirm, disabled-add-with-reason + superadmin-only role toggle, warm empty state, a11y). AI mockups skipped (designer API out of quota → ASCII wireframes); codex design voice timed out (non-blocking). |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **CODEX:** read auth/tenancy/invites + the wire-shape history; 18 findings. The load-bearing catch (#1):
  deferring promote/demote BREAKS "assign admins" for an already-claimed member (dev@frutero) — user re-included
  `PATCH /members/:did` (superadmin, last-admin guard). Others folded: reject-don't-coerce role escalation (#17);
  pending-invite immutability — no `ON CONFLICT DO UPDATE` of role (#4); generic anti-enum + no raw constraint
  text/email echo (#6/#18); seats = member rows only so platform-only superadmins don't burn a seat (#11);
  operator `/admin/*` = documented break-glass for the bootstrap (#3/#14); additive `role`/`isSuperadmin` on
  `TenantView` + fixture updates (#13); minimal `invited_by_did` audit (#15); authorize-before-lookup (#12);
  namespaced advisory lock (#9).
- **CROSS-MODEL:** the eng-review Step-0 trim (defer promote) and Codex#1 disagreed; the user sided with Codex
  (re-include promote) — "manage admins" is hollow without it. Consensus on the security hardening.
- **DECISIONS:** scope reduced (defer manage-OTHER-superadmins + full audit log only) · cap = member rows +
  pending invites, superadmin-via-member-row counts, advisory-locked, over-cap grandfathered · promote/demote
  re-included (superadmin) · reject-not-coerce · additive `/tenants/me` · break-glass via operator key.
- **DESIGN:** Team-panel §5 cleared (5→9/10) — 7 design decisions locked (states, seat-cap/over-cap, role pills, destructive revoke-confirm, disabled-add-with-reason, warm empty state, a11y). Wave A (backend) is MERGED + DEPLOYED (migration 0007, superadmin seeded); Wave B builds the panel per §5.
- **VERDICT:** ENG + DESIGN CLEARED — buildable as two gated waves (backend role spine + cap + endpoints → deploy → SPA
  Team panel). A `/plan-design-review` on the Settings panel before Wave B is recommended but not required.

NO UNRESOLVED DECISIONS
- Tenant CRUD from the UI (create/disable tenants) — superadmin manages roles/invites only for now.
- Audit log of role changes; email notifications on invite/promote; richer member identity (names) beyond DID.
- Retiring the operator `/admin/*` (kept as the CLI path).
