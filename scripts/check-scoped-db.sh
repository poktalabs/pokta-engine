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
#   - engine-api/src/scoped-db.ts  — THE tenant-scoping layer itself; its raw SQL is
#                                     tenant-bound by construction (ledger key embeds
#                                     consumerId; approvals resolved via sourceRun).
#   - engine-api/src/demo.ts
#     engine-api/src/dashboard.ts
#     engine-api/src/console.ts     — operator-only cross-tenant ROLLUP surfaces
#                                     (/demo, /dashboard, /console). Gated at app
#                                     composition by operatorAuth() (fail-closed when
#                                     OPERATOR_KEY unset). They are NOT /v1 tenant
#                                     routes; cross-tenant reads there are by design.
#
# Anything else under engine-api/src (the /v1 surface: app.ts, index.ts, auth.ts,
# and any future handler files) MUST go through scoped-db.ts.
#
set -euo pipefail

# Resolve repo-relative paths regardless of CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SRC_DIR="${REPO_ROOT}/engine-api/src"

# Files allowed to perform raw engine_* table access.
ALLOWLIST=(
  "scoped-db.ts"
  "demo.ts"
  "dashboard.ts"
  "console.ts"
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

# Search every .ts under engine-api/src EXCEPT the allowlisted files.
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
