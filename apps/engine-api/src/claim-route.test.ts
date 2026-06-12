import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Wave 1 POST /v1/tenants/claim coverage (D2/D4/D6, anti-enum). Hermetic: @godin-engine/db
 * + @godin-engine/queue mocked; the Privy verifier AND the verified-email resolver are
 * injected OFFLINE via buildApp({ auth, resolvePrivyEmails }). The db mock is an
 * in-memory engine_tenants + engine_tenant_members + engine_tenant_invites + quota
 * ledger that emulates the membership UNIQUE(did) and the claim flow.
 *
 * Asserts: service-mode rejected; unauth → 401; already-member → TenantView with NO
 * Privy call; verified-email match → TenantView; over the per-DID throttle → 429
 * QUOTA_EXCEEDED; and the ★ anti-enumeration invariant — no-match / collision /
 * inactive / revoked all return a BYTE-IDENTICAL TENANT_UNKNOWN envelope.
 */

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
  tenants: {
    'mi-pase': { tenantId: 'mi-pase', name: 'Mi Pase', status: 'active', currency: 'MXN', locale: 'es-MX', branding: {}, allowedWorkflows: [], secretPrefix: 'MIPASE' },
    vino: { tenantId: 'vino', name: 'Vino', status: 'pending', currency: 'USD', locale: 'en', branding: {}, allowedWorkflows: [], secretPrefix: 'VINO' },
    other: { tenantId: 'other', name: 'Other', status: 'active', currency: 'USD', locale: 'en', branding: {}, allowedWorkflows: [], secretPrefix: 'OTHER' },
  },
}

class FakeUniqueViolation extends Error {
  code = '23505'
  constraint = 'tenant_members_did_unique'
}

vi.mock('@godin-engine/queue', () => ({
  getBoss: async () => ({ send: async () => undefined }),
  QUEUE: 'workflow.run',
}))

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
  const didFromMemberJoin = (pred: unknown): string | undefined => {
    const p = pred as { eq?: [string, string] }
    return p?.eq?.[0] === 'M.did' ? p.eq[1] : undefined
  }
  const emailsFromInvite = (m: unknown): string[] | undefined => {
    const w = m as { and?: unknown[] }
    for (const part of w?.and ?? []) {
      const p = part as { inArray?: [unknown, string[]] }
      if (p?.inArray && p.inArray[0] === 'V.email') return p.inArray[1]
    }
    return undefined
  }
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

  // SELECT chain: invites find (.from(V).where(inArray email).limit) AND
  // findTenantByMember (.from(M).innerJoin(T).where(eq M.did).limit).
  const select = (_proj?: unknown) => ({
    from: () => ({
      // invites find
      where: (w: unknown) => ({
        limit: async (n: number) => {
          const emails = new Set(emailsFromInvite(w) ?? [])
          return store.invites.filter((i) => emails.has(i.email) && i.status !== 'revoked').slice(0, n)
        },
      }),
      // findTenantByMember
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

  const insert = () => ({
    values: (v: { tenantId: string; did: string }) => ({
      onConflictDoNothing: async () => {
        if (store.members.some((m) => m.tenantId === v.tenantId && m.did === v.did)) return
        if (store.members.some((m) => m.did === v.did)) throw new FakeUniqueViolation()
        store.members.push({ tenantId: v.tenantId, did: v.did })
      },
    }),
  })
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

  const execute = async (q: unknown) => {
    const sqlText = (q as { __sql?: string })?.__sql ?? ''
    const vals = (q as { vals?: unknown[] })?.vals ?? []
    // claim throttle ledger ops (keyed by the ledger id string).
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
    // claimInvite `select ... for update` on engine_tenant_invites by email.
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
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = { invites: store.invites.map((i) => ({ ...i })), members: store.members.map((m) => ({ ...m })) }
      try {
        return await fn({ select, insert, update, delete: del, execute })
      } catch (e) {
        store.invites = snapshot.invites
        store.members = snapshot.members
        throw e
      }
    },
    query: {
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

function appWith(emails: (did: string) => Promise<string[]>, did = 'did:privy:new') {
  return buildApp({
    auth: { verifyPrivyToken: async () => ({ userId: did, appId: 'app1' }) },
    resolvePrivyEmails: emails,
  })
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

async function post(app: ReturnType<typeof buildApp>, headers: Record<string, string>) {
  return app.request('/v1/tenants/claim', { method: 'POST', headers })
}

describe('POST /v1/tenants/claim — gating', () => {
  it('401 with no credential', async () => {
    const res = await post(appWith(async () => []), {})
    expect(res.status).toBe(401)
  })

  it('service-mode principal is rejected (TENANT_UNKNOWN, never claims)', async () => {
    const res = await post(appWith(async () => ['a@b.co']), { 'X-Service-Key': 'svc-key-mipase' })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TENANT_UNKNOWN')
  })
})

describe('POST /v1/tenants/claim — happy + idempotent', () => {
  it('verified-email match → binds DID and returns the TenantView', async () => {
    store.invites.push({ tenantId: 'mi-pase', email: 'owner@b.co', status: 'pending', claimedByDid: null })
    const res = await post(appWith(async () => ['owner@b.co']), { Authorization: 'Bearer x' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string }
    expect(body.id).toBe('mi-pase')
    expect(store.members).toContainEqual({ tenantId: 'mi-pase', did: 'did:privy:new' })
  })

  it('already-a-member → TenantView WITHOUT calling Privy', async () => {
    store.members.push({ tenantId: 'mi-pase', did: 'did:privy:member' })
    const resolver = vi.fn(async () => ['x@y.co'])
    const app = appWith(resolver, 'did:privy:member')
    const res = await post(app, { Authorization: 'Bearer x' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string }
    expect(body.id).toBe('mi-pase')
    expect(resolver).not.toHaveBeenCalled()
  })
})

describe('POST /v1/tenants/claim — throttle (D6)', () => {
  it('over the per-DID daily limit → 429 QUOTA_EXCEEDED', async () => {
    const day = new Date().toISOString().slice(0, 10)
    store.ledger[`did:privy:new:__tenant_claim__:${day}`] = 5 // at the default cap
    const res = await post(appWith(async () => ['owner@b.co']), { Authorization: 'Bearer x' })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('QUOTA_EXCEEDED')
  })
})

describe('POST /v1/tenants/claim — anti-enumeration (identical envelope)', () => {
  async function envelopeFor(setup: () => void, did: string, emails: string[]) {
    store.invites = []
    store.members = []
    store.ledger = {}
    __resetTenantCache()
    __resetClaimNegCache()
    setup()
    const res = await post(appWith(async () => emails, did), { Authorization: 'Bearer x' })
    return { status: res.status, body: await res.json() }
  }

  it('no-match / collision / inactive / revoked all return a BYTE-IDENTICAL TENANT_UNKNOWN envelope', async () => {
    // no verified email at all
    const noEmail = await envelopeFor(() => {}, 'did:a', [])
    // no matching invite
    const noMatch = await envelopeFor(() => {}, 'did:b', ['nobody@x.co'])
    // collision: invite already claimed by another did
    const collision = await envelopeFor(
      () => store.invites.push({ tenantId: 'mi-pase', email: 'c@x.co', status: 'claimed', claimedByDid: 'did:owner' }),
      'did:c',
      ['c@x.co'],
    )
    // inactive tenant (vino is pending)
    const inactive = await envelopeFor(
      () => store.invites.push({ tenantId: 'vino', email: 'v@x.co', status: 'pending', claimedByDid: null }),
      'did:d',
      ['v@x.co'],
    )
    // revoked invite → never matches (no-match path)
    const revoked = await envelopeFor(
      () => store.invites.push({ tenantId: 'mi-pase', email: 'r@x.co', status: 'revoked', claimedByDid: null }),
      'did:e',
      ['r@x.co'],
    )

    const all = [noEmail, noMatch, collision, inactive, revoked]
    for (const r of all) {
      expect(r.status).toBe(403)
      expect(r.body).toEqual({ error: { code: 'TENANT_UNKNOWN', message: 'principal maps to no active tenant', retryable: false } })
    }
    // Byte-identical bodies across every failure reason.
    const serialized = all.map((r) => JSON.stringify(r.body))
    expect(new Set(serialized).size).toBe(1)
  })

  it('negative cache: a second login for a no-match DID does NOT call Privy again', async () => {
    const resolver = vi.fn(async () => ['nobody@x.co'])
    const app = appWith(resolver, 'did:cached')
    const first = await post(app, { Authorization: 'Bearer x' })
    expect(first.status).toBe(403)
    expect(resolver).toHaveBeenCalledTimes(1)
    // Second attempt: short-circuited by the neg-cache, identical envelope, no Privy.
    const second = await post(app, { Authorization: 'Bearer x' })
    expect(second.status).toBe(403)
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(await second.json()).toEqual({ error: { code: 'TENANT_UNKNOWN', message: 'principal maps to no active tenant', retryable: false } })
  })
})
