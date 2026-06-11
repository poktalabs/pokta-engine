export const meta = {
  name: 'tenant-members-table-wave0',
  description: 'Behavior-preserving refactor: engine_tenant_members table (UNIQUE did) replaces engine_tenants.members[]',
  phases: [
    { title: 'Spine', detail: 'serial: members table + migration w/ data-copy -> rewire resolution+seed -> drop members[] -> /tenants/me split-brain guard -> update hermetic mocks; full star suite + typecheck + check:scoped green; commit' },
    { title: 'Tests', detail: 'parallel new-behavior tests -> serial integrator' },
    { title: 'Verify', detail: 'adversarial panel: behavior drift, data-migration loss, cross-tenant DID, scoped+split-brain' },
    { title: 'Harden', detail: 'apply confirmed findings, re-run suite, commit' },
  ],
}

const GROUND = [
  'REPO (cd here; absolute paths): /Users/mel/workspaces/poktalabs/projects/godinez-ai/godin-engine/code/godin-engine-v0.1',
  'BRANCH: feat/tenant-members-table (off origin/main; setup commit with the plan doc present). Do NOT create branches.',
  'COMMIT IDENTITY: git -c user.name="troopdegen" -c user.email="mel@innvertir.com" commit ... ; last body line: Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>',
  'PLAN (read it): docs/feature-requests/tenant-invites/PLAN.md — this is Wave 0 (section 3 + D9). BEHAVIOR-PRESERVING: replace the engine_tenants.members[] array with an engine_tenant_members table. The star auth/tenancy regressions are the SPEC; they must stay green with IDENTICAL resolution behavior. The ONLY intentional behavior addition is the /tenants/me split-brain guard (step 6).',
  'STACK: pnpm 10.26.1, Node 22, strict TS, turbo, drizzle-orm 0.38 / drizzle-kit 0.30 (migrations in packages/db/drizzle/, generate via: pnpm --filter @godin-engine/db db:generate ; latest is 0004_skinny_fixer.sql so yours is 0005). vitest 2.1.8 (node + jsdom). Hono.',
  'VERIFY CMDS (from REPO root): pnpm typecheck ; pnpm test ; pnpm check:scoped ; pnpm build',
  '',
  '=== CURRENT STATE (verified) ===',
  "packages/db/src/schema.ts: engineTenants pgTable has members: text('members').array().notNull().default(sql backtick {} backtick) AND index('tenants_members_idx').on(t.members). Imports include { pgTable, pgEnum, text, jsonb, integer, numeric, timestamp, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core' and { sql } from 'drizzle-orm'. engineTenants PK = tenantId.",
  "apps/engine-api/src/tenants.ts (ALLOWLISTED in check:scoped): findTenantByMember(did, db) currently does db.select().from(schema.engineTenants).where( sql: engineTenants.members @> ARRAY[did]::text[] ).limit(2) and returns the row (1 match) | undefined (0) | { ambiguous: true } (>1). getTenant(id) is a PK read with a 60s cache. Also exports allowedWorkflowsFor, toTenantView, isActive, tenantStatusOf, TenantRow. There is NO addTenantMember/removeTenantMember yet.",
  "apps/engine-api/src/scoped-db.ts: resolveTenant(consumer, db) privy-mode calls findTenantByMember(consumer.identity, db); none/ambiguous -> { ok:false }. (The word members at scoped-db lines ~281-284 refers to WORKFLOW family ids — UNRELATED, do NOT touch.)",
  "apps/engine-api/src/seed-tenants.ts (ALLOWLISTED): each TENANT_SEEDS entry has members: string[] (currently []). seedTenants() inserts engineTenants with members = unionDids(t.members, envMemberDids(t.secretPrefix)) and ON CONFLICT sets members via an array(select distinct unnest(members || excluded.members)) union. envMemberDids(secretPrefix) reads the env var named <secretPrefix>_MEMBER_DIDS (e.g. MIPASE_MEMBER_DIDS). unionDids helper exists.",
  'apps/engine-api/src/auth.ts: only COMMENTS reference members[]; no member query. No code change needed.',
  "apps/engine-api/src/app.ts: GET /v1/tenants/me (~line 156) resolves via resolveTenant then toTenantView; it does NOT currently apply the consumer.id-disagreement guard the data routes use via scopedTenantId (~line 57: if consumer.mode==='privy' && consumer.id && consumer.id !== tenantId then null). app.ts is NOT allowlisted (no raw db).",
  '',
  '=== HERMETIC TEST MOCKS THAT EMULATE THE members @> ARRAY QUERY (must be updated to the new table query, keeping assertions intact) ===',
  'These mock @godin-engine/db with a hand-rolled drizzle chain and emulate findTenantByMember by filtering a REGISTRY array on members.includes(did). After the rewire, findTenantByMember queries engine_tenant_members; update each mock chain + fixtures so resolution returns the SAME tenant as before (behavior-preserving). Files: apps/engine-api/src/app.test.ts (its REGISTRY rows carry members:[...]; the runsAndMembers select chain .where(pred.member)->limit returns REGISTRY rows whose members include the DID — re-point to a members-table fixture), privy-split-brain.test.ts, isolation.test.ts, tenants.test.ts, tenant-seed.test.ts, tenants-me.test.ts. Read each before editing; do NOT weaken any star assertion — only the db-mock plumbing + member fixtures change shape.',
].join('\n')

phase('Spine')
const SPINE = await agent(
  'You are the SPINE builder for Wave 0 — a BEHAVIOR-PRESERVING refactor replacing engine_tenants.members[] with an engine_tenant_members table. Keep the entire existing star auth/tenancy suite green (it is the spec), make the net schema change, then ONE commit. Iterate until pnpm typecheck + pnpm check:scoped + pnpm build + the relevant star suites are GREEN.\n\n' + GROUND + '\n\n' +
  'STEPS (serial; re-run pnpm typecheck as you go):\n\n' +
  "STEP 1 — SCHEMA (packages/db/src/schema.ts): ADD a table engineTenantMembers = pgTable('engine_tenant_members', { tenantId: text('tenant_id').notNull().references(() => engineTenants.tenantId, { onDelete: 'cascade' }), did: text('did').notNull(), source: text('source'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() }, (t) => [primaryKey({ columns: [t.tenantId, t.did] }), uniqueIndex('tenant_members_did_unique').on(t.did)]). The uniqueIndex on did is the GLOBAL DID-UNIQUENESS guard (D9): a DID belongs to at most ONE tenant. REMOVE the engineTenants members column AND index('tenants_members_idx').on(t.members). Generate the migration: pnpm --filter @godin-engine/db db:generate (produces 0005_*.sql). THEN HAND-EDIT the generated 0005 SQL so the final statement order is: (1) CREATE TABLE engine_tenant_members + its unique index, (2) a DATA-COPY: INSERT INTO \"engine_tenant_members\" (\"tenant_id\", \"did\") SELECT \"tenant_id\", unnest(\"members\") FROM \"engine_tenants\" ON CONFLICT DO NOTHING; (3) DROP INDEX tenants_members_idx, (4) ALTER TABLE engine_tenants DROP COLUMN members. The data-copy MUST come BEFORE the drop-column or existing prod members (e.g. mi-pase env-seeded DIDs) are lost and every current user is locked out. pnpm --filter @godin-engine/db typecheck green.\n\n" +
  'STEP 2 — REWIRE tenants.ts (ALLOWLISTED; raw db OK here): findTenantByMember(did, db) now selects the joined tenant row from engineTenantMembers innerJoin engineTenants on tenantId where engineTenantMembers.did = did, limit 2. Return the tenant row (1) | undefined (0) | { ambiguous: true } (>1) — SAME contract as today (keep the ambiguous branch as defense even though uniqueIndex(did) makes >1 impossible). ADD addTenantMember(tenantId, did, db, source) that inserts into engineTenantMembers ON CONFLICT (tenant_id, did) DO NOTHING, and surfaces a UNIQUE(did) violation (did already in ANOTHER tenant) as a typed/distinguishable outcome (throw a typed error or return a flag) so Wave 1 claim can map it to a collision. ADD removeTenantMember(tenantId, did, db) that deletes the row. Keep all member db access in tenants.ts so check:scoped stays green.\n\n' +
  'STEP 3 — REWIRE seed-tenants.ts (ALLOWLISTED): seedTenants no longer writes a members array. Insert the engineTenants row WITHOUT members; then for each member DID (the seed static t.members UNION envMemberDids(t.secretPrefix)) call addTenantMember(t.tenantId, did, db, source=seed) with INSERT-ONLY semantics (ON CONFLICT DO NOTHING). Keep envMemberDids + the <secretPrefix>_MEMBER_DIDS contract. Remove the now-dead members-array onConflict union SQL (and unionDids if it becomes unused).\n\n' +
  'STEP 4 — DROP-COLUMN fallout: TenantRow no longer has members. Fix every TS reference (toTenantView already omits it; the seed TenantSeed.members input shape can stay, feeding addTenantMember). typecheck green.\n\n' +
  'STEP 5 — UPDATE HERMETIC TEST MOCKS (see the list in GROUND) so the existing star suites pass with IDENTICAL behavior: re-point each db-mock findTenantByMember plumbing from the members-array filter to an engine_tenant_members fixture (a list of {tenantId, did} the new query-chain resolves by did). Keep all assertions intact. Run: pnpm vitest run apps/engine-api/src/app.test.ts apps/engine-api/src/privy-split-brain.test.ts apps/engine-api/src/isolation.test.ts apps/engine-api/src/tenants.test.ts apps/engine-api/src/tenant-seed.test.ts apps/engine-api/src/tenants-me.test.ts and get them all green.\n\n' +
  'STEP 6 — /tenants/me SPLIT-BRAIN GUARD (the one intentional behavior addition): in app.ts GET /v1/tenants/me, after resolveTenant, apply the same guard scopedTenantId uses: if consumer.mode===privy && consumer.id && consumer.id !== resolved.tenant.tenantId then fail TENANT_UNKNOWN. Add/adjust a tenants-me test asserting a privy principal whose non-empty consumer.id disagrees gets 403, and that the existing happy path still passes.\n\n' +
  'STEP 7 — VERIFY + COMMIT: pnpm typecheck (all), pnpm test (full node+jsdom; PG-dependent pricing-chain tests skip without Postgres, that is fine), pnpm check:scoped, pnpm build all GREEN; star auth/tenancy regressions green with behavior preserved. Commit: refactor(tenancy): engine_tenant_members table replaces members[] array (UNIQUE did) with a body summarizing the table+migration-with-data-copy, rewired resolution+seed, dropped column, and split-brain guard, plus the Co-Authored-By trailer.\n\n' +
  'If you cannot reach green, STOP and report exactly what failed (leave changes in the tree). Return a structured report.',
  { phase: 'Spine', label: 'spine:refactor', schema: { type: 'object', additionalProperties: false,
    required: ['committed','typecheckGreen','checkScopedGreen','buildGreen','testsGreen','commitSha','migrationFile','dataCopyInMigration','filesChanged','deviations','summary'],
    properties: { committed:{type:'boolean'}, typecheckGreen:{type:'boolean'}, checkScopedGreen:{type:'boolean'}, buildGreen:{type:'boolean'}, testsGreen:{type:'boolean'}, commitSha:{type:'string'}, migrationFile:{type:'string'}, dataCopyInMigration:{type:'boolean'}, filesChanged:{type:'array',items:{type:'string'}}, deviations:{type:'array',items:{type:'string'}}, summary:{type:'string'} } } }
)
log('Spine: committed=' + (SPINE && SPINE.committed) + ' typecheck=' + (SPINE && SPINE.typecheckGreen) + ' tests=' + (SPINE && SPINE.testsGreen) + ' check:scoped=' + (SPINE && SPINE.checkScopedGreen) + ' dataCopy=' + (SPINE && SPINE.dataCopyInMigration) + ' sha=' + (SPINE && SPINE.commitSha))
if (!SPINE || !SPINE.committed || !SPINE.typecheckGreen || !SPINE.checkScopedGreen || !SPINE.testsGreen) {
  return { ok: false, stoppedAt: 'Spine', reason: 'Spine did not reach a green committed state', spine: SPINE }
}

phase('Tests')
const TCTX = GROUND + '\n\nSpine is committed. Summary: ' + (SPINE.summary || '') + '\nAuthor ONE NEW hermetic test file (model on app.test.ts db-mock pattern; read it + tenants.test.ts first). Write ONLY your file. Do NOT run the full suite (the integrator does).'
const TFILES = [
  { label: 'test:members-resolution', file: 'apps/engine-api/src/tenant-members.test.ts', spec: 'Cover table-backed resolution + helpers: (1) findTenantByMember(did) returns the tenant whose engine_tenant_members row has that did; 0 rows -> undefined; (2) addTenantMember inserts; re-add same (tenant,did) -> no-op; (3) addTenantMember with a did already bound to ANOTHER tenant -> the typed collision outcome/throw (UNIQUE(did)); (4) removeTenantMember deletes -> findTenantByMember then undefined. Hermetic (mock db emulating the engine_tenant_members query + a unique(did) violation).' },
  { label: 'test:members-seed-migration', file: 'apps/engine-api/src/tenant-members-seed.test.ts', spec: 'Cover seed rewire + migration intent: (1) seedTenants inserts member rows for the static + envMemberDids set INSERT-ONLY (re-seed -> no duplicate, no wipe); (2) read packages/db/drizzle/0005_*.sql as text and assert it contains an INSERT INTO ... engine_tenant_members ... unnest( ... data-copy that appears BEFORE the DROP COLUMN members (guards against losing prod members); (3) assert the unique(did) index line is present in that migration.' },
]
const TESTS = await parallel(TFILES.map((t) => () => agent(
  TCTX + '\n\nYOUR FILE: ' + t.file + '\nCOVER: ' + t.spec + '\nWrite it now.',
  { phase: 'Tests', label: t.label, schema: { type:'object', additionalProperties:false, required:['file','written','testCount','notes'], properties:{ file:{type:'string'}, written:{type:'boolean'}, testCount:{type:'number'}, notes:{type:'string'} } } }
)))
const written = (TESTS || []).filter(Boolean)
log('Tests authored: ' + written.map((t) => t.file).join(', '))

const INTEG = await agent(
  'You are the TEST INTEGRATOR for Wave 0. New files: ' + written.map((t) => t.file + ' (' + t.testCount + ')').join(', ') + '.\n' + GROUND + '\n' +
  'Get the FULL green bar with the new tests: pnpm typecheck (fix type errors in NEW tests to match the real tenants.ts signatures — prod is source of truth); pnpm test (full; PG pricing-chain skips OK; every other test incl. the star auth/tenancy regressions + the 2 new files PASS); pnpm check:scoped OK. Fix ill-formed new tests; do NOT weaken star assertions; if a test reveals a real prod bug fix it minimally + note it. Commit the test files (+ any minimal prod fix): test(tenancy): engine_tenant_members resolution + migration-data-copy guard, plus the Co-Authored-By trailer. Report totals + sha; if not green STOP and report which fail + why.',
  { phase: 'Tests', label: 'tests:integrate', schema: { type:'object', additionalProperties:false, required:['allGreen','committed','commitSha','passed','failed','productionFixes','summary'], properties:{ allGreen:{type:'boolean'}, committed:{type:'boolean'}, commitSha:{type:'string'}, passed:{type:'number'}, failed:{type:'number'}, productionFixes:{type:'array',items:{type:'string'}}, failingDetails:{type:'string'}, summary:{type:'string'} } } }
)
log('Integrator: green=' + (INTEG && INTEG.allGreen) + ' passed=' + (INTEG && INTEG.passed) + ' failed=' + (INTEG && INTEG.failed) + ' sha=' + (INTEG && INTEG.commitSha))
if (!INTEG || !INTEG.allGreen) return { ok:false, stoppedAt:'Tests', reason:'Integrator not green', spine: SPINE, integrator: INTEG }

phase('Verify')
const PCTX = GROUND + '\n\nSpine + tests committed and green (passed=' + INTEG.passed + '). You are an ADVERSARIAL reviewer of a BEHAVIOR-PRESERVING auth-spine refactor. DEFAULT POSTURE: suspicion — assume the rewire silently changed resolution behavior, lost data, or opened a cross-tenant hole. READ the committed code (git diff origin/main...HEAD + files); do NOT just trust tests. Report concrete real issues, mark isReal + minimal fix. Do NOT edit files.'
const LENSES = [
  { label:'verify:behavior-drift', lens:'BEHAVIOR DRIFT: does the new table-backed findTenantByMember resolve EXACTLY as the old members @> ARRAY did — same tenant for a member DID, undefined for none, ambiguous(>1) preserved? Check resolveTenant + every star regression still asserts the same outcomes (privy-split-brain, isolation, tenants, tenant-seed). Any weakened assertion or changed status code is a finding.' },
  { label:'verify:data-migration', lens:'DATA MIGRATION LOSS: read packages/db/drizzle/0005_*.sql. Is the INSERT ... SELECT unnest(members) data-copy present AND ordered BEFORE the DROP COLUMN members (and after CREATE TABLE)? If missing/misordered, existing prod members (mi-pase env-seeded DIDs) are DROPPED and every current user is locked out. Critical.' },
  { label:'verify:cross-tenant-unique', lens:'CROSS-TENANT DID + ambiguity: does uniqueIndex(did) actually prevent a DID in two tenants? Does addTenantMember surface the UNIQUE(did) violation as a handleable outcome (not an unhandled 500)? Is the ambiguous(>1) branch still handled fail-closed even though it should now be structurally impossible?' },
  { label:'verify:scoped-splitbrain', lens:'check:scoped + split-brain: confirm all engine_tenant_members access is in tenants.ts/seed-tenants.ts (allowlisted) and NONE leaked into app.ts (run pnpm check:scoped). Confirm the new /tenants/me split-brain guard rejects a privy principal whose non-empty consumer.id disagrees with the resolved tenant, and did not break the existing tenants-me happy path.' },
]
const PANEL = await parallel(LENSES.map((l) => () => agent(
  PCTX + '\n\nYOUR LENS: ' + l.lens + '\nInvestigate only this lens. Return findings.',
  { phase:'Verify', label:l.label, schema:{ type:'object', additionalProperties:false, required:['lens','verdict','findings'], properties:{ lens:{type:'string'}, verdict:{type:'string',enum:['clean','issues-found']}, findings:{type:'array',items:{ type:'object', additionalProperties:false, required:['title','isReal','severity','file','detail','fix'], properties:{ title:{type:'string'}, isReal:{type:'boolean'}, severity:{type:'string',enum:['critical','high','medium','low']}, file:{type:'string'}, detail:{type:'string'}, fix:{type:'string'} } } } } } }
)))
const real = (PANEL || []).filter(Boolean).flatMap((p) => (p.findings || []).filter((f) => f.isReal))
log('Panel: ' + real.length + ' real finding(s)')
if (real.length === 0) return { ok:true, stoppedAt:'complete', spine:SPINE, integrator:{ passed:INTEG.passed, sha:INTEG.commitSha }, panel:'clean', hardened:false }

phase('Harden')
const HARD = await agent(
  'You are the HARDENER for Wave 0. The adversarial panel found ' + real.length + ' REAL finding(s). Verify each by reading (reject false positives with reason), apply minimal correct fixes, add a regression test where uncovered, keep the green bar.\n' + GROUND + '\nREAL FINDINGS:\n' +
  real.map((f, i) => (i + 1) + '. [' + f.severity + '] ' + f.title + ' (' + f.file + ')\n   ' + f.detail + '\n   fix: ' + f.fix).join('\n\n') +
  '\nThen pnpm typecheck + pnpm test + pnpm check:scoped GREEN. Commit: fix(tenancy): harden members-table refactor per adversarial review, plus the Co-Authored-By trailer. Report fixed vs rejected.',
  { phase:'Harden', label:'harden:members', schema:{ type:'object', additionalProperties:false, required:['allGreen','committed','commitSha','fixed','rejected','summary'], properties:{ allGreen:{type:'boolean'}, committed:{type:'boolean'}, commitSha:{type:'string'}, fixed:{type:'array',items:{type:'string'}}, rejected:{type:'array',items:{type:'string'}}, summary:{type:'string'} } } }
)
log('Harden: green=' + (HARD && HARD.allGreen) + ' fixed=' + (HARD && HARD.fixed ? HARD.fixed.length : 0) + ' rejected=' + (HARD && HARD.rejected ? HARD.rejected.length : 0) + ' sha=' + (HARD && HARD.commitSha))
return { ok: !!(HARD && HARD.allGreen), stoppedAt: HARD && HARD.allGreen ? 'complete' : 'Harden', spine:SPINE, integrator:{ passed:INTEG.passed, sha:INTEG.commitSha }, panelRealFindings: real.length, harden: HARD }
