import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * TARGETED ALLOWLIST GUARD (Wave 1 / Codex / PLAN §2 "Tight allowlist") — Wave 1 adds
 * TWO files to check:scoped's broad raw-db allowlist: invites.ts AND deprovision-invite.ts.
 * That exemption must NOT let either file hide a raw read of some OTHER engine_* table.
 * This test reads each allowlisted Wave-1 file as TEXT and asserts the ONLY engine_*
 * table it names is `engine_tenant_invites` (the membership write/delete goes through
 * addTenantMember/removeTenantMember in tenants.ts — itself allowlisted + guarded — not
 * a raw engine_tenant_members reference here). So every broad allowlist exemption is
 * provably pinned to its one table; a future edit that adds a raw engine_runs/etc. read
 * fails THIS test even though check:scoped stays green for the exempt file.
 */

const here = dirname(fileURLToPath(import.meta.url))

// Every Wave-1 file granted the broad check:scoped raw-db exemption.
const ALLOWLISTED_WAVE1_FILES = ['invites.ts', 'deprovision-invite.ts'] as const

const ALLOWED_TABLE_TOKENS = new Set(['engine_tenant_invites', 'engineTenantInvites'])
const BANNED_SCHEMA_SYMBOLS = [
  'engineRuns',
  'engineApprovals',
  'engineWorkflowState',
  'engineTenants',
  'engineQuotaLedger',
  'engineTenantMembers',
  'engineTenantIntegrations',
] as const

describe('Wave-1 allowlisted files — touch ONLY engine_tenant_invites (allowlist guard)', () => {
  for (const file of ALLOWLISTED_WAVE1_FILES) {
    const src = readFileSync(join(here, file), 'utf8')

    it(`${file} references no engine_* table other than engine_tenant_invites`, () => {
      // Every `engine_<name>` token (raw SQL) OR `schema.engine*` reference in source.
      const tables = new Set<string>()
      for (const m of src.matchAll(/engine_[a-z_]+/g)) tables.add(m[0])
      for (const m of src.matchAll(/schema\.(engine[A-Za-z]+)/g)) tables.add(m[1]!)

      const offenders = [...tables].filter((t) => !ALLOWED_TABLE_TOKENS.has(t))
      expect(
        offenders,
        `${file} must touch only engine_tenant_invites, found: ${offenders.join(', ')}`,
      ).toEqual([])
    })

    it(`${file} does not reference any other engine_* schema symbol`, () => {
      for (const banned of BANNED_SCHEMA_SYMBOLS) {
        expect(src.includes(`schema.${banned}`), `${file} must not use schema.${banned}`).toBe(false)
      }
    })
  }
})
