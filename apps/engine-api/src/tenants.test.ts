import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REGISTRY + RESOLVE unit coverage (PR2 §6 / T3 + T4).
 *
 * REGISTRY — the in-process tenant registry accessor (`apps/engine-api/src/tenants.ts`):
 *   getTenant cache hit (no second read) / cache miss (exactly one indexed row read) /
 *   TTL-expiry (after the ~60s window the next call re-reads — driven by an INJECTED
 *   clock via __resetTenantCache, never a real sleep); unknown id → undefined (and the
 *   absence is negatively cached); findTenantByMember(did) → the unique owning tenant,
 *   undefined for none, and the ambiguous marker for >1.
 *
 * RESOLVE — the registry-backed `resolveTenant` (`apps/engine-api/src/scoped-db.ts`)
 *   exercised against the REAL tenants module (NOT a mock — this proves the live
 *   getTenant/findTenantByMember/isActive wiring): service consumer → tenant ok; privy
 *   DID in exactly one members[] → ok; DID in NO members[] → not-ok (TENANT_UNKNOWN);
 *   DID in TWO tenants → not-ok (ambiguous, never guesses); status pending/disabled →
 *   not-ok; empty/undefined id → not-ok.
 *
 * Canonical mocking pattern (see auth/isolation/scoped-db.test.ts): the
 * @pokta-engine/db client throws on import without DATABASE_URL, so we ALWAYS mock it.
 * The registry + resolveTenant both take an INJECTABLE db arg, so each case passes a
 * recording fake client; the real `db` export is never touched. drizzle-orm is mocked
 * structurally so `eq`/`sql` yield inspectable markers we can read the queried id from.
 */

// ── drizzle-orm: structural markers so the fake db can read which id was queried ──
vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...x: unknown[]) => ({ and: x.filter(Boolean) }),
  desc: (x: unknown) => ({ desc: x }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ sql: { strings, vals } }),
    { raw: (s: unknown) => ({ raw: s }) },
  ),
}))

// ── @pokta-engine/db: schema columns tagged so eq-markers reveal the queried column ──
// The registry references schema.engineTenants.<col> and schema.engineTenantMembers.<col>.
// The real `db` is irrelevant — getTenant / findTenantByMember / resolveTenant all
// accept db as an argument.
vi.mock('@pokta-engine/db', () => ({
  db: {},
  schema: {
    engineTenants: {
      tenantId: 'T.tenant_id',
    },
    engineTenantMembers: {
      tenantId: 'M.tenant_id',
      did: 'M.did',
    },
  },
}))

const { getTenant, findTenantByMember, __resetTenantCache, isActive, TENANT_CACHE_TTL_MS } =
  await import('./tenants')
const { resolveTenant } = await import('./scoped-db')

// ── Row factory: a TenantRow shaped enough for the code under test ────────────
type Status = 'active' | 'pending' | 'disabled'
function row(tenantId: string, status: Status = 'active', members: string[] = []) {
  return {
    tenantId,
    name: tenantId,
    status,
    currency: 'MXN',
    locale: 'es-MX',
    branding: { name: tenantId },
    allowedWorkflows: [],
    members,
    secretPrefix: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// ── Recording fake db ─────────────────────────────────────────────────────────
// Backs getTenant via query.engineTenants.findFirst (keyed by the eq-marker id) and
// findTenantByMember via select().from().where().limit() (keyed by the did baked into
// the sql template vals). Counts every read so cache hit/miss is provable.
interface Marker {
  eq?: [unknown, unknown]
  and?: unknown[]
}
function eqId(where: unknown): string | undefined {
  const w = where as Marker
  if (w?.eq && w.eq[0] === 'T.tenant_id') return w.eq[1] as string
  return undefined
}

/** Pull the queried DID out of an `eq(M.did, did)` where-marker. */
function didFromWhere(where: unknown): string | undefined {
  const w = where as Marker
  if (w?.eq && w.eq[0] === 'M.did') return w.eq[1] as string
  return undefined
}

function makeDb(rowsById: Record<string, ReturnType<typeof row>>) {
  let findFirstCalls = 0
  let selectCalls = 0
  const db = {
    query: {
      engineTenants: {
        findFirst: async (args: { where: unknown }) => {
          findFirstCalls++
          const id = eqId(args.where)
          return id ? rowsById[id] : undefined
        },
      },
    },
    // findTenantByMember now joins engine_tenant_members → engine_tenants:
    //   db.select({tenant:T}).from(M).innerJoin(T, eq(M.tenant_id, T.tenant_id))
    //     .where(eq(M.did, did)).limit(2)
    // The fixture is the row factory's `members` (a list of DIDs per tenant); the
    // fake resolves the DID to the owning tenant row(s) and projects { tenant }.
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (w: unknown) => {
            selectCalls++
            const did = didFromWhere(w)
            const matches = Object.values(rowsById).filter((r) => did != null && r.members.includes(did))
            return { limit: async (n: number) => matches.slice(0, n).map((tenant) => ({ tenant })) }
          },
        }),
      }),
    }),
  }
  return {
    db,
    get findFirstCalls() {
      return findFirstCalls
    },
    get selectCalls() {
      return selectCalls
    },
  }
}

// Deterministic clock the registry reads via the __resetTenantCache hook.
let clockMs = 0
const clock = () => clockMs
beforeEach(() => {
  clockMs = 1_000_000
  __resetTenantCache(clock)
})

// principals (see auth.ts Consumer)
const svc = (id: string) => ({ id, identity: `service:${id}`, mode: 'service' as const })
const privy = (did: string) => ({ id: '', identity: did, mode: 'privy' as const })

// ── REGISTRY ──────────────────────────────────────────────────────────────────
describe('REGISTRY · getTenant', () => {
  it('cache MISS reads exactly one indexed row, then a HIT serves from cache (no second read)', async () => {
    const fake = makeDb({ 'mi-pase': row('mi-pase') })

    const first = await getTenant('mi-pase', fake.db as never)
    expect(first?.tenantId).toBe('mi-pase')
    expect(fake.findFirstCalls).toBe(1) // miss → one row read

    const second = await getTenant('mi-pase', fake.db as never)
    expect(second?.tenantId).toBe('mi-pase')
    expect(fake.findFirstCalls).toBe(1) // hit → NO additional read
  })

  it('TTL-expiry: after the ~60s window the next call RE-READS (injected clock, no sleep)', async () => {
    const fake = makeDb({ 'mi-pase': row('mi-pase') })

    await getTenant('mi-pase', fake.db as never)
    expect(fake.findFirstCalls).toBe(1)

    // still inside the window → cache hit, no re-read.
    clockMs += TENANT_CACHE_TTL_MS - 1
    await getTenant('mi-pase', fake.db as never)
    expect(fake.findFirstCalls).toBe(1)

    // step PAST the TTL → entry expired → exactly one fresh read.
    clockMs += 2
    await getTenant('mi-pase', fake.db as never)
    expect(fake.findFirstCalls).toBe(2)
  })

  it('unknown id → undefined, and the absence is negatively cached (no re-read within TTL)', async () => {
    const fake = makeDb({ 'mi-pase': row('mi-pase') })

    expect(await getTenant('ghost', fake.db as never)).toBeUndefined()
    expect(fake.findFirstCalls).toBe(1)

    // negative cache: a second lookup inside the window does NOT hit the db again.
    expect(await getTenant('ghost', fake.db as never)).toBeUndefined()
    expect(fake.findFirstCalls).toBe(1)
  })

  it('empty id → undefined without any read', async () => {
    const fake = makeDb({ 'mi-pase': row('mi-pase') })
    expect(await getTenant('', fake.db as never)).toBeUndefined()
    expect(fake.findFirstCalls).toBe(0)
  })
})

describe('REGISTRY · findTenantByMember', () => {
  it('returns the UNIQUE tenant whose members[] contains the DID', async () => {
    const fake = makeDb({
      'mi-pase': row('mi-pase', 'active', ['did:privy:abc']),
      other: row('other', 'active', ['did:privy:xyz']),
    })
    const found = await findTenantByMember('did:privy:abc', fake.db as never)
    expect(found && 'tenantId' in found && found.tenantId).toBe('mi-pase')
  })

  it('DID in NO members[] → undefined', async () => {
    const fake = makeDb({ 'mi-pase': row('mi-pase', 'active', ['did:privy:abc']) })
    expect(await findTenantByMember('did:privy:nobody', fake.db as never)).toBeUndefined()
  })

  it('DID listed by TWO tenants → ambiguous marker (never guesses)', async () => {
    const fake = makeDb({
      'mi-pase': row('mi-pase', 'active', ['did:privy:dup']),
      other: row('other', 'active', ['did:privy:dup']),
    })
    const found = await findTenantByMember('did:privy:dup', fake.db as never)
    expect(found).toEqual({ ambiguous: true })
  })

  it('empty did → undefined without any read', async () => {
    const fake = makeDb({ 'mi-pase': row('mi-pase', 'active', ['did:privy:abc']) })
    expect(await findTenantByMember('', fake.db as never)).toBeUndefined()
    expect(fake.selectCalls).toBe(0)
  })
})

// ── RESOLVE (registry-backed resolveTenant, against the REAL tenants module) ────
describe('RESOLVE · resolveTenant', () => {
  it('service consumer → resolves the active tenant row', async () => {
    const fake = makeDb({ 'mi-pase': row('mi-pase', 'active') })
    const res = await resolveTenant(svc('mi-pase'), fake.db as never)
    expect(res.ok).toBe(true)
    expect(res.ok && res.tenant.tenantId).toBe('mi-pase')
  })

  it('privy DID present in EXACTLY ONE members[] → resolves that tenant', async () => {
    const fake = makeDb({
      'mi-pase': row('mi-pase', 'active', ['did:privy:abc']),
      other: row('other', 'active', ['did:privy:xyz']),
    })
    const res = await resolveTenant(privy('did:privy:abc'), fake.db as never)
    expect(res.ok).toBe(true)
    expect(res.ok && res.tenant.tenantId).toBe('mi-pase')
  })

  it('privy DID in NO members[] → not-ok (TENANT_UNKNOWN)', async () => {
    const fake = makeDb({ 'mi-pase': row('mi-pase', 'active', ['did:privy:abc']) })
    expect(await resolveTenant(privy('did:privy:nobody'), fake.db as never)).toEqual({ ok: false })
  })

  it('privy DID in TWO tenants → not-ok (ambiguous, never guesses a tenant)', async () => {
    const fake = makeDb({
      'mi-pase': row('mi-pase', 'active', ['did:privy:dup']),
      other: row('other', 'active', ['did:privy:dup']),
    })
    expect(await resolveTenant(privy('did:privy:dup'), fake.db as never)).toEqual({ ok: false })
  })

  it('service tenant status PENDING → not-ok (fail closed)', async () => {
    const fake = makeDb({ vino: row('vino', 'pending') })
    expect(await resolveTenant(svc('vino'), fake.db as never)).toEqual({ ok: false })
  })

  it('service tenant status DISABLED → not-ok (fail closed)', async () => {
    const fake = makeDb({ frozen: row('frozen', 'disabled') })
    expect(await resolveTenant(svc('frozen'), fake.db as never)).toEqual({ ok: false })
  })

  it('privy DID resolving to a PENDING tenant → not-ok (status gate after membership)', async () => {
    const fake = makeDb({ vino: row('vino', 'pending', ['did:privy:vino']) })
    expect(await resolveTenant(privy('did:privy:vino'), fake.db as never)).toEqual({ ok: false })
  })

  it('unknown service id → not-ok', async () => {
    const fake = makeDb({ 'mi-pase': row('mi-pase', 'active') })
    expect(await resolveTenant(svc('ghost'), fake.db as never)).toEqual({ ok: false })
  })

  it('empty service id → not-ok', async () => {
    const fake = makeDb({ 'mi-pase': row('mi-pase', 'active') })
    expect(await resolveTenant(svc(''), fake.db as never)).toEqual({ ok: false })
  })

  it('empty privy identity → not-ok', async () => {
    const fake = makeDb({ 'mi-pase': row('mi-pase', 'active', ['did:privy:abc']) })
    expect(await resolveTenant(privy(''), fake.db as never)).toEqual({ ok: false })
  })
})

// ── sanity: isActive is the real, un-weakened status predicate ────────────────
describe('isActive — only active resolves', () => {
  it('active → true; pending/disabled → false', () => {
    expect(isActive({ status: 'active' })).toBe(true)
    expect(isActive({ status: 'pending' })).toBe(false)
    expect(isActive({ status: 'disabled' })).toBe(false)
  })
})
