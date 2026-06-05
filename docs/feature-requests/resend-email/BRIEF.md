# BRIEF — F2: Resend email integration

- **TICK:** TASK-002
- **Branch:** `feat/resend-email-integration` (from `feat/foundation-demo-integrations`)
- **PR into:** `feat/foundation-demo-integrations`
- **Lane:** B

## Goal

After gate 2 (the owner approves the outbound email), the engine sends a **real
email** via Resend. Replaces the simulated send in `send-step`. (Decision D2:
in-place, no new workflow.)

## Where the send lives

The send happens in **`send-step`**, which runs *after* gate-2 approval and is the
**terminal** step. The drafted email comes in as the approved artifact; you send it.

## Files you own (touch these)

- `packages/resend/src/index.ts` — implement `sendEmail()` (stub is in place).
- `packages/resend/src/index.test.ts` — expand the seed test.
- `workflows/src/send-step/index.ts` — call Resend, record the outcome.

## Do NOT touch

- ❌ `proposal-step/*` — that's pre gate-2; the email is only drafted there, never sent.
- ❌ `workflows/src/index.ts` (the registry) — no new workflow (D2).
- ❌ `packages/contract/*` — `IntegrationResult` seam is frozen (D5).
- ❌ `packages/notion/*`, `engine-api/src/dashboard*` — other lanes.
- ❌ `pnpm-lock.yaml` deps for Resend — `resend` is already installed in Phase 0.

## The seam (frozen — `packages/contract/src/integration.ts`)

`send-step` output gains `sendResult: IntegrationResult`:

```ts
{ provider: 'resend', status: 'ok'|'failed', ref?: messageId, error?: string, at: ISOstring }
```

## Implementation

1. **`packages/resend`** — use the `resend` SDK. Read `RESEND_API_KEY` +
   `RESEND_FROM` from env (mirror `packages/llm`: env-read, **throws** when
   unconfigured or on error). `sendEmail({to,subject,body})` returns `{messageId}`.
   If `RESEND_TO` is set, override the recipient (demo safety — keeps test sends
   off real client inboxes).
2. **`send-step/index.ts`** — attempt the send. Wrap in try/catch:
   - success → `sendResult = { provider:'resend', status:'ok', ref:messageId, at }`
   - failure → `sendResult = { provider:'resend', status:'failed', error:msg, at }`
     and **resolve the run** (don't throw) so the dashboard shows the failed send
     for retry instead of a dead run (D3).
   Replace the simulated `SendOutput` with one that carries `sendResult`.

## Rules

- Resend client: env-read, throw on error. No DB/secrets via `ctx`.
- Send only in `send-step` (post gate-2). Never send from `proposal-step`.
- Recipient comes from the approved email, overridable by `RESEND_TO`. Never hardcode.
- Fail-soft: a send failure is recorded, not thrown.

## Tests (D6)

- `packages/resend`: mock the SDK — success returns `{messageId}`; API error throws.
- `send-step`: mock the resend module — ok path sets `sendResult.status='ok'`;
  throw path sets `status='failed'`, run resolves.

## Acceptance

- Approving gate 2 delivers a real email via Resend to the recipient.
- `output.sendResult.status='ok'` with the Resend `messageId`.
- Bad key / unverified from-domain → `status='failed'`, run succeeds, dashboard shows red.
- `pnpm typecheck && pnpm test` green.

## Ops

- Set `RESEND_API_KEY`, `RESEND_FROM` (verified domain/sender), and `RESEND_TO`
  (demo recipient) on the Railway **worker**.
- **Redeploy the worker** after setting env (reads env once at module load).

When done: write `REPORT.md` here (what shipped, the from/to setup, how to verify, follow-ups).
