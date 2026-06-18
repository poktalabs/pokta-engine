import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Context, MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { EngineError } from '@pokta-engine/contract'
import { db } from '@pokta-engine/db'
import { gatedTargets as gatedTargetsOf, getWorkflow, listManifests } from '@pokta-engine/workflows'
import { getIntegration } from '@pokta-engine/integrations'
import type {
  WorkflowManifest,
  WorkspaceWorkflowsResponse,
  IntegrationListResponse,
  IntegrationStatus,
  InviteView,
  InviteListResponse,
  MemberRole,
  TenantListResponse,
} from '@pokta-engine/contract'
import { getBoss, QUEUE, type RunJob } from '@pokta-engine/queue'
import { consumerAuth, type AuthOptions, type Consumer } from './auth'
import { forConsumer, resolveTenant, claimThrottle, CLAIM_THROTTLE_PER_DAY } from './scoped-db'
import { allowedWorkflowsFor, toTenantView, setMemberRole, listTenants, type TenantRow } from './tenants'
import { findInviteForEmails, claimInvite, addInvite, listInvites } from './invites'
import { isSuperadmin, tenantRoleOf } from './roles'
import { deprovisionInvite } from './deprovision-invite'
import {
  buildDefaultPrivyEmailResolver,
  type ResolvePrivyEmails,
} from './privy-user'
import { isClaimNegCached, rememberClaimMiss } from './claim-neg-cache'
import { validateInviteEmails } from './seed-tenants'
import { cardsForTenant, familyMemberIds } from './workspace-cards'
import { mountDemo } from './demo'
import { mountDashboard } from './dashboard'
import { mountConsole } from './console'

// Child-only workflows: approval (`onApprove`) + onComplete targets. A direct
// POST to any of these is refused — they are reachable only as child runs.
const gatedTargets = gatedTargetsOf()

/**
 * Per-tenant allow-list helper (T5). The registry stays PURE (it knows nothing
 * about tenants); the allow-list is enforced HERE in the control plane. A
 * workflow id is dispatchable by a tenant iff it is BOTH in the tenant's
 * `allowedWorkflows` AND a live registry workflow.
 */
function allowedForTenant(tenant: TenantRow, workflowId: string): boolean {
  return allowedWorkflowsFor(tenant).includes(workflowId)
}

/** The workflow manifests this tenant may see — list surfaces filtered to its allow-list. */
function manifestsForTenant(tenant: TenantRow): WorkflowManifest[] {
  const allow = new Set(allowedWorkflowsFor(tenant))
  return listManifests().filter((m) => allow.has(m.id))
}

async function enqueue(runId: string): Promise<void> {
  const boss = await getBoss()
  await boss.send(QUEUE, { runId } satisfies RunJob)
}

function fail(c: Context, err: EngineError) {
  return c.json({ error: err.toEnvelope() }, err.httpStatus as ContentfulStatusCode)
}

/**
 * Parse a request-body `role` (admin-roles Wave A). `undefined`/absent → 'member'
 * (the default); 'admin'/'member' → that role; anything else → `null` (invalid →
 * the route returns 400). Does NOT authorize — admin-grant authorization is a
 * separate check (only a superadmin may pass 'admin').
 */
function parseRole(raw: unknown): MemberRole | null {
  if (raw === undefined || raw === null) return 'member'
  if (raw === 'admin' || raw === 'member') return raw
  return null
}

/**
 * The SINGLE fixed message every role-authz failure returns (anti-enum, §8). A
 * tenant-admin probing another tenant's :tenantId, a member forcing the panel, a
 * non-superadmin hitting a superadmin route — all get the BYTE-IDENTICAL
 * APPROVAL_DENIED so nothing about tenant existence or membership leaks. Mapped to
 * 403 by ERROR_HTTP_STATUS[APPROVAL_DENIED].
 */
const AUTHZ_DENIED_MESSAGE = 'not authorized'

/** The DID for a privy consumer, or '' for non-privy (which can never be admin/superadmin). */
function consumerDid(consumer: Consumer): string {
  return consumer.mode === 'privy' ? (consumer.identity ?? '') : ''
}

/**
 * requireTenantAdmin(consumer, tenantId) — pass iff the caller is a platform
 * superadmin OR a tenant member with role 'admin' IN `tenantId`. AUTHORIZES BEFORE
 * any tenant existence lookup (Codex#12: no 404-vs-403 / timing leak). Returns null
 * on success, or the single anti-enum APPROVAL_DENIED EngineError on failure.
 */
async function requireTenantAdmin(consumer: Consumer, tenantId: string): Promise<EngineError | null> {
  const did = consumerDid(consumer)
  if (!did) return new EngineError('APPROVAL_DENIED', AUTHZ_DENIED_MESSAGE)
  if (await isSuperadmin(did, db)) return null
  const role = await tenantRoleOf(tenantId, did, db)
  if (role === 'admin') return null
  return new EngineError('APPROVAL_DENIED', AUTHZ_DENIED_MESSAGE)
}

/**
 * requireSuperadmin(consumer) — pass iff the caller is a platform superadmin. Returns
 * null on success, or the single anti-enum APPROVAL_DENIED EngineError on failure.
 */
async function requireSuperadmin(consumer: Consumer): Promise<EngineError | null> {
  const did = consumerDid(consumer)
  if (!did) return new EngineError('APPROVAL_DENIED', AUTHZ_DENIED_MESSAGE)
  if (await isSuperadmin(did, db)) return null
  return new EngineError('APPROVAL_DENIED', AUTHZ_DENIED_MESSAGE)
}

/**
 * Resolve the data-plane scope id for a /v1 request: the membership-resolved
 * tenant id (NEVER the raw credential id). EVERY data-plane route (dispatch,
 * runs, approvals) keys its `forConsumer` scope off THIS, so a Privy principal's
 * reads and writes land on the tenant its `members[]` authorized — not on the
 * legacy PRIVY_TENANT_MAP `consumer.id`, which is a decoupled config surface
 * (`'' ` when unset). Returns `null` when the principal resolves to no active
 * tenant (route → TENANT_UNKNOWN) so reads/writes can never hit an unowned
 * (e.g. empty-string) scope. Fails closed for a privy principal whose non-empty
 * `consumer.id` disagrees with the resolved tenant (confused-deputy guard).
 */
async function scopedTenantId(consumer: Consumer): Promise<string | null> {
  const resolved = await resolveTenant(consumer)
  if (!resolved.ok) return null
  const tenantId = resolved.tenant.tenantId
  if (consumer.mode === 'privy' && consumer.id && consumer.id !== tenantId) return null
  return tenantId
}

/**
 * Operator gate for the cross-tenant rollup surfaces (/demo, /dashboard, /console).
 * Requires header X-Operator-Key === env OPERATOR_KEY. FAIL CLOSED: if OPERATOR_KEY
 * is unset we do NOT serve these surfaces at all (404, never confirm they exist).
 * Lives at the app-composition level — NOT inside the mount fns — so the bare-Hono
 * dashboard.test.ts (mounts mountDashboard, expects /dashboard → 200) stays green.
 */
export function operatorAuth(): MiddlewareHandler {
  const operatorKey = process.env.OPERATOR_KEY?.trim()
  return async (c, next) => {
    if (!operatorKey) return c.notFound()
    const key = c.req.header('X-Operator-Key')
    if (!key || key !== operatorKey) return c.notFound()
    return next()
  }
}

/**
 * Browser CORS for the `/v1` data plane. The SPA (a different origin in prod)
 * calls the engine cross-origin — without CORS the browser blocks the request and
 * the Privy login never reaches `/v1/tenants/me`. (Local dev is same-origin via the
 * Vite proxy, so this only matters on a real deploy.)
 *
 * Fail-closed: allowed origins come from `CORS_ORIGINS` (comma-separated). Unset →
 * EMPTY allowlist → no `Access-Control-Allow-Origin` for any cross-origin caller
 * (same-origin / no-Origin clients like curl and the operator pages are unaffected).
 * Bearer-token auth (not cookies), so no `credentials` mode; the Authorization
 * header is explicitly allowed. Mounted BEFORE `consumerAuth` so the unauthenticated
 * OPTIONS preflight is answered by `cors()` and never 401'd.
 */
export function parseCorsOrigins(raw = process.env.CORS_ORIGINS): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0)
}

export function corsMiddleware(origins = parseCorsOrigins()): MiddlewareHandler {
  const allow = new Set(origins)
  return cors({
    origin: (origin) => (allow.has(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  })
}

export interface BuildAppOptions {
  /** Forwarded to consumerAuth — lets tests inject an offline Privy verifier. */
  auth?: AuthOptions
  /** Override CORS allowed origins (tests). Defaults to the CORS_ORIGINS env. */
  corsOrigins?: string[]
  /**
   * Override the Privy verified-email resolver for POST /v1/tenants/claim (tests
   * inject an OFFLINE resolver so no getUser network call happens). Defaults to the
   * real getUser-backed resolver built from PRIVY_APP_ID/PRIVY_APP_SECRET; when Privy
   * is unconfigured the default is null and every claim is treated as no-match.
   */
  resolvePrivyEmails?: ResolvePrivyEmails
}

/**
 * The SINGLE fixed message for every claim/resolve failure (D-anti-enum). The
 * client response is BYTE-IDENTICAL across no-match / collision / inactive / revoked
 * / no-email so a caller cannot enumerate which emails are invited or which DIDs
 * collide. `EngineError.toEnvelope()` exposes `message`, so the message string MUST
 * be identical too — not just the code.
 */
const TENANT_UNKNOWN_MESSAGE = 'principal maps to no active tenant'

/** Project a stored invite row into the minimal, honest admin InviteView. */
function toInviteView(row: {
  email: string
  status: 'pending' | 'claimed' | 'revoked'
  role: MemberRole
  claimedByDid: string | null
  claimedAt: Date | null
}): InviteView {
  return {
    email: row.email,
    status: row.status,
    role: row.role,
    claimedByDid: row.claimedByDid,
    claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
  }
}

/**
 * Operator-gated admin invite management (Wave 3). Mounted under the SAME fail-closed
 * operatorAuth() gate as /demo (see buildApp), so when OPERATOR_KEY is unset OR the
 * X-Operator-Key header is wrong/missing every route 404s and never confirms a
 * tenant/invite exists. NO raw db here — all DB goes through invites.ts (addInvite /
 * listInvites) and deprovision-invite.ts (deprovisionInvite), keeping check:scoped green.
 *
 *   POST   /admin/tenants/:tenantId/invites  { email } → upsert a pending invite
 *   GET    /admin/tenants/:tenantId/invites           → the tenant's invite roster
 *   DELETE /admin/tenants/:tenantId/invites/:email     → revoke + remove the member
 */
function mountAdminInvites(app: Hono): void {
  app.post('/admin/tenants/:tenantId/invites', async (c) => {
    const tenantId = c.req.param('tenantId')
    const body = (await c.req.json().catch(() => null)) as { email?: unknown; role?: unknown } | null
    const rawEmail = body?.email
    if (typeof rawEmail !== 'string' || !rawEmail.trim()) {
      return fail(c, new EngineError('ARGS_INVALID', 'body.email is required'))
    }
    const email = rawEmail.trim().toLowerCase()
    try {
      validateInviteEmails([email])
    } catch {
      return fail(c, new EngineError('ARGS_INVALID', 'body.email is not a valid email address'))
    }
    // Operator break-glass MAY grant any role (it is the privileged invariant-bypass
    // path, §8). Defaults to 'member'; an invalid role string → 400.
    const role = parseRole(body?.role)
    if (role === null) {
      return fail(c, new EngineError('ARGS_INVALID', "body.role must be 'admin' or 'member'"))
    }

    let outcome
    try {
      // invitedByDid=null: the operator key is a machine secret, not a DID actor.
      outcome = await addInvite(tenantId, email, role, null, db)
    } catch (e) {
      if (e instanceof EngineError && e.code === 'TEAM_FULL') return fail(c, e)
      // A non-existent tenant trips the FK on insert — surface a clean 404, not a 500.
      if (isForeignKeyViolation(e)) {
        return fail(c, new EngineError('SKILL_NOT_FOUND', `tenant '${tenantId}' not found`))
      }
      throw e
    }
    // Email already ACTIVE for a DIFFERENT tenant → 409 (APPROVAL_DENIED maps to 409).
    if (outcome === 'conflict-other-tenant') {
      return c.json(
        { error: new EngineError('APPROVAL_DENIED', 'email is already active for another tenant').toEnvelope() },
        409,
      )
    }
    return c.json({ email, outcome })
  })

  app.get('/admin/tenants/:tenantId/invites', async (c) => {
    const tenantId = c.req.param('tenantId')
    const rows = await listInvites(tenantId, db)
    const invites = rows.map(toInviteView)
    return c.json({ invites } satisfies InviteListResponse)
  })

  app.delete('/admin/tenants/:tenantId/invites/:email', async (c) => {
    const tenantId = c.req.param('tenantId')
    const email = decodeURIComponent(c.req.param('email')).trim().toLowerCase()
    const result = await deprovisionInvite(tenantId, email, db)
    return c.json(result)
  })
}

/** Postgres foreign-key-violation SQLSTATE — surfaced as a clean 404 for a bad tenant id. */
function isForeignKeyViolation(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code ?? (e as { cause?: { code?: unknown } })?.cause?.code
  return code === '23503'
}

/**
 * Compose the Hono app with NO import-time side effects (no getBoss/serve/connect).
 * index.ts is the only entrypoint that starts the queue + HTTP server.
 */
export function buildApp(opts: BuildAppOptions = {}): Hono {
  const app = new Hono()

  // The verified-email resolver for POST /v1/tenants/claim: the injected (test)
  // resolver wins; otherwise the real getUser-backed one (null when Privy unconfigured).
  const resolvePrivyEmails = opts.resolvePrivyEmails ?? buildDefaultPrivyEmailResolver()

  app.get('/', (c) => c.json({ service: 'godin-engine engine-api', version: '0.1.0', ok: true }))

  // ── Operator-only surfaces (cross-tenant rollups) — gated at composition level ──
  const op = operatorAuth()
  // The prospect-facing demo (`/demo`, `/demo/ops`, `/demo/api/*`) is PUBLIC: no
  // operator key, so a visitor can "check the demo" without an account. Safety is
  // enforced INSIDE demo.ts, not by this gate: every read/write is scoped to
  // consumerId 'demo' (incl. the /demo/ops rollup), runs are forced no-LLM
  // (scripted), and /demo/api/run is per-IP rate-limited. The cross-tenant operator
  // rollups live at /dashboard + /console, which STAY key-gated below.
  app.use('/dashboard', op)
  app.use('/dashboard/*', op)
  app.use('/console', op)
  app.use('/console/*', op)
  // The demo UI is the Vite app's public /demo route (a different origin), so the
  // demo data API needs browser CORS (same fail-closed allowlist as /v1). Mounted
  // before mountDemo so the unauthenticated OPTIONS preflight is answered here.
  app.use('/demo/api/*', corsMiddleware(opts.corsOrigins))
  mountDemo(app)
  mountDashboard(app)
  mountConsole(app)
  // ── Operator-only admin: invite management (Wave 3) — SAME fail-closed gate ──
  app.use('/admin', op)
  app.use('/admin/*', op)
  mountAdminInvites(app)

  // ── Tenant data plane (/v1) — browser CORS THEN dual-mode auth → c.set('consumer') ──
  // CORS first: it answers the unauthenticated OPTIONS preflight and short-circuits
  // before consumerAuth (which would 401 a header-less preflight).
  app.use('/v1/*', corsMiddleware(opts.corsOrigins))
  app.use('/v1/*', consumerAuth(opts.auth))

  /**
   * GET /v1/tenants/me (T6) — the authed tenant's own profile. Resolves the tenant
   * from ctx (service id OR Privy membership), then returns the shared TenantView:
   * typed branding, `allowedWorkflows` filtered to the tenant's set ∩ the live
   * registry, and integrations validated against the live integration registry.
   * Auth is already enforced by the middleware (no credential → 401). A principal
   * that resolves to no ACTIVE tenant → TENANT_UNKNOWN (403) — pending/disabled
   * tenants are NOT active and so collapse into the same fail-closed 403, never
   * leaking that the tenant exists-but-isn't-active.
   */
  app.get('/v1/tenants/me', async (c) => {
    const consumer = c.get('consumer')
    const resolved = await resolveTenant(consumer)
    if (!resolved.ok) return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no active tenant'))
    // Confused-deputy guard (parity with scopedTenantId / the data routes): a privy
    // principal whose non-empty consumer.id disagrees with the membership-resolved
    // tenant fails closed, so a post-claim /tenants/me can never succeed while the
    // later scoped data calls (keyed off the resolved tenant) would fail.
    const tenantId = resolved.tenant.tenantId
    if (consumer.mode === 'privy' && consumer.id && consumer.id !== tenantId) {
      return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no active tenant'))
    }
    const view = toTenantView(resolved.tenant, allowedWorkflowsFor(resolved.tenant))
    // admin-roles Wave A (Codex#13): ADDITIVE role + isSuperadmin so the SPA adapts
    // the Team panel. Resolved fresh per request via the allowlisted roles.ts. A
    // service principal (no DID) is neither a tenant member nor a superadmin.
    const did = consumerDid(consumer)
    const role = did ? await tenantRoleOf(tenantId, did, db) : null
    const superadmin = did ? await isSuperadmin(did, db) : false
    return c.json({
      ...view,
      ...(role ? { role } : {}),
      isSuperadmin: superadmin,
    })
  })

  /**
   * POST /v1/tenants/claim (Wave 1 / D4) — email-preauthorized first-login auto-
   * provision. A Privy principal whose DID is in no tenant yet matches their
   * Privy-VERIFIED email against engine_tenant_invites and, on a match, binds the DID
   * into that tenant; later logins resolve straight through membership.
   *
   * Flow (order matters):
   *   (1) Privy-bearer only — a service principal already IS its tenant, never claims.
   *   (2) Already a member (resolveTenant ok) → return its TenantView (idempotent;
   *       NO Privy call, NO throttle charge).
   *   (3) DID in the negative cache (a recent no-match) → identical TENANT_UNKNOWN,
   *       skipping Privy (D6 flood guard).
   *   (4) Throttle the claim per-DID (D6) → over-limit returns QUOTA_EXCEEDED (429).
   *   (5) resolvePrivyEmails(did) (injected seam) → findInviteForEmails → claimInvite.
   *   (6) ok → freshly-resolved TenantView. ANY failure (no email / no match /
   *       collision / inactive / revoked) → cache the miss + the SINGLE identical
   *       TENANT_UNKNOWN envelope (anti-enumeration). Failures are logged SERVER-SIDE
   *       (did + reason) for ops, never leaked to the client.
   */
  app.post('/v1/tenants/claim', async (c) => {
    const consumer = c.get('consumer')

    // (1) Privy-bearer only. A service principal is its own tenant; claiming is N/A.
    if (consumer.mode !== 'privy') {
      return fail(c, new EngineError('TENANT_UNKNOWN', TENANT_UNKNOWN_MESSAGE))
    }
    const did = consumer.identity
    if (!did) return fail(c, new EngineError('TENANT_UNKNOWN', TENANT_UNKNOWN_MESSAGE))

    // (2) Already bound → idempotent: return the current TenantView, no Privy/throttle.
    const existing = await resolveTenant(consumer)
    if (existing.ok) {
      const tenantId = existing.tenant.tenantId
      // Same confused-deputy guard as /tenants/me & the data routes.
      if (consumer.id && consumer.id !== tenantId) {
        return fail(c, new EngineError('TENANT_UNKNOWN', TENANT_UNKNOWN_MESSAGE))
      }
      return c.json(toTenantView(existing.tenant, allowedWorkflowsFor(existing.tenant)))
    }

    // The single byte-identical failure response (anti-enumeration). Every distinct
    // failure reason below returns EXACTLY this; the reason is only logged server-side.
    const denyAndRemember = (reason: string) => {
      rememberClaimMiss(did)
      // eslint-disable-next-line no-console
      console.warn(`[claim] denied did=${did} reason=${reason}`)
      return fail(c, new EngineError('TENANT_UNKNOWN', TENANT_UNKNOWN_MESSAGE))
    }

    // (3) Negative cache: a recent no-match short-circuits WITHOUT calling Privy.
    if (isClaimNegCached(did)) {
      return fail(c, new EngineError('TENANT_UNKNOWN', TENANT_UNKNOWN_MESSAGE))
    }

    // (4) Per-DID claim throttle (D6). Over the daily limit → 429 QUOTA_EXCEEDED.
    try {
      await claimThrottle(did, CLAIM_THROTTLE_PER_DAY, db)
    } catch (e) {
      if (e instanceof EngineError) return fail(c, e)
      throw e
    }

    // (5) Resolve the DID's VERIFIED emails (injected seam; null → unconfigured → no match).
    if (!resolvePrivyEmails) return denyAndRemember('privy-email-resolver-unconfigured')
    let emails: string[]
    try {
      emails = await resolvePrivyEmails(did)
    } catch {
      // A resolver throw is fail-closed (the default impl already returns [] on throw).
      return denyAndRemember('privy-getuser-threw')
    }
    if (emails.length === 0) return denyAndRemember('no-verified-email')

    const invite = await findInviteForEmails(emails, db)
    if (!invite) return denyAndRemember('no-matching-invite')

    const outcome = await claimInvite({ email: invite.email, did }, db)
    if (outcome === 'collision') return denyAndRemember('collision')
    if (outcome === 'inactive') return denyAndRemember('inactive-tenant')
    if (outcome === 'not-found') return denyAndRemember('invite-not-found')

    // (6) Bound. Re-resolve FRESH so the returned TenantView reflects the new membership.
    const resolved = await resolveTenant(consumer)
    if (!resolved.ok) return denyAndRemember('post-claim-resolve-failed')
    return c.json(toTenantView(resolved.tenant, allowedWorkflowsFor(resolved.tenant)))
  })

  // ── admin-roles Wave A — JWT/role-gated team management (under /v1 consumerAuth) ──
  // Every authz failure returns the SAME anti-enum APPROVAL_DENIED (403/409 per code).
  // Authorization runs BEFORE any tenant/invite existence lookup (Codex#12). NO raw
  // db — all DB goes through roles.ts / invites.ts / tenants.ts / deprovision-invite.

  /** GET /v1/tenants/:tenantId/invites — requireTenantAdmin → the tenant's team roster. */
  app.get('/v1/tenants/:tenantId/invites', async (c) => {
    const consumer = c.get('consumer')
    const tenantId = c.req.param('tenantId')
    const denied = await requireTenantAdmin(consumer, tenantId)
    if (denied) return fail(c, denied)
    const rows = await listInvites(tenantId, db)
    const invites = rows.map(toInviteView)
    return c.json({ invites } satisfies InviteListResponse)
  })

  /**
   * POST /v1/tenants/:tenantId/invites { email, role? } — requireTenantAdmin. REJECT
   * (not coerce, Codex#17): a non-superadmin passing role:'admin' → APPROVAL_DENIED
   * (403). Only a superadmin may grant 'admin'. Seat cap → TEAM_FULL (409). An email
   * active for another tenant → a GENERIC failure (no leak, Codex#6/#18).
   */
  app.post('/v1/tenants/:tenantId/invites', async (c) => {
    const consumer = c.get('consumer')
    const tenantId = c.req.param('tenantId')
    const denied = await requireTenantAdmin(consumer, tenantId)
    if (denied) return fail(c, denied)

    const body = (await c.req.json().catch(() => null)) as { email?: unknown; role?: unknown } | null
    const rawEmail = body?.email
    if (typeof rawEmail !== 'string' || !rawEmail.trim()) {
      return fail(c, new EngineError('ARGS_INVALID', 'body.email is required'))
    }
    const email = rawEmail.trim().toLowerCase()
    try {
      validateInviteEmails([email])
    } catch {
      return fail(c, new EngineError('ARGS_INVALID', 'body.email is not a valid email address'))
    }
    const role = parseRole(body?.role)
    if (role === null) {
      return fail(c, new EngineError('ARGS_INVALID', "body.role must be 'admin' or 'member'"))
    }
    // Reject-don't-coerce: only a superadmin may grant 'admin'. A tenant-admin asking
    // for 'admin' gets the SAME anti-enum denial (never a silent member-invite).
    if (role === 'admin') {
      const did = consumerDid(consumer)
      if (!(await isSuperadmin(did, db))) {
        return fail(c, new EngineError('APPROVAL_DENIED', AUTHZ_DENIED_MESSAGE))
      }
    }

    let outcome
    try {
      outcome = await addInvite(tenantId, email, role, consumerDid(consumer) || null, db)
    } catch (e) {
      if (e instanceof EngineError && e.code === 'TEAM_FULL') return fail(c, e)
      if (isForeignKeyViolation(e)) {
        // A non-existent tenant: an authorized superadmin gets a clean 404; this never
        // fires for a tenant-admin (they only pass requireTenantAdmin for a tenant they
        // are a member of, which exists).
        return fail(c, new EngineError('SKILL_NOT_FOUND', `tenant '${tenantId}' not found`))
      }
      throw e
    }
    if (outcome === 'conflict-other-tenant') {
      // GENERIC envelope — never leak the email, the index, or the other tenant.
      return c.json(
        { error: new EngineError('APPROVAL_DENIED', 'email is not available').toEnvelope() },
        409,
      )
    }
    return c.json({ email, role, outcome })
  })

  /** DELETE /v1/tenants/:tenantId/invites/:email — requireTenantAdmin → deprovision. */
  app.delete('/v1/tenants/:tenantId/invites/:email', async (c) => {
    const consumer = c.get('consumer')
    const tenantId = c.req.param('tenantId')
    const denied = await requireTenantAdmin(consumer, tenantId)
    if (denied) return fail(c, denied)
    const email = decodeURIComponent(c.req.param('email')).trim().toLowerCase()
    const result = await deprovisionInvite(tenantId, email, db)
    return c.json(result)
  })

  /**
   * PATCH /v1/tenants/:tenantId/members/:did { role } — requireSuperadmin. Promote/
   * demote an already-bound member (Codex#1: a CLAIMED member can't be made admin via
   * an invite). Last-admin guard → 409 APPROVAL_DENIED. A non-member or wrong tenant →
   * the SAME anti-enum APPROVAL_DENIED (no existence leak).
   */
  app.patch('/v1/tenants/:tenantId/members/:did', async (c) => {
    const consumer = c.get('consumer')
    const denied = await requireSuperadmin(consumer)
    if (denied) return fail(c, denied)
    const tenantId = c.req.param('tenantId')
    const targetDid = decodeURIComponent(c.req.param('did'))
    const body = (await c.req.json().catch(() => null)) as { role?: unknown } | null
    if (body?.role !== 'admin' && body?.role !== 'member') {
      return fail(c, new EngineError('ARGS_INVALID', "body.role must be 'admin' or 'member'"))
    }
    const role = body.role as MemberRole
    const result = await setMemberRole(tenantId, targetDid, role, db)
    if (result === 'last-admin') {
      // No lockout: can't demote the tenant's only admin.
      return c.json(
        { error: new EngineError('APPROVAL_DENIED', 'cannot demote the last admin').toEnvelope() },
        409,
      )
    }
    if (result === 'not-a-member') {
      // Anti-enum: indistinguishable from an unauthorized probe.
      return fail(c, new EngineError('APPROVAL_DENIED', AUTHZ_DENIED_MESSAGE))
    }
    return c.json({ tenantId, did: targetDid, role })
  })

  /** GET /v1/superadmin/tenants — requireSuperadmin → the tenant picker list. */
  app.get('/v1/superadmin/tenants', async (c) => {
    const consumer = c.get('consumer')
    const denied = await requireSuperadmin(consumer)
    if (denied) return fail(c, denied)
    const rows = await listTenants(db)
    const tenants = rows.map((t) => ({ id: t.tenantId, name: t.name, status: t.status }))
    return c.json({ tenants } satisfies TenantListResponse)
  })

  /**
   * GET /v1/workflows (T5 list surface) — the workflows THIS tenant may dispatch.
   * Filtered to the tenant's allow-list ∩ the live registry; a tenant never sees
   * a workflow it could not POST. The Zod `input` schema is intentionally NOT
   * serialized (it is a live validator, not JSON) — only safe manifest metadata.
   */
  app.get('/v1/workflows', async (c) => {
    const consumer = c.get('consumer')
    const resolved = await resolveTenant(consumer)
    if (!resolved.ok) return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no active tenant'))
    const workflows = manifestsForTenant(resolved.tenant).map((m) => ({
      id: m.id,
      version: m.version,
      runtime: m.runtime,
      timeoutMs: m.timeoutMs,
    }))
    return c.json({ workflows })
  })

  /**
   * POST /v1/workflows/:id/runs — the consumer boundary (D-4). Tenant comes from
   * ctx.consumer (NEVER body.consumer_id). A mismatched body.consumer_id is a 400.
   * Quota enforced pre-dispatch in one transaction (D-5).
   */
  app.post('/v1/workflows/:id/runs', async (c) => {
    const consumer = c.get('consumer')
    const resolved = await resolveTenant(consumer)
    if (!resolved.ok) return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no known tenant'))
    // The data-plane scope key is ALWAYS the membership-resolved tenant id, NEVER
    // the raw credential id. For a service principal these are identical by
    // construction (resolveTenant does getTenant(consumer.id)). For a Privy
    // principal `consumer.id` comes from the legacy PRIVY_TENANT_MAP env, which is
    // DECOUPLED from `members[]`; trusting it would let the allow-list gate (keyed
    // off the resolved tenant) and the data write (keyed off the env map) target
    // DIFFERENT tenants — a confused-deputy / split-brain hole. We close it by
    // deriving the scope from `resolved` and, for privy, fail closed on any
    // disagreement with a non-empty consumer.id.
    const tenantId = resolved.tenant.tenantId
    if (consumer.mode === 'privy' && consumer.id && consumer.id !== tenantId) {
      return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no known tenant'))
    }

    const id = c.req.param('id')
    const wf = getWorkflow(id)
    if (!wf) return fail(c, new EngineError('SKILL_NOT_FOUND', `workflow '${id}' not found`))
    // ── Per-tenant allow-list gate (T5) ──────────────────────────────────────
    // A workflow the tenant is not allow-listed for is a 404 SKILL_NOT_FOUND, NOT
    // a 403 — anti-enumeration: a tenant must not be able to discover that another
    // tenant's workflow exists. This sits RIGHT AFTER getWorkflow so a known-but-
    // disallowed id is indistinguishable from an unknown id at the boundary.
    if (!allowedForTenant(resolved.tenant, id)) {
      return fail(c, new EngineError('SKILL_NOT_FOUND', `workflow '${id}' not found`))
    }
    if (gatedTargets.has(id)) {
      return fail(c, new EngineError('APPROVAL_REQUIRED', `'${id}' is only reachable via an approved gate`))
    }

    const body = (await c.req.json().catch(() => null)) as { consumer_id?: string; input?: unknown } | null
    if (body?.consumer_id && body.consumer_id !== tenantId) {
      return fail(c, new EngineError('ARGS_INVALID', 'body.consumer_id does not match the authenticated tenant'))
    }

    const parsed = wf.manifest.input.safeParse(body?.input)
    if (!parsed.success) return fail(c, new EngineError('ARGS_INVALID', parsed.error.message))

    const quota = wf.manifest.policy.find((p) => p.kind === 'quota')
    const scoped = forConsumer(db, tenantId)

    let result: { runId: string; traceId: string }
    try {
      result = await scoped.dispatchRun({
        workflowId: id,
        input: parsed.data,
        quotaPerDay: quota && quota.kind === 'quota' ? quota.perDay : undefined,
      })
    } catch (e) {
      if (e instanceof EngineError) return fail(c, e)
      throw e
    }

    await enqueue(result.runId)
    return c.json({ runId: result.runId, status: 'queued', traceId: result.traceId })
  })

  app.get('/v1/runs/:id', async (c) => {
    const tenantId = await scopedTenantId(c.get('consumer'))
    if (tenantId === null) return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no active tenant'))
    const scoped = forConsumer(db, tenantId)
    const row = await scoped.getRun(c.req.param('id'))
    if (!row) return fail(c, new EngineError('SKILL_NOT_FOUND', 'not found'))
    return c.json(row)
  })

  app.get('/v1/runs', async (c) => {
    const tenantId = await scopedTenantId(c.get('consumer'))
    if (tenantId === null) return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no active tenant'))
    const scoped = forConsumer(db, tenantId)
    const rows = await scoped.listRuns({ status: c.req.query('status') })
    return c.json({ runs: rows })
  })

  /**
   * GET /v1/workspace/workflows (P5b) — the operator workspace's workflow CARDS for
   * this tenant: the catalog families whose PARENT id is in the tenant's allow-list,
   * each folded with this tenant's recent run + pending-approval state. Resolves the
   * tenant ROW (for allowedWorkflowsFor) with the SAME confused-deputy guard
   * scopedTenantId applies, then scopes the read via forConsumer. Fail-closed.
   */
  app.get('/v1/workspace/workflows', async (c) => {
    const consumer = c.get('consumer')
    const resolved = await resolveTenant(consumer)
    if (!resolved.ok) return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no active tenant'))
    const tenantId = resolved.tenant.tenantId
    if (consumer.mode === 'privy' && consumer.id && consumer.id !== tenantId) {
      return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no active tenant'))
    }
    const cards = cardsForTenant(allowedWorkflowsFor(resolved.tenant))
    const scoped = forConsumer(db, tenantId)
    const workflows = await scoped.workspaceWorkflowCards(cards)
    return c.json({ workflows } satisfies WorkspaceWorkflowsResponse)
  })

  /**
   * GET /v1/workflows/:id/runs?status= (P5b) — this tenant's runs for the workflow
   * FAMILY rooted at `:id`. ANTI-ENUMERATION: an id not in the tenant's allow-list is
   * a 404 SKILL_NOT_FOUND (matches the dispatch gate; never confirm existence). The
   * family members (parent + gated children) are resolved via familyMemberIds, so a
   * parent card's runs include its children's runs. Returns the RunListResponse
   * `{ runs }` envelope for consistency with GET /v1/runs.
   */
  app.get('/v1/workflows/:id/runs', async (c) => {
    const consumer = c.get('consumer')
    const resolved = await resolveTenant(consumer)
    if (!resolved.ok) return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no active tenant'))
    const tenantId = resolved.tenant.tenantId
    if (consumer.mode === 'privy' && consumer.id && consumer.id !== tenantId) {
      return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no active tenant'))
    }
    const id = c.req.param('id')
    if (!allowedForTenant(resolved.tenant, id)) {
      return fail(c, new EngineError('SKILL_NOT_FOUND', `workflow '${id}' not found`))
    }
    const members = familyMemberIds(id)
    const scoped = forConsumer(db, tenantId)
    let rows = await scoped.listRunsForWorkflows(members)
    const status = c.req.query('status')
    if (status) rows = rows.filter((r) => r.status === status)
    // `{ runs }` envelope mirrors GET /v1/runs; rows are raw engine_runs rows that
    // JSON-serialize to the RunListResponse shape (Date → ISO string) like that route.
    return c.json({ runs: rows })
  })

  /**
   * GET /v1/integrations (P5b) — this tenant's integration CONNECTION status rows,
   * enriched with the live registry descriptor (displayName/category). A stored row
   * whose integration_id is no longer in the live registry is SKIPPED (defensive).
   * NO secret value is ever returned. Scoped via forConsumer; fail-closed.
   */
  app.get('/v1/integrations', async (c) => {
    const tenantId = await scopedTenantId(c.get('consumer'))
    if (tenantId === null) return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no active tenant'))
    const scoped = forConsumer(db, tenantId)
    const rows = await scoped.listTenantIntegrations()
    const integrations: IntegrationStatus[] = []
    for (const row of rows) {
      const mod = getIntegration(row.integrationId)
      if (!mod) continue // not in the live registry → skip (defensive)
      integrations.push({
        id: row.integrationId,
        displayName: mod.descriptor.displayName,
        category: mod.descriptor.category,
        status: row.status,
      })
    }
    return c.json({ integrations } satisfies IntegrationListResponse)
  })

  /** GET /v1/approvals?state=pending&approver=role:medic — this tenant's gate worklist (D-8). */
  app.get('/v1/approvals', async (c) => {
    const tenantId = await scopedTenantId(c.get('consumer'))
    if (tenantId === null) return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no active tenant'))
    const scoped = forConsumer(db, tenantId)
    const rows = await scoped.listApprovals({
      state: c.req.query('state'),
      approver: c.req.query('approver'),
    })
    return c.json({ approvals: rows })
  })

  /** POST /v1/approvals/:id/approve — flip the gate and dispatch the onApprove run (D-8). */
  app.post('/v1/approvals/:id/approve', async (c) => {
    const consumer = c.get('consumer')
    const id = c.req.param('id')
    const tenantId = await scopedTenantId(consumer)
    if (tenantId === null) return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no active tenant'))
    const scoped = forConsumer(db, tenantId)

    const approval = await scoped.getApproval(id)
    if (!approval) return fail(c, new EngineError('SKILL_NOT_FOUND', 'not found'))
    if (approval.state !== 'pending') {
      return c.json({ error: new EngineError('APPROVAL_DENIED', `already ${approval.state}`).toEnvelope() }, 409)
    }

    const target = getWorkflow(approval.workflowId)
    if (!target) return fail(c, new EngineError('SKILL_NOT_FOUND', `onApprove target '${approval.workflowId}' missing`))
    const parsedArtifact = target.manifest.input.safeParse(approval.artifact)
    if (!parsedArtifact.success) {
      return fail(c, new EngineError('ARGS_INVALID', `artifact does not match '${approval.workflowId}' input`))
    }

    const outcome = await scoped.approve({
      approvalId: id,
      decidedBy: consumer.identity, // bound to the authenticated principal, not a body string
      childInput: parsedArtifact.data,
    })
    if (!outcome.ok) {
      if (outcome.reason === 'not-found') return fail(c, new EngineError('SKILL_NOT_FOUND', 'not found'))
      return c.json({ error: new EngineError('APPROVAL_DENIED', outcome.reason).toEnvelope() }, 409)
    }

    await enqueue(outcome.runId)
    return c.json({ approvalId: id, state: 'approved', runId: outcome.runId })
  })

  app.post('/v1/approvals/:id/reject', async (c) => {
    const consumer = c.get('consumer')
    const id = c.req.param('id')
    const tenantId = await scopedTenantId(consumer)
    if (tenantId === null) return fail(c, new EngineError('TENANT_UNKNOWN', 'principal maps to no active tenant'))
    const scoped = forConsumer(db, tenantId)
    const outcome = await scoped.reject({ approvalId: id, decidedBy: consumer.identity })
    if (!outcome.ok) {
      return c.json(
        { error: new EngineError('APPROVAL_DENIED', 'not found or already decided').toEnvelope() },
        409,
      )
    }
    return c.json({ approvalId: id, state: 'rejected' })
  })

  return app
}
