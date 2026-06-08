# Journals — godin-engine

Purpose: Capture meaningful godin-engine activity as structured content substrate
(build-in-public, learnings, evidence) without replacing operational source-of-truth files.

Approval boundary: All journal entries are `internal-only` by default. External use requires
explicit human owner (Mel) approval. **Client identities (the retailer, the construction firm) and
any client pricing/margins/PII are abstracted in anything tagged for external use** until explicitly
authorized to name them.

Source-of-truth files (journals must not replace):
- `docs/feature-requests/*/DESIGN.md`, `M1-engine-plan.md`, `CLAUDE-DESIGN-PROMPT.md`
- Git history, CI config, the engine code itself
- Claude auto-memory (`~/.claude/projects/.../godinez-ai/memory/`) + the gbrain project page

Active streams:
- `changelog.md` — meaningful changes and milestones
- `proof-ledger.md` — evidence behind claims (commits, PRs, CI runs, tests)
- `content-backlog.md` — review-bound content candidates (build-in-public drafts)

Rules:
- Record signal, not raw logs.
- Tie claims to evidence.
- Keep client details private or abstracted.
- Do not publish from journals without approval.
