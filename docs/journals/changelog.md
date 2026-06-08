# Changelog — godin-engine

## 2026-06-08 — M1 (first client workflow) shipped + M2 dashboard reframed tenant-agnostic

Type: change
Approval: internal-only

Context:
- godin-engine v0.1 (governed agent-orchestration engine). Session covered M1 ship + M2 design start.

What happened:
- **M1 shipped.** A validated, externally-built daily-pricing pipeline (TS/JS) was *rewritten* into
  the engine's `manifest` + `run(input, ctx)` chained-run contract (preserve the tested pure logic,
  re-shape orchestration + IO). PR #5 squash-merged to `main`. 273/273 tests green.
- **CI proven.** GitHub Actions with an ephemeral `postgres:16` service + branch protection on a
  required `test` check; the integration test runs against real Postgres in CI, then tears down.
  One bug caught + fixed: `pnpm/action-setup@v4` failed because the pnpm version was specified twice
  (workflow `version: 10` + `package.json` `packageManager`). Removed the explicit version.
- **M2 design reframed.** The customer dashboard started as a single-client app, then got pulled into
  a **tenant-agnostic governed agent-workflow workspace** once a second, very different client was put
  beside the first. Deliverable: a Claude-Design generation prompt
  (`docs/feature-requests/customer-dashboard/CLAUDE-DESIGN-PROMPT.md`).

Why it matters:
- First real client workflow now runs under the engine's lifecycle/governance/observability instead
  of as an external script. The dashboard direction is now general (a product), not a one-off.

Evidence:
- See `proof-ledger.md` (PR #5, CI run, test count, files).

Content potential:
- Strong build-in-public angle: the dashboard pivot + the CI-caught bug. Drafted in `content-backlog.md`.

Boundary:
- Client names + client pricing numbers stay abstracted in anything external until Mel authorizes.
