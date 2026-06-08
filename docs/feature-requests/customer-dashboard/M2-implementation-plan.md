# M2 Implementation Plan — godin-engine Customer-Delivery Workspace SPA

> **Mission:** Ship a tenant-agnostic, governed agent-workflow workspace whose universal heart is the Approvals queue, delivered single-tenant for Mi Pase but architected for Vino Design Build as tenant #2. Mock-data-first, then `/v1` wiring, then auth, then i18n, then Railway deploy.
>
> **Repo target:** `/Users/mel/workspaces/poktalabs/projects/godinez-ai/godin-engine/code/godin-engine-v0.1/`
> **New package:** `web/` (added to `pnpm-workspace.yaml` as a top-level workspace, sibling of `engine-api/`, `worker/`, `workflows/`).
> **Design system source of truth (already in repo):** `docs/feature-requests/customer-dashboard/design-system/{tokens.css,status-tokens.css,reference-components.md,wireframe-reconciliation.md}`.
> **Design system files NOT yet in repo (P1-C deliverables):** `light-form-fields.css`, `risk-tiers.css`. These do **not** exist today — do not `@import` them until P1-C lands them (see §P1).

---

## 0. Locked Stack (pin these EXACT versions — verified against repo + godinez-studio + pokta-care)

**Repo-state corrections baked in (verified 2026-06-08 against the live tree):**
- Root `package.json` declares `packageManager: "pnpm@10.26.1"` and `engines.node: ">=20"`. **Use pnpm 10.26.1.** Do NOT downgrade to 9.15.0 — that desyncs the shared lockfile for engine-api/worker.
- Existing `.github/workflows/ci.yml` already uses `pnpm/action-setup@v4` (version inferred from `packageManager`) + `actions/setup-node@v4` with `node-version: 22`, and carries the comment "pnpm version comes from package.json packageManager (don't double-specify)." The web CI lane **extends this existing job** — it does NOT introduce a second pnpm pin.
- Node version: root engines is `>=20`, CI runs Node 22. Decision: **standardize on Node 22** for CI + Dockerfile (it satisfies `>=20`); leave `engines` at `>=20`.
- `tsconfig.base.json` has `noEmit: true`; every package (`contract`, etc.) extends it and builds with `tsc --noEmit`. There is **no `composite`/declaration emit anywhere**. This decides the web build seam (see §P0 sub-decision and the locked `package.json` scripts below).
- `packages/contract/src/integration.ts` defines only `IntegrationResult` with `provider: 'notion' | 'resend'` (a **run-output** type). There is **no** integration-catalog type, no Approval-view type, no Schedule/Report/Quota type. All of these are contract additions, scheduled explicitly below.

```jsonc
{
  "name": "@godin-engine/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",   // NOT `tsc -b` — repo is noEmit/source-only; see P0 sub-decision
    "start": "serve dist -s -l $PORT",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@godin-engine/contract": "workspace:*",      // shared API types — the contract seam (Bundler resolution to ./src)
    "@privy-io/react-auth": "^3.28.0",             // pokta-care version (NOT patrimo's v2)
    "@radix-ui/react-slot": "^1.2.4",
    "@sentry/react": "^10.42.0",
    "@tanstack/react-query": "^5.64.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.575.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.1.0",
    "react-virtuoso": "^4.18.3",                   // for the ~316-row Mi Pase batch table — confirm React 19 support (see P0-A task)
    "serve": "^14.2.4",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.5.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.58.2",
    "@tailwindcss/typography": "^0.5.19",
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.1.0"
  },
  "optionalDependencies": {
    "@tailwindcss/oxide-linux-x64-gnu": "4.3.0",   // pokta-care fix: Tailwind v4 native binary on Railway glibc
    "lightningcss-linux-x64-gnu": "1.32.0"
  }
}
```

**Self-hosted fonts** (Pokta Labs stack, via Fontsource — do NOT use Google Fonts `<link>` like godinez-studio; brand-locked self-host): add `@fontsource-variable/source-serif-4`, `@fontsource-variable/manrope`, `@fontsource-variable/funnel-display` to deps and `@import` them at app entry.

**Engine version note:** godin-engine root scaffold sample uses React 18; **override to React 19** for the SPA to match the two shipped SPAs + TanStack Query v5 / RR v7. Because the lockfile is shared, P0-A must (a) regenerate `pnpm-lock.yaml` and (b) verify the React 19 + `@types/node` 22 override introduces no peer conflict for engine-api/worker (those are server packages and do not depend on React; conflict surface is expected to be nil, but verify).

---

## 1. Top-Level Dependency Graph & Critical Path

The corrected graph routes the **auth/identity model through the critical path** (it gates both P5b consumer-scoping and P6), and pulls **contract response-type definition early** (it gates mock fixtures, not just wiring).

```
P0 scaffold ──┬──> P1 design-system+shell ──┬──> P2 Approvals heart ──┐
              │                              ├──> P3 Workflows+Runs    ├──> P5b API wiring ─┐
              │                              ├──> P4 Integrations+Rpts │                    │
              │                              └──> P4C Settings ────────┘                    ├──> P6 auth gating ──> P8 deploy+CI
              │                                                                             │
              ├──> [CONTRACT-TYPES gate] (P0-B/P1): Approval-view + Run-list + Integration- │
              │     catalog + Schedule + Report + Quota types added to packages/contract ───┤ (gates ALL mock fixtures + wiring)
              │                                                                             │
              ├──> P5a backend (engine-api): route-module REFACTOR (serial) → consumer- ────┤
              │     binding + Privy-JWT middleware (serial, ONE owner) → per-resource       │
              │     endpoints (parallel) ──────────────────────────────────────────────────┘
              │                                                                             ▲
              ├──> [AUTH-MODEL spike] (Wave 1, owned): Privy-JWT→consumer_id; SPA carries ──┘
              │     Privy JWT ONLY (never X-Service-Key in browser). Gates P5a-auth + P6.
              │
              └──> P7 i18n infra (parallel) → per-surface string sweep (gated per surface DoD)
```

### Critical (longest serial) chain — corrected
```
P0 scaffold (Vite+TS+Tailwind boots; contract-seam decided; lockfile regenerated)
  → CONTRACT-TYPES gate: Approval-view + Run-list response types finalized in contract   [GATE: blocks mock fixtures]
  → P1 core tokens land (index.css @theme: color/spacing/radius)                          [GATE: blocks primitives]
  → P1-A1 button + pill (shell-consumed primitives)
  → P1-B shell + ApprovalQueueFrame route mount
  → P2-A renderer TYPE CONTRACT (small interface, <1hr)                                    [GATE: forks B and C]
  → P2-B BatchApprovalRenderer (Mi Pase, the heart) reaches all 6 states on mock data
  → P5a-AUTH: consumer-binding + Privy-JWT acceptance middleware (engine-api)              [GATE: real consumer scoping]
  → P5b approvals/runs hooks wired to /v1 (against finalized contract types)
  → P6-B Privy gating + token injection into apiFetch
  → P8 Railway service + Dockerfile + CI green + deploy
```
This is the chain to staff first and protect. The two non-obvious additions to the critical path vs. the draft: **(1) the contract response-type gate** (mock fixtures cannot be frozen against types that don't exist yet) and **(2) P5a-AUTH** (P5's and P6's DoD both require real server-side consumer scoping, so the identity model is not side-lane ballast).

### What parallelizes vs. what is gated
| Parallel-safe (independent agents) | Gated (must wait) | Gate reason |
|---|---|---|
| P0-A scaffold • P0-B contract audit • AUTH-MODEL spike • P5a route-module refactor | All P1+ components | Need scaffold + core tokens to render |
| CONTRACT-TYPES (Approval/Run/Integration/Schedule/Report/Quota) • core token CSS | Mock fixtures (P2/P3/P4) | **Fixtures freeze against the NEW contract types, not today's contract** |
| P1-A2 (hairline-grid, stat-tile, state trio) ‖ P1-B shell | — | A2 no longer blocks B; only P1-A1 (button/pill) does |
| P1-C light-form-fields ‖ risk-tiers (separate files) | ScheduleEditor/Settings inputs (forms); P2-C/P4-A (risk) | Form fields gate forms only; risk tokens gate risk UI only — **neither gates the critical-path batch renderer** |
| P2-B Batch renderer ‖ P2-C Single-action renderer | — | Both fork off the P2-A type contract independently |
| P3-A ‖ P3-B ‖ P4-A ‖ P4-B ‖ P4-C (all on mock data) | P5b per-surface wiring | Each hook gates on ITS OWN frozen fixture + ITS endpoint |
| P5a per-resource endpoints (after refactor + middleware land) | — | Refactor + shared middleware are serial prerequisites |
| P7 i18n infra + content catalogs (new files) | Per-surface string sweep | Sweep gates on that surface's component-lane DoD |

---

## P0 — Scaffold & Foundation

**Goal:** A booting `@godin-engine/web` Vite SPA inside the existing pnpm monorepo, importing types from `@godin-engine/contract`, with strict TS, path aliases, a **regenerated shared lockfile**, a **decided contract-build seam**, a **canonical provider-nesting skeleton**, and a green local `dev`/`typecheck`.

### P0 sub-decisions (resolve BEFORE writing files — prerequisites for P0's own DoD)

1. **Contract-consumption / build seam (CRITICAL — was a hidden blocker).** The repo is `noEmit:true` everywhere; `@godin-engine/contract` builds with `tsc --noEmit` and has no `composite`/declarations. Therefore `tsc -b` (project-references build mode) **cannot reference contract** and would break on the first build. **Decision (locked): use `tsc --noEmit` + Vite transpile**, with Vite Bundler resolution importing contract from its `./src` (`workspace:*`). This matches every other package in the repo. `web/package.json` `build` = `tsc --noEmit && vite build` (already reflected in §0). Do not introduce composite anywhere.

2. **Canonical provider-nesting skeleton (resolves the main.tsx concurrent-edit hazard).** P0 defines the FINAL nesting order with all four providers stubbed so later lanes only fill bodies, never restructure the tree. **Order (locked, driven by token-injection requirement — Privy must wrap Query so `apiFetch` can read the access token):**
   ```
   <PrivyProvider>            // P6 fills config; stub passthrough in P0
     <QueryProvider>          // P0 owns
       <LanguageProvider>     // P7 fills catalogs; stub passthrough in P0
         <TenantProvider>     // P1 fills config
           <RouterProvider /> // P0 owns
   ```
   Implement as `web/src/providers/AppProviders.tsx` — a composable wrapper where **each provider lives in its own file** and `AppProviders` only imports + nests them. `main.tsx` imports `AppProviders` and nothing else provider-related. This reduces the multi-lane conflict surface on `main.tsx` to zero (each lane edits only its own provider file).

3. **Lockfile regeneration (prerequisite for "CI green").** Adding `web/` + React 19 override requires regenerating the shared `pnpm-lock.yaml`. This MUST be the first committed step; the frozen-lockfile CI lane depends on it.

### Tasks (file-level)
- **P0-A first task:** add `web/package.json` deps (exact §0 versions) → run `pnpm install` to regenerate `pnpm-lock.yaml` → verify no React 18/19 peer conflict for engine-api/worker → commit lockfile. Confirm `react-virtuoso@^4.18.3` declares React 19 peer support (check the cited SPAs' actual React major; if they are React 18, bump virtuoso to a React-19-tested minor and re-pin).
- Root `pnpm-workspace.yaml` — add `web` as a top-level entry (mirror `engine-api`/`worker`/`workflows`):
  ```yaml
  packages: [packages/*, engine-api, worker, workflows, web]
  ```
- `web/vite.config.ts` — `plugins: [react(), tailwindcss()]`; `resolve.alias["@"] → ./src`; dev `server.proxy` `/v1` → engine-api local URL, `changeOrigin: true`.
- `web/tsconfig.json` — extends `tsconfig.base.json`; strict; `"paths": { "@/*": ["./src/*"] }`; **no `composite`, no `references` to contract** (Bundler resolution handles it).
- `web/public/_redirects` — `/* /index.html 200` (SPA fallback).
- `web/index.html` — root mount, no Google Fonts link.
- `web/src/main.tsx` — imports `<AppProviders>` only.
- `web/src/providers/AppProviders.tsx` + the four provider files (Privy stub, Query, Language stub, Tenant stub) in the locked nesting order.
- `web/src/App.tsx` — `createBrowserRouter` skeleton with lazy pages + `<Suspense>` (full route tree filled in P1-B).
- `web/src/lib/utils.ts` — `cn()` (clsx + tailwind-merge).
- `web/src/lib/api.ts` — `apiFetch<T>()` stub (retry/backoff/timeout shape from godinez-studio; token injection deferred to P6; **no X-Service-Key in browser** — see auth model in P5a/P6).
- `web/src/providers/QueryProvider.tsx` — `QueryClient` (`staleTime: 30_000`, `retry: 1`, `MutationCache.onError → toast.error`).
- `.github/workflows/ci.yml` — **EXTEND the existing job** (do not add a second pnpm pin): add `pnpm --filter @godin-engine/web typecheck`. Frozen-lockfile install depends on the regenerated lockfile from P0-A's first task.

### Parallel lanes
- **Lane P0-A (scaffold):** everything above, lockfile-first.
- **Lane P0-B (contract audit + early type deliverable):** inventory existing contract types (`run.ts`, `manifest.ts`, `policy.ts`, `errors.ts`, `integration.ts`). Produce the **gap list**, then immediately deliver the **two critical-path response types** as a committed contract addition:
  - `ApprovalView` — the shape of each element in `GET /v1/approvals`'s `{ approvals: ApprovalView[] }`, reconciled against `engine-api/src/index.ts` line 147's actual JSON: `{ approvalId, sourceRunId, workflowId, artifact, state, approver?, decidedBy?, decidedAt?, dispatchedRunId?, createdAt }`. **`artifact` is opaque per-workflow Zod input** (validated at approve-time against `target.manifest.input`) — type it as `artifact: unknown` plus a `workflowId` discriminator; do NOT bake a fixed 316-row shape into the contract.
  - `RunListItem` / `RunDetail` — reconciled against `GET /v1/runs` (`{ runs }`) and `GET /v1/runs/:id` (the raw row).
  - Also document the **approve/reject response semantics** for the P2 state machine: approve → `{ approvalId, state:'approved', runId }` (dispatches a child run; can 409 `APPROVAL_DENIED` if already decided); reject → `{ approvalId, state:'rejected' }`. **Feed this to P2-A so the 6-state model is aligned to real POST-flip/child-run semantics before renderers freeze it** (resolves the optimistic-update divergence risk).
- **Lane P0-C (auth-model spike — own owner, Wave 1):** decide and document the identity model: **SPA carries Privy JWT ONLY; never embeds `X-Service-Key` (a machine secret) in the browser.** Specify the engine-api change required: middleware verifies the Privy JWT, extracts the user, resolves `consumer_id`, and supplies the human approver identity for `decided_by`. This spike's output is the spec for the P5a-AUTH task and gates P6-B.

### Serialization
P0-A (lockfile-first) ‖ P0-B ‖ P0-C run concurrently. P0-A scaffold + P0-B's two critical response types must finish before P1 fixtures. P0-C output must finish before P5a-AUTH starts.

### Definition of Done
- `pnpm --filter @godin-engine/web dev` serves a blank routed shell at `:5173`; `typecheck` passes via `tsc --noEmit`.
- `web` resolves `import type { RunStatus } from "@godin-engine/contract"` via Bundler resolution (no `tsc -b`).
- Regenerated `pnpm-lock.yaml` committed; `pnpm install --frozen-lockfile` passes; no React peer conflict.
- `AppProviders.tsx` in canonical nesting order committed (the contract for P6/P7).
- `docs/feature-requests/customer-dashboard/contract-gaps.md` committed; `ApprovalView` + `RunListItem`/`RunDetail` types committed to `packages/contract/src`.
- Auth-model decision committed to `docs/feature-requests/customer-dashboard/auth-model.md`.
- `react-virtuoso` React-19 compatibility confirmed (or pin corrected).

---

## P1 — Design System + Shell (THE GATE)

**Goal:** Pokta Labs design system wired into Tailwind v4, brand shape DNA enforced, tenant-agnostic shell + nav + locale toggle rendering with Mi Pase and Vino lockup variants. The hard gate is **core token CSS only** — primitives and design-decision files fan out around it.

### Sub-decisions resolved in P1 (decoupled, NOT a blanket pre-gate)

1. **Light-surface form fields (P1-C-forms).** Define base: `bg-[var(--surface)] border border-[var(--rule)] rounded-none` + focus `border-[var(--accent-text)] ring-1 ring-[var(--accent-text)]`. Commit as **`light-form-fields.css`** (new file). **Gates ScheduleEditor (P3) + Settings (P4-C) inputs ONLY** — does NOT gate the batch renderer or shell.
2. **Vino risk-tier palette (P1-C-risk) — ESCALATED to a brand-owner decision (see Open Decisions).** Verified: `status-tokens.css` has only `ok/warn/fail/idle(+info)`; `--status-fail` already aliases `--color-accent` (brick ember), the only "stop" color. There is **no 4th distinct risk color**, and the design doc states `#19A662` green was "the one added color" this session. A new Very-High color is a brand-governance change, not an engineering call. **Default path pending Mel's sign-off: collapse risk to 3 tiers** (Low=`--muted-foreground`/idle, Medium=`--status-warn`, High=`--status-fail`) reusing existing tokens with **no new color**. If Mel approves a 4th color, add it to `tokens.css` + `status-tokens.css`. Commit `.risk-*` classes to a **separate `risk-tiers.css`** (avoids merge contention with `index.css`/`status-tokens.css`). Contrast-check all tiers on light surface before P2-C/P4-A consume them. **Gates P2-C single-action + P4-A integration badges ONLY.**

### Tasks
- `web/src/index.css` — `@import "tailwindcss"; @plugin "@tailwindcss/typography";` then `@import` the **existing** repo CSS (`tokens.css`, `status-tokens.css`) + Fontsource font imports + `@theme inline` block mapping `--font-serif: "Source Serif 4 Variable"`, `--font-sans: "Manrope Variable"`, Funnel for `.btn`/accents; radius 0 enforced globally. **`light-form-fields.css` and `risk-tiers.css` are appended to the `@import` list ONLY after P1-C lands them** (gated import — do not reference non-existent files).
- `web/src/components/ui/button.tsx` — `.btn` CVA: hard-offset stamp (`4px→6px→0` shadow), `1.5px solid ink` border, Funnel Display, Amber primary / Brick-Ember destructive. Radix `Slot` for `asChild`. Honor `prefers-reduced-motion` on the stamp (a11y).
- `web/src/components/ui/pill.tsx` — `.pill-ok/-warn/-fail/-idle`, square `.status-tick` (size-1.5), 11px all-caps, **icon+label always (never color alone)**, Lucide icons, accessible name on the icon.
- `web/src/components/ui/HairlineGrid.tsx` + `StatTile.tsx` — outer frame + `gap-px` reveals `--rule`; serif index number, bold value; `divide-y` soft rows.
- `web/src/components/ui/{EmptyState,LoadingState,ErrorState}.tsx` — warm empty, disabled-primary loading, inline-alert+retry error. ErrorState accepts an `ErrorEnvelope` and renders code-aware copy (incl. a **403/Forbidden** variant).
- `web/src/components/layout/Shell.tsx` — sticky header + left sidebar + `<Outlet/>`; `data-tenant` attr on root.
- `web/src/components/layout/Sidebar.tsx` — nav: Workflows, Approvals (pending-count badge), Integrations, Reports, Settings. **Settings is built in P4-C — do not ship a dead link** (if Settings is descoped, remove the item; see P4-C).
- `web/src/components/layout/TenantHeader.tsx` — Pokta lockup + tenant name + optional amber "TEST STORE" badge.
- `web/src/components/layout/LocaleToggle.tsx` — EN/ES-MX segmented control with **`role="radiogroup"` semantics** (a11y), active = `bg-secondary` fill + light text.
- `web/src/providers/TenantProvider.tsx` (fills the P0 stub) — active tenant id (hardcoded `mipase`) + per-tenant config object `{ name, currency, locale, lockup, integrations[] }`. **Theming mechanism: `data-tenant` + config object, NOT a per-tenant CSS theme** (light base locked for both).
- `web/src/App.tsx` — full route tree: `/:tenant` Shell with children `/workflows`, `/workflows/:id`, `/runs/:id`, `/approvals`, `/integrations`, `/reports`, `/reports/:id`, `/settings`.

### Parallel lanes
- **Lane P1-A0 (THE hard gate):** `index.css` core token/`@theme` mapping (color/spacing/radius/fonts). **Universal prerequisite — the only thing all components wait on.**
- **Lane P1-A1 (shell-consumed primitives):** `button` + `pill`. Gates P1-B.
- **Lane P1-A2 (other primitives):** `HairlineGrid`, `StatTile`, `EmptyState/LoadingState/ErrorState`. **Runs parallel with P1-B** (shell doesn't consume these).
- **Lane P1-B (shell + nav + tenant/locale + route tree):** gates on P1-A0 + P1-A1 only.
- **Lane P1-C-forms (`light-form-fields.css`):** parallel; gates forms only.
- **Lane P1-C-risk (`risk-tiers.css`):** parallel; gates risk UI only; pending brand sign-off (Open Decisions).

### File-ownership (hub files — resolves cross-lane write contention)
| Hub file | Owner lane | Rule |
|---|---|---|
| `web/src/index.css` | P1-A0 | Other lanes' imports (P1-C, Fontsource) land as small reviewed diffs through the owner, in order. |
| `web/src/main.tsx` | P0-A | Frozen after P0 — only imports `AppProviders`. No other lane edits it. |
| `web/src/providers/AppProviders.tsx` | P0-A | Adds an import line per provider; provider bodies live in per-lane files. |
| `web/src/App.tsx` | P1-B | Route additions (Settings etc.) go through this owner. |
| each `providers/<X>Provider.tsx` | the owning feature lane (Privy=P6, Language=P7, Tenant=P1) | Independent files, no contention. |

### Serialization
P1-A0 (core tokens) → { P1-A1 → P1-B } ‖ P1-A2 ‖ P1-C-forms ‖ P1-C-risk. **Only core tokens are the hard gate.**

### Definition of Done
- Brand audit passes: radius 0 everywhere, button stamp animates `4→6→0` (respects reduced-motion), square ticks not dots, no gradients/soft blurs, fonts self-hosted.
- Shell renders Mi Pase lockup; flipping TenantProvider to `vino` swaps lockup + nav config with zero CSS change.
- All four state primitives render in a demo route, including the 403 ErrorState variant.
- `light-form-fields.css` + `risk-tiers.css` committed and gated-imported; risk tiers contrast-checked.
- Sidebar has no dead links (Settings resolved per P4-C).

---

## P2 — Approvals: The Universal Heart

**Goal:** The generic `ApprovalQueueFrame` + the Mi Pase `BatchApprovalRenderer` (P0 priority) reaching all 6 states on mock data, plus the Vino `SingleActionApprovalRenderer` (P1 priority). Critical-path centerpiece.

### P2-A: the renderer CONTRACT (the real gate — small, lands fast)
The plan's central thesis (swap the `renderer` prop, nothing else changes between tenants) requires an **explicit, committed interface** before B and C fork. Define and commit (to `web/src/components/approvals/types.ts`, importing `ApprovalView` + `ErrorEnvelope` from contract):

```ts
type DecisionRequest = { approvalId: string; artifact: unknown };   // artifact = per-workflow Zod input
type PartialFailure = { failedItemIds: string[]; errors: ErrorEnvelope[] };

interface ApprovalRenderer<TArtifact = unknown> {
  artifactKind: string;                 // discriminator (== workflowId domain) — drives renderer selection
  render(args: {
    artifact: TArtifact;
    selection: Set<string>;             // per-row selection (batch); single-item set (single-action)
    onSelectionChange(next: Set<string>): void;
    disabled: boolean;                  // frame drives this from submitting state
  }): ReactNode;
  toDecisionPayload(selection: Set<string>, artifact: TArtifact): DecisionRequest;
}
```
- The **frame** owns the 6 states (default / empty / submitting / success / partial-failure / rejected) and the async lifecycle; the **renderer** owns artifact presentation + selection.
- **Partial-failure flows back as `failedItemIds`** (a list) — uniform for both batch (many ids) and single-action (one id). The frame renders "Retry failed" against that list.
- The 6-state model is reviewed against **real approve/reject semantics from P0-B** (child-run dispatch, 409-already-decided, partial-failure shape) before it freezes.

### Tasks
- `web/src/lib/mock/approvals.ts` — fixtures typed as `ApprovalView` (from contract). **The batch artifact is derived from the real daily-pricing workflow's manifest input schema** (located in `workflows/pricing/` — P2-B's first sub-task is to read that Zod input and derive the mock, NOT invent a 316-row shape). Include the specced edge cases (40+ char name + tooltip, at-floor margin, >30% Δ, mixed categories). Vino artifacts = 3 single-action examples (email send / CRM move / estimate commit) derived from their workflow inputs (or flagged mock-only if those workflows don't exist yet). Response envelope `{ approvals: ApprovalView[] }` is reconciled in the mock/hook layer.
- `web/src/components/approvals/ApprovalQueueFrame.tsx` — generic frame implementing the 6-state machine against the P2-A interface. **A11y: focus management contract** — on submit move focus to a status region; announce success/partial-failure/rejection via an `aria-live="polite"` region; confirm dialog is focus-trapped.
- `web/src/components/approvals/BatchApprovalRenderer.tsx` — **(Mi Pase, P0, critical path)** `react-virtuoso` virtualized table; sticky header + sticky action bar; columns Product / SKU / Category / Current(MXN) / Suggested(+Δ%) / Competitor ref / Margin(≤15% floor treatment) / Why-flagged; row-exclude before "Approve all & apply"; confirm "This will update N prices in Shopify (test store)". **A11y for virtualization:** set `aria-rowcount` (total logical rows) on the grid container and `aria-rowindex` on each rendered row so screen readers report true counts despite windowing; ensure tab order + arrow-key navigation work across virtualized rows.
- `web/src/components/approvals/SingleActionRenderer.tsx` — **(Vino, P1)** focused card: what/where + risk-tier badge (P1-C-risk) + drafted-content preview + Approve/Reject + optional "edit before approving".
- `web/src/components/approvals/RiskBadge.tsx` — tiers per the **resolved** P1-C-risk scale (3-tier default), icon+label, accessible name.
- `web/src/components/approvals/AuditTrail.tsx` — inline expandable detail (`decidedBy/decidedAt/reason`). **Scope reconciled with P5a:** this inline view is the ONLY audit surface in M2; the P5a "approval audit query" endpoint is **descoped from M2** unless it backs this inline view (see P5a / Open Decisions) — do not build a backend endpoint with no consumer.
- `web/src/pages/Approvals.tsx` — selects renderer by `artifactKind`/`workflowId` discriminator; pending-count drives sidebar badge.

### Parallel lanes
- **Lane P2-A (contract + state machine):** split into **(a) the type contract** (lands `<1hr`, forks B and C immediately) and **(b) the state-machine implementation** (proceeds in parallel with B and C — they depend only on the contract). Mock fixtures co-owned with whoever freezes the contract.
- **Lane P2-B (Batch renderer, critical path):** gates on P2-A(a) contract + P1-A0 tokens + P1-A2 hairline-grid + the real pricing-manifest input schema. Floor/Δ treatment from design tokens.
- **Lane P2-C (Single-action renderer):** gates on P2-A(a) contract + P1-C-risk palette. Fully parallel to P2-B.

### Serialization
P2-A(a) type contract → (P2-B ‖ P2-C ‖ P2-A(b) state machine). Fixtures freeze against the contract `ApprovalView` (from P0-B), not today's contract.

### Definition of Done
- Mi Pase batch: mock rows (count derived from real schema) scroll smoothly (virtualized), all 6 states reachable, row-exclude works, confirm dialog shows correct count, partial-failure lists exactly which rows failed + "Retry failed", a11y rowcount/rowindex verified with a screen reader.
- Vino single-action: 3 example cards render with correct (resolved) risk tiers; same 6 states.
- Swapping `renderer` prop is the ONLY change between tenants; frame focus-management + live-region announcements verified.

---

## P3 — Workflows + Runs

**Goal:** Workflow list + detail (Daily Pricing worked example) + Run detail, full state matrix, on mock data. Independent of P2.

### Tasks
- `web/src/lib/mock/workflows.ts` + `mock/runs.ts` — typed against contract `WorkflowManifest` + `RunListItem`/`RunDetail` (from P0-B). Mi Pase Daily Pricing + Vino's Lead Qual / Proposal / Email Triage.
- `web/src/lib/mock/schedules.ts` — **NEW** (was missing). Typed against the `Schedule` contract type (P5a-added). Mi Pase "Daily 6AM" expressed in the chosen schedule representation (see ScheduleEditor decision).
- `web/src/pages/Workflows.tsx` — `WorkflowCard` list **with full state matrix: loading / empty / error(+403) / loaded** (was only covering detail).
- `web/src/components/workflows/WorkflowCard.tsx` — trigger label, last-run outcome pill, pending-approval badge.
- `web/src/pages/WorkflowDetail.tsx` — 4 states: empty (first-run CTA), running (live progress), failed (plain-language + Retry), idle (last summary + next scheduled).
- `web/src/components/workflows/PipelineFlow.tsx` — 3-node flow Draft → [Amber gate] → Apply; current stage highlighted (reduced-motion aware).
- `web/src/components/workflows/ScheduleEditor.tsx` — uses `light-form-fields.css` (P1-C-forms). **Decision (default): friendly daily-time picker for Mi Pase + raw-cron field for power users; define invalid-schedule error state.** **Ships read-only/disabled with an explicit "editing coming soon" state until Schedules CRUD (P5a) lands** — never a dead write surface.
- `web/src/components/workflows/RunHistoryTable.tsx` — hairline-grid; date / auto-applied / approved / rejected / outcome pill.
- `web/src/pages/RunDetail.tsx` — stat tiles (Products analyzed / Auto-applied / Needs review / No change), all-clear celebratory state, partial-failure; full state matrix (loading/empty/error+403/loaded).
- `web/src/components/runs/AutoAppliedCollapse.tsx` — collapsed-as-done, expand → hairline table.

### Parallel lanes
- **Lane P3-A (Workflows list+detail+pipeline+schedule editor + schedules mock).**
- **Lane P3-B (Run detail + stat tiles + auto-applied collapse).**
Both gate on P1-A0/A1/A2 + their mocks; parallel to each other AND to all of P2. ScheduleEditor inputs gate on P1-C-forms.

### Definition of Done
Workflows-list + workflow-detail + run-detail each render their **full state matrix** (loading/empty/error/403/loaded) on mock data; pipeline flow highlights current stage; ScheduleEditor uses locked form-field styling and shows the "editing coming soon" disabled state until P5a.

---

## P4 — Integrations + Reports + Settings

**Goal:** Integrations card grid, Reports index+detail, and the **Settings surface** (previously routed-but-unbuilt), on mock data. Independent of P2/P3.

### Contract reconciliation (resolves the R8 understatement — CRITICAL)
The run-output type `IntegrationResult` (`provider:'notion'|'resend'`) is a **different type** from the integrations **catalog** the dashboard needs. The catalog type does not exist. **P5a defines `GET /v1/integrations` FIRST-class and the catalog type is added to `packages/contract` BEFORE P4 mocks are written:**
```ts
interface IntegrationStatus {     // catalog/status — NOT IntegrationResult
  provider: string;               // OPEN string (shopify, mercadolibre, gohighlevel, jobtread, ...)
  status: 'connected' | 'estimated' | 'not-yet-live';
  riskTier: RiskTier;             // matches the resolved P1-C-risk scale
  detail?: string;
}
```
All P4 mock providers (Shopify, Mercado Libre, Coppel, Elektra, Liverpool, Amazon MX, GoHighLevel, JobTread, Gmail, Google Calendar, Twilio, SmartSuite) have **no backend** — the integrations grid is **mock-only behind `VITE_USE_MOCKS` until P5a lands**, and the page renders a clear "status is illustrative" affordance. The today-real console side-channel returns only notion+resend; the new `/v1/integrations` route promotes that and is documented as the only live source when keys are present.

### Tasks
- `web/src/lib/mock/integrations.ts` — typed against `IntegrationStatus`; Mi Pase + Vino sets per the providers above; `riskTier` from the resolved scale.
- `web/src/components/integrations/IntegrationCard.tsx` — pop-card (own `1.5px ink` border + `4px 4px 0 0` stamp) or hairline cell; status pill + risk-tier badge (P1-C-risk) + optional data slot.
- `web/src/pages/Integrations.tsx` — per-tenant grid driven by TenantProvider config; **full state matrix (loading/empty/error+403/loaded)**.
- `web/src/lib/mock/reports.ts` — typed against the `Report` contract type (P5a-added). Mi Pase (Daily pricing impact, Competitor metadata) + Vino (CEO brief, Pipeline health, Stale leads).
- `web/src/pages/Reports.tsx` — index list; **full state matrix**.
- `web/src/pages/ReportDetail.tsx` — summary + table/chart slot; **full state matrix**.
- **`web/src/pages/Settings.tsx` (NEW — P4-C, resolves the missing surface):** tenant profile, integration credential status (**read-only status display for M2** — credential editing is descoped; state it explicitly), team/members (read-only roster or descoped placeholder), notification prefs, locale default. Uses `light-form-fields.css` (P1-C-forms) for any editable field. Define its **4 states** (loading/empty/error+403/loaded). **No backend exists** → Settings is mock-only behind `VITE_USE_MOCKS` with a "coming soon" state on any non-read surface. If Mel descopes Settings entirely for M2 (Open Decisions), **remove it from Sidebar + route tree** instead of shipping dead links.

### Parallel lanes
- **Lane P4-A (Integrations)** — gates on P1-C-risk + the `IntegrationStatus` contract type.
- **Lane P4-B (Reports)** — gates on P1-A0/A2 + `Report` contract type.
- **Lane P4-C (Settings)** — gates on P1-A0/A1/A2 + P1-C-forms. Parallel to A/B and to P2/P3.

### Definition of Done
Integration grids render correct per-tenant sets with correct status/risk behind `VITE_USE_MOCKS`; Reports index + one detail + Settings each render their **full state matrix** on mock data; Settings has no dead write surfaces (read-only or "coming soon").

---

## P4-Z — Vino tenant end-to-end acceptance (cross-cutting)

**Goal:** Prove the "architected for tenant #2" claim with a single owned acceptance task, not scattered mocks.

### Task
- **Flip `TenantProvider` to `vino` and verify the whole app:** shell + all surfaces (Workflows list, Approvals via SingleActionRenderer, Integrations grid, Reports, Settings) render Vino's config — lockup, nav, **USD currency**, single-action approvals, Vino integrations/reports — with **zero CSS change**. File any per-tenant config gaps back to P1/P2/P3/P4 owners.

### Serialization
Runs as a Wave-2 integration DoD after P2-C + P3 + P4 reach mock-DoD. Owned by one agent.

### Definition of Done
Vino renders end-to-end on mock data with zero CSS divergence; gap list (if any) closed.

---

## P5 — API Wiring + New Backend Endpoints

**Goal:** Replace mock data with real `/v1` calls via TanStack Query hooks; in parallel, build the missing engine-api endpoints. **Mock freeze is per-surface, not global.**

### P5a — Backend (engine-api) — serial prerequisites then parallel endpoints

> **CRITICAL parallelization fix:** `engine-api/src/index.ts` is a **single monolithic file** holding all 7 existing routes. Adding 8+ endpoints + cross-cutting middleware to one file makes N agents collide on every commit. The first two P5a tasks are **serial, single-owner prerequisites**:

1. **(SERIAL, one agent, ~half a day) Route-module refactor.** Split `index.ts` into per-resource modules (`routes/runs.ts`, `routes/approvals.ts`, `routes/schedules.ts`, `routes/integrations.ts`, `routes/reports.ts`, `routes/quota.ts`) mounted via `app.route()`. Behavior-preserving; existing tests stay green. **MUST land before any parallel endpoint work.**
2. **(SERIAL, one agent — P5a-AUTH, on the critical path) Consumer-binding + Privy-JWT middleware.** Per the P0-C auth spike: a shared middleware module that verifies the Privy JWT, resolves `consumer_id`, supplies the human approver identity for `decided_by`, and enforces consumer scoping on `/v1/runs` + `/v1/approvals` (removes the client-side "security theater"; the browser never sends `X-Service-Key`). **Every resource route depends on this — merge it before the resource agents start.** This is on the critical path (P5 + P6 DoD both require real server-side consumer scoping).

Then, **in parallel (one agent per module, after 1+2 land):**
- `GET /v1/integrations` — `{ integrations: IntegrationStatus[] }` (promote `console.ts integrationStatus()`; **must reflect the WORKER's actual config, not just api env** — R5). Add `IntegrationStatus` to contract.
- `GET /v1/consumers/:id/quota` — promote `quotaLedger`; add `Quota` type to contract.
- Schedules CRUD — `POST/GET /v1/workflows/:id/schedules`, `PATCH/DELETE /v1/schedules/:id`; add `Schedule` type.
- `GET /v1/workflows/:id/runs?status=&consumer=` — per-workflow runs filter (missing today).
- `GET /v1/runs/:id/logs` — run timeline; add `RunLogEntry` type.
- Reports — `GET /v1/reports/workflow-stats`, `/consumer-usage`, `/approvals-metrics`; add `Report` type(s).
- **(Stretch) Approval retry / manual dispatch.**
- **Approval audit query — DESCOPED from M2** unless it backs the P2 inline `AuditTrail`. Decision: descope (no standalone audit UI in M2); revisit when a dedicated audit view is specced. Do not ship an endpoint with no consumer.

**Envelope + error-code discipline (resolves the unspecified-envelope gap):** Each endpoint documents its exact success envelope nested key, matching today's conventions (`{ runs }`, `{ approvals }`, approve `{ approvalId, state, runId }`). All errors reuse the **existing** `ErrorEnvelope` + fixed `ERROR_CODES` enum (`SKILL_NOT_FOUND, ARGS_INVALID, SKILL_EXEC_ERROR, SKILL_TIMEOUT, QUOTA_EXCEEDED, APPROVAL_REQUIRED, APPROVAL_DENIED`) + `ERROR_HTTP_STATUS` (note: **both `APPROVAL_REQUIRED` and `APPROVAL_DENIED` map to 403** — the client must read `error.code`, not the status, to distinguish them). If reports/quota need a new code, that is an explicit `ERROR_CODES` + `ERROR_HTTP_STATUS` contract change — flag it in the PR; reuse existing codes where possible.

### P5b — Client wiring (per-surface gating)
- `web/src/lib/api.ts` — finalize `apiFetch<T>()`: 3-retry exp-backoff, 30s timeout, network-only retry, **`Authorization: Bearer <Privy JWT>` only (NO `X-Service-Key` in the browser)**, FormData support, error-envelope parsing → typed errors mapping the **two distinct 403 codes** (`APPROVAL_REQUIRED` vs `APPROVAL_DENIED`) by reading `error.code`.
- `web/src/hooks/` — one hook per surface, swapping mock→`apiFetch`: `use-approvals.ts`, `use-approval-decision.ts`, `use-runs.ts`, `use-run.ts`, `use-run-logs.ts`, `use-workflows.ts`, `use-schedules.ts`, `use-integrations.ts`, `use-quota.ts`, `use-reports.ts`.
- `MutationCache.onError → toast.error` for all mutations.
- Approve/reject optimistic updates + invalidation of `["approvals"]` + `["runs"]`, aligned to the **real POST-flip/child-run/partial-failure semantics** confirmed in P0-B (so the P2 state model and P5b optimistic logic cannot diverge).

### Parallel lanes
- **Lane P5a-refactor (serial)** → **Lane P5a-auth (serial, critical path)** → **Lanes P5a-resource\*** (parallel, one per module).
- **Lane P5b (client hooks):** per-surface freeze. **What is actually gate-free vs. gated:**
  - **Gate-free once their contract type exists (P0-B already added `ApprovalView`/`RunListItem`):** approvals list, approve, reject, runs list, run detail — BUT they still depend on **P5a-auth** for real consumer scoping per the P5 DoD. So "wire-now" means "build the hook now; full DoD (consumer-scoped) gates on P5a-auth."
  - **Gated on their P5a endpoint + contract type:** schedules, integrations, quota, reports, per-workflow runs, logs.
  - **No global freeze barrier** — each hook gates only on its own reconciled fixture + endpoint.

### Serialization (the key gate)
P5a-refactor → P5a-auth → P5a-resource(parallel). P5b per-hook: each gates on (its contract type ∈ committed) ∧ (its endpoint landed for new ones) ∧ (P5a-auth landed, for the consumer-scoped DoD).

### Definition of Done
- All surfaces read live `/v1` data with mocks removed (or behind `VITE_USE_MOCKS` for demo).
- Approve/reject round-trips create the dispatched child run and refresh the queue.
- **Consumer scoping enforced server-side via Privy-JWT→consumer_id; cross-consumer request rejected; no `X-Service-Key` in the browser.**
- `packages/contract` is the single source of truth for all shapes; every endpoint's envelope documented and matched in mocks/hooks; the two 403 codes handled distinctly client-side.

---

## P6 — Privy Auth

**Goal:** Gate the workspace behind Privy login; inject the Privy access token (only) into `apiFetch`.

### Tasks
- `web/src/providers/PrivyProvider.tsx` (fills the P0 stub) — `<PrivyProvider appId={VITE_PRIVY_APP_ID} ...>`; **B2B console, NOT a wallet app — disable embedded-wallet auto-create, no wagmi.**
- `web/src/components/auth/ProtectedRoute.tsx` — `usePrivy().ready/authenticated`; `LoadingState` while not ready, `<Navigate>` to login when unauthenticated.
- `web/src/pages/SignIn.tsx` — Privy `login()` via `useLogin`.
- `web/src/lib/api.ts` — `getAccessToken()` per request → `Authorization: Bearer`. **No `X-Service-Key` from the browser** (machine secret stays server-side). The engine-api accepts the Privy JWT and maps it to `consumer_id` via the P5a-auth middleware.
- Env: `VITE_PRIVY_APP_ID`, `VITE_API_URL`, `VITE_SENTRY_DSN` (baked at build via Dockerfile ARGs).

### Parallel lanes
- **Lane P6-A (Privy provider + SignIn):** can be built early (parallel to P5); edits only its own provider file + a new page (no `main.tsx` contention thanks to `AppProviders`).
- **Lane P6-B (token injection + route gating of live data):** gates on **P5a-auth** (backend must accept Privy JWT) + P5b hooks existing.

### Serialization
P6-B gates on P5a-auth + P5b. P6-A is independent.

### Definition of Done
Unauthenticated users hit SignIn; authenticated requests carry a valid Privy JWT (and nothing else); engine-api authorizes by `consumer_id` resolved from that JWT; `decided_by` reflects the human approver.

---

## P7 — i18n + Locale/Currency

**Goal:** English-first + ES-MX string catalogs, per-tenant currency formatting. Custom-context pattern (no react-i18next).

### Tasks
- `web/src/providers/LanguageProvider.tsx` (fills the P0 stub) + `web/src/lib/i18n.tsx` — `useLanguage()` + `useContent()` (port from `landing-godinez-ai/src/lib/i18n.tsx`); locales `"en"` primary / `"es-MX"`; persist to `localStorage` (`godin-locale`).
- `web/src/lib/content-en.ts` (primary) + `web/src/lib/content-es.ts` — parallel typed catalogs; namespace by surface; `export type Content = typeof contentEn`. **`content-es.ts` is gated on `content-en.ts` being complete per surface** (it's the type source).
- `web/src/lib/i18n-currency.tsx` — `getFormattedPrice(amount)` via `Intl.NumberFormat`; **currency derived from TENANT (Mi Pase→MXN, Vino→USD), not user pref**; locale from user pref.
- Wire `LocaleToggle` (P1) to `toggleLocale`.
- **String replacement is gated per-surface** (resolves the write-contention contradiction): the i18n infra + catalogs are new files (no contention, build in parallel from Wave 2), but the **per-surface string sweep waits until that surface's component lane reports DoD** — never run concurrently with active authoring.
- Money in batch table / reports / stat tiles uses `getFormattedPrice`.

### ES-MX domain copy (resolves the "translation is mechanical" error)
Translation of specialized pricing copy ("below-15%-floor anomaly", "cost-unknown", margin-floor callouts, competitor names, approval copy) is **NOT mechanical extraction**. Add an explicit task: **ES-MX domain-copy authorship/review by a Spanish-native reviewer** (separate from `Intl` formatting), budgeted as its own line item. `content-es.ts` ships only after that review per surface.

### Parallel lanes
- **Lane P7-A (i18n infra + EN catalog scaffolding):** new files, parallel from Wave 2.
- **Lane P7-B (currency wiring):** gates on TenantProvider (P1).
- **Lane P7-C (per-surface string sweep):** each surface gates on its component-lane DoD.
- **Lane P7-D (ES-MX domain translation/review):** gates on per-surface EN catalog completion.

### Definition of Done
Toggle flips EN↔ES-MX with persistence; MXN for Mi Pase, USD for Vino; dates/numbers locale-aware; no hardcoded user-facing strings remain (verified per surface after that surface's sweep); ES-MX domain copy reviewed by a Spanish-native reviewer.

---

## P8 — Deploy + CI on Railway

**Goal:** `@godin-engine/web` as its own Railway service, built via Dockerfile (Tailwind v4 native-binary safety), CI green.

### Tasks
- `web/Dockerfile` — **pokta-care two-stage Dockerfile** (NOT Nixpacks): `node:22-slim` build stage, `corepack enable` pinning **pnpm 10.26.1** (root-authoritative — NOT 9.15.0), copy whole workspace, `pnpm install --no-frozen-lockfile`, accept `ARG VITE_API_URL / VITE_PRIVY_APP_ID / VITE_SENTRY_DSN`, run `pnpm --filter @godin-engine/web build` (= `tsc --noEmit && vite build` — works because the contract-seam decision in P0 made the repo build with this command); runtime stage `serve -s dist -l ${PORT:-8080}`. **No `preDeployCommand`** (static build — do NOT copy the api service's `db:migrate` preDeploy).
- `web/railway.json` — `builder: DOCKERFILE`, `dockerfilePath: web/Dockerfile`; `watchPatterns: ["web/**","packages/**",".npmrc","package.json","pnpm-lock.yaml"]`; `restartPolicyType: ON_FAILURE`, `maxRetries: 3`.
  > engine-api/worker use NIXPACKS; the SPA deliberately uses Dockerfile. Per repo memory: **one worker only, explicit Watch Paths per service** — set web's watch paths so api/worker redeploys don't rebuild the SPA and vice-versa.
- **Service-creation sequencing (resolves chicken-and-egg):** confirm the Railway project supports a **3rd service**; document who creates it (CLI vs dashboard). **engine-api must have a stable PUBLIC domain BEFORE baking `VITE_API_URL`** (build-time ARG). Note: changing `VITE_API_URL` requires a **rebuild, not a restart** (ties to the "env read-once" repo memory).
- Railway service env (build-time ARGs + runtime): `VITE_API_URL`, `VITE_PRIVY_APP_ID`, `VITE_SENTRY_DSN`, `PORT`.
- `web/src/lib/sentry.ts` — `initSentry()` called from `web/src/main.tsx` (single line; `main.tsx` ownership stays with P0-A — Sentry init is the one allowed addition, landed as a reviewed diff).
- `.github/workflows/ci.yml` — **extend the existing job**: add `pnpm --filter @godin-engine/web build` + `typecheck`. No second pnpm pin; Node 22 already set.
- `web/.env.example`.

### Parallel lanes
- **Lane P8-A (Dockerfile + railway.json + service creation):** Dockerfile/railway.json can be drafted during P0/P1, but **local validation of `pnpm --filter @godin-engine/web build` gates on the P0 contract-seam decision** (it must succeed locally with the exact command before the Dockerfile is meaningful). End-to-end deploy validation gates on P5 (live data) + P6 (auth) + engine-api public domain.
- **Lane P8-B (CI lane + Sentry):** parallel.

### Serialization
Local build validation gates on P0 contract-seam. Final deploy validation gates on P5 + P6 + engine-api public domain provisioned.

### Definition of Done
Web service deploys on Railway from the monorepo (3rd service confirmed), serves the SPA with SPA-fallback, baked Vite envs correct (`VITE_API_URL` points at the live engine-api domain), CI green on PR (single pnpm pin, Node 22), Sentry receiving errors, healthcheck on `/`, no `preDeployCommand`.

---

## Accessibility (cross-cutting — line item in every surface DoD)

Resolves the near-absent a11y coverage. Owned partly by P1 primitives, partly by per-surface tasks:
- **Virtualized batch table (P2-B):** `aria-rowcount` (total logical) + `aria-rowindex` per row so SR row counts survive windowing; keyboard tab + arrow navigation across virtualized rows.
- **6-state machine (P2-A):** focus management contract (where focus goes on submit/success/error), `aria-live="polite"` announcements for async approval results, focus-trap in confirm dialogs.
- **Pills/badges (P1):** icon+label never color-alone (already a design rule) + accessible names on icons.
- **Segmented controls (P1 LocaleToggle, any other):** `role="radiogroup"` semantics.
- **Contrast audit (P1-C):** verify `#19A662` green / amber / brick-ember on light surfaces meet WCAG AA; risk-tier tokens contrast-checked before consumption.
- **Reduced motion:** button stamp + pipeline-flow animations honor `prefers-reduced-motion`.
**DoD:** each surface's "all states render" DoD includes its a11y items above.

---

## States matrix (every data surface — loading / empty / error / 403 / loaded)

Resolves the unmapped state coverage. Each surface must render all five:

| Surface | Phase | Notes |
|---|---|---|
| Approvals queue | P2 | 6-state machine (superset) |
| Workflows list | P3-A | was uncovered |
| Workflow detail | P3-A | empty/running/failed/idle (domain states) + 403 |
| Runs list | P5b/P3 | |
| Run detail | P3-B | + all-clear + partial-failure |
| Integrations | P4-A | behind `VITE_USE_MOCKS` |
| Reports index | P4-B | |
| Report detail | P4-B | |
| Quota | P5 | once endpoint lands |
| Settings | P4-C | read-only/"coming soon" non-read surfaces |

---

## Risks & Open Gaps (tracked)

| # | Risk / Gap | Phase | Mitigation |
|---|---|---|---|
| R1 | Light-surface form fields undefined | P1-C-forms | `light-form-fields.css` new file; gates forms ONLY (ScheduleEditor, Settings). |
| R2 | Risk-tier palette — no 4th brand color exists | P1-C-risk → **brand owner** | Default 3 tiers (no new color). 4th tier needs Mel's brand sign-off (Open Decisions). `.risk-*` in separate `risk-tiers.css`. |
| R3 | Tenant theming mechanism | P1 | `data-tenant` + config object; light base locked; no per-tenant CSS. P4-Z proves it. |
| R4 | Missing engine-api endpoints | P5a | After route-module refactor + auth middleware (serial), parallelize per module. |
| R5 | Worker vs api config drift for `/v1/integrations` | P5a | Integration status must reflect WORKER config, not api env. |
| R6 | Consumer scoping = client-side theater today | P5a-auth/P6 | Server-side Privy-JWT→consumer_id; no `X-Service-Key` in browser. On critical path. |
| R7 | Batch table performance | P2-B | `react-virtuoso` (pinned, React-19 confirmed); sticky header/action bar. |
| R8 | Mock↔real contract drift; integration providers/types don't exist | P0-B/P5a | Add `ApprovalView`/`RunListItem`/`IntegrationStatus`/`Schedule`/`Report`/`Quota` to contract BEFORE mocks; `IntegrationStatus ≠ IntegrationResult`. |
| R9 | Tailwind v4 native binary on Railway | P8 | Dockerfile + oxide/lightningcss `optionalDependencies` pins. |
| R10 | Auth model ambiguity | P0-C/P5a/P6 | Decided: Privy JWT only; backend middleware resolves consumer_id + approver identity. |
| R11 | Audit trail surface | P2/P5a | Inline expandable `AuditTrail` only; standalone audit endpoint DESCOPED from M2. |
| R12 | Railway watch-path bleed; env read-once; 3rd service | P8 | Precise `watchPatterns`; confirm 3rd service; `VITE_API_URL` change = rebuild; engine-api domain before bake. |
| R13 | Monolithic `engine-api/src/index.ts` merge hazard | P5a | Serial route-module refactor first; shared middleware merged before parallel endpoints. |
| R14 | `main.tsx`/`index.css`/`App.tsx` hub-file contention | P0/P1 | `AppProviders` composition + file-ownership table; provider bodies in per-lane files. |
| R15 | i18n retrofit churn + domain translation | P7 | Per-surface sweep gated on surface DoD; ES-MX domain copy is a reviewed task, not extraction. |
| R16 | Schedule editor writes nowhere | P3/P5a | Read-only "editing coming soon" until Schedules CRUD lands. |
| R17 | Pricing artifact shape guessed | P2-B | Derive batch mock from `workflows/pricing/` manifest input Zod; artifact typed `unknown` + `workflowId` discriminator. |

---

## Agent Staffing Summary (parallel-safe waves)

- **Wave 1 (immediately parallel):** P0-A scaffold (lockfile-first) · P0-B contract audit + Approval/Run **response types** · P0-C **auth-model spike** · P5a **route-module refactor** (serial) · P1-C-forms · P1-C-risk (pending brand sign-off).
- **Wave 2 (after core tokens P1-A0 — THE GATE):** P1-A1 button/pill → P1-B shell ‖ P1-A2 other primitives · P2-A type contract → (P2-B ‖ P2-C ‖ P2-A state machine) · P3-A ‖ P3-B · P4-A ‖ P4-B ‖ P4-C Settings · P4-Z Vino acceptance · P7-A i18n infra · P6-A Privy provider · P5a-auth middleware (serial, after refactor) → P5a resource endpoints (parallel) · P8-A/B infra scaffolding.
- **Wave 3 (after per-surface fixtures frozen + P5a-auth + matching endpoints):** P5b client wiring (per-hook agents) · P6-B token+gating · P7-B currency · P7-C per-surface sweeps · P7-D ES-MX domain review.
- **Wave 4 (integration):** P8 deploy validation (after engine-api public domain) · canary.

**Protect the critical path:** P0 → CONTRACT-TYPES → P1-A0 → P1-A1 → P1-B → P2-A(contract) → P2-B → **P5a-auth** → P5b(approvals) → P6-B → P8. Staff this chain (especially the **auth middleware**, the most under-staffed real-critical item) with your most senior agents; everything else is parallel ballast.

**Key plan file:** commit to `/Users/mel/workspaces/poktalabs/projects/godinez-ai/godin-engine/code/godin-engine-v0.1/docs/feature-requests/customer-dashboard/M2-implementation-plan.md`. P1-C outputs land beside it as `light-form-fields.css` + `risk-tiers.css`; contract additions land in `packages/contract/src`.

---

## Changes from draft (critique resolved)

**Critical (6):**
1. **Contract-build seam fixed.** Repo is `noEmit:true` with no composite anywhere; `tsc -b` would break referencing `contract`. Locked to `tsc --noEmit && vite build` + Vite Bundler resolution to `contract/src`; pinned as an explicit P0 sub-decision and reflected in `package.json` scripts. P8 Dockerfile inherits the fixed command and its local validation gates on this decision.
2. **"Wire-now" hooks de-mythologized.** Verified the endpoints exist but their **response types don't** in `contract`. Added `ApprovalView`/`RunListItem`/`RunDetail` as an early P0-B deliverable; fixtures freeze against the new types, not today's contract.
3. **Settings surface built.** Added P4-C (page, components, 4-state matrix, mock data, descoped credential editing) so the routed/nav'd Settings is no longer a dead link; alternative explicit-removal path documented.
4. **Renderer contract specified.** P2-A now commits an explicit `ApprovalRenderer` interface (props, per-item decision flow, `failedItemIds` partial-failure mapping) before B/C fork; split into a tiny type contract (gate) + state-machine impl (parallel).
5. **Integrations contract reconciled.** Verified `IntegrationResult` is `notion|resend` run-output only. Introduced a separate `IntegrationStatus` catalog type, added to contract via P5a **before** P4 mocks; all invented providers flagged mock-only behind `VITE_USE_MOCKS`.
6. **engine-api monolith refactor.** Made the first P5a task a serial route-module split + a single-owner consumer-scoping/Privy-JWT middleware, eliminating the worst merge hazard; endpoints parallelize only after both land.

**High (9):**
7. P1-A over-serialization split into A0 (core tokens = the only hard gate), A1 (button/pill, gates shell), A2 (other primitives, parallel with shell).
8. P1-C risk tokens moved to a separate `risk-tiers.css` (no concurrent edit to `index.css`/`status-tokens.css`); read-dependency on existing tokens noted; escalated to a brand decision.
9. Approval/Run **response types** pulled out of P5a into an early P0-B gate so P2 fixtures have a real type to freeze against.
10. Critical path redrawn through **P5a-auth** (both P5 and P6 DoD require server-side consumer scoping); auth-model spike scheduled in Wave 1 with an owner.
11. Shared-file contention resolved with `AppProviders.tsx` composition + an explicit file-ownership table; `main.tsx` frozen after P0.
12. P5a real-semantics alignment: P0-B documents approve/reject child-run + 409 + partial-failure shape; P2 state machine reviewed against it before freeze.
13. Repo-state errors corrected: pnpm **10.26.1** (not 9.15.0), Node 22 standardized, CI **extends** the existing job (no double pnpm pin), `light-form-fields.css` removed from "already in repo."
14. Accessibility added as a cross-cutting section + per-surface DoD line items (virtualized-table `aria-rowcount/rowindex`, focus mgmt + live regions, `role="radiogroup"`, dialog focus-trap, contrast audit, reduced-motion).
15. Risk-tier brand-governance escalated: default 3-tier no-new-color path; 4th color requires Mel's sign-off.

**Medium/Low folded in:** canonical provider nesting (Privy⊃Query) as a P0 artifact; pnpm/Node Dockerfile + corepack corrected; lockfile-regeneration made an explicit P0 first task with frozen-lockfile dependency; P1-A fanned into parallel primitive sub-lanes; P1-C decoupled from the token gate (batch renderer needs neither form fields nor risk tokens); P2-A frame split into contract vs. implementation; mock-freeze made per-surface (no global barrier); P7 string-sweep gated per-surface-DoD with a real ES-MX domain-translation task; states matrix added for every data surface; auth model resolved (Privy JWT only, no browser service key); ScheduleEditor ships read-only until P5a; envelope + two-403-code error mapping specified against the real `ERROR_CODES`; tenant theming verified via owned P4-Z Vino acceptance; P8 service-creation sequencing (3rd service, engine-api domain before bake, no preDeploy); react-virtuoso React-19 check + audit-endpoint/UI scope reconciled (inline only; standalone endpoint descoped); pricing artifact mock derived from the real `workflows/pricing/` manifest input.

## Decisions resolved (Mel, 2026-06-08)

1. **Risk-tier color → 3 tiers, NO new color.** Low = `--muted-foreground`, Medium = `--status-warn` (amber), High = `--status-fail` (brick ember); very-high folds into High. `risk-tiers.css` (P1-C-risk) uses existing tokens only — no `tokens.css` brand change. Unblocks P2-C single-action risk badges + P4-A integration badges with no governance gate.
2. **Settings → read-only for M2.** Build the page: tenant profile + integration status + user roster, all read-only. No credential editing (no backend in M2). Nav link stays live. (P4-C proceeds as specced.)
3. **ScheduleEditor → daily-time picker + raw-cron.** Friendly daily-time picker (Mi Pase "6 AM") for operators plus a raw-cron field for power users / Vino event triggers. Editing stays disabled until Schedules CRUD ships (P5a). (P3 builds both inputs, read-only initially.)
4. **Audit endpoint.** Confirm descoping the standalone "query approvals by approver/time/outcome" endpoint for M2 (inline `AuditTrail` only). Build it only if you want a dedicated audit view this milestone.