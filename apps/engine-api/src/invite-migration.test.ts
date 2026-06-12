import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Wave 1 MIGRATION INTENT (D8 / Codex) — the 0006_*.sql invites migration must carry
 * the two LOAD-BEARING constraints drizzle-kit can drop:
 *   (a) the partial unique index `tenant_invites_active_email` on (email) WITH the
 *       `WHERE ... status != 'revoked'` clause — global-unique ACTIVE email; without
 *       the WHERE, a revoked invite would block re-inviting the email elsewhere AND
 *       the index would not be partial (D8 broken).
 *   (b) the `CHECK (email = lower(email))` so ops SQL cannot insert a mixed-case
 *       variant that dodges the verified-email match.
 */

const here = dirname(fileURLToPath(import.meta.url))
const drizzleDir = join(here, '..', '..', '..', 'packages', 'db', 'drizzle')

function read0006(): string {
  const file = readdirSync(drizzleDir).find((f) => /^0006_.*\.sql$/.test(f))
  expect(file, 'a 0006_*.sql migration must exist').toBeDefined()
  return readFileSync(join(drizzleDir, file as string), 'utf8')
}

describe('0006 invites migration — load-bearing constraints', () => {
  it('creates the partial unique index on (email) WITH the WHERE status != revoked clause', () => {
    const sql = read0006()
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+"?tenant_invites_active_email"?[\s\S]*?\(\s*"?email"?\s*\)[\s\S]*?WHERE[\s\S]*?"?status"?\s*!=\s*'revoked'/i,
    )
  })

  it('adds the lower(email) CHECK constraint', () => {
    const sql = read0006()
    expect(sql).toMatch(/CHECK\s*\([\s\S]*?email"?\s*=\s*lower\([\s\S]*?email"?\s*\)/i)
  })

  it('creates the engine_tenant_invites table with the invite_status enum', () => {
    const sql = read0006()
    expect(sql).toMatch(/CREATE\s+TYPE\s+"?(public"?\."?)?invite_status"?\s+AS\s+ENUM\('pending',\s*'claimed',\s*'revoked'\)/i)
    expect(sql).toMatch(/CREATE\s+TABLE\s+"?engine_tenant_invites"?/i)
  })
})
