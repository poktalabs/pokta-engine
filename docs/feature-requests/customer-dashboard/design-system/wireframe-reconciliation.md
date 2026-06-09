# Wireframe → Pokta Labs brand reconciliation

Audit of `docs/design/Godin-Engine-Workspace-Screens.html` (Claude Design hi-fi export,
2026-06-08) against the imported design system. Reviewed via headless render of all key
screens + states (Workflows shell, Daily Pricing idle/empty/running, Run detail, Flagged
price review hero).

## Verdict

**Structure, IA, state coverage, and copy are excellent — ship the structure.** Brand
application is ~80% there with a tight, consistent, mechanical set of gaps. The wireframe
already uses the right tokens (`var(--font-serif)`, `var(--color-primary)`), the right hexes
(#FF9900 / #0E092A / #C11816 / #F4F2F9), the "Godin Engine by Pokta Labs" lockup, the EN/ES-MX
toggle, the Mi Pase tenant header + "Shopify test store" badge, the amber-gate pipeline, and
the exactly-correct flag reasons (cost-unknown / below-15%-floor anomaly). Light base — locked.

| Dimension | Score |
|---|---|
| Information architecture / hierarchy | 9/10 |
| State coverage | 9/10 |
| Copy & domain accuracy | 10/10 |
| Brand color usage | 7/10 |
| Brand shape (radius) | 5/10 |
| Brand elevation (shadows) | 4/10 |
| Typography | 9/10 |

## Decisions (locked this session)

- **Light base** — confirmed by the wireframe; the workspace is built on the light Ghost-White
  brand base (dark is reserved for deliberate bands only). No dark-theme work now.
- **Status palette** (Mel, 2026-06-08): OK/applied/approved/live = **#19A662** (new brand-tuned
  green, the one added color), warn/needs-review = **brand amber #FF9900**, fail/rejected/risk =
  **brick-ember #C11816**. Codified in `status-tokens.css`. Always icon + label, never color alone.

## The fixes (priority order)

1. **[P0] Button hard-offset stamp is missing.** Amber buttons render flat/soft-shadowed. Brand
   `.btn` = Funnel face + **1.5px solid ink border** + **`4px 4px 0 0 ink`** rest shadow → hover
   `translate(-2px,-2px)` + `6px 6px` → active `translate(2px,2px)` + `0 0`. This is THE brand
   signature; without it the buttons read generic. Use the `.btn` from `tokens.css` verbatim.
2. **[P0] Radius → 0.** Remove all `border-radius` (found 6–8px on buttons/pills/chips). Brand is
   sharp everywhere; status pills are sharp rectangles (see `status-tokens.css .pill`).
3. **[P1] Kill soft shadows.** Remove `box-shadow: 0 1px 4px rgba(0,0,0,…)`. Elevation is the
   hard-offset ink stamp only (buttons, pop-cards); structure otherwise carries on hairline rules.
4. **[P1] Status colors → status tokens.** Replace the wireframe's ad-hoc greens/reds (LIVE badge,
   APPLIED/FAILED pills, the green "248", red "rejected" counts) with `status-tokens.css` roles.
   Green is now #19A662 everywhere; failed = brick-ember; needs-review = amber.
5. **[P2] Greys → brand muted.** Replace `#999 / #666 / #8b8597` with `var(--muted-foreground)`
   (color-mix ink). Replace any `--color-spot-red` drift with `--color-accent` / `--spot`.
6. **[P2] Tables use the hairline-grid pattern.** The run-history and flagged tables should be the
   brand's hairline-grid (cells on `--surface`, 1px `--rule` gaps, square Brick-Ember ticks) — see
   `reference-components.md` §4. Mostly already close; align row separators to `--border` (15% ink).

## Copy-pasteable brand-fix override

Drop this AFTER `tokens.css` + `status-tokens.css` to correct the wireframe globally (or fold the
rules into the SPA's components as they're built). It neutralizes radius + soft shadows and restamps
buttons; status/greys still need the token swaps in fixes #4–#5.

```css
/* brand-fix.css — radius 0, kill soft shadows, restore the button stamp */
*, *::before, *::after { border-radius: 0 !important; }

/* nuke soft/blurred shadows; keep only deliberate hard-offset stamps */
[style*="box-shadow"], .card, .tile, .panel { box-shadow: none !important; }

/* re-stamp every button to the brand signature (matches tokens.css .btn) */
button, .btn, [role="button"] {
  font-family: var(--font-funnel);
  cursor: pointer;
  border: 1.5px solid var(--color-ink);
  box-shadow: 4px 4px 0 0 var(--color-ink);
  transition: transform .12s cubic-bezier(.2,.8,.2,1), box-shadow .12s cubic-bezier(.2,.8,.2,1);
}
button:hover, .btn:hover { transform: translate(-2px,-2px); box-shadow: 6px 6px 0 0 var(--color-ink); }
button:active, .btn:active { transform: translate(2px,2px); box-shadow: 0 0 0 0 var(--color-ink); }
header button, header .btn { box-shadow: 3px 3px 0 0 var(--color-ink); }   /* lighter in the bar */
@media (prefers-reduced-motion: reduce) {
  button, .btn { transition: box-shadow .12s ease; }
  button:hover, button:active, .btn:hover, .btn:active { transform: none; }
}

/* muted greys → brand muted */
[style*="#999"], [style*="#666"], [style*="#8b8597"] { color: var(--muted-foreground) !important; }
```

> Note: the `*{border-radius:0}` + button override is a blunt global pass for the standalone
> wireframe preview. In the real SPA, apply the same intent per-component (use `.btn` + the status
> classes directly) rather than `!important` sledgehammers.

## What did NOT need fixing (keep as-is)

- Lockup "Godin Engine by Pokta Labs", Mi Pase tenant header, "Shopify test store" badge.
- EN / ES-MX toggle (matches the brand segmented control).
- Pipeline-flow graphic with the amber Approval-gate node.
- Confident-set-as-done ("248 applied automatically · View all"); flag reasons; what/where/risk strip.
- Serif headings / Manrope body / Funnel labels; sharp stat tiles; hairline dividers.
- Real high-mix catalog data (iPhone 15 Pro, bidé Nuur, motos, colchones, perfumes), MXN, deltas, margin-floor callouts.
