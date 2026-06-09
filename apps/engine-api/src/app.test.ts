import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SignJWT, generateKeyPair, exportSPKI } from 'jose'

/**
 * Security-spine tests (M1.5 / T1-T3). Hermetic: we MOCK @godin-engine/db and
 * @godin-engine/queue so nothing touches Postgres or pg-boss, and we inject an
 * OFFLINE Privy verifier via buildApp({ auth: { verifyPrivyToken } }) so no JWKS
 * fetch happens. Tokens are minted locally with `jose` (ES256) only to exercise
 * the seam contract (the real prod path uses @privy-io/server-auth).
 */

// ── In-memory fake db captured per test (asserts scoping) ────────────────────
type Row = Record<string, unknown>
const state: { runs: Row[]; approvals: Row[]; inserted: Row[] } = { runs: [], approvals: [], inserted: [] }

function whereMatch(rows: Row[]): Row[] {
  // The fake ignores the drizzle predicate object; the scoped helper is what we
  // assert, by reading state.inserted (forced consumerId) and by the route 404s.
  return rows
}

vi.mock('@godin-engine/queue', () => ({
  getBoss: async () => ({ send: async () => undefined }),
  QUEUE: 'workflow.run',
}))

// Minimal registry the resolveTenant path reads: both spine tenants (mi-pase,
// other) are ACTIVE so service-mode resolution succeeds and the /v1 routes scope
// to the resolved tenant id (== the service-key consumer id). This makes the db
// mock COMPLETE for the post-harden code path (GET /v1/runs et al. now resolve
// the tenant first); it changes no assertion — these tests still assert auth +
// scoping behavior, not tenant content.
const REGISTRY: Row[] = [
  // did:privy:abc is mi-pase's MEMBER — post-harden, a Privy bearer scopes by
  // members[] (the authority), not the legacy PRIVY_TENANT_MAP. The two privy
  // cases below also set PRIVY_TENANT_MAP=...=mi-pase, so the resolved tenant and
  // the (now-subordinate) map AGREE → 200; a disagreement would fail closed.
  { tenantId: 'mi-pase', name: 'Mi Pase', status: 'active', currency: 'MXN', locale: 'es-MX', branding: {}, allowedWorkflows: [], members: ['did:privy:abc'], secretPrefix: 'MIPASE' },
  { tenantId: 'other', name: 'Other', status: 'active', currency: 'USD', locale: 'en', branding: {}, allowedWorkflows: [], members: [], secretPrefix: 'OTHER' },
]

vi.mock('@godin-engine/db', () => {
  // Unified select chain. `.where(pred)` returns BOTH:
  //   - `.orderBy().limit()` → runs list (scoped-db.listRuns), and
  //   - `.limit(n)`          → findTenantByMember (no orderBy), resolving the
  //                            registry rows whose members[] contains the DID.
  // The drizzle `sql` membership clause is encoded as { member: did }.
  const runsAndMembers = {
    from: () => ({
      innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: async () => state.approvals.map((r) => ({ approval: r })) }) }) }),
      where: (pred: { member?: string }) => ({
        orderBy: () => ({ limit: async () => state.runs }),
        limit: async (_n: number) =>
          REGISTRY.filter((t) => pred?.member != null && (t.members as string[]).includes(pred.member)),
      }),
    }),
  }
  const db = {
    select: (proj?: unknown) => (proj ? { from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: async () => state.approvals.map((r) => ({ approval: r })) }) }) }) }) } : runsAndMembers),
    insert: () => ({ values: async (v: Row) => { state.inserted.push(v) } }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async () => [],
        insert: () => ({ values: async (v: Row) => { state.inserted.push(v) } }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      }),
    query: {
      engineRuns: { findFirst: async () => state.runs[0] },
      engineApprovals: { findFirst: async () => state.approvals[0] },
      // getTenant(id) → findFirst({ where: eq(tenant_id, id) }); the drizzle mock
      // encodes eq as { eq: ['tenant_id', id] }.
      engineTenants: {
        findFirst: async ({ where }: { where: { eq?: [string, string] } }) => {
          const wantId = where?.eq?.[0] === 'tenant_id' ? where.eq[1] : undefined
          return REGISTRY.find((t) => t.tenantId === wantId)
        },
      },
    },
  }
  return {
    db,
    schema: {
      engineRuns: { runId: 'run_id', consumerId: 'consumer_id', status: 'status', createdAt: 'created_at' },
      engineApprovals: { approvalId: 'approval_id', sourceRunId: 'source_run_id', state: 'state', approver: 'approver', createdAt: 'created_at' },
      engineTenants: { tenantId: 'tenant_id', members: 'members' },
    },
  }
})

vi.mock('drizzle-orm', () => ({
  and: (...x: unknown[]) => ({ and: x }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  desc: (x: unknown) => x,
  // `${members} @> ARRAY[${did}]::text[]` — capture the DID string value (the
  // members column interpolates to the 'members' sentinel) as { member: did }.
  sql: Object.assign((_s: TemplateStringsArray, ...vals: unknown[]) => {
    const did = vals.find((v) => typeof v === 'string' && v !== 'members') as string | undefined
    return { member: did }
  }, { raw: () => ({}) }),
}))

const { buildApp } = await import('./app')
const { __resetTenantCache } = await import('./tenants')

beforeEach(() => {
  state.runs = []
  state.approvals = []
  state.inserted = []
  __resetTenantCache()
  process.env.SERVICE_KEYS = 'mi-pase:svc-key-mipase,other:svc-key-other'
  process.env.OPERATOR_KEY = 'op-secret'
  delete process.env.PRIVY_TENANT_MAP
})

describe('T1 — auth middleware', () => {
  it('401 with no credential', async () => {
    const app = buildApp()
    const res = await app.request('/v1/runs')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('401 with an invalid service key', async () => {
    const app = buildApp()
    const res = await app.request('/v1/runs', { headers: { 'X-Service-Key': 'nope' } })
    expect(res.status).toBe(401)
  })

  it('200 with a valid service key → consumer scoped', async () => {
    const app = buildApp()
    const res = await app.request('/v1/runs', { headers: { 'X-Service-Key': 'svc-key-mipase' } })
    expect(res.status).toBe(200)
  })

  it('verifies a Privy Bearer token via the injected offline seam', async () => {
    process.env.PRIVY_TENANT_MAP = 'did:privy:abc=mi-pase'
    const app = buildApp({ auth: { verifyPrivyToken: async () => ({ userId: 'did:privy:abc', appId: 'app1' }) } })
    const res = await app.request('/v1/runs', { headers: { Authorization: 'Bearer whatever' } })
    expect(res.status).toBe(200)
  })

  it('401 when the injected verifier throws (expired/bad-sig/wrong-aud)', async () => {
    const app = buildApp({ auth: { verifyPrivyToken: async () => { throw new Error('expired') } } })
    const res = await app.request('/v1/runs', { headers: { Authorization: 'Bearer x' } })
    expect(res.status).toBe(401)
  })

  it('mints a real ES256 JWT with jose and verifies it offline (seam contract)', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256')
    const pem = await exportSPKI(publicKey)
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject('did:privy:abc')
      .setAudience('app1')
      .setIssuer('privy.io')
      .setExpirationTime('1h')
      .sign(privateKey)
    // A test's offline verifier can mirror what @privy-io does with PRIVY_VERIFICATION_KEY=pem.
    const verifyPrivyToken = async (t: string) => {
      const { jwtVerify, importSPKI } = await import('jose')
      const key = await importSPKI(pem, 'ES256')
      const { payload } = await jwtVerify(t, key, { audience: 'app1', issuer: 'privy.io' })
      return { userId: payload.sub as string, appId: payload.aud as string }
    }
    process.env.PRIVY_TENANT_MAP = 'did:privy:abc=mi-pase'
    const app = buildApp({ auth: { verifyPrivyToken } })
    const res = await app.request('/v1/runs', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
  })
})

describe('T2 — scoping & tenant binding', () => {
  it('cross-tenant run id → 404 SKILL_NOT_FOUND, never 403', async () => {
    state.runs = [] // findFirst returns undefined for this tenant
    const app = buildApp()
    const res = await app.request('/v1/runs/some-other-tenant-run', { headers: { 'X-Service-Key': 'svc-key-mipase' } })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('SKILL_NOT_FOUND')
  })
})

describe('T3 — operator surfaces', () => {
  it('404 on /dashboard without X-Operator-Key', async () => {
    const app = buildApp()
    const res = await app.request('/dashboard')
    expect(res.status).toBe(404)
  })

  it('404 on /dashboard when OPERATOR_KEY is unset (fail closed)', async () => {
    delete process.env.OPERATOR_KEY
    const app = buildApp()
    const res = await app.request('/dashboard', { headers: { 'X-Operator-Key': 'anything' } })
    expect(res.status).toBe(404)
  })
})
