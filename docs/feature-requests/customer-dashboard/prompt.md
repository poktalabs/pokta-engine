ultracode — execute PR2 (Tier-2 tenancy runtime, BACKEND) per the implementation plan:
docs/feature-requests/customer-dashboard/PR2-IMPLEMENTATION-PLAN.md
(repo: /Users/mel/workspaces/poktalabs/projects/godinez-ai/godin-engine/code/godin-engine-v0.1)

Read that plan IN FULL first — it is self-contained (locked decisions, engine_tenants schema, T1–T9 acceptance criteria, test matrix, and the serial/parallel orchestration). Then build it exactly as its §7 Orchestration describes:

- Branch feat/m2-tenancy-runtime off origin/main.
- PHASE 1 SPINE (strictly serial, one agent): T1→T2→T3→T4→T5→T6→T7→T8, typecheck green after each, commit.
- PHASE 2 TESTS (parallel, disjoint test files) → serial integrator (full suite + typecheck + check:scoped), commit.
- PHASE 3 adversarial isolation panel (3 read-only skeptics) → serial harden pass, commit.
- PHASE 4 push + open PR (base main) titled "PR2: Tier-2 tenancy runtime (backend)"; report the PR URL.

Hold the green bar: 331 tests stay green (pricing-chain integration skips without PG) + new tests; M1 mi-pase regression ★ and PR1 cross-tenant isolation ★ must stay green; pnpm check:scoped (grep gate) stays OK. Do NOT touch apps/web (that's PR2b). Commit each phase with git -c user.name="troopdegen" -c user.email="mel@innvertir.com". The plan docs are uncommitted on main's working tree — fold them into the PR2 branch in your setup commit. If any phase can't reach green or the M1 regression breaks, STOP and report rather than stacking broken commits.
