import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPair, exportSPKI, SignJWT } from 'jose'

/**
 * POST /v1/tenants/claim — focused behavioral coverage (Wave 1 / §4, D4/D6, anti-enum).
 *
 * Hermetic: @godin-engine/db + @godin-engine/queue are MOCKED so nothing touches
 * Postgres or pg-boss; the Privy bearer verifier AND the verified-email resolver are
 * injected OFFLINE via buildApp({ auth, resolvePrivyEmails }) so no JWKS fetch and no
 * getUser network call ever happen. One token is also minted with a real ES256 jose
 * key + verified offline to exercise the bearer seam contract end-to-end.
 *
 * The db mock is a tiny in-memory engine_tenants + engine_tenant_members +
 * engine_tenant_invites + engine_quota_ledger that emulates the membership UNIQUE(did)
 * guard, the invite claim flow, and the per-DID claim throttle ledger.
 *
 * This file asserts the SPECIFIC §4 invariants:
 *   (1) an unbound DID whose verified email matches a pending invite binds + returns
 *       the TenantView;
 *   (2) a DID that is ALREADY an active member returns its TenantView WITHOUT calling
 *       the Privy email resolver and WITHOUT charging the throttle ledger;
 *   (3) ANTI-ENUM — no-match / collision / revoked / inactive-tenant ALL return a
 *       BYTE-IDENTICAL TENANT_UNKNOWN envelope (asserted by exact deep-equality of the
 *       parsed JSON body across the four cases);
 *   (4) over the per-DID daily throttle → 429 QUOTA_EXCEEDED;
 *   (5) no credential → 401; a service-mode principal → rejected (TENANT_UNKNOWN, 403).
 */

// ── In-memory store shared with the db mock ─────────────────────────────────────
interface InviteRow {
  tenantId: string
  email: string
  status: 'pending' | 'claimed' | 'revoked'
  claimedByDid: string | null
}
const store: {
  invites: InviteRow[]
  members: Array<{ tenantId: string; did: string }>
  ledger: Record<string, number>
  tenants: Record<string, Record<string, unknown>>
} = {
  invites: [],
  members: [],
  ledger: {},
  // mi-pase + acme are ACTIVE; frozen is NOT active (pending) → its invites resolve
  // to the inactive-tenant deny path inside claimInvite's pre-mutation gate.
  tenants: {
    'mi-pase': { tenantId: 'mi-pase', name: 'Mi Pase', status: 'active', currency: 'MXN', locale: 'es-MX', branding: {}, allowedWorkflows: [], secretPrefix: 'MIPASE' },
    acme: { tenantId: 'acme', name: 'Acme', status: 'active', currency: 'USD', locale: 'en', branding: {}, allowedWorkflows: [], secretPrefix: 'ACME' },
    frozen: { tenantId: 'frozen', name: 'Frozen', status: 'pending', currency: 'USD', locale: 'en', branding: {}, allowedWorkflows: [], secretPrefix: 'FROZEN' },
  },
}

/** A pg-style UNIQUE(did) violation, as the membership insert surfaces it. */
class FakeUniqueViolation extends Error {
  code = '23505'
  constraint = 'tenant_members_did_unique'
}

vi.mock('@godin-engine/queue', () => ({
  getBoss: async () => ({ send: async () => undefined }),
  QUEUE: 'workflow.run',
}))

// drizzle markers: eq/and/ne/inArray yield inspectable objects; sql captures the
// template text + values so the raw execute() paths (ledger + claim FOR UPDATE) can
// route on a substring of the SQL.
vi.mock('drizzle-orm', () => ({
  and: (...x: unknown[]) => ({ and: x.filter(Boolean) }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  ne: (a: unknown, b: unknown) => ({ ne: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  desc: (x: unknown) => x,
  sql: Object.assign((s: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: s.join('?'), vals }), {
    raw: () => ({}),
  }),
}))

vi.mock('@godin-engine/db', () => {
  // DID out of findTenantByMember's `eq(M.did, did)` where-marker.
  const didFromMemberJoin = (pred: unknown): string | undefined => {
    const p = pred as { eq?: [string, string] }
    return p?.eq?.[0] === 'M.did' ? p.eq[1] : undefined
  }
  // Email set out of findInviteForEmails' `and(inArray(V.email, [...]), ne(...))`.
  const emailsFromInvite = (m: unknown): string[] | undefined => {
    const w = m as { and?: unknown[] }
    for (const part of w?.and ?? []) {
      const p = part as { inArray?: [unknown, string[]] }
      if (p?.inArray && p.inArray[0] === 'V.email') return p.inArray[1]
    }
    return undefined
  }
  // (tenant_id, email) out of claimInvite's update where-marker.
  const invAndPair = (m: unknown): { tenantId?: string; email?: string } => {
    const w = m as { and?: unknown[] }
    const out: { tenantId?: string; email?: string } = {}
    for (const part of w?.and ?? []) {
      const p = part as { eq?: [string, string] }
      if (p?.eq?.[0] === 'V.tenant_id') out.tenantId = p.eq[1]
      if (p?.eq?.[0] === 'V.email') out.email = p.eq[1]
    }
    return out
  }

  // SELECT chain serves BOTH findInviteForEmails (.from(V).where(inArray).limit) and
  // findTenantByMember (.from(M).innerJoin(T).where(eq M.did).limit).
  const select = (_proj?: unknown) => ({
    from: () => ({
      where: (w: unknown) => ({
        limit: async (n: number) => {
          const emails = new Set(emailsFromInvite(w) ?? [])
          return store.invites.filter((i) => emails.has(i.email) && i.status !== 'revoked').slice(0, n)
        },
      }),
      innerJoin: () => ({
        where: (pred: unknown) => ({
          limit: async (n: number) => {
            const did = didFromMemberJoin(pred)
            return store.members
              .filter((m) => did != null && m.did === did)
              .map((m) => ({ tenant: store.tenants[m.tenantId] }))
              .slice(0, n)
          },
        }),
      }),
    }),
  })

  // addTenantMember: insert(M).values(...).onConflictDoNothing() — emulates PK no-op
  // and the cross-tenant UNIQUE(did) → 23505.
  const insert = () => ({
    values: (v: { tenantId: string; did: string }) => ({
      onConflictDoNothing: async () => {
        if (store.members.some((m) => m.tenantId === v.tenantId && m.did === v.did)) return
        if (store.members.some((m) => m.did === v.did)) throw new FakeUniqueViolation()
        store.members.push({ tenantId: v.tenantId, did: v.did })
      },
    }),
  })

  // claimInvite: update(V).set(...).where(and(eq tenant_id, eq email)).
  const update = () => ({
    set: (vals: Partial<InviteRow>) => ({
      where: async (w: unknown) => {
        const { tenantId, email } = invAndPair(w)
        const row = store.invites.find((i) => i.tenantId === tenantId && i.email === email)
        if (row) {
          if (vals.status) row.status = vals.status
          if ('claimedByDid' in vals) row.claimedByDid = vals.claimedByDid ?? null
        }
      },
    }),
  })
  const del = () => ({ where: async () => undefined })

  // Raw SQL paths: claim throttle ledger + claimInvite's `select ... for update`.
  const execute = async (q: unknown) => {
    const sqlText = (q as { __sql?: string })?.__sql ?? ''
    const vals = (q as { vals?: unknown[] })?.vals ?? []
    if (sqlText.includes('insert into engine_quota_ledger')) {
      const id = vals[0] as string
      if (!(id in store.ledger)) store.ledger[id] = 0
      return []
    }
    if (sqlText.includes('select count from engine_quota_ledger')) {
      const id = vals[0] as string
      return [{ count: store.ledger[id] ?? 0 }]
    }
    if (sqlText.includes('update engine_quota_ledger')) {
      const id = vals[0] as string
      store.ledger[id] = (store.ledger[id] ?? 0) + 1
      return []
    }
    if (sqlText.includes('from engine_tenant_invites')) {
      const email = vals.find((v) => typeof v === 'string') as string | undefined
      const inv = store.invites.find((i) => i.email === email && i.status !== 'revoked')
      return inv
        ? [{ tenant_id: inv.tenantId, email: inv.email, status: inv.status, claimed_by_did: inv.claimedByDid }]
        : []
    }
    return []
  }

  const db = {
    select,
    insert,
    update,
    delete: del,
    execute,
    // claimInvite runs inside ONE transaction; on a thrown sentinel (collision) the tx
    // must ROLL BACK — we snapshot + restore invites/members so the rollback is real.
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = {
        invites: store.invites.map((i) => ({ ...i })),
        members: store.members.map((m) => ({ ...m })),
      }
      try {
        return await fn({ select, insert, update, delete: del, execute })
      } catch (e) {
        store.invites = snapshot.invites
        store.members = snapshot.members
        throw e
      }
    },
    query: {
      // getTenant(id) → findFirst({ where: eq(tenant_id, id) }).
      engineTenants: {
        findFirst: async ({ where }: { where: { eq?: [string, string] } }) => {
          const id = where?.eq?.[0] === 'tenant_id' ? where.eq[1] : undefined
          return id ? store.tenants[id] : undefined
        },
      },
    },
  }

  return {
    db,
    schema: {
      engineTenants: { tenantId: 'tenant_id' },
      engineTenantMembers: { tenantId: 'M.tenant_id', did: 'M.did' },
      engineTenantInvites: { tenantId: 'V.tenant_id', email: 'V.email', status: 'V.status' },
    },
  }
})

const { buildApp } = await import('./app')
const { __resetTenantCache } = await import('./tenants')
const { __resetClaimNegCache } = await import('./claim-neg-cache')

/** Build an app with an offline Privy verifier (DID-pinned) + an injected email resolver. */
function appWith(resolveEmails: (did: string) => Promise<string[]>, did = 'did:privy:claimer') {
  return buildApp({
    auth: { verifyPrivyToken: async () => ({ userId: did, appId: 'app1' }) },
    resolvePrivyEmails: resolveEmails,
  })
}

function post(app: ReturnType<typeof buildApp>, headers: Record<string, string>) {
  return app.request('/v1/tenants/claim', { method: 'POST', headers })
}

/** The single fixed envelope every claim/resolve failure must return (anti-enum). */
const TENANT_UNKNOWN_ENVELOPE = {
  error: { code: 'TENANT_UNKNOWN', message: 'principal maps to no active tenant', retryable: false },
}

beforeEach(() => {
  store.invites = []
  store.members = []
  store.ledger = {}
  __resetTenantCache()
  __resetClaimNegCache()
  process.env.SERVICE_KEYS = 'mi-pase:svc-key-mipase'
  delete process.env.PRIVY_TENANT_MAP
})

describe('POST /v1/tenants/claim — happy path (1) unbound DID, matching invite', () => {
  it('verified email matches a pending invite → binds the DID and returns the TenantView', async () => {
    store.invites.push({ tenantId: 'mi-pase', email: 'owner@acme.co', status: 'pending', claimedByDid: null })
    const app = appWith(async () => ['owner@acme.co'], 'did:privy:claimer')

    const res = await post(app, { Authorization: 'Bearer x' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string }
    expect(body.id).toBe('mi-pase')

    // The DID is now bound, and the invite is marked claimed by it.
    expect(store.members).toContainEqual({ tenantId: 'mi-pase', did: 'did:privy:claimer' })
    const invite = store.invites.find((i) => i.email === 'owner@acme.co')
    expect(invite).toMatchObject({ status: 'claimed', claimedByDid: 'did:privy:claimer' })
  })

  it('binds via a real ES256 bearer (jose) verified offline + injected resolver', async () => {
    store.invites.push({ tenantId: 'acme', email: 'eng@acme.co', status: 'pending', claimedByDid: null })
    const { publicKey, privateKey } = await generateKeyPair('ES256')
    const pem = await exportSPKI(publicKey)
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject('did:privy:jose')
      .setAudience('app1')
      .setIssuer('privy.io')
      .setExpirationTime('1h')
      .sign(privateKey)
    const verifyPrivyToken = async (t: string) => {
      const { jwtVerify, importSPKI } = await import('jose')
      const key = await importSPKI(pem, 'ES256')
      const { payload } = await jwtVerify(t, key, { audience: 'app1', issuer: 'privy.io' })
      return { userId: payload.sub as string, appId: payload.aud as string }
    }
    const app = buildApp({ auth: { verifyPrivyToken }, resolvePrivyEmails: async () => ['eng@acme.co'] })

    const res = await post(app, { Authorization: `Bearer ${token}` })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { id: string }).id).toBe('acme')
    expect(store.members).toContainEqual({ tenantId: 'acme', did: 'did:privy:jose' })
  })
})

describe('POST /v1/tenants/claim — (2) already an active member', () => {
  it('returns the TenantView WITHOUT calling the Privy resolver and WITHOUT a throttle charge', async () => {
    store.members.push({ tenantId: 'mi-pase', did: 'did:privy:member' })
    const resolver = vi.fn(async () => ['ignored@acme.co'])
    const app = appWith(resolver, 'did:privy:member')

    const res = await post(app, { Authorization: 'Bearer x' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { id: string }).id).toBe('mi-pase')

    // Idempotent fast-path: the Privy email seam was never invoked …
    expect(resolver).not.toHaveBeenCalled()
    // … and no claim-throttle ledger row was created/charged for this DID.
    const day = new Date().toISOString().slice(0, 10)
    expect(store.ledger[`did:privy:member:__tenant_claim__:${day}`]).toBeUndefined()
    expect(Object.keys(store.ledger)).toHaveLength(0)
  })
})

describe('POST /v1/tenants/claim — (3) anti-enumeration: one byte-identical envelope', () => {
  async function claimWith(setup: () => void, did: string, emails: string[]) {
    store.invites = []
    store.members = []
    store.ledger = {}
    __resetTenantCache()
    __resetClaimNegCache()
    setup()
    const res = await post(appWith(async () => emails, did), { Authorization: 'Bearer x' })
    return { status: res.status, body: await res.json() }
  }

  it('no-match / collision / revoked / inactive-tenant ALL return a BYTE-IDENTICAL TENANT_UNKNOWN envelope', async () => {
    // no-match: a verified email with no invite anywhere.
    const noMatch = await claimWith(() => {}, 'did:privy:a', ['nobody@acme.co'])

    // collision: the invite is already claimed by a DIFFERENT did.
    const collision = await claimWith(
      () => store.invites.push({ tenantId: 'mi-pase', email: 'taken@acme.co', status: 'claimed', claimedByDid: 'did:privy:owner' }),
      'did:privy:b',
      ['taken@acme.co'],
    )

    // revoked: a revoked invite never matches (collapses into the no-match path).
    const revoked = await claimWith(
      () => store.invites.push({ tenantId: 'mi-pase', email: 'gone@acme.co', status: 'revoked', claimedByDid: null }),
      'did:privy:c',
      ['gone@acme.co'],
    )

    // inactive-tenant: a pending invite into a NON-active tenant (frozen) is gated
    // before any mutation.
    const inactive = await claimWith(
      () => store.invites.push({ tenantId: 'frozen', email: 'cold@acme.co', status: 'pending', claimedByDid: null }),
      'did:privy:d',
      ['cold@acme.co'],
    )

    const all = [noMatch, collision, revoked, inactive]
    for (const r of all) {
      expect(r.status).toBe(403)
      expect(r.body).toEqual(TENANT_UNKNOWN_ENVELOPE)
    }
    // Exact deep-equality across every distinct failure reason → no enumeration signal.
    expect(noMatch.body).toEqual(collision.body)
    expect(collision.body).toEqual(revoked.body)
    expect(revoked.body).toEqual(inactive.body)
    // And byte-identical when serialized.
    const serialized = all.map((r) => JSON.stringify(r.body))
    expect(new Set(serialized).size).toBe(1)

    // The collision must NOT have leaked a side effect: the offending did is not bound.
    expect(store.members.some((m) => m.did === 'did:privy:b')).toBe(false)
  })
})

describe('POST /v1/tenants/claim — (4) per-DID throttle', () => {
  it('over the daily claim limit → 429 QUOTA_EXCEEDED (resolver never reached)', async () => {
    const day = new Date().toISOString().slice(0, 10)
    store.ledger[`did:privy:flood:__tenant_claim__:${day}`] = 5 // at CLAIM_THROTTLE_PER_DAY
    const resolver = vi.fn(async () => ['owner@acme.co'])
    store.invites.push({ tenantId: 'mi-pase', email: 'owner@acme.co', status: 'pending', claimedByDid: null })

    const res = await post(appWith(resolver, 'did:privy:flood'), { Authorization: 'Bearer x' })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('QUOTA_EXCEEDED')
    // Throttle short-circuits BEFORE the getUser email resolve.
    expect(resolver).not.toHaveBeenCalled()
  })
})

describe('POST /v1/tenants/claim — (5) credential gating', () => {
  it('401 with no credential', async () => {
    const res = await post(appWith(async () => ['owner@acme.co']), {})
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('a service-mode principal is rejected (TENANT_UNKNOWN, never claims)', async () => {
    const resolver = vi.fn(async () => ['owner@acme.co'])
    store.invites.push({ tenantId: 'mi-pase', email: 'owner@acme.co', status: 'pending', claimedByDid: null })

    const res = await post(appWith(resolver), { 'X-Service-Key': 'svc-key-mipase' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(TENANT_UNKNOWN_ENVELOPE)
    // A service principal IS its own tenant; the claim path never touches Privy.
    expect(resolver).not.toHaveBeenCalled()
  })
})
