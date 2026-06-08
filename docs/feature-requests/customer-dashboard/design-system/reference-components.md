# Reference component patterns (from poktalabs-landing-page)

Exact Astro source of the three landing-page patterns most relevant to the workspace SPA. Match these
when building the React equivalents — same tokens, same shape DNA, same lockup proportions. Imported
2026-06-08 from `poktalabs-landing-page/src/components/`.

These are **marketing-page** components; for the dashboard, keep the token usage and shape language,
adapt the density (see `README.md` adaptation notes).

---

## 1. Brand lockup (from `Nav.astro`) — use verbatim proportions

Mark left + two-tone wordmark right. The lockup is brand-locked:

```html
<a href="/" class="inline-flex items-center gap-1 font-serif text-2xl tracking-tight font-semibold">
  <img src="/logo/poktalabs-logo.svg" alt="" width="20" height="20" class="size-5" />
  <span class="font-funnel font-medium">
    <span class="text-secondary">Pokta</span><span class="text-accent">Labs</span>
  </span>
</a>
```

Rules (from the design system): wordmark is **Funnel Display medium**, one token `PoktaLabs` (no
space); "Pokta" = `text-secondary` (Midnight Violet), "Labs" = `text-accent` (Brick Ember); mark
height ≈ 0.83 × wordmark size, gap ≈ 0.167 × wordmark size. **Caveat:** both wordmark inks are dark —
near-invisible on a dark band; needs a dark variant ("Pokta" → Ghost White, "Labs" → Amber) if the
workspace goes dark.

**Workspace note:** the client workspace is per-tenant themed. The Pokta Labs lockup is the *product*
brand; the *tenant* (Mi Pase / Vino) identity sits beside or below it (e.g. "PoktaLabs · workspace"
with the tenant name). Decide the co-branding lockup when building the shell.

Sticky header shell pattern:
```html
<header class="sticky top-0 z-40 bg-[var(--background)] border-b border-[var(--rule)]">
  <nav class="max-w-[1240px] mx-auto px-6 h-[68px] flex items-center justify-between gap-6"> … </nav>
</header>
```

### Buttons — the hard-offset ink stamp (signature affordance, see doc §7)

`.btn` (in `tokens.css`) now owns the brand's signature elevation. Every button carries it:
- **Face** Funnel Display, `cursor: pointer`, **constant `1.5px solid ink` border**.
- **Shadow state machine:** rest `4px 4px 0 0 ink` → hover `translate(-2px,-2px)` + `6px 6px` (lifts
  toward cursor) → active `translate(2px,2px)` + `0 0` (sinks flat). Curve `0.12s cubic-bezier(0.2,0.8,0.2,1)`.
- **Offset color by surface** (set in CSS, not utilities): default = ink; navbar (`header .btn`) =
  lighter `3→5→0` ink; dark band (`[data-theme="dark"] .btn`) = **Brick Ember** red stamp.
- **Brick-Ember stamp on light = destructive/alert only** (e.g. a Reject action), used rarely.

Fill variants (both ride the same `.btn` stamp):
```html
<!-- Primary (the one amber CTA per decision point) -->
<button class="btn inline-flex items-center gap-2 px-6 py-3.5 font-medium
               bg-[var(--primary)] text-[var(--primary-foreground)]"> … </button>
<!-- Secondary (lower-commitment, outline) -->
<button class="btn inline-flex items-center px-6 py-3.5 font-medium
               border border-secondary text-secondary"> … </button>
```
Sizes (padding only): small `px-5 py-2.5 text-sm` (navbar), default `px-6 py-3.5`, large `px-7 py-4 text-base`.
**Do:** exactly one primary per decision point + a secondary outline beside it; let the offset color
follow the surface. **Don't:** round corners, soften the shadow, recolor the amber fill, put a red
stamp on a routine CTA, or set a button in the serif.

Hard-offset shadow also appears on the mobile menu / pop-cards: `shadow-[6px_6px_0_0_var(--color-ink)]`.

---

## 2. Language toggle (from `LangToggle.astro`) — i18n control pattern

Sharp segmented control, hairline-bordered, current locale inverted (ink fill). This is the exact
i18n affordance the workspace should reuse (English-first, ES-MX secondary).

```html
<div class="inline-flex items-center border border-[var(--rule)]" role="group" aria-label="Language">
  <!-- active locale: filled with Secondary / Midnight Violet (NOT raw ink — ink is for
       text/rules/the stamp; Secondary is the brand's dark fill). Updated doc §7 chrome. -->
  <span aria-current="true"
        class="px-2.5 py-1.5 text-xs font-semibold tracking-[0.08em] cursor-default select-none
               bg-secondary text-[var(--color-white-soft)]">EN</span>
  <!-- inactive locale: bordered divider + hover -->
  <a href="…" hreflang="es"
     class="px-2.5 py-1.5 text-xs font-semibold tracking-[0.08em] transition-colors
            border-l border-[var(--rule)]
            text-[var(--foreground-soft)] hover:text-[var(--foreground)] hover:bg-[var(--surface-2)]">ES</a>
</div>
```

For the SPA this becomes a runtime locale switch (state + string catalog) rather than locale-routed
hrefs, but keep this exact visual treatment.

---

## 3. Approval gate (from `ApprovalGate.astro`) — our hero concept's brand expression

The landing page already visualizes "agent drafts, human approves." Note the brand cues: a sharp
square instrument badge (`size-14 border`, no radius), the `ph:cpu` Phosphor icon in `--accent-text`,
serif headline with a Funnel-italic emphasis word in the accent color, generous editorial spacing.

```html
<section class="bg-[var(--surface-2)] border-b border-[var(--rule)]">
  <div class="max-w-[1080px] mx-auto px-6 py-24 md:py-32 text-center" data-reveal>
    <span class="inline-grid place-items-center size-14 border border-[var(--rule)] bg-[var(--background)]">
      <Icon name="ph:cpu" class="size-7 text-[var(--accent-text)]" />
    </span>
    <h2 class="mt-8 font-normal text-3xl md:text-5xl lg:text-[3.4rem] leading-[1.12] tracking-[-0.01em]">
      …<em class="font-funnel font-medium italic text-[var(--accent-text)]">emphasis</em>…
    </h2>
    <p class="mt-7 text-lg text-[var(--foreground-soft)] leading-relaxed max-w-[58ch] mx-auto">…</p>
  </div>
</section>
```

**Workspace translation:** the dashboard's Approvals queue is the *functional* version of this
marketing section. Carry over the cues — sharp square instrument badge, `ph:` (Phosphor) iconography,
serif section headings, Funnel-italic accent emphasis, hairline section borders — but at operator
density (a queue/table, tighter spacing), not a centered marketing hero. Icon set: **Phosphor**
(`@iconify-json/ph`), already the landing page's icon family.

---

---

## 4. Hairline-grid cards — the dense-data pattern (doc §7, "Cards: two systems")

**This is how dense dashboard surfaces (run-detail, the approval table, stat tiles) stay on-brand.**
The brand's signature "scientific-print table" look: cards are cells in a grid whose **1px gaps are
the rules**. The wrapper paints one ink field; `gap-px` lets it show through, so every divider is one
shared hairline (never doubled).

```html
<!-- wrapper: outer frame + ink field bleeds through the 1px grid gaps -->
<div class="border border-[var(--rule)] grid gap-px bg-[var(--rule)] md:grid-cols-3">
  <div class="bg-[var(--surface)] p-7 md:p-10"> … </div>          <!-- standard cell -->
  <div class="bg-[var(--surface-2)] p-7 md:p-10"> … </div>        <!-- Lavender cell = emphasis -->
</div>
```

Two border weights, keep the hierarchy: **hard ink `--rule`** frames the grid + figures;
**soft 15%-ink `--border`** separates rows *within* a cell. For a row list inside a cell:
`border-t border-[var(--border)] divide-y divide-[var(--border)]`, rows `py-4`.

Details that read as on-brand:
- **Tick / bullet = a small SQUARE** `size-1.5 bg-[var(--accent-text)]` (Brick Ember), never a round dot.
- **Index numeral** `font-serif text-3xl leading-none` in `--muted-foreground` or `--accent-text`,
  number `padStart(2,'0')`.
- **Embedded figure** `relative border border-[var(--rule)] aspect-[4/3] overflow-hidden`.

**Pop-card** (the other card system) = freestanding, own `1.5px ink` border + `4px 4px 0 0 ink` stamp,
laid on a real `gap-6` grid, lifts on hover. Use ONLY when cards are *choices*, not a table. For our
data-dense surfaces the **hairline grid is the default**; reserve pop-cards for things like the
workflow picker or integration choice tiles.

Form fields (doc §7) — only specced for the dark CTA band so far; for light-surface dashboard inputs
this is a gap to settle alongside the status palette (see README):
`bg-[var(--color-white-soft)] text-[var(--color-ink)] border` + focus `border-accent ring-1 ring-accent`.

Live reference page in the source repo: `src/pages/design/brutalist.astro` (`/design/brutalist`).

---

## Quick token cheat-sheet (full list in `tokens.css` / design doc)

- **Fonts:** `font-serif` (Source Serif 4, headings), `font-sans` (Manrope, body/UI), `font-funnel`
  (Funnel Display, buttons + italic emphasis).
- **Brand fills:** `bg-primary` (#FF9900 amber), `text-accent` (#C11816 brick ember),
  `text-secondary`/`bg-secondary` (#0E092A midnight violet).
- **Adaptive UI:** `--background`, `--surface`, `--surface-2`, `--foreground`, `--foreground-soft`,
  `--muted-foreground`, `--primary`, `--primary-foreground`, `--accent-text`, `--rule`, `--border`.
- **Shape:** radius 0, `border-[var(--rule)]` hairlines, `shadow-[6px_6px_0_0_var(--color-ink)]`, no
  gradients, optional `.grain-overlay`.
- **Focus:** 2px Brick Ember outline, 2px offset. **Selection:** amber bg, dark text.
