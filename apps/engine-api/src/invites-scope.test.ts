import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * TARGETED ALLOWLIST GUARD (Wave 1 / Codex) — invites.ts is added to check:scoped's
 * allowlist, but that broad exemption must NOT hide a raw read of some OTHER engine_*
 * table. This test reads invites.ts as TEXT and asserts the ONLY engine_* table it
 * names is `engine_tenant_invites` (the membership write goes through
 * addTenantMember in tenants.ts, not a raw engine_tenant_members reference here).
 * So the allowlisted file's raw db footprint is provably scoped to its one table.
 */

const here = dirname(fileURLToPath(import.meta.url))
const invitesSrc = readFileSync(join(here, 'invites.ts'), 'utf8')

describe('invites.ts — touches ONLY engine_tenant_invites (allowlist guard)', () => {
  it('references no engine_* table other than engine_tenant_invites', () => {
    // Every `engine_<name>` token that appears in source — in raw SQL strings OR a
    // schema.engine* reference.
    const tables = new Set<string>()
    for (const m of invitesSrc.matchAll(/engine_[a-z_]+/g)) tables.add(m[0])
    for (const m of invitesSrc.matchAll(/schema\.(engine[A-Za-z]+)/g)) tables.add(m[1]!)

    const allowed = new Set(['engine_tenant_invites', 'engineTenantInvites'])
    const offenders = [...tables].filter((t) => !allowed.has(t))
    expect(offenders, `invites.ts must touch only engine_tenant_invites, found: ${offenders.join(', ')}`).toEqual(
      [],
    )
  })

  it('does not reference schema.engineRuns / engineApprovals / engineWorkflowState / engineTenants', () => {
    for (const banned of ['engineRuns', 'engineApprovals', 'engineWorkflowState', 'engineTenants', 'engineQuotaLedger', 'engineTenantMembers', 'engineTenantIntegrations']) {
      expect(invitesSrc.includes(`schema.${banned}`)).toBe(false)
    }
  })
})
