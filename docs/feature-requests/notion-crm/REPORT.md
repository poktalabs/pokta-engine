# REPORT — F1: Notion CRM integration

- **TICK:** TASK-001
- **Branch:** `feat/notion-crm-integration` → PR into `feat/foundation-demo-integrations`
- **Lane:** A

## What shipped

After gate-1 approval, `proposal-step` now writes a **real row** to the Notion CRM
database instead of simulating it. The simulated commit is replaced by an actual
`@notionhq/client` `pages.create` call, recorded as an `IntegrationResult` on the
workflow output.

### Files changed

- `packages/notion/src/index.ts` — implemented `commitCrmEntry(row)`. Lazily
  constructs a `@notionhq/client` `Client` from env (`NOTION_API_KEY`,
  `NOTION_CRM_DB_ID`). Mirrors the `packages/llm` discipline: throws when
  unconfigured or on API error; the caller owns the fallback. Returns
  `{ pageId, url }`.
- `packages/notion/src/index.test.ts` — expanded from the Phase-0 seed: mocks
  `@notionhq/client`, asserts success returns `{pageId,url}`, asserts the property
  mapping, asserts API error throws, asserts unconfigured throws (no API call),
  and covers url synthesis when the API response omits `url`.
- `workflows/src/proposal-step/index.ts` — drafts the proposal/email FIRST, then
  attempts the CRM write fail-soft (D3). Adds `crmResult: IntegrationResult` to
  `ProposalOutput`. A Notion failure records `status:'failed'` and continues —
  `run()` never throws, the proposal survives, gate 2 still opens.
- `workflows/src/proposal-step/index.test.ts` (new) — mocks `@pokta-engine/notion`
  and `@pokta-engine/llm`: ok path → `crmResult.status='ok'` with ref+url; throw
  path → `status='failed'`, proposal still drafts, run resolves; verifies the
  approved `CrmEntry` is passed through to `commitCrmEntry`.

Untouched (per constraints): `call-intake/*`, `send-step/*`,
`workflows/src/index.ts`, `packages/contract/*`, `engine-api/*`,
`packages/resend/*`, the `IntegrationResult` seam, and the Notion deps in the
lockfile (`@notionhq/client` already present from Phase 0; resolved to 2.3.0).

## Notion field mapping (`CrmRow` → Notion DB property)

| CrmRow field      | Notion property    | Notion type    | Notes |
|-------------------|--------------------|----------------|-------|
| `opportunityName` | `Opportunity`      | **title**      | The DB's required title property. |
| `account`         | `Account`          | `rich_text`    | |
| `contactName`     | `Contact`          | `rich_text`    | |
| `stage`           | `Stage`            | `select`       | Option created on the fly if it doesn't exist. |
| `estimatedValue`  | `Estimated Value`  | `rich_text`    | Value is a formatted string (e.g. `"$135,000"`), not a clean number — stored as text to avoid parse loss. |
| `summary`         | `Summary`          | `rich_text`    | Truncated to 2000 chars (Notion rich_text limit per block). |
| `tags`            | `Tags`             | `multi_select` | Each tag becomes an option (created on the fly). |

The target Notion database MUST have these exact property names/types, with the
title property named **`Opportunity`**. If the operator's DB uses different
property names, either rename the DB properties to match or adjust the mapping in
`packages/notion/src/index.ts` (mapping is the only DB-shape coupling).

## How to verify

### Env (set on the Railway **worker** — it runs `run()`)
- `NOTION_API_KEY` — Notion internal integration token.
- `NOTION_CRM_DB_ID` — target CRM database id.

### Notion setup
1. Create/identify the CRM database with the properties above.
2. **Share the database with the integration** (Notion → database → ⋯ → Connections
   → add your integration) or the API returns "could not find database".
3. Set both env vars on the worker, then **redeploy the worker** — env is read once
   at module load (STATUS gotcha noted in the brief).

### Manual smoke
- Run the Vino pipeline, approve gate 1. A new row appears in the CRM database with
  the opportunity name as the title. `output.crmResult.status='ok'` and
  `output.crmResult.url` opens the page.
- Bad/missing key or unshared DB → `output.crmResult.status='failed'` with the
  error string; the proposal still drafts, the run still succeeds (green), and the
  dashboard renders the red outcome.

## Test results

- `pnpm typecheck` — green (all 9 workspace projects).
- `pnpm test` — green, 10/10 (notion 5, proposal-step 3, resend 2 existing).

## Follow-ups / uncertainties

- **DB property names are assumed.** The mapping uses `Opportunity`, `Account`,
  `Contact`, `Stage`, `Estimated Value`, `Summary`, `Tags`. Real-provider
  verification against the actual demo database is the manual staging step — if the
  DB schema differs, the create call will fail (fail-soft handles it; row just
  won't write until names align). Confirm/adjust at staging.
- `estimatedValue` is stored as text. If the demo DB wants a Notion `number`
  property for roll-ups, we'd need to parse the currency string — deferred since
  the upstream value is a formatted string and lossy to parse.
- `url` is read defensively from the create response; on the rare partial-object
  response we synthesize `https://www.notion.so/<id>`. Verified by unit test, not
  against a live partial response.
- Credentials are not set locally (expected). All verification here is via mocked
  unit tests; live Notion write is the staging step above.
