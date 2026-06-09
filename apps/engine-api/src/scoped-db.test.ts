import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * scoped-db UNIT (M1.5 / T2). We inject a RECORDING fake db into
 * forConsumer(db, consumerId) and assert that EVERY accessor injects the
 * consumer_id filter — either directly (runs / runs-via-join) or, for approvals,
 * resolved through the source run (engine_approvals has NO consumer_id column).
 *
 * Strategy: we mock drizzle-orm so `eq(col, val)` returns a structurally
 * inspectable marker `{ eq: [col, val] }` and `and(...)` returns `{ and: [...] }`.
 * The fake db records every where/values/findFirst call, so we can walk the
 * predicate tree and PROVE a `consumer_id` equality is always present. The fake
 * db exposes ONLY the methods forConsumer calls — there is no escape hatch to a
 * raw, unscoped select, so an unscoped read of engine_runs / engine_approvals /
 * engine_workflow_state is structurally unreachable through this API.
 */

// ── drizzle-orm: structural markers so we can inspect predicates ──────────────
vi.mock('drizzle-orm', () => ({
  and: (...x: unknown[]) => ({ and: x.filter(Boolean) }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  desc: (x: unknown) => ({ desc: x }),
  sql: Object.assign((strings: TemplateStringsArray, ...vals: unknown[]) => ({ sql: { strings, vals } }), {
    raw: (s: unknown) => ({ raw: s }),
  }),
}))

// ── @godin-engine/db: schema columns are tagged string markers ───────────────
// The accessors reference schema.engineRuns.<col> / schema.engineApprovals.<col>.
// We give each a unique, identifiable token so `eq` markers reveal which column
// was compared. The real `db` is irrelevant — forConsumer takes db as an arg.
vi.mock('@godin-engine/db', () => ({
  db: {},
  schema: {
    engineRuns: {
      runId: 'R.run_id',
      consumerId: 'R.consumer_id',
      status: 'R.status',
      createdAt: 'R.created_at',
    },
    engineApprovals: {
      approvalId: 'A.approval_id',
      sourceRunId: 'A.source_run_id',
      state: 'A.state',
      approver: 'A.approver',
      createdAt: 'A.created_at',
    },
  },
}))

// ── ./tenants: registry seam mocked so resolveTenant is hermetic ─────────────
// resolveTenant (PR2) is registry-backed: service mode → getTenant(id); privy
// mode → findTenantByMember(did); both then require status==='active'. We mock
// the registry module so these unit assertions exercise resolveTenant's branching
// + status gate WITHOUT a DB. isActive is the real status predicate (no weakening).
const registry: {
  tenants: Record<string, { status: 'active' | 'pending' | 'disabled' }>
  members: Record<string, string[]> // did → tenant ids listing it
} = { tenants: {}, members: {} }

vi.mock('./tenants', () => ({
  getTenant: async (id: string) => {
    const t = registry.tenants[id]
    return t ? { tenantId: id, status: t.status } : undefined
  },
  findTenantByMember: async (did: string) => {
    const ids = registry.members[did] ?? []
    if (ids.length === 0) return undefined
    if (ids.length > 1) return { ambiguous: true }
    const id = ids[0] as string
    const t = registry.tenants[id]
    return t ? { tenantId: id, status: t.status } : undefined
  },
  isActive: (row: { status: string }) => row.status === 'active',
}))

const { forConsumer, resolveTenant } = await import('./scoped-db')

const CONSUMER = 'mi-pase'
const svc = (id: string) => ({ id, identity: `service:${id}`, mode: 'service' as const })
const privy = (did: string) => ({ id: '', identity: did, mode: 'privy' as const })
type Marker = { eq?: [unknown, unknown]; and?: unknown[] }

// ── Recording fake db ────────────────────────────────────────────────────────
// Captures the predicate objects handed to .where(...) plus inserted values and
// findFirst args. Resolvers are configurable per-test.
interface Recorder {
  whereArgs: unknown[]
  selectProjections: unknown[]
  innerJoinOn: unknown[]
  insertedValues: unknown[]
  findFirstArgs: unknown[]
  // resolvers
  selectRows: Marker[] | Record<string, unknown>[]
  runFindFirst: () => Promise<unknown>
  approvalFindFirst: () => Promise<unknown>
  updateReturning: () => Promise<unknown[]>
  // rows returned by the in-transaction `SELECT ... FOR UPDATE` (lock read)
  txExecuteRows: () => Promise<unknown[]>
}

function makeDb(rec: Recorder) {
  return {
    select(proj?: unknown) {
      rec.selectProjections.push(proj)
      const rows = rec.selectRows
      return {
        from: () => ({
          where: (w: unknown) => {
            rec.whereArgs.push(w)
            return { orderBy: () => ({ limit: async () => rows }) }
          },
          innerJoin: (_tbl: unknown, on: unknown) => {
            rec.innerJoinOn.push(on)
            return {
              where: (w: unknown) => {
                rec.whereArgs.push(w)
                // listApprovals maps r.approval
                return { orderBy: () => ({ limit: async () => (rows as Record<string, unknown>[]).map((r) => ({ approval: r })) }) }
              },
            }
          },
        }),
      }
    },
    insert: () => ({
      values: async (v: unknown) => {
        rec.insertedValues.push(v)
      },
    }),
    update: () => ({
      set: () => ({
        where: (w: unknown) => {
          rec.whereArgs.push(w)
          return { returning: async () => rec.updateReturning() }
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async () => rec.txExecuteRows(),
        insert: () => ({ values: async (v: unknown) => rec.insertedValues.push(v) }),
        update: () => ({
          set: () => ({
            where: (w: unknown) => {
              rec.whereArgs.push(w)
              return undefined
            },
          }),
        }),
      }),
    query: {
      engineRuns: {
        findFirst: async (args: unknown) => {
          rec.findFirstArgs.push({ table: 'engineRuns', args })
          return rec.runFindFirst()
        },
      },
      engineApprovals: {
        findFirst: async (args: unknown) => {
          rec.findFirstArgs.push({ table: 'engineApprovals', args })
          return rec.approvalFindFirst()
        },
      },
    },
  }
}

function freshRecorder(over: Partial<Recorder> = {}): Recorder {
  return {
    whereArgs: [],
    selectProjections: [],
    innerJoinOn: [],
    insertedValues: [],
    findFirstArgs: [],
    selectRows: [],
    runFindFirst: async () => undefined,
    approvalFindFirst: async () => undefined,
    updateReturning: async () => [],
    txExecuteRows: async () => [],
    ...over,
  }
}

// ── Predicate-tree walker: collect every eq([col,val]) pair anywhere ─────────
function collectEqs(node: unknown, out: Array<[unknown, unknown]> = []): Array<[unknown, unknown]> {
  if (!node || typeof node !== 'object') return out
  const n = node as Marker
  if (n.eq) out.push(n.eq as [unknown, unknown])
  if (Array.isArray(n.and)) for (const child of n.and) collectEqs(child, out)
  return out
}

/** Assert a where-predicate (or findFirst where) constrains consumer_id = CONSUMER. */
function expectScopedToConsumer(predicate: unknown) {
  const eqs = collectEqs(predicate)
  const match = eqs.find(([col, val]) => col === 'R.consumer_id' && val === CONSUMER)
  expect(match, `expected a consumer_id=${CONSUMER} equality in predicate ${JSON.stringify(predicate)}`).toBeTruthy()
}

let rec: Recorder
beforeEach(() => {
  rec = freshRecorder()
})

describe('forConsumer exposes only scoped accessors (no raw escape hatch)', () => {
  it('the scoped object has no select / query / transaction / insert passthrough', () => {
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    const bag = scoped as unknown as Record<string, unknown>
    // The only surface is the typed accessor set — raw drizzle handles are absent.
    expect(bag.select).toBeUndefined()
    expect(bag.query).toBeUndefined()
    expect(bag.transaction).toBeUndefined()
    expect(bag.db).toBeUndefined()
    // Sanity: the intended scoped accessors are present.
    for (const k of ['listRuns', 'getRun', 'insertRun', 'listApprovals', 'getApproval', 'dispatchRun', 'approve', 'reject']) {
      expect(typeof bag[k]).toBe('function')
    }
    expect(scoped.consumerId).toBe(CONSUMER)
  })
})

describe('listRuns — injects consumer_id on engine_runs', () => {
  it('filters by consumer_id (no status)', async () => {
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    await scoped.listRuns()
    expect(rec.whereArgs).toHaveLength(1)
    expectScopedToConsumer(rec.whereArgs[0])
  })

  it('keeps consumer_id even when a status filter is added', async () => {
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    await scoped.listRuns({ status: 'queued', limit: 5 })
    expectScopedToConsumer(rec.whereArgs[0])
    // status filter is ALSO present, but never replaces the tenant filter.
    const eqs = collectEqs(rec.whereArgs[0])
    expect(eqs.some(([col, val]) => col === 'R.status' && val === 'queued')).toBe(true)
  })
})

describe('getRun — injects consumer_id on the findFirst predicate', () => {
  it('scopes the lookup to (run_id AND consumer_id)', async () => {
    rec = freshRecorder({ runFindFirst: async () => ({ runId: 'r1', consumerId: CONSUMER }) })
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    await scoped.getRun('r1')
    expect(rec.findFirstArgs).toHaveLength(1)
    const call = rec.findFirstArgs[0] as { table: string; args: { where: unknown } }
    expect(call.table).toBe('engineRuns')
    expectScopedToConsumer(call.args.where)
    // and the run_id equality is present too.
    const eqs = collectEqs(call.args.where)
    expect(eqs.some(([col, val]) => col === 'R.run_id' && val === 'r1')).toBe(true)
  })

  it('returns undefined for a cross-tenant/missing run (findFirst undefined)', async () => {
    rec = freshRecorder({ runFindFirst: async () => undefined })
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    expect(await scoped.getRun('other-tenant-run')).toBeUndefined()
  })
})

describe('insertRun — FORCES this tenant consumer_id regardless of input', () => {
  it('overrides any consumerId smuggled in the values', async () => {
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    // Caller tries to spoof another tenant; forConsumer must overwrite it.
    await scoped.insertRun({ consumerId: 'evil-tenant', runId: 'r1', workflowId: 'wf' } as never)
    expect(rec.insertedValues).toHaveLength(1)
    expect((rec.insertedValues[0] as { consumerId: string }).consumerId).toBe(CONSUMER)
  })
})

describe('listApprovals — scoped via INNER JOIN engine_runs on consumer_id', () => {
  it('joins approvals→runs on source_run_id and filters runs.consumer_id', async () => {
    rec = freshRecorder({ selectRows: [{ approvalId: 'ap1', sourceRunId: 'r1' }] })
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    const out = await scoped.listApprovals()
    expect(out).toEqual([{ approvalId: 'ap1', sourceRunId: 'r1' }])
    // The join condition links approval.source_run_id = run.run_id.
    expect(rec.innerJoinOn).toHaveLength(1)
    const joinEqs = collectEqs(rec.innerJoinOn[0])
    expect(joinEqs.some(([a, b]) => a === 'A.source_run_id' && b === 'R.run_id')).toBe(true)
    // The where clause carries the tenant scope on the RUN side (R.consumer_id).
    expectScopedToConsumer(rec.whereArgs[0])
  })

  it('keeps consumer_id alongside optional state/approver filters', async () => {
    rec = freshRecorder({ selectRows: [] })
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    await scoped.listApprovals({ state: 'pending', approver: 'role:owner' })
    expectScopedToConsumer(rec.whereArgs[0])
    const eqs = collectEqs(rec.whereArgs[0])
    expect(eqs.some(([c, v]) => c === 'A.state' && v === 'pending')).toBe(true)
    expect(eqs.some(([c, v]) => c === 'A.approver' && v === 'role:owner')).toBe(true)
  })
})

describe('getApproval — resolves tenant THROUGH the source run (no consumer_id column)', () => {
  it('loads the approval, then re-loads its source run scoped to the consumer', async () => {
    rec = freshRecorder({
      approvalFindFirst: async () => ({ approvalId: 'ap1', sourceRunId: 'r1', state: 'pending' }),
      runFindFirst: async () => ({ runId: 'r1', consumerId: CONSUMER }),
    })
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    const out = await scoped.getApproval('ap1')
    expect(out).toMatchObject({ approvalId: 'ap1' })

    // 1) the approval lookup is by approval_id (no consumer_id — the column does not exist).
    const apCall = rec.findFirstArgs.find((c) => (c as { table: string }).table === 'engineApprovals') as {
      args: { where: unknown }
    }
    const apEqs = collectEqs(apCall.args.where)
    expect(apEqs.some(([c, v]) => c === 'A.approval_id' && v === 'ap1')).toBe(true)
    expect(apEqs.some(([c]) => c === 'R.consumer_id')).toBe(false)

    // 2) the SECOND lookup (the source run) IS scoped to consumer_id — this is the
    //    tenant guard for approvals.
    const runCall = rec.findFirstArgs.find((c) => (c as { table: string }).table === 'engineRuns') as {
      args: { where: unknown }
    }
    expectScopedToConsumer(runCall.args.where)
    const runEqs = collectEqs(runCall.args.where)
    expect(runEqs.some(([c, v]) => c === 'R.run_id' && v === 'r1')).toBe(true)
  })

  it('returns undefined when the source run belongs to another tenant', async () => {
    // approval exists, but its source run is not visible to this consumer.
    rec = freshRecorder({
      approvalFindFirst: async () => ({ approvalId: 'ap1', sourceRunId: 'r1', state: 'pending' }),
      runFindFirst: async () => undefined, // scoped run lookup misses -> cross-tenant
    })
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    expect(await scoped.getApproval('ap1')).toBeUndefined()
    // it DID attempt the scoped source-run resolution.
    expect(rec.findFirstArgs.some((c) => (c as { table: string }).table === 'engineRuns')).toBe(true)
  })

  it('returns undefined when the approval itself is missing (no source-run lookup)', async () => {
    rec = freshRecorder({ approvalFindFirst: async () => undefined })
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    expect(await scoped.getApproval('nope')).toBeUndefined()
    // short-circuits before resolving any source run.
    expect(rec.findFirstArgs.some((c) => (c as { table: string }).table === 'engineRuns')).toBe(false)
  })
})

describe('dispatchRun — forces consumer_id on the inserted run row', () => {
  it('stamps THIS tenant on the run, ignoring any ambient value', async () => {
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    const { runId, traceId } = await scoped.dispatchRun({ workflowId: 'wf', input: { a: 1 } })
    expect(runId).toBeTruthy()
    expect(traceId).toBeTruthy()
    expect(rec.insertedValues).toHaveLength(1)
    const ins = rec.insertedValues[0] as { consumerId: string; workflowId: string }
    expect(ins.consumerId).toBe(CONSUMER)
    expect(ins.workflowId).toBe('wf')
  })
})

describe('approve — child run inherits THIS tenant; decidedBy bound to caller', () => {
  it('inserts the child run with the consumer_id and updates the approval', async () => {
    rec = freshRecorder({
      approvalFindFirst: async () => ({ approvalId: 'ap1', sourceRunId: 'r1', state: 'pending', workflowId: 'send-step' }),
      runFindFirst: async () => ({ runId: 'r1', consumerId: CONSUMER }),
      txExecuteRows: async () => [{ state: 'pending' }], // lock read confirms still-pending
    })
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    const res = await scoped.approve({ approvalId: 'ap1', decidedBy: 'service:mi-pase', childInput: { x: 1 } })
    expect(res).toMatchObject({ ok: true })
    // the child run carries the forced tenant.
    const child = rec.insertedValues[0] as { consumerId: string; parentRunId: string }
    expect(child.consumerId).toBe(CONSUMER)
    expect(child.parentRunId).toBe('r1')
  })

  it('returns not-found for a cross-tenant approval (source run not visible)', async () => {
    rec = freshRecorder({
      approvalFindFirst: async () => ({ approvalId: 'ap1', sourceRunId: 'r1', state: 'pending' }),
      runFindFirst: async () => undefined, // cross-tenant
    })
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    expect(await scoped.approve({ approvalId: 'ap1', decidedBy: 'x', childInput: {} })).toEqual({
      ok: false,
      reason: 'not-found',
    })
    // never inserted a child run for the wrong tenant.
    expect(rec.insertedValues).toHaveLength(0)
  })

  it('returns already-<state> for a non-pending approval', async () => {
    rec = freshRecorder({
      approvalFindFirst: async () => ({ approvalId: 'ap1', sourceRunId: 'r1', state: 'approved' }),
      runFindFirst: async () => ({ runId: 'r1', consumerId: CONSUMER }),
    })
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    const res = await scoped.approve({ approvalId: 'ap1', decidedBy: 'x', childInput: {} })
    expect(res).toMatchObject({ ok: false })
  })
})

describe('reject — ownership gate via source run before mutating', () => {
  it('rejects only after the scoped source-run check passes', async () => {
    rec = freshRecorder({
      approvalFindFirst: async () => ({ approvalId: 'ap1', sourceRunId: 'r1', state: 'pending' }),
      runFindFirst: async () => ({ runId: 'r1', consumerId: CONSUMER }),
      updateReturning: async () => [{ approvalId: 'ap1' }],
    })
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    expect(await scoped.reject({ approvalId: 'ap1', decidedBy: 'service:mi-pase' })).toEqual({ ok: true })
    // the scoped source-run resolution happened (tenant guard).
    expect(rec.findFirstArgs.some((c) => (c as { table: string }).table === 'engineRuns')).toBe(true)
  })

  it('returns not-found for a cross-tenant approval without mutating', async () => {
    rec = freshRecorder({
      approvalFindFirst: async () => ({ approvalId: 'ap1', sourceRunId: 'r1', state: 'pending' }),
      runFindFirst: async () => undefined,
      updateReturning: async () => {
        throw new Error('reject must not reach UPDATE for a cross-tenant approval')
      },
    })
    const scoped = forConsumer(makeDb(rec) as never, CONSUMER)
    expect(await scoped.reject({ approvalId: 'ap1', decidedBy: 'x' })).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('resolveTenant — registry-backed TENANT_UNKNOWN seam (PR2)', () => {
  it('resolves an active tenant by service id / privy membership; fails closed otherwise', async () => {
    registry.tenants = {
      'mi-pase': { status: 'active' },
      other: { status: 'active' },
      vino: { status: 'pending' },
      frozen: { status: 'disabled' },
    }
    registry.members = {
      'did:privy:abc': ['mi-pase'], // single → resolves
      'did:privy:dup': ['mi-pase', 'other'], // ambiguous → not-ok
      'did:privy:vino': ['vino'], // mapped, but tenant not active → not-ok
    }

    // service mode → getTenant(consumer.id); active tenant resolves with its row.
    const svcOk = await resolveTenant(svc('mi-pase'))
    expect(svcOk.ok).toBe(true)
    expect(svcOk.ok && svcOk.tenant.tenantId).toBe('mi-pase')
    expect(await resolveTenant(svc(''))).toEqual({ ok: false }) // empty id
    expect(await resolveTenant(svc('ghost'))).toEqual({ ok: false }) // unknown id
    expect(await resolveTenant(svc('vino'))).toEqual({ ok: false }) // pending → fail closed
    expect(await resolveTenant(svc('frozen'))).toEqual({ ok: false }) // disabled → fail closed

    // privy mode → findTenantByMember(consumer.identity); status gate after membership.
    const privyOk = await resolveTenant(privy('did:privy:abc'))
    expect(privyOk.ok).toBe(true)
    expect(privyOk.ok && privyOk.tenant.tenantId).toBe('mi-pase')
    expect(await resolveTenant(privy('did:privy:nobody'))).toEqual({ ok: false }) // no membership
    expect(await resolveTenant(privy('did:privy:dup'))).toEqual({ ok: false }) // ambiguous → never guesses
    expect(await resolveTenant(privy('did:privy:vino'))).toEqual({ ok: false }) // non-active
    expect(await resolveTenant(privy(''))).toEqual({ ok: false }) // empty identity
  })
})
