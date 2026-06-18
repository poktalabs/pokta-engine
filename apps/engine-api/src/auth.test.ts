import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SignJWT, generateKeyPair, exportSPKI, importSPKI, jwtVerify } from 'jose'

/**
 * AUTH-block spine tests (M1.5 / T1). Focused, hermetic coverage of the dual-mode
 * consumerAuth() middleware surfaced through buildApp({ auth }). We MOCK
 * @pokta-engine/db and @pokta-engine/queue so nothing touches Postgres or pg-boss
 * (the db client throws on import without DATABASE_URL), and we never hit the
 * network: the Privy verifier is either injected as a local async fn or, for the
 * "real token" cases, a `jose` ES256 verifier that mirrors what
 * @privy-io/server-auth does with PRIVY_VERIFICATION_KEY.
 *
 * Assertions go beyond status codes:
 *  - the exact UNAUTHENTICATED envelope { code, message, retryable } per failure,
 *  - the RESOLVED consumer (id / identity / mode) observed through the only public
 *    surface that records it: dispatch forces consumer.id onto the inserted run
 *    row, and approve binds consumer.identity into the approval update's decidedBy.
 *
 * Every failure mode FAILS CLOSED — there is no SERVICE_KEYS-unset "allow all".
 */

// ── In-memory capture of what the scoped-db layer writes (proves resolution) ──
type Row = Record<string, unknown>
const state: {
  runs: Row[]
  approvals: Row[]
  inserted: Row[]
  updated: Row[]
} = { runs: [], approvals: [], inserted: [], updated: [] }

vi.mock('@pokta-engine/queue', () => ({
  getBoss: async () => ({ send: async () => undefined }),
  QUEUE: 'workflow.run',
}))

vi.mock('@pokta-engine/db', () => {
  const chain = (rows: Row[]) => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({ orderBy: () => ({ limit: async () => rows.map((r) => ({ approval: r })) }) }),
      }),
      where: () => ({ orderBy: () => ({ limit: async () => rows }) }),
    }),
  })
  const db = {
    select: (proj?: unknown) => chain(proj ? state.approvals : state.runs),
    insert: () => ({ values: async (v: Row) => { state.inserted.push(v) } }),
    update: () => ({
      set: (v: Row) => {
        state.updated.push(v)
        return { where: () => ({ returning: async () => [{ approvalId: 'ap' }] }) }
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        // The scoped layer does two `tx.execute(sql\`...\`)` lock reads:
        //  - dispatch quota: `select count ...` → return count 0 so it proceeds.
        //  - approve gate:   `select state ...`  → return 'pending' so the
        //    under-lock re-check passes and the child run is dispatched.
        // One shape carrying both fields satisfies both call sites.
        execute: async () => [{ count: 0, state: 'pending' }],
        insert: () => ({ values: async (v: Row) => { state.inserted.push(v) } }),
        update: () => ({
          set: (v: Row) => {
            state.updated.push(v)
            return { where: async () => undefined }
          },
        }),
      }),
    query: {
      engineRuns: { findFirst: async () => state.runs[0] },
      engineApprovals: { findFirst: async () => state.approvals[0] },
    },
  }
  return {
    db,
    schema: {
      engineRuns: { runId: 'run_id', consumerId: 'consumer_id', status: 'status', createdAt: 'created_at' },
      engineApprovals: {
        approvalId: 'approval_id',
        sourceRunId: 'source_run_id',
        state: 'state',
        approver: 'approver',
        createdAt: 'created_at',
      },
    },
  }
})

vi.mock('drizzle-orm', () => ({
  and: (...x: unknown[]) => ({ and: x }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  desc: (x: unknown) => x,
  sql: Object.assign((..._a: unknown[]) => ({}), { raw: () => ({}) }),
}))

// ── ./tenants registry mock (PR2) ────────────────────────────────────────────
// resolveTenant now consults the registry: service mode → getTenant(id); privy
// mode → findTenantByMember(DID). The AUTH assertions below (resolved consumer.id
// forced onto the run; decidedBy = identity) require both the service tenants
// (mi-pase / other) AND the Privy DID (did:privy:abc → mi-pase) to resolve as
// ACTIVE with pricing-draft allow-listed. This mock supplies exactly that — it
// changes no auth assertion, only the registry resolveTenant reads after auth.
const SVC_TENANTS: Record<string, { status: 'active'; allowedWorkflows: string[] }> = {
  'mi-pase': { status: 'active', allowedWorkflows: ['pricing-draft', 'pricing-apply-flagged'] },
  other: { status: 'active', allowedWorkflows: ['pricing-draft', 'pricing-apply-flagged'] },
}
const MEMBER_OF: Record<string, string> = { 'did:privy:abc': 'mi-pase' }
vi.mock('./tenants', () => ({
  getTenant: async (id: string) => {
    const t = SVC_TENANTS[id]
    return t ? { tenantId: id, name: id, status: t.status, allowedWorkflows: t.allowedWorkflows } : undefined
  },
  findTenantByMember: async (did: string) => {
    const id = MEMBER_OF[did]
    if (!id) return undefined
    const t = SVC_TENANTS[id]
    return t ? { tenantId: id, name: id, status: t.status, allowedWorkflows: t.allowedWorkflows } : undefined
  },
  isActive: (row: { status: string }) => row.status === 'active',
  allowedWorkflowsFor: (row: { allowedWorkflows: string[] }) => row.allowedWorkflows,
  toTenantView: (row: { tenantId: string }) => ({ id: row.tenantId }),
}))

// Real workflow registry drives dispatch/approve. We pin to known ids whose input
// schemas accept `{}` so the auth assertions are never masked by an input 400:
//   - `pricing-draft` is a public, non-gated POST target with an all-optional
//     passthrough input → dispatch reaches the (mocked) insert.
//   - `pricing-apply-flagged` is its `onApprove` target with an all-optional
//     passthrough input → the approve route's artifact safeParse succeeds.
const { buildApp } = await import('./app')
const { gatedTargets } = await import('@pokta-engine/workflows')

const dispatchable = { id: 'pricing-draft' }
const gatedId = 'pricing-apply-flagged'
// Sanity-guard the pins against the real registry so a workflow rename fails loud.
const gated = gatedTargets()
if (gated.has(dispatchable.id)) throw new Error(`${dispatchable.id} should be directly dispatchable`)
if (!gated.has(gatedId)) throw new Error(`${gatedId} should be a gated onApprove target`)

beforeEach(() => {
  state.runs = []
  state.approvals = []
  state.inserted = []
  state.updated = []
  process.env.SERVICE_KEYS = 'mi-pase:svc-key-mipase,other:svc-key-other'
  delete process.env.PRIVY_TENANT_MAP
  delete process.env.PRIVY_APP_ID
  delete process.env.PRIVY_APP_SECRET
  delete process.env.PRIVY_VERIFICATION_KEY
})

// Mint a Privy-shaped ES256 token + a jose verifier mirroring @privy-io's offline
// verification (PRIVY_APP_ID is the audience; issuer is privy.io).
async function privyKit(opts: {
  sub?: string
  aud?: string
  iss?: string
  exp?: string | number
  signWith?: 'good' | 'bad'
} = {}) {
  const good = await generateKeyPair('ES256')
  const bad = await generateKeyPair('ES256')
  const pem = await exportSPKI(good.publicKey) // the "verification key" the server trusts
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject(opts.sub ?? 'did:privy:abc')
    .setAudience(opts.aud ?? 'app1')
    .setIssuer(opts.iss ?? 'privy.io')
    .setExpirationTime(opts.exp ?? '1h')
    .sign(opts.signWith === 'bad' ? bad.privateKey : good.privateKey)
  const verifyPrivyToken = async (t: string) => {
    const key = await importSPKI(pem, 'ES256')
    const { payload } = await jwtVerify(t, key, { audience: 'app1', issuer: 'privy.io' })
    return { userId: payload.sub as string, appId: payload.aud as string }
  }
  return { token, verifyPrivyToken }
}

describe('consumerAuth — fail-closed credential checks', () => {
  it('no service key and no bearer → 401 UNAUTHENTICATED with the exact envelope', async () => {
    const app = buildApp()
    const res = await app.request('/v1/runs')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string; message: string; retryable: boolean } }
    expect(body.error).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'missing X-Service-Key or Bearer token',
      retryable: false,
    })
  })

  it('an unknown X-Service-Key → 401 UNAUTHENTICATED (invalid X-Service-Key)', async () => {
    const app = buildApp()
    const res = await app.request('/v1/runs', { headers: { 'X-Service-Key': 'not-a-real-key' } })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
    expect(body.error.message).toBe('invalid X-Service-Key')
  })

  it('a Bearer token when Privy is unconfigured (no override, no app env) → 401', async () => {
    // No verifyPrivyToken override and no PRIVY_APP_ID/SECRET → default verifier is null.
    const app = buildApp()
    const res = await app.request('/v1/runs', { headers: { Authorization: 'Bearer anything' } })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
    expect(body.error.message).toBe('Privy verification not configured')
  })

  it('an empty Bearer token → 401 UNAUTHENTICATED', async () => {
    const app = buildApp({ auth: { verifyPrivyToken: async () => ({ userId: 'did:privy:abc', appId: 'app1' }) } })
    const res = await app.request('/v1/runs', { headers: { Authorization: 'Bearer    ' } })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })
})

describe('consumerAuth — valid X-Service-Key', () => {
  it('proceeds (200) and resolves consumer.id to the key owner', async () => {
    const app = buildApp()
    const res = await app.request('/v1/runs', { headers: { 'X-Service-Key': 'svc-key-mipase' } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runs: unknown[] }
    expect(body).toHaveProperty('runs')
  })

  it('forces the resolved tenant id onto the dispatched run (consumer.id binding)', async () => {
    const app = buildApp()
    const res = await app.request(`/v1/workflows/${dispatchable.id}/runs`, {
      method: 'POST',
      headers: { 'X-Service-Key': 'svc-key-mipase', 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    })
    expect(res.status).toBe(200)
    // dispatchRun forces consumerId from c.get('consumer').id — proves key→tenant.
    expect(state.inserted.at(-1)).toMatchObject({ consumerId: 'mi-pase' })
  })

  it('a different valid key resolves to its own distinct tenant (other)', async () => {
    const app = buildApp()
    const res = await app.request(`/v1/workflows/${dispatchable.id}/runs`, {
      method: 'POST',
      headers: { 'X-Service-Key': 'svc-key-other', 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    })
    // 'other' is in SERVICE_KEYS so resolveTenant accepts it; consumerId is forced.
    expect(res.status).toBe(200)
    expect(state.inserted.at(-1)).toMatchObject({ consumerId: 'other' })
  })

  it("binds decided_by to identity 'service:<id>' on approve", async () => {
    state.runs = [{ runId: 'r1', consumerId: 'mi-pase' }]
    state.approvals = [{ approvalId: 'ap-1', sourceRunId: 'r1', workflowId: gatedId, artifact: {}, state: 'pending' }]
    const app = buildApp()
    const res = await app.request('/v1/approvals/ap-1/approve', {
      method: 'POST',
      headers: { 'X-Service-Key': 'svc-key-mipase' },
    })
    expect(res.status).toBe(200)
    // the approval update binds decidedBy to the authenticated principal string.
    const decision = state.updated.find((u) => u.decidedBy != null)
    expect(decision?.decidedBy).toBe('service:mi-pase')
  })
})

describe('consumerAuth — Privy bearer (offline verification seam)', () => {
  it('a valid minted ES256 JWT verifies offline → proceeds, mode=privy, identity=DID', async () => {
    const { token, verifyPrivyToken } = await privyKit({ sub: 'did:privy:abc' })
    process.env.PRIVY_TENANT_MAP = 'did:privy:abc=mi-pase'
    const app = buildApp({ auth: { verifyPrivyToken } })

    // A read proves it authenticated (200, not 401).
    const read = await app.request('/v1/runs', { headers: { Authorization: `Bearer ${token}` } })
    expect(read.status).toBe(200)

    // Approve proves identity binding: decidedBy is the verified DID, NOT a service string.
    state.runs = [{ runId: 'r1', consumerId: 'mi-pase' }]
    state.approvals = [{ approvalId: 'ap-1', sourceRunId: 'r1', workflowId: gatedId, artifact: {}, state: 'pending' }]
    const res = await app.request('/v1/approvals/ap-1/approve', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const decision = state.updated.find((u) => u.decidedBy != null)
    expect(decision?.decidedBy).toBe('did:privy:abc')
  })

  it('maps the verified DID to its tenant and forces that consumerId on dispatch', async () => {
    const { token, verifyPrivyToken } = await privyKit({ sub: 'did:privy:abc' })
    process.env.PRIVY_TENANT_MAP = 'did:privy:abc=mi-pase'
    const app = buildApp({ auth: { verifyPrivyToken } })
    const res = await app.request(`/v1/workflows/${dispatchable.id}/runs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    })
    expect(res.status).toBe(200)
    expect(state.inserted.at(-1)).toMatchObject({ consumerId: 'mi-pase' })
  })

  it('an EXPIRED JWT → 401 (verifier throws, fail closed)', async () => {
    const { token, verifyPrivyToken } = await privyKit({ exp: 0 }) // already expired
    const app = buildApp({ auth: { verifyPrivyToken } })
    const res = await app.request('/v1/runs', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
    expect(body.error.message).toBe('invalid or expired bearer token')
  })

  it('a WRONG-AUDIENCE JWT → 401 (audience mismatch throws)', async () => {
    const { token, verifyPrivyToken } = await privyKit({ aud: 'wrong-app' })
    const app = buildApp({ auth: { verifyPrivyToken } })
    const res = await app.request('/v1/runs', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('a BAD-SIGNATURE JWT → 401 (signed by a different key than the verifier trusts)', async () => {
    const { token, verifyPrivyToken } = await privyKit({ signWith: 'bad' })
    const app = buildApp({ auth: { verifyPrivyToken } })
    const res = await app.request('/v1/runs', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('a verifier that is UNREACHABLE (throws non-JWT error) → 401, never fail open', async () => {
    // Simulates a JWKS-fetch / network failure inside @privy-io: any throw → 401.
    const app = buildApp({
      auth: {
        verifyPrivyToken: async () => {
          throw new Error('ECONNREFUSED: privy JWKS unreachable')
        },
      },
    })
    const res = await app.request('/v1/runs', { headers: { Authorization: 'Bearer some.jwt.value' } })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
    expect(body.error.message).toBe('invalid or expired bearer token')
  })
})
