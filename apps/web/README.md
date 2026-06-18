# @pokta-engine/web

The customer-delivery workspace SPA for godin-engine (M2). A tenant-agnostic,
governed agent-workflow console whose universal heart is the **Approvals queue**,
delivered single-tenant for **Mi Pase** but architected for **Vino Design Build**
as tenant #2.

- React 19 · Vite 6 · TypeScript (strict) · Tailwind v4 · TanStack Query v5 · React Router v7
- Shared API types come from `@pokta-engine/contract` (`workspace:*`, Bundler resolution — no `tsc -b`).
- **Mock-data-first:** with `VITE_USE_MOCKS=true` the app serves from an in-process
  mock registry and never touches the network.

## Run it

From the **repo root** (this is a pnpm workspace; run with `--filter`):

```bash
pnpm --filter @pokta-engine/web dev
```

Then open http://localhost:5173 — it redirects to `/mipase/approvals`.

`VITE_USE_MOCKS=true` is the **default for local dev** (see `web/.env` / `web/.env.example`),
so no engine-api is required to click through every screen. When mocks are off,
the Vite dev proxy forwards `/v1` → `http://localhost:8787` (local engine-api).

### Other scripts

```bash
pnpm --filter @pokta-engine/web typecheck   # tsc --noEmit (strict)
pnpm --filter @pokta-engine/web build       # tsc --noEmit && vite build
pnpm --filter @pokta-engine/web preview      # serve the production build locally
```

## Environment

Copy `.env.example` → `.env` and adjust. All vars are Vite build-time (`VITE_*`):

| Var | Purpose | Local default |
|---|---|---|
| `VITE_USE_MOCKS` | Serve from the in-process mock registry instead of `/v1` | `true` |
| `VITE_API_URL` | Engine API base (ignored when mocks are on) | empty (proxy) |
| `VITE_PRIVY_APP_ID` | Privy auth (P6) | empty |
| `VITE_SENTRY_DSN` | Sentry error reporting (P8) | empty |

## Screens (mock-data)

Routes are tenant-scoped under `/:tenant` (M2 defaults to `mipase`):

- `/:tenant/approvals` — Approvals queue (the heart). Mi Pase batch pricing
  renderer (virtualized) + Vino single-action renderer, selected by `artifactKind`.
- `/:tenant/workflows` — Workflows list (full state matrix).
- `/:tenant/workflows/:id` — Daily Pricing worked detail (pipeline + schedule editor).
- `/:tenant/runs/:id` — Run detail (stat tiles, auto-applied collapse, partial-failure).
- `/:tenant/integrations` — Per-tenant integration grid.
- `/:tenant/reports` + `/:tenant/reports/:id` — Reports index + detail.
- `/:tenant/settings` — Tenant profile, integration status, member roster (read-only for M2).

## Design system

Source of truth lives in
`docs/feature-requests/customer-dashboard/design-system/`. The brand shape DNA is
enforced in `src/styles/` (radius 0, hard-offset button stamp, square status ticks,
3-tier risk reusing existing tokens, Source Serif / Manrope / Funnel self-hosted via
Fontsource).

## i18n (P7)

Lightweight string-catalog (NOT react-i18next), in `src/i18n/`:

- `LocaleProvider` — active locale, `localStorage` persistence (`godin-locale`), `<html lang>` sync.
- `useT()` — typed dotted-path resolver (`t('shell.nav.approvals')`); EN fallback.
- `useCurrency()` — `getFormattedPrice` via `Intl.NumberFormat`; **currency derives
  from the tenant** (Mi Pase → MXN, Vino → USD), locale from user pref.
- EN is the primary/default catalog and the type source; ES-MX is a catalog stub
  (domain copy gets a Spanish-native review per surface in P7-D).

The shell (top bar + sidebar nav + `LocaleToggle`) is wired as the proof surface;
the full per-surface string sweep lands later, gated per surface.
