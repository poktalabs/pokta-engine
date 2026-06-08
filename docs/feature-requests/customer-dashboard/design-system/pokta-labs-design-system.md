# Pokta Labs Design System

> Source of truth for the Pokta Labs brand and design system, extracted from the
> landing page (`src/styles/global.css`, `src/i18n/ui.ts`, components) and the
> brand-architecture decision of 2026-06-05.
>
> Form-ready: each section maps to a field group in a "Set up your design system"
> form. All suggested copy is em-dash-free to match the brand voice (a hard rule).

---

## 1. Identity / Positioning

**Name:** Pokta Labs

**What it is (category):**

> A founder-led frontier-tech studio that deploys AI systems into businesses. We build the systems and put them to work in healthcare, business, and education.

**Positioning statement:**

> Pokta Labs deploys frontier AI as systems that run in production. We work at the edge of what AI can do and turn it into systems that operate inside healthcare organizations, businesses, and education, built to the depth the work demands.

**Tagline:** Frontier tech for healthcare, business, and education.

**Signature lines:** "Frontier capability, deployed." / "From the frontier to your operation."

**Differentiator (the spine of the brand):**

> No slideware. Everything we show already operates in the world and is used by real people today. A consultancy hands you a deck. We hand you systems that run.

**Sister-brand line** (use in About / footer where the relationship comes up):

> Pokta Labs is the frontier-tech delivery studio of Frutero, LLC. We build the systems. Our sister brand, Frutero, runs the builder community and education programs that grow the operators behind them.

### Brand architecture (Frutero, LLC holding)

|            | Pokta Labs                                        | Frutero (sister brand)                                              |
| ---------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Role       | B2B / frontier-tech delivery studio               | Community + education services (talent accelerator)                 |
| Owns       | Products + B2B client engagements (Vino, Mi-PASE) | AgentCamp, Vibe Coding Bootcamp, hackathon mentorship, Frutero Club |
| Proof type | Shipped systems                                   | Delivered programs                                                  |

### The three verticals (each anchored to a shipped system)

| Vertical                       | Hero proof (the system)                                                                               | The offer                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Healthcare** (deepest proof) | RheumaAI (7,870+ peer-reviewed sources), RheumaScore (157 calculators, FHE), DNAI, LES AI, Pokta Care | Clinical AI systems with the human always in control                                           |
| **Business / SMB**             | `godin-engine` / Godinez.AI, the orchestration engine powering live POCs (Vino Design Build, Mi-PASE) | Agentic workflows, integrations, and automation, deployed into your operation                  |
| **Education**                  | DevRel Engineer Agent: 95%+ submission rate across 3 co-organized hackathons                          | Education tools, builder programs, and corporate training (200+ trained on AWS, Healthcare IT) |

R&D depth layer: **Research** (Scientific Paper Pipeline), **Tooling** (internOS, open source).

### Brand pillars / principles

1. **Only what ships** — if it does not run in the world, it does not make the page.
2. **Frontier tech, grounded** — the most advanced only matters if it solves a concrete, measurable problem.
3. **Humans in control** — AI proposes and executes; the decisions that matter stay with people.
4. **Lab speed** — what takes others quarters, we ship in days.

### Process model

Explore → Prototype → Validate → Deploy → Scale.

### Audiences

Healthcare · Business/SMB · Education (in that priority order).

### Honesty guardrails (keep the brand "only what ships")

- Business/SMB stage = "live POCs and demos," not "clients" (no revenue yet).
- Say "in production" only for healthcare and the engine itself.
- Education leads with the agent (a system), then the offer. Do not claim Frutero's community or bootcamp programs as Pokta's.

### Languages

Bilingual. Spanish default (`/`), English at `/en/`. LatAm-first audience.

### Founder

Ángel Meléndez Córdoba (Mel), Founder & CEO. Healthcare-technology career: biomedical engineer, Clinical Engineer in hospitals, Healthcare IT, Solutions Architect at Telmex (EHR ops for 30 Mexico City hospitals, first Vendor Neutral Archive deployment in Mexico, Farmacias Guadalajara SAP migration at 80% savings, AWS Champion). Builds with Dr. Erick Zamora Tehozol, practicing rheumatologist in Mérida, as medical advisor and clinical design partner.

---

## 2. Logo & Lockup

### The mark

A circular badge that reads as a stylized **P** (Pokta) built from instrument-like geometry: a compass / target / radar motif. Source: `public/logo/poktalabs-logo.svg` (1024x1024, vector) and `public/logo/poktalabs-logo.png` (raster, for canvas / OG rendering).

Construction and colors (the mark is the most saturated expression of the palette, three brand colors, no neutrals):

| Element                                      | Color                     |
| -------------------------------------------- | ------------------------- |
| Disc field                                   | Amber Glow `#FF9900`      |
| P structure (horizontal bar + vertical stem) | Midnight Violet `#0E092A` |
| P bowl ring (top-right)                      | Midnight Violet `#0E092A` |
| P bowl core (inside the ring)                | Brick Ember `#C11816`     |
| Radiating diagonal rays (upper-left)         | Brick Ember `#C11816`     |
| Thin outer ring stroke                       | Amber Glow `#FF9900`      |

The mark is full-bleed to its circle (the artwork includes no internal padding), so treat the circle edge as the boundary when spacing it.

### The wordmark

One token, **no space**: `Pokta` + `Labs` set tight as `PoktaLabs`.

| Property      | Value                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typeface      | **Funnel Display**, weight **medium (500)** (not the heading serif, despite the anchor's `font-serif` class, the inner span overrides to `font-funnel`) |
| "Pokta" color | Secondary, Midnight Violet `#0E092A`, applied via `text-secondary` (mirrors the mark's P structure)                                                     |
| "Labs" color  | Accent, Brick Ember `#C11816`, applied via `text-accent` (mirrors the mark's bowl core and rays)                                                        |

The wordmark colors are pulled straight from the mark: "Pokta" takes the Midnight Violet of the P structure, "Labs" takes the Brick Ember of the bowl core and rays. The lockup is self-consistent, the word and the symbol use the same two ink colors over the Amber field.
| Tracking | Tight: `-0.025em` (navbar / footer) to `-0.02em` (OG card) |

### The horizontal lockup ("Logo + PoktaLabs")

This is the canonical signature for the navbar, footer, OG / social cards, and **any replicated image that uses the horizontal layout**. Mark sits left, wordmark right, vertically centered.

**Proportions (locked, derived from the navbar and mirrored in the OG card):**

- Mark height = **20/24 (≈0.83) of the wordmark font size.**
- Gap between mark and wordmark = **4/24 (≈0.167) of the wordmark font size.**

| Context            | Mark | Gap  | Wordmark                 | Source               |
| ------------------ | ---- | ---- | ------------------------ | -------------------- |
| Navbar             | 20px | 4px  | 24px Funnel Display 500  | `Nav.astro` (SVG)    |
| Footer             | 20px | 4px  | 24px Funnel Display 500  | `Footer.astro` (SVG) |
| OG card (1200x630) | 93px | 19px | 112px Funnel Display 500 | `gen-og.mjs` (PNG)   |

To scale the lockup to any new horizontal image: pick the wordmark font size `S`, then mark `= 0.83 * S`, gap `= 0.167 * S`. Use the **PNG** mark for raster / canvas / OG output, the **SVG** for web and anything that scales.

### Usage rules

- **Always pair mark + wordmark** in the horizontal lockup for nav, footer, OG, and replicated horizontal images. The mark may stand alone only as a favicon / app icon / avatar (square contexts), never the wordmark alone in these surfaces.
- **Keep the wordmark two-tone, matched to the mark.** "Pokta" is Midnight Violet `#0E092A`, "Labs" is Brick Ember `#C11816`. Both are fixed, the same on every light surface.
- **Clear space (recommended):** keep free space of at least the mark's radius (½ its height) on all sides of the full lockup.
- **Minimum size (recommended):** mark not below 20px tall on screen (its current navbar size); below that the bowl core and rays muddy.
- **Background:** the lockup is built for the light Ghost White base. It also works on the Ink Black dark band, with one caveat below.
- **Do not:** add a space inside "PoktaLabs"; set the wordmark in the heading serif (Source Serif 4) or any non-Funnel face; recolor "Labs" away from Brick Ember; recolor or restyle the mark; add effects (shadow, gradient, outline) to either element; change the mark-to-wordmark ratio or gap.

### Known caveat (dark bands)

The wordmark now hardcodes **both** words to dark ink: "Pokta" Midnight Violet `#0E092A`, "Labs" Brick Ember `#C11816`. Both are near-invisible on the deep-navy / Ink-Black dark band. Every current lockup surface (navbar, footer, OG card) sits on the light Ghost White base, so this is safe today. If the lockup ever needs to appear on a dark band, it requires a dedicated dark variant, for example "Pokta" to Ghost White `#F4F2F9` or Bright Snow `#F8F8F8` and "Labs" to Amber `#FF9900`. Not yet implemented in code, flagged in the appendix.

## 3. Voice & Tone

**Voice:** Frontier-lab. Plain, declarative, confident, anti-hype. Editorial / scientific-journal register.

**Rules:**

- Short, direct sentences. Lead with the claim, back it with a number.
- Proof over adjectives ("55 users in 10 days, 67% return"; "7,870+ peer-reviewed sources"; "95%+ submission rate").
- Name the enemy: slideware, demos that never ship, consulting decks.
- **No em-dashes or en-dashes anywhere.** Use commas and periods. (Hard, enforced rule across the codebase.)
- No hedging, no hype-stacking. (Language has "no gradients" too.)

**Tone examples (from the site):**

- "We do not pitch slideware."
- "We work at the frontier and ship it, learning in days what takes others quarters."
- "It recommends with verifiable citations; the physician always decides."

---

## 4. Color Palette

Eight-color system. Deep-navy + lavender base. **Orange is primary, red is the accent.**
Coolors: `05010a-0a051a-0e092a-c11816-ff9900-efebfa-f4f2f9-f8f8f8`

Defined as Tailwind v4 `@theme` tokens in `src/styles/global.css`. Each token name **is** the utility name, so `--color-primary` gives `text-primary` / `bg-primary` / `border-primary`, and so on.

| Token                | Utility        | Hex       | Name            | Role                                                   |
| -------------------- | -------------- | --------- | --------------- | ------------------------------------------------------ |
| `--color-primary`    | `*-primary`    | `#FF9900` | Amber Glow      | Primary (CTAs, key fills, brand pop)                   |
| `--color-secondary`  | `*-secondary`  | `#0E092A` | Midnight Violet | Secondary (deep navy), dark surfaces, "Pokta" wordmark |
| `--color-accent`     | `*-accent`     | `#C11816` | Brick Ember     | Accent (links, ticks, "Labs" wordmark)                 |
| `--color-ink`        | `*-ink`        | `#0A051A` | Ink Black       | Main text / foreground                                 |
| `--color-light`      | `*-light`      | `#EFEBFA` | Lavender Mist   | Card / surface-1 / drawers                             |
| `--color-paper`      | `*-paper`      | `#F4F2F9` | Ghost White     | Page background                                        |
| `--color-ink-black`  | `*-ink-black`  | `#05010A` | Black           | Reference only, use sparingly                          |
| `--color-white-soft` | `*-white-soft` | `#F8F8F8` | Bright Snow     | Effective white, use sparingly                         |

### Usage convention (no inline hex, ever)

Two layers, pick by intent:

1. **Static brand colors → role utilities.** Use `text-primary`, `bg-secondary`, `border-accent`, etc. These are fixed and never change with theme. Use them for brand-locked elements (the logo wordmark, fixed accents). **Never** write an inline hex like `text-[#C11816]`, and never reach for a raw `var(--color-*)` in a bracket utility when a clean role utility exists.
2. **Theme-adaptive UI → semantic vars.** Use `text-[var(--foreground)]`, `border-[var(--rule)]`, `text-[var(--accent-text)]`, etc. These swap between the light default and the dark CTA band. Use them for body UI that must flip on dark surfaces. (Note `--accent-text` is Brick Ember on light but flips to Amber on dark, so it is _not_ interchangeable with the static `text-accent`.)

The `:root` semantic layer (`--foreground`, `--background`, `--surface`, `--surface-2`, `--primary`, `--primary-foreground`, `--accent-text`, `--spot`, `--rule`, `--border`) is built on the palette tokens above and is the only place raw `--color-*` tokens should be referenced.

**Semantic mapping (light theme is the locked default):**

- Background = Ghost White · Surface = Bright Snow · Surface-2 = Lavender Mist
- Text = Ink · Primary = Amber (with dark text on it, ~9:1 contrast)
- Accent text = Brick Ember on the light base (~5.5:1, legible)
- Rules / borders = Ink hairlines; soft border = 15% ink

**Dark band (not a page theme; used only for deliberate CTA sections):**

- Background = Ink Black · Surface = Ink · Surface-2 = Midnight Violet
- Accent flips to Amber (red is too dark on navy) · Spot = Brick Ember

---

## 5. Typography

Self-hosted via Fontsource (no Google Fonts link in production).

| Role               | Font                          | Notes                                                                                    |
| ------------------ | ----------------------------- | ---------------------------------------------------------------------------------------- |
| Display / headings | **Source Serif 4** (variable) | Weight 400, tracking `-0.02em`, leading `1.1`. Signature face (inspired by dnai.health). |
| Body / UI          | **Manrope** (variable)        | Body copy, labels, the uppercase kicker / eyebrow.                                       |
| Accent / nav / buttons | **Funnel Display** (variable) | Italic emphasis (e.g. "_frontier tech_"), button labels, nav + footer links (natural case, `0.95rem`), the signature headline word. |

**Conventions:**

- Headings are serif, weight 400 (light, editorial, not bold).
- Hero scale: `text-5xl → 6xl → 7xl`, tracking `-0.02em`, leading `1.1`.
- Kicker / eyebrow: Manrope, `0.75rem`, uppercase, letter-spacing `0.16em`, weight 600.
- Headline emphasis word: Funnel Display _italic_, in Brick Ember red.
- Body lede: serif, `text-xl → 2xl`, leading `1.5`, in `foreground-soft`.

---

## 6. Shape, Spacing & Texture

What makes it read as a scientific-print / research-lab system instead of generic SaaS.

- **Shape: SHARP. Radius 0 everywhere.** Square frames, no rounded corners.
- **Hairline rules:** 1px ink borders (`--rule`), thin column rules.
- **Shadows: hard offset only, and now load-bearing.** A constant ink border plus a hard `Npx Npx 0 0` offset stamp is the site's elevation language (buttons, pop-cards, mobile menu). No soft / blurred shadows, ever. The offset distance encodes state, not just decoration (rest → hover lifts → press sinks flat). Full spec in Section 7.
- **Paper grain overlay:** fixed SVG fractal-noise texture, opacity `0.06`, `mix-blend-mode: multiply`. Printed-paper feel on every page.
- **No gradients** (hard brand rule in UI).
- **Layout:** max container `1240px`, `px-6` gutters, 12-col grid.
- **Motion (intensity 4):** gentle fade-up on scroll-enter (`translateY(16px)`, `0.6s`, `cubic-bezier(0.16, 1, 0.3, 1)`). Buttons and pop-cards use the tactile hard-offset stamp (lift toward the cursor on hover, sink flat on press) on a snappy `0.12s cubic-bezier(0.2, 0.8, 0.2, 1)` curve, see Section 7. Honors `prefers-reduced-motion` (offset kept, slide dropped).
- **Focus state:** 2px Brick Ember outline, 2px offset.
- **Selection:** Amber background, dark text.
- **Figure captions:** small muted text preceded by a short Brick Ember tick mark.

**Design dials / mood words:** resonant-stark · snug-simple · retro-futuristic-healthcare · research-laboratory-professional.

---

## 7. Components

The reusable UI primitives, as actually built in `src/components`. The site is
carried by **buttons**, the **hairline-grid card system**, and (since the
industrial-brutalist pass, commit #6) the **hard-offset stamp** that gives buttons
and pop-cards their elevation. The living reference is the in-repo page at
`/design/brutalist` (`src/pages/design/brutalist.astro`), rendered with the real
tokens, keep it and this section in sync.

### Buttons

Every button carries the base `.btn` class (`src/styles/global.css`). `.btn` is
no longer just a font + motion hook, it now defines the **hard-offset ink stamp**
that is the brand's signature affordance:

- **Face:** Funnel Display. **Cursor:** `pointer` (so the native `<button>` submit matches the link buttons).
- **Border:** constant `1.5px solid ink`, regardless of shadow color.
- **Shadow (the state machine):** rest `4px 4px 0 0 ink` → hover `translate(-2px, -2px)` + `6px 6px 0 0 ink` (lifts toward the cursor) → active `translate(2px, 2px)` + `0 0 0 0 ink` (sinks flat onto the page).
- **Curve:** `0.12s cubic-bezier(0.2, 0.8, 0.2, 1)` on transform + shadow; `prefers-reduced-motion` keeps the shadow change but drops the slide.

**Fill variants** (the fill/text classes; all sit on the same `.btn` stamp)

| Variant             | Classes                                                  | Look                                                |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| Primary (filled)    | `bg-[var(--primary)] text-[var(--primary-foreground)]`   | Amber fill, dark ink text (~9:1). The main CTA.     |
| Secondary (outline) | `border border-secondary text-secondary`                 | Midnight Violet text on paper, under the ink stamp. |

Both are `inline-flex items-center font-medium`; the primary usually carries an
icon with `gap-2`.

**Shadow-color contexts** (the offset color shifts by surface, set in CSS, not utilities)

| Context                       | Rest → hover → press shadow                       | Why                                                                 |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Default (light page)          | `4 → 6 → 0` in **ink**                             | The baseline stamp.                                                 |
| Navbar (`header .btn`)        | `3 → 5 → 0` in **ink**                             | Lighter in the compact 68px bar so it does not shout.               |
| Dark CTA band (`[data-theme="dark"] .btn`) | `4 → 6 → 0` in **Brick Ember** `--color-accent` | Ink/light both read wrong on Midnight Violet; the amber fill stays, the accent **red** reads cleanly as a solid block. (Red's "too dark on navy" caveat is about *text*, not fills.) |

The reference page also shows a **Brick-Ember-shadow variant on light**, reserved
for destructive / alert actions, use rarely; routine site CTAs keep the ink stamp.

**Sizes** (padding only, the variant classes stay the same)

| Size    | Padding              | Used in                                  |
| ------- | -------------------- | ---------------------------------------- |
| Small   | `px-5 py-2.5 text-sm`| Navbar access button (`Nav.astro`)       |
| Default | `px-6 py-3.5`        | Hero, ProjectDetail inline CTAs          |
| Large   | `px-7 py-4 text-base`| Section-closing CTAs (CtaBand, AboutPage, ProjectDetail) |

**Do:** keep exactly one primary per decision point; pair it with a secondary
outline for the lower-commitment action; let the offset color follow the surface.
**Do not:** round the corners, swap the hard offset for a soft/blurred shadow,
recolor the amber fill, put a red shadow on a routine (non-destructive) CTA, or
set a button in the serif.

### Form fields (the dark CTA band)

Inputs live only inside the one dark CTA panel, styled as white islands on
Midnight Violet (`CtaBand.astro`):

- Base: `bg-[var(--color-white-soft)] text-[var(--color-ink)] border border-transparent px-3.5 py-2.5`.
- Focus: `focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent` (Brick Ember 1px frame + ring).
- Selects add `appearance-none pr-10` plus a custom `ph:caret-down` icon in `text-secondary` (native select chrome ignores padding inconsistently).

### Cards: two systems

The site uses two card languages, pick by intent:

1. **Hairline-grid** (default, for dense related sets) — cells in a shared ink field, below.
2. **Pop-card** (for a small set of peer choices you want to feel tactile) — separated, stamped, lift on hover. Currently the Audiences sectors (`Audiences.astro`, on home + about).

**Pop-card** is the card-scale echo of the button stamp: each card is freestanding
with its own `1.5px ink` border and a `4px 4px 0 0 ink` rest shadow, laid out on a
real `gap-6` grid (not the flush `gap-px`). On hover it lifts `translate(-3px, -3px)`
to `6px 6px 0 0 ink` on the snappy `0.18s` curve; `prefers-reduced-motion` drops
the lift. Use it sparingly, when cards are *choices*, not a *table*; the hairline
grid stays the default.

### Hairline-grid cards

The default. Cards are cells in a grid whose 1px gaps are the rules. The wrapper
paints a single ink field and a `gap-px` grid lets it show through between cells,
so every divider is one shared hairline, never doubled. This is the signature
"scientific-print table" look.

**Pattern (from `Features`, `Showcase`):**

```html
<!-- wrapper: outer frame + ink field shows through the 1px grid gaps -->
<div class="border border-[var(--rule)] grid gap-px bg-[var(--rule)] md:grid-cols-3">
  <!-- each cell sits on a surface, padded, no border of its own -->
  <div class="bg-[var(--surface)] p-7 md:p-10"> ... </div>
  <div class="bg-[var(--surface-2)] p-7 md:p-10"> ... </div>  <!-- Lavender cell = emphasis -->
</div>
```

| Element                  | Convention                                                                 |
| ------------------------ | -------------------------------------------------------------------------- |
| Wrapper                  | `border border-[var(--rule)] grid gap-px bg-[var(--rule)]`                  |
| Standard cell            | `bg-[var(--surface)]` (Bright Snow), padding `p-7 md:p-10` (or `md:p-8`)    |
| Emphasis cell            | `bg-[var(--surface-2)]` (Lavender Mist) to lift one cell out of the field   |
| Cell span                | `md:col-span-2` / `md:col-span-3` to make a feature cell wider              |
| Embedded figure          | `relative border border-[var(--rule)] aspect-[4/3]` (or `16/9`) `overflow-hidden` |
| Row list inside a cell   | `border-t border-[var(--border)] divide-y divide-[var(--border)]`, rows `py-4` (soft 15% borders, not the hard `--rule`) |
| Index numeral            | `font-serif text-3xl leading-none` in `--muted-foreground` or `--accent-text`, number `padStart(2,'0')` |
| Tick / bullet            | a small **square** `size-1.5 bg-[var(--accent-text)]` (Brick Ember), never a round dot |

Note the two border weights in play: the **hard ink `--rule`** frames the grid
and figures; the **soft 15%-ink `--border`** separates rows *within* a cell. Keep
that hierarchy, structure is ink, internal lists are faint.

### Navigation, footer & chrome

The industrial-brutalist pass restyled the shared chrome (commit #6):

- **Nav links (`Nav.astro`):** Funnel Display, weight 400, `0.95rem`, natural case (was Manrope `0.8rem` uppercase, `0.12em` tracked). Color `--foreground-soft` → `--accent-text` (Brick Ember) on hover, with accent-red `[ bracket ]` pseudo-elements that fade + slide in. Bracket space is reserved so siblings do not shift on hover.
- **Page-centered nav:** from `≥1024px` the link list is lifted out of the `justify-between` flow and absolutely centered to the page (`left:50%` + translate); below that it stays inline (no room beside the toggle).
- **Footer links (`Footer.astro`):** Funnel Display 400 to match the nav, but **no brackets**, the bracket hover is a nav-only signature so the footer reads as the quieter surface.
- **Language toggle (`LangToggle.astro`):** active pill now fills with **Secondary** (Midnight Violet `bg-secondary`), not raw `--foreground` ink, matching the brand's dedicated dark surface (ink is for text / rules / the stamp; Secondary is for dark fills).
- **CTA band headline (`CtaBand.astro`):** the signature word (`frontera` / `frontier`) is wrapped in Funnel-italic accent via build-time `set:html` on the trusted i18n string (no client JS), plus a short Brick Ember **marker rule** above the headline (the brand tick, scaled up). On the dark band `--accent-text` resolves to amber, so the word reads amber there.

---

## 8. Imagery

**Style:** Editorial scientific-engraving illustration. Flat, line-driven, diagrammatic. One distinct engraving per project.

**Recurring motifs:** orbital rings, node / network graphs, ECG / sine waveforms, molecular diagrams, constellation dots, organs-as-icons inside circular badges.

**Palette in imagery:** pale Ghost-White / Lavender ground · Ink-navy linework · Amber / orange as the dominant fill · faint ghosted background "data" motifs · occasional muted violet accent dots.

**Hard constraint:** medical imagery stays instrumental / diagrammatic (instruments, gauges, organ icons, reference diagrams). No rendered human bodies or anatomical figures (the gpt-image-1 safety filter rejects them).

**Known palette gap (to fix on regeneration):**

- Orange currently skews golden / over-saturated, with internal glow-gradients, vs. the flat brand `#FF9900`.
- Brick Ember red (`#C11816`) is almost entirely absent from imagery, though it is the brand accent.
- Midnight Violet / Lavender appears only as tiny dots, underused.
- Fix: anchor fills to exact flat `#FF9900` (no internal gradient), introduce Brick Ember as a deliberate secondary accent (one or two elements per image), and use Midnight Violet / Lavender for the ghosted background motifs. Enforce in the `scripts/gen-*.mjs` prompts.

---

## Appendix: pending site-copy changes (not yet applied)

The live copy in `src/i18n/ui.ts` still reflects the older "healthcare and education, SMB secondary" framing. To match Section 1:

- Promote Business/SMB from third-mention to a co-equal vertical (hero, `audiences`, `features`).
- Reframe education around the DevRel agent as proof (education currently has no concrete proof point on the page).
- Add the Frutero sister-brand line to the About section.
- Reconsider the hero line ("We accelerate healthcare and education") to carry all three verticals.
- Logo lockup: the wordmark is two fixed dark inks ("Pokta" `#0E092A`, "Labs" `#C11816`) in `Nav.astro`, `Footer.astro`, and `gen-og.mjs`. Both read low-contrast on a dark band. All current surfaces are light, so no fix is needed now; if the lockup ever lands on a dark band, add a dark variant ("Pokta" to `#EFEBFA`/`#F8F8F8`, "Labs" to `#FF9900`). See Section 2 caveat.
