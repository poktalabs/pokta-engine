#!/usr/bin/env bash
#
# check-scoped-db.sh — CI tenant-isolation gate (M1.5 / D-4).
#
# FAILS the build if a raw engine_* table access (db.select / db.insert /
# db.update / db.delete / db.transaction / db.query.engine* / .from(schema.engine*))
# appears in the /v1 tenant data-plane surface OUTSIDE of scoped-db.ts.
#
# WHY: every /v1 route MUST resolve the DB through forConsumer(db, consumer.id)
# (scoped-db.ts), which injects `consumer_id = <tenant>` on every accessor and
# resolves approvals through their source run. A raw, unscoped engine_* access in
# a request handler is a cross-tenant leak waiting to happen. This gate makes that
# structurally un-mergeable.
#
# ALLOWLIST (intentionally exempt):
#   - apps/engine-api/src/scoped-db.ts  — THE tenant-scoping layer itself; its raw SQL
#                                     is tenant-bound by construction (ledger key embeds
#                                     consumerId; approvals resolved via sourceRun).
#   - apps/engine-api/src/demo.ts
#     apps/engine-api/src/dashboard.ts
#     apps/engine-api/src/console.ts  — operator-only cross-tenant ROLLUP surfaces
#                                     (/demo, /dashboard, /console). Gated at app
#                                     composition by operatorAuth() (fail-closed when
#                                     OPERATOR_KEY unset). They are NOT /v1 tenant
#                                     routes; cross-tenant reads there are by design.
#
# Anything else under apps/engine-api/src (the /v1 surface: app.ts, index.ts, auth.ts,
# and any future handler files) MUST go through scoped-db.ts.
#
set -euo pipefail

# Resolve repo-relative paths regardless of CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SRC_DIR="${REPO_ROOT}/apps/engine-api/src"

# Files allowed to perform raw engine_* table access.
ALLOWLIST=(
  "scoped-db.ts"
  "demo.ts"
  "dashboard.ts"
  "console.ts"
  # tenants.ts — the engine_tenants REGISTRY reader (PR2). engine_tenants is the
  # tenancy CONFIG table, NOT an engine_runs-class tenant-DATA table: it holds the
  # rows that DECIDE who a principal is and what it may do, and exposes no
  # cross-tenant data read. Its reads are by-primary-key (getTenant) or by the
  # members[] index (findTenantByMember); there is nothing here to scope to a
  # consumer_id, so it is exempt by design (see tenants.ts header).
  "tenants.ts"
  # seed-tenants.ts — deploy-time idempotent upsert of the engine_tenants CONFIG
  # table (run after db:migrate). Not a /v1 request handler; writes only the
  # tenancy config rows (validated charset/uniqueness/manifest membership). It
  # performs no cross-tenant DATA write. Exempt like tenants.ts.
  "seed-tenants.ts"
  # invites.ts — the engine_tenant_invites ACCESSOR (Wave 1). Touches ONLY
  # engine_tenant_invites (+ the one engine_tenant_members write via addTenantMember
  # in tenants.ts) — NOT an engine_runs-class tenant-DATA table. A targeted grep test
  # (invites-scope.test.ts) asserts it reads/writes no OTHER engine_* table, so the
  # broad allowlist exemption cannot hide an unscoped cross-tenant read.
  "invites.ts"
  # deprovision-invite.ts — the DB-driven ops deprovision/reset path (D5/D7): revoke
  # the invite + removeTenantMember in one tx. Not a /v1 request handler (guarded by
  # import.meta.url like seed-tenants main()); touches only engine_tenant_invites
  # (+ the membership delete via tenants.ts). Exempt like invites.ts.
  "deprovision-invite.ts"
  # roles.ts — the role/authz READ layer (admin-roles Wave A). Touches ONLY the three
  # role-bearing tables: engine_superadmins, engine_tenant_members, engine_tenant_invites
  # (superadmin membership, per-tenant role, the seat-count for the 5-cap, the per-tenant
  # advisory lock). NOT an engine_runs-class tenant-DATA surface. A targeted grep test
  # (roles-scope.test.ts) pins it to exactly those three tables so the broad allowlist
  # exemption cannot hide an unscoped cross-tenant read.
  "roles.ts"
)

# Raw-access patterns that must not appear in /v1 handler files.
#   db.select( / db.insert( / db.update( / db.delete( / db.transaction( / db.execute(
#   db.query.engine...                  (drizzle relational query on an engine_* table)
#   .from(schema.engine...              (a select that targets an engine_* table)
PATTERN='db\.(select|insert|update|delete|transaction|execute)\(|db\.query\.engine|\.from\(schema\.engine'

# Build a grep exclude list for the allowlisted basenames.
EXCLUDES=()
for f in "${ALLOWLIST[@]}"; do
  EXCLUDES+=(--exclude="${f}")
done

# Search every .ts under apps/engine-api/src EXCEPT the allowlisted files.
# grep exits 1 when there are no matches — that is the PASS case for us.
HITS="$(grep -rnE "${PATTERN}" "${SRC_DIR}" \
  --include='*.ts' \
  --exclude='*.test.ts' \
  "${EXCLUDES[@]}" || true)"

if [[ -n "${HITS}" ]]; then
  echo "FAIL: raw engine_* table access found in a /v1 surface (must go through forConsumer/scoped-db.ts):"
  echo "${HITS}"
  echo ""
  echo "Route handlers must resolve the DB via forConsumer(db, consumer.id). If this"
  echo "is an operator-gated cross-tenant rollup, add the file to ALLOWLIST in"
  echo "scripts/check-scoped-db.sh (and confirm it is operatorAuth()-gated)."
  exit 1
fi

echo "OK: no unscoped engine_* table access in the /v1 surface."
