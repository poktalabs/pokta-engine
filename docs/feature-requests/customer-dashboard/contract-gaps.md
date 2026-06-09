# Contract Gaps — godin-engine `packages/contract` (M2 P0-B audit)

Inventory of `packages/contract/src` as of M2 P0, the response types delivered in
P0, and the endpoints/types still missing (added in P5a, before their P3/P4 mocks
freeze). `IntegrationResult` (run-output, `notion|resend`) is **NOT** the
integrations **catalog** type the dashboard needs — they are different types.

## Existing contract types (audited)

| File | Exports | Kind |
|---|---|---|
| `errors.ts` | `ERROR_CODES`, `ErrorCode`, `ErrorEnvelope`, `ERROR_HTTP_STATUS`, `EngineError` | error envelope |
| `policy.ts` | `QuotaPolicy`, `ApprovalPolicy`, `Policy` | governance policy |
| `run.ts` | `RunStatus`, `RunContext`, `RunResult`, `IntegrationClients`, `IntegrationName`, `IntegrationAccessor` | runtime |
| `manifest.ts` | `WorkflowManifest`, `RunFn`, `WorkflowModule`, `Runtime` | authored manifest |
| `integration.ts` | `IntegrationResult` (`provider: 'notion' \| 'resend'`) | **run-output** (NOT catalog) |

## Delivered in P0 (this milestone, committed)

| File | Exports | Reconciled against |
|---|---|---|
| `approval.ts` | `ApprovalState`, `ApprovalView`, `ApprovalListResponse`, `ApproveResponse`, `RejectResponse` | `GET /v1/approvals` (`{ approvals }`), approve `{ approvalId, state:'approved', runId }`, reject `{ approvalId, state:'rejected' }` |
| `run-views.ts` | `RunListItem`, `RunDetail`, `RunListResponse` | `GET /v1/runs` (`{ runs }`), `GET /v1/runs/:id` (raw row) |

`ApprovalView.artifact` is typed `unknown` (per-workflow Zod input, validated at
approve-time against `target.manifest.input`) + a `workflowId` discriminator — no
fixed 316-row pricing shape baked into the contract.

## Approve / reject response semantics (feed to P2-A state machine)

- **Approve** → `{ approvalId, state: 'approved', runId }`. Dispatches a child run
  (`dispatchedRunId`). Can **409 `APPROVAL_DENIED`** if already decided.
- **Reject** → `{ approvalId, state: 'rejected' }`. Only flips a `pending` row.
- Both `APPROVAL_REQUIRED` and `APPROVAL_DENIED` are **HTTP 403** — clients must
  read `error.code`, not the status, to distinguish them.
- Partial-failure flows back as `failedItemIds: string[]` (uniform batch/single).

## Gaps — endpoints + types to add LATER (P5a, before their mocks freeze)

| Endpoint (P5a) | New contract type | Consumer surface |
|---|---|---|
| `GET /v1/integrations` | `IntegrationStatus` (`{ provider: string; status: 'connected'\|'estimated'\|'not-yet-live'; riskTier; detail? }`) | P4-A Integrations grid |
| `GET /v1/consumers/:id/quota` | `Quota` | P5 Quota surface |
| `POST/GET /v1/workflows/:id/schedules`, `PATCH/DELETE /v1/schedules/:id` | `Schedule` | P3 ScheduleEditor (read-only until CRUD lands) |
| `GET /v1/workflows/:id/runs?status=&consumer=` | (reuses `RunListItem`) | P3 per-workflow runs filter |
| `GET /v1/runs/:id/logs` | `RunLogEntry` | P3-B run timeline |
| `GET /v1/reports/workflow-stats`, `/consumer-usage`, `/approvals-metrics` | `Report` (+ variants) | P4-B Reports |
| (stretch) Approval retry / manual dispatch | — | P2 retry |

**Consumer-scoped reads:** all read routes (`/v1/runs`, `/v1/approvals`, and the
new ones) must enforce server-side consumer scoping via the P5a-AUTH Privy-JWT
middleware (see `auth-model.md`) — not the current client-side `consumer=` query.

**Descoped from M2:** standalone "query approvals by approver/time/outcome" audit
endpoint. The inline expandable `AuditTrail` (P2) is the only audit surface this
milestone — do not ship a backend endpoint with no consumer.

**Error-code discipline:** reuse the existing `ERROR_CODES` enum + `ERROR_HTTP_STATUS`.
Any new code needed by reports/quota is an explicit contract change flagged in the
PR — reuse existing codes where possible.
