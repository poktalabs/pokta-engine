# Feature requests — demo integrations + operator dashboard

Parallel work for the Vino call→proposal demo. Each feature is one lane, built in
its own worktree, PR'd back into the integration branch.

## Branching model

```
master
  └─ feat/foundation-demo-integrations   ← integration branch (Phase 0 lives here)
       ├─ feat/notion-crm-integration     → PRs into feat/foundation-demo-integrations
       ├─ feat/resend-email-integration   → PRs into feat/foundation-demo-integrations
       └─ feat/operator-dashboard         → PRs into feat/foundation-demo-integrations
```

All three lane branches **branch from** and **PR into**
`feat/foundation-demo-integrations` (NOT `master`). The foundation branch
collects all three, then goes to `master` as one reviewed unit.

## Lanes

| Dir | Feature | Branch | TICK | Owns |
|---|---|---|---|---|
| [`notion-crm/`](notion-crm/BRIEF.md) | Real Notion CRM write | `feat/notion-crm-integration` | TASK-001 | `packages/notion`, `proposal-step` |
| [`resend-email/`](resend-email/BRIEF.md) | Real Resend send | `feat/resend-email-integration` | TASK-002 | `packages/resend`, `send-step` |
| [`operator-dashboard/`](operator-dashboard/BRIEF.md) | `/dashboard` operator view | `feat/operator-dashboard` | TASK-003 | `engine-api/src/dashboard*` |

## Ground rules (all lanes)

1. **Branch from `feat/foundation-demo-integrations`**, PR back into it.
2. **Stay in your lane's files** (see each BRIEF's "owns" / "do NOT touch").
3. The integration seam `IntegrationResult` (`packages/contract/src/integration.ts`)
   is **frozen** — read it, don't change it.
4. Integration failure is **fail-soft**: catch, record an `IntegrationResult` in the
   run output, never throw out of `run()` (decision D3).
5. Run `pnpm typecheck && pnpm test` green before opening your PR.
6. When done, write `REPORT.md` next to your `BRIEF.md` (what shipped, decisions,
   how to verify, any follow-ups).

Full plan + eng-review rationale: `../../../workstreams/v0.1-spike/PLAN-demo-integrations.md`
(decisions referenced as D1–D6).
