import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * TARGETED ALLOWLIST GUARD (admin-roles Wave A / §7) — roles.ts is added to
 * check:scoped's broad raw-db allowlist. That exemption must NOT let it hide a raw
 * read of an engine_runs-class tenant-DATA table. roles.ts is the ROLE/AUTHZ read
 * layer; it may touch ONLY the three role-bearing tables: engine_superadmins,
 * engine_tenant_members, engine_tenant_invites. This test reads roles.ts as TEXT and
 * asserts every engine_* token / schema.engine* symbol it names is one of those three
 * — so a future edit adding a raw engine_runs/engine_approvals/etc. read fails HERE
 * even though check:scoped stays green for the exempt file.
 */

const here = dirname(fileURLToPath(import.meta.url))

const ALLOWED_TABLE_TOKENS = new Set([
  'engine_superadmins',
  'engineSuperadmins',
  'engine_tenant_members',
  'engineTenantMembers',
  'engine_tenant_invites',
  'engineTenantInvites',
])

const BANNED_SCHEMA_SYMBOLS = [
  'engineRuns',
  'engineApprovals',
  'engineWorkflowState',
  'engineTenants',
  'engineQuotaLedger',
  'engineTenantIntegrations',
] as const

describe('roles.ts — touches ONLY the three role-bearing tables (allowlist guard)', () => {
  const src = readFileSync(join(here, 'roles.ts'), 'utf8')

  it('references no engine_* table other than superadmins / members / invites', () => {
    const tables = new Set<string>()
    for (const m of src.matchAll(/engine_[a-z_]+/g)) tables.add(m[0])
    for (const m of src.matchAll(/schema\.(engine[A-Za-z]+)/g)) tables.add(m[1]!)
    const offenders = [...tables].filter((t) => !ALLOWED_TABLE_TOKENS.has(t))
    expect(
      offenders,
      `roles.ts must touch only superadmins/members/invites, found: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('does not reference any banned engine_* schema symbol', () => {
    for (const banned of BANNED_SCHEMA_SYMBOLS) {
      expect(src.includes(`schema.${banned}`), `roles.ts must not use schema.${banned}`).toBe(false)
    }
  })
})
