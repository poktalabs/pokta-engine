# Proof Ledger — godin-engine

## 2026-06-08 — M1 shipped + CI proven

Claim supported:
- The first client workflow was rewritten into the engine and merged with passing CI.

Evidence:
- PR #5 (`feat/m1-mi-pase-pricing` → `main`), squash-merged: github.com/poktalabs/pokta-engine/pull/5
- CI run on the PR: `test` check green (~47s) with a `postgres:16` service; first run failed at
  `pnpm/action-setup@v4` (doubled pnpm version) — fix commit `f803045`.
- Local: `pnpm test` → 273/273 pass, 0 skipped.
- `.github/workflows/ci.yml` (postgres service + migrate step + branch protection on `test`).
- New code: `workflows/pricing/*`, `packages/shopify/*`, `packages/mercadolibre/*`,
  `packages/db/src/schema.ts` (`engine_workflow_state`), `worker/src/{dispatch,integration-resolver,provider-config,reaper}.ts`.

What it proves:
- The rewrite-not-wrap path works end-to-end and is gated by CI against a real database.

What it does not prove:
- No real client side effects yet — creds (`MIPASE_*`) not set on the Railway worker; runs against a
  Shopify **dev** store only. No production-price writes (gated on margin validation). No real
  user/operator has used the dashboard (M2 is at the design-prompt stage, no UI built).

Approval:
- internal-only (our own ship metrics are fine to share; client outcomes are not yet authorized).

---

## 2026-06-08 — M2 dashboard reframed tenant-agnostic

Claim supported:
- The dashboard is being designed as a tenant-agnostic governed-workflow workspace, not a single-client app.

Evidence:
- `docs/feature-requests/customer-dashboard/CLAUDE-DESIGN-PROMPT.md` (two contrasting tenants;
  Approvals queue as universal heart with a pluggable item renderer; English-first + i18n).
- `docs/feature-requests/customer-dashboard/DESIGN.md` (approved direction).

What it proves:
- The design abstraction is documented and grounded in two real, structurally different workflows.

What it does not prove:
- Nothing is built. The prompt has not been run through Claude Design yet; no Vite SPA exists.

Approval:
- internal-only.
