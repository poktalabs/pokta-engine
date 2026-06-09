#!/usr/bin/env bash
#
# check-no-mock-render.sh — CI no-mock-in-production gate (P5b Wave 2 / D5).
#
# FAILS the build if any file under apps/web/src/pages OR apps/web/src/features
# performs a VALUE or SIDE-EFFECT import from '@/mocks' — i.e. a production render
# surface is still backed by mock fixtures instead of the real /v1 read models.
#
# Matches (FAIL):
#   import '@/mocks…'                     (side-effect import)
#   import { X } from '@/mocks…'          (named value import, incl. multi-line)
#   import X from '@/mocks…'              (default value import)
#   import X, { Y } from '@/mocks…'       (mixed value import)
#
# Does NOT match (ALLOWED):
#   import type { X } from '@/mocks…'     (type-only import — erased at build)
#   *.test.* files                        (tests legitimately drive the registry)
#
# An inline `{ type X }` specifier inside an OTHERWISE value import still counts
# as a value import (the statement also imports values), which is correct: the
# discriminator is the leading `import type` (a whole-statement type-only import).
#
# WHY: lib/api.ts carries a single side-effect `import '@/mocks'` to register the
# test mock-registry — but that is in lib/, OUTSIDE pages/ + features/, so it is
# intentionally out of scope here. Any mock VALUE import that reaches a render
# surface means a page was not fully wired to the live backend.
#
set -euo pipefail

# Resolve repo-relative paths regardless of CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SCAN_DIRS=(
  "${REPO_ROOT}/apps/web/src/pages"
  "${REPO_ROOT}/apps/web/src/features"
)

# Collect candidate .ts/.tsx files (excluding test files).
FILES=()
for dir in "${SCAN_DIRS[@]}"; do
  [[ -d "${dir}" ]] || continue
  while IFS= read -r f; do
    FILES+=("${f}")
  done < <(find "${dir}" -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.test.ts' ! -name '*.test.tsx')
done

[[ ${#FILES[@]} -eq 0 ]] && {
  echo "OK: no production mock value/side-effect imports under apps/web/src/{pages,features}."
  exit 0
}

# Perl scan: match a full `import … from '@/mocks…'` (or bare `import '@/mocks…'`)
# statement, ACROSS newlines, that is NOT an `import type …` statement. Slurp the
# whole file (`-0777`) so multi-line named imports are matched as one statement.
HITS="$(perl -0777 -ne '
  while (/(^[ \t]*import\b(?:(?!;|from).)*?(?:from\s*)?["'"'"']\@\/mocks[^"'"'"']*["'"'"'])/msg) {
    my $stmt = $1;
    next if $stmt =~ /^\s*import\s+type\b/;   # type-only import → allowed
    # Report file:line of the statement start.
    my $pre = substr($_, 0, pos($_) - length($stmt));
    my $line = ($pre =~ tr/\n//) + 1;
    my $first = (split /\n/, $stmt)[0];
    print "$ARGV:$line: $first\n";
  }
' "${FILES[@]}" || true)"

if [[ -n "${HITS}" ]]; then
  echo "FAIL: a production render surface (apps/web/src/pages or /features) still"
  echo "imports a VALUE from '@/mocks'. Wire it to the real /v1 read model, or use a"
  echo "type-only import (\`import type …\`) if you only need the shape:"
  echo ""
  echo "${HITS}"
  exit 1
fi

echo "OK: no production mock value/side-effect imports under apps/web/src/{pages,features}."
