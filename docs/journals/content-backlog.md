# Content Backlog — godin-engine

## Candidate: The day our client dashboard stopped being a client dashboard

Status: ready-for-human-review
Approval: internal-only

Source streams:
- journals/changelog.md#2026-06-08
- journals/proof-ledger.md#2026-06-08

Format options:
- Blog post (primary) / LinkedIn post / X thread

Core idea:
- Building a dashboard for one client almost made us build the wrong thing. Putting a second,
  structurally opposite client next to the first forced the real abstraction — and the real product.

Grounded facts (from proof ledger):
- M1 (first client workflow) rewritten into the engine and merged (PR #5), 273/273 tests, CI green
  against a real Postgres, one doubled-pnpm-version bug caught by CI.
- M2 design reframed to a tenant-agnostic governed-workflow workspace; approval queue as the universal
  heart with a pluggable item renderer; English-first + i18n.

Interpretation:
- The forcing function for good abstractions isn't more thinking about client #1 — it's client #2.

Proof needed before external use:
- Mel's OK to publish at all, and specifically whether to name the clients/engine or keep abstracted.

Risks / things not to say:
- Do NOT name the clients, their staff, their pricing, margins, or dollar figures without explicit
  approval. Draft below keeps them abstracted ("a Mexican online retailer", "a US construction firm").
- Don't imply real production price changes happened — they haven't (dev store only).

Next action:
- Mel reviews the draft below; decides publish/abstract/name; picks channel.

---

### DRAFT (build-in-public blog post) — clients abstracted

**The day our client dashboard stopped being a client dashboard**

We're building godin-engine: a control plane that runs AI-agent workflows for real businesses and
governs them — state, quotas, and the part everyone underestimates, human approval. Nothing important
gets written to the outside world until a person signs off.

This week had two halves. The first was shipping. The second was the more interesting kind of mistake:
almost building the right feature for the wrong shape of the problem.

**Half one: making the first real workflow real**

Our first paying client had a workflow that already worked — a daily pricing pipeline, hundreds of
products, validated logic, a pile of passing tests. The temptation with something that already works
is to wrap it: drop the script behind an endpoint and call it integrated.

We rewrote it instead. The tested *brain* (the pricing math, the matching, the classification) carried
over almost untouched. The *shell* — how it's orchestrated, where it reads its keys, how it pauses for
approval — got rebuilt to fit the engine's contract: a workflow declares a manifest and a `run()`, and
a run can hand off to a chained run behind an approval gate. Confident changes apply automatically;
the judgment calls wait for a human to approve them as a batch.

It merged with the boring stuff in place: 273 tests passing, and CI running the integration test
against a real Postgres database that spins up and tears down per run. CI immediately earned its keep
by failing — not on our code, but on a config smell: the pnpm version was pinned in two places at once
and the setup action refused to guess. The kind of thing that "works on my machine" forever and breaks
the first time a teammate or a fresh environment touches it. One line to fix. That's the whole point of
CI catching it instead of a person.

**Half two: the second client changed the product**

Then we started on the dashboard — the place a client logs in to run their workflow, watch it, and
approve the held-back actions. The first draft was, honestly, a pricing app. Tables of products,
prices, competitor references, approve-the-batch. Clean. Specific. Wrong.

It was wrong because of client number two: a construction firm whose workflows look nothing like daily
pricing. Low frequency instead of high. *Every* outbound action gated individually — a drafted email, a
CRM stage change, a committed estimate — instead of one batch of homogeneous changes. Seven connected
systems instead of one. Stakes measured in client relationships and signed numbers, not a price tick.

Put those two side by side and the pricing-shaped dashboard collapses. But the *thing they share*
snaps into focus: a queue of actions an agent has prepared and a human must approve, where each item
says plainly what will change, in which system, and at what risk. That queue is the product. The
pricing table is just one way to *render* an item in it; the construction firm's single-action approval
card is another. Same frame, pluggable body.

So the dashboard stopped being a client dashboard and became a tenant-agnostic workspace: a generic
shell (workflows, approvals, integrations, reports), themed per client, English-first but built for
other languages and currencies from the start, with the approval queue as its beating heart.

**The lesson**

You don't find the right abstraction by thinking harder about your first user. You find it by putting
a second, genuinely different user next to the first and watching which parts survive. Client #1 tells
you what to build. Client #2 tells you what it actually is.

Next: turning that into screens, then into the real thing.

---

*(end draft)*
