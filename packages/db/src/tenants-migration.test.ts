import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Migration-integrity regression (PR2 harden / isolation-panel finding 4).
 *
 * `engine_tenants.secret_prefix` MUST be UNIQUE at the DATABASE, not only in the
 * in-memory seed validator. Without it, an out-of-band INSERT/UPDATE could create
 * two ACTIVE tenants sharing a prefix (e.g. both 'MIPASE') and thus read each
 * other's provider env (MIPASE_SHOPIFY_ACCESS_TOKEN). This test reads the emitted
 * drizzle migrations and asserts the unique index on `secret_prefix` is present in
 * the SQL — so dropping it from the schema (and regenerating) fails CI here.
 */

const drizzleDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

function allMigrationSql(): string {
  return readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(drizzleDir, f), 'utf8'))
    .join('\n')
}

describe('engine_tenants migration — secret_prefix UNIQUE (finding 4)', () => {
  it('declares a UNIQUE index on secret_prefix somewhere in the migrations', () => {
    const sql = allMigrationSql()
    // Match: CREATE UNIQUE INDEX ... ON "engine_tenants" ... ("secret_prefix")
    const re = /CREATE\s+UNIQUE\s+INDEX[^;]*?"engine_tenants"[^;]*?\(\s*"secret_prefix"\s*\)/is
    expect(sql).toMatch(re)
  })

  it('still creates the engine_tenants table (sanity — the registry migration exists)', () => {
    const sql = allMigrationSql()
    expect(sql).toMatch(/CREATE TABLE "engine_tenants"/i)
  })
})
