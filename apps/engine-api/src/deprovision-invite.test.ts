import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Wave 1 DEPROVISION coverage (D5/D7) — deprovisionInvite revokes the invite AND
 * removes the claimed member in ONE tx, so the DID can no longer resolve to the
 * tenant. Idempotent: an absent / already-revoked invite is a no-op. Hermetic db mock
 * over in-memory engine_tenant_invites + engine_tenant_members.
 */

interface InviteRow {
  tenantId: string
  email: string
  status: 'pending' | 'claimed' | 'revoked'
  claimedByDid: string | null
}
const store: { invites: InviteRow[]; members: Array<{ tenantId: string; did: string }> } = {
  invites: [],
  members: [],
}

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...x: unknown[]) => ({ and: x.filter(Boolean) }),
  sql: Object.assign((s: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: s.join('?'), vals }), {
    raw: () => ({}),
  }),
}))

vi.mock('@godin-engine/db', () => {
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
  const memAndPair = (m: unknown): { tenantId?: string; did?: string } => {
    const w = m as { and?: unknown[] }
    const out: { tenantId?: string; did?: string } = {}
    for (const part of w?.and ?? []) {
      const p = part as { eq?: [string, string] }
      if (p?.eq?.[0] === 'M.tenant_id') out.tenantId = p.eq[1]
      if (p?.eq?.[0] === 'M.did') out.did = p.eq[1]
    }
    return out
  }
  const update = () => ({
    set: (vals: Partial<InviteRow>) => ({
      where: async (w: unknown) => {
        const { tenantId, email } = invAndPair(w)
        const row = store.invites.find((i) => i.tenantId === tenantId && i.email === email)
        if (row && vals.status) row.status = vals.status
      },
    }),
  })
  const del = () => ({
    where: async (w: unknown) => {
      const { tenantId, did } = memAndPair(w)
      for (let i = store.members.length - 1; i >= 0; i--) {
        if (store.members[i]!.tenantId === tenantId && store.members[i]!.did === did) store.members.splice(i, 1)
      }
    },
  })
  const execute = async (q: unknown) => {
    const vals = (q as { vals?: unknown[] })?.vals ?? []
    const tenantId = vals[0] as string
    const email = vals[1] as string
    const inv = store.invites.find((i) => i.tenantId === tenantId && i.email === email && i.status !== 'revoked')
    return inv ? [{ claimed_by_did: inv.claimedByDid, status: inv.status }] : []
  }
  const db = {
    update,
    delete: del,
    execute,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ update, delete: del, execute }),
  }
  return {
    db,
    schema: {
      engineTenantInvites: { tenantId: 'V.tenant_id', email: 'V.email' },
      engineTenantMembers: { tenantId: 'M.tenant_id', did: 'M.did' },
    },
  }
})

const { deprovisionInvite } = await import('./deprovision-invite')

beforeEach(() => {
  store.invites = []
  store.members = []
})

describe('deprovisionInvite — revoke + remove member (D5/D7)', () => {
  it('revokes a claimed invite AND removes the bound member', async () => {
    store.invites.push({ tenantId: 'mi-pase', email: 'a@b.co', status: 'claimed', claimedByDid: 'did:owner' })
    store.members.push({ tenantId: 'mi-pase', did: 'did:owner' })
    const res = await deprovisionInvite('mi-pase', 'A@B.co')
    expect(res).toEqual({ revoked: true, removedMember: 'did:owner' })
    expect(store.invites[0]?.status).toBe('revoked')
    expect(store.members).toHaveLength(0)
  })

  it('revokes a pending (unclaimed) invite, removes no member', async () => {
    store.invites.push({ tenantId: 'mi-pase', email: 'a@b.co', status: 'pending', claimedByDid: null })
    const res = await deprovisionInvite('mi-pase', 'a@b.co')
    expect(res).toEqual({ revoked: true, removedMember: null })
    expect(store.invites[0]?.status).toBe('revoked')
  })

  it('an absent invite is a no-op', async () => {
    const res = await deprovisionInvite('mi-pase', 'nobody@x.co')
    expect(res).toEqual({ revoked: false, removedMember: null })
  })

  it('an already-revoked invite is a no-op (idempotent)', async () => {
    store.invites.push({ tenantId: 'mi-pase', email: 'a@b.co', status: 'revoked', claimedByDid: 'did:old' })
    store.members.push({ tenantId: 'mi-pase', did: 'did:old' })
    const res = await deprovisionInvite('mi-pase', 'a@b.co')
    expect(res).toEqual({ revoked: false, removedMember: null })
    // member is NOT removed for an already-revoked invite (already deprovisioned).
    expect(store.members).toHaveLength(1)
  })
})
