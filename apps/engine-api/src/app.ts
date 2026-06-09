import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Context, MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { EngineError } from '@godin-engine/contract'
import { db } from '@godin-engine/db'
import { gatedTargets as gatedTargetsOf, getWorkflow, listManifests } from '@godin-engine/workflows'
import { getIntegration } from '@godin-engine/integrations'
import type {
  WorkflowManifest,
  WorkspaceWorkflowsResponse,
  IntegrationListResponse,
  IntegrationStatus,
} from '@godin-engine/contract'
import { getBoss, QUEUE, type RunJob } from '@godin-engine/queue'
import { consumerAuth, type AuthOptions, type Consumer } from './auth'
import { forConsumer, resolveTenant } from './scoped-db'
import { allowedWorkflowsFor, toTenantView, type TenantRow } from './tenants'
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
}

/**
 * Compose the Hono app with NO import-time side effects (no getBoss/serve/connect).
 * index.ts is the only entrypoint that starts the queue + HTTP server.
 */
export function buildApp(opts: BuildAppOptions = {}): Hono {
  const app = new Hono()

  app.get('/', (c) => c.json({ service: 'godin-engine engine-api', version: '0.1.0', ok: true }))

  // ── Operator-only surfaces (cross-tenant rollups) — gated at composition level ──
  const op = operatorAuth()
  app.use('/demo', op)
  app.use('/demo/*', op)
  app.use('/dashboard', op)
  app.use('/dashboard/*', op)
  app.use('/console', op)
  app.use('/console/*', op)
  mountDemo(app)
  mountDashboard(app)
  mountConsole(app)

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
    const view = toTenantView(resolved.tenant, allowedWorkflowsFor(resolved.tenant))
    return c.json(view)
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
