# Auth Model — godin-engine Customer Workspace (M2 P0-C decision)

**Status:** Decided (M2 P0-C spike). Gates P5a-AUTH (engine-api middleware) and P6-B (SPA token injection).

## Decision: Privy JWT only

The SPA carries a **Privy JWT and nothing else**. The browser **NEVER** embeds
`X-Service-Key` (a machine secret). Today's client-side consumer scoping is
security theater — the real authorization boundary moves server-side.

```
Browser (SPA)                         engine-api                         DB
─────────────                         ──────────                         ──
Privy login → access token
  │
  │  Authorization: Bearer <Privy JWT>
  ▼
                          verify JWT (Privy public keys)
                          extract Privy user id
                          resolve  user → consumer_id
                          enforce  consumer scoping on
                                   /v1/runs + /v1/approvals
                          supply   human approver identity
                                   for decided_by
                                                              ───────────►  rows
                                                                            scoped by
                                                                            consumer_id
```

## What the SPA does (P6)

- `apiFetch` attaches `Authorization: Bearer <Privy access token>` per request via
  `getAccessToken()`. (P0 stubs `getAuthToken()` to return `null`.)
- It attaches **no** `X-Service-Key`. The machine secret stays server-side only.
- Both 403 error codes — `APPROVAL_REQUIRED` and `APPROVAL_DENIED` — map to HTTP
  403, so the client branches on `error.code`, never the status.

## What engine-api must add (P5a-AUTH — serial, critical path)

A shared middleware module (mounted before every resource route, after the
route-module refactor) that:

1. **Verifies** the Privy JWT against Privy's public keys.
2. **Extracts** the Privy user and **resolves `consumer_id`** (user → consumer
   mapping; M1 had env-backed single-tenant, M2 makes it real).
3. **Enforces consumer scoping** on `/v1/runs` and `/v1/approvals` — a request
   for another consumer's resources is rejected (403). Removes the client-side
   `consumer=` query "scoping."
4. **Supplies the human approver identity** for `decided_by` on approve/reject,
   replacing the request-body `decided_by` fallback (`'unknown'`).

This middleware is on the critical path: both the P5 and P6 Definitions of Done
require real server-side consumer scoping.

## Non-goals for M2

- No wallet/embedded-wallet flows — this is a B2B console; Privy is configured
  with embedded-wallet auto-create **disabled**, no wagmi.
- No client-held machine secrets, ever.
