# BRIEF — F1: Notion CRM integration

- **TICK:** TASK-001
- **Branch:** `feat/notion-crm-integration` (from `feat/foundation-demo-integrations`)
- **PR into:** `feat/foundation-demo-integrations`
- **Lane:** A

## Goal

After gate 1 (the owner approves the drafted CRM entry), the engine writes a
**real row** to the Notion CRM database. Replaces the simulated CRM commit in
`proposal-step`. (Decision D2: in-place, no new workflow.)

## Where the write lives — read this twice

The write happens in **`proposal-step`** (which runs *after* gate-1 approval),
**NOT in `call-intake`**. `call-intake` only *drafts* the CRM entry pre-approval;
the drafting agent must never commit (AGENTS.md hard rule: "the drafting agent
cannot self-approve"). The committed side effect is post-approval, which the gate
chain already enforces.

## Files you own (touch these)

- `packages/notion/src/index.ts` — implement `commitCrmEntry()` (stub is in place).
- `packages/notion/src/index.test.ts` — expand the seed test.
- `workflows/src/proposal-step/index.ts` — call Notion, record the outcome.

## Do NOT touch

- ❌ `call-intake/*` — drafting only, no commit.
- ❌ `workflows/src/index.ts` (the registry) — no new workflow (D2).
- ❌ `packages/contract/*` — the `IntegrationResult` seam is frozen (D5); don't add manifest fields.
- ❌ `send-step/*`, `engine-api/src/dashboard*` — other lanes.
- ❌ `pnpm-lock.yaml` deps for Notion — `@notionhq/client` is already installed in Phase 0.

## The seam (frozen — `packages/contract/src/integration.ts`)

`proposal-step` output gains `crmResult: IntegrationResult`:

```ts
{ provider: 'notion', status: 'ok'|'failed', ref?: pageId, url?: pageUrl, error?: string, at: ISOstring }
```

## Implementation

1. **`packages/notion`** — use `@notionhq/client`. Read `NOTION_API_KEY` +
   `NOTION_CRM_DB_ID` from env (mirror `packages/llm`: env-read, **throws** when
   unconfigured or on API error; caller owns the fallback). `commitCrmEntry(row)`
   creates a page in the CRM database and returns `{ pageId, url }`. Map `CrmRow`
   fields onto the Notion DB properties (title = opportunityName, etc.).
2. **`proposal-step/index.ts`** — after the proposal/email is drafted, attempt the
   CRM write. Wrap in try/catch:
   - success → `crmResult = { provider:'notion', status:'ok', ref:pageId, url, at }`
   - failure → `crmResult = { provider:'notion', status:'failed', error:msg, at }`
     and **continue** — the proposal must still be returned, gate 2 still opens (D3).
   Add `crmResult` to `ProposalOutput`.

## Rules

- Notion client: env-read, throw on error. No DB/secrets via `ctx`.
- Fail-soft: a Notion failure never throws out of `run()` and never discards the proposal.
- Order so the drafted proposal survives a CRM failure.

## Tests (D6)

- `packages/notion`: mock `@notionhq/client` — success returns `{pageId,url}`; API error throws.
- `proposal-step`: mock the notion module — ok path sets `crmResult.status='ok'`;
  throw path sets `status='failed'`, proposal still drafts, run resolves.

## Acceptance

- Approving gate 1 creates a real, correct row in the Notion CRM database.
- `output.crmResult.status='ok'` with a working page URL.
- Bad/missing key → `status='failed'`, proposal still drafts, run succeeds, dashboard shows red outcome.
- `pnpm typecheck && pnpm test` green.

## Ops

- Set `NOTION_API_KEY` + `NOTION_CRM_DB_ID` on the Railway **worker** (the worker runs `run()`).
- **Redeploy the worker** after setting env — it reads env once at module load (STATUS gotcha).
- Share the CRM database with the integration in Notion, or the API can't see it.

When done: write `REPORT.md` here (what shipped, the field mapping you chose, how to verify, follow-ups).
