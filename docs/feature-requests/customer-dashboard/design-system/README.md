# Pokta Labs Design System — imported reference for the godin-engine workspace SPA

Imported 2026-06-08 from `~/workspaces/poktalabs/projects/marketing/code/poktalabs-landing-page`.
This is the **exact** brand/design source of truth, copied here so the M2 customer-dashboard SPA
applies Pokta Labs styling correctly (the Claude-Design wireframes have good structure but off-brand
styling — this bundle is what corrects that).

**Why this brand:** godin-engine / Godinez.AI **is Pokta Labs' Business/SMB vertical** — the design
system doc itself names Vino Design Build + Mi-PASE as the engine's live POCs. The client workspace
ships under the Pokta Labs brand.

## Files
- `tokens.css` — **source of truth.** Exact copy of the landing page's `src/styles/global.css`:
  Tailwind v4 `@theme` palette tokens + the `:root` / `.dark` semantic layer + base layer + helpers
  (`.btn`, `.kicker`, `.grain-overlay`). Framework-agnostic — drop it into the Vite SPA unchanged.
- `pokta-labs-design-system.md` — the full written system (identity, voice, color, type, shape,
  imagery). Exact copy; read it for the *why* behind every token.
- `reference-components.md` — the landing page's `ApprovalGate`, `LangToggle`, and `Nav` lockup
  patterns (Astro), kept as the canonical reference to match when we build the React equivalents.
  `ApprovalGate` and `LangToggle` map directly onto our two core concepts (approval gate + i18n).

## Applying it to the Vite + React SPA (when M2 is scaffolded)
1. **Stack matches.** Landing is Astro + Tailwind v4; the SPA is React + Vite + Tailwind v4. The
   `@theme` mechanism is identical — `tokens.css` works as-is.
2. **Fonts** (self-hosted via Fontsource, no Google Fonts link):
   ```
   pnpm add @fontsource-variable/source-serif-4 @fontsource-variable/manrope @fontsource-variable/funnel-display
   ```
   Import the variable CSS once at the app entry. Roles: **Source Serif 4** = headings (weight 400,
   editorial), **Manrope** = body/UI/labels, **Funnel Display** = buttons + italic emphasis.
3. **Color usage — two layers, never inline hex (hard rule):**
   - Static brand colors → role utilities: `text-primary`, `bg-secondary`, `border-accent`.
   - Theme-adaptive UI → semantic vars: `text-[var(--foreground)]`, `border-[var(--rule)]`,
     `text-[var(--accent-text)]`. (`--accent-text` is Brick Ember on light, flips to Amber on dark —
     not interchangeable with static `text-accent`.)
4. **Shape DNA (non-negotiable brand signature):** radius **0** everywhere, 1px ink hairline rules,
   hard-offset shadows only (`6px 6px 0 0 ink`), **no gradients**, optional paper-grain overlay.
5. **Voice in UI copy:** plain, declarative, **no em/en dashes anywhere** (enforced brand rule).

## ⚠️ Adaptation notes (decisions to make — do NOT silently guess)

This system was authored for a **marketing site** (light Ghost-White base, generous `py-24` sections,
editorial scale). Our surface is a **dense operator dashboard** (nav + tables of ~300 rows + an
approval queue). Two real gaps to resolve before/while building:

1. **Light vs dark.** The Pokta system's locked default is **light** (dark is a deliberate CTA band
   only). The existing engine `/console` and likely your wireframes are **dark**. Decide: build the
   workspace on the **light** brand base (on-brand, editorial, unusual-and-premium for a dashboard) or
   define a proper **dark** workspace theme by extending the `.dark` token block (more conventional for
   data-dense ops, but currently only specced for one CTA band). Recommend light to stay on-brand;
   confirm before committing — it sets the whole look.
2. **Status palette gap.** The brand palette has **no semantic status colors** (success / warning /
   error / info) — it's amber-primary + brick-ember-accent + midnight-violet + lavender. A dashboard
   needs run/approval status signals (ok / pending / failed / rejected; risk low→very-high). Options:
   (a) map within the brand (e.g. approved = amber fill, pending = ink outline, failed/rejected =
   brick-ember, idle = muted) — most on-brand; or (b) extend `@theme` with a small, calibrated status
   ramp (green/amber/red) tuned to the palette. **Don't reuse the console's generic green/red/amber
   without a decision** — that's the off-brand styling we're fixing. Pair color with icon + label
   always (accessibility + the brand never encodes meaning by color alone).

Density: scale spacing down from the marketing rhythm; reserve `--primary` (amber) for the one
primary action per screen. **The brand already has a dense-data pattern** — the **hairline-grid card**
(doc §7 / `reference-components.md` §4): cells in a shared ink field with `gap-px` 1px rules, the
"scientific-print table" look. Use it for run-detail, stat tiles, and the approval table; hard `--rule`
frames the grid, soft `--border` (15% ink) separates rows within a cell; ticks are small **squares**
in Brick Ember, never round dots. (This resolves most of the earlier "dense surface" worry — the
system is *built* to look like a print table.)

Re-imported 2026-06-08 (v2): the source added **§7 Components** (buttons = hard-offset ink stamp state
machine; two card systems; chrome), updated `LangToggle` active fill to `bg-secondary` (not raw ink),
and the brutalist button pass in `tokens.css`. Still-open gaps: **light-surface form fields** (only the
dark CTA band is specced) and the **status palette** — settle both before/while building.
