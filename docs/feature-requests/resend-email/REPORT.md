# REPORT — F2: Resend email integration

- **TICK:** TASK-002
- **Branch:** `feat/resend-email-integration` → PR into `feat/foundation-demo-integrations`
- **Status:** shipped; `pnpm typecheck && pnpm test` green.

## What shipped

After gate 2 (owner approves the outbound email), `send-step` now sends a **real
email via Resend**, replacing the simulated send. The outcome is recorded on the
run output as an `IntegrationResult` (the frozen seam), fail-soft per D3.

### `packages/resend/src/index.ts`

- Implemented `sendEmail({ to, subject, body })` using the `resend` SDK.
- Mirrors `packages/llm` discipline: reads its own env, **throws** when
  unconfigured or on API error; the caller owns the fallback.
- Lazily constructs a single `Resend(API_KEY)` client (`getClient()`).
- Calls `client.emails.send({ from, to, subject, text })`. On `{ error }` it
  throws `Resend send failed: <msg>`; on a missing `data.id` it throws
  `Resend send returned no message id`. On success returns `{ messageId }`.
- **Recipient override:** if `RESEND_TO` is set it replaces `input.to`
  (`const to = TO_OVERRIDE || input.to`) — demo safety to keep test sends off
  real client inboxes. Recipient is never hardcoded.

### `workflows/src/send-step/index.ts`

- `SendOutput` now carries `sendResult: IntegrationResult` (provider `'resend'`)
  alongside `sent`, `to`, `subject`. The simulated `note` field is gone.
- The send is wrapped in try/catch:
  - **success** -> `sent: true`, `sendResult = { provider:'resend', status:'ok', ref: messageId, at }`
  - **failure** -> `sent: false`, `sendResult = { provider:'resend', status:'failed', error: msg, at }`
    and the run **resolves** (never throws) so the dashboard shows the failed
    send for retry (D3 fail-soft).
- `at` is an ISO 8601 timestamp captured at the start of the attempt.

### Untouched (per brief constraints)

`proposal-step/*`, `call-intake/*`, `workflows/src/index.ts` (registry),
`packages/contract/*` (seam frozen), `engine-api/*`, `packages/notion/*`,
`pnpm-lock.yaml`. The `IntegrationResult` seam is unchanged.

## From / To / override setup

| Env var          | Required | Meaning                                                        |
| ---------------- | -------- | ------------------------------------------------------------- |
| `RESEND_API_KEY` | yes      | Resend API key.                                              |
| `RESEND_FROM`    | yes      | Verified sender, e.g. `"Vino <hello@vino.example>"`.        |
| `RESEND_TO`      | optional | Demo recipient override. When set, all sends go here instead of the approved `email.to`. |

`resendConfigured()` is true only when both `RESEND_API_KEY` and `RESEND_FROM`
are non-empty. Env is read at module load.

## How to verify

**Unit (now, mocked — green):**

```
pnpm typecheck   # all 9 workspace projects pass
pnpm test        # 10 tests pass (resend: 6, send-step: 2, notion: 2)
```

- `packages/resend/src/index.test.ts` mocks the `resend` SDK: success returns
  `{ messageId }`; `RESEND_TO` overrides the recipient; an `{ error }` response
  and a missing id both throw; unconfigured throws before calling the SDK.
- `workflows/src/send-step/index.test.ts` mocks `@godin-engine/resend`: ok path ->
  `sendResult.status === 'ok'` with the `messageId`; throw path -> `status === 'failed'`
  with the error and the run **resolves** (no throw).

**Manual (staging — later):**

1. On the Railway **worker**, set `RESEND_API_KEY`, `RESEND_FROM` (verified
   domain/sender), and `RESEND_TO` (demo recipient).
2. **Redeploy the worker** — env is read once at module load.
3. Run the Vino pipeline through gate 2 and approve. Expect a real email at the
   `RESEND_TO` inbox and `output.sendResult.status === 'ok'` with the Resend
   `messageId` in `ref`.
4. Negative check: set a bad key or an unverified `RESEND_FROM` -> the run still
   succeeds, `output.sendResult.status === 'failed'` with the error, dashboard
   renders the red outcome.

## Test results

```
Test Files  3 passed (3)
     Tests  10 passed (10)
typecheck: all 9 workspace projects Done
```

## Follow-ups / uncertainties

- **Plain-text only.** Body is sent as `text`; the drafted email is plain text
  today. If HTML formatting is wanted later, add an `html` field to `EmailInput`
  and pass it through (Resend's `EmailRenderOptions` requires at least one of
  react/html/text).
- **resend SDK version.** Lockfile resolves `resend@4.8.0` (package.json range
  `^4.0.1`). `emails.send` returning `{ data, error }` is stable across 4.x.
- **No real send verified.** Credentials are not set locally (expected); only the
  mocked unit tests run. Real delivery is the staging step above.
- **vitest 2.1 quirk.** The send-step test avoids `mockReset()` in a `beforeEach`
  because vitest 2.1 surfaces a throwing mock implementation installed right
  after a reset as an uncaught error. Each test installs its own implementation
  instead. Revisit if vitest is upgraded.
