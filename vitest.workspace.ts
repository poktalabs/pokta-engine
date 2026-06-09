import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineWorkspace } from 'vitest/config'

/**
 * Root vitest workspace (PR2b W0). Splits the suite into two projects so the SPA
 * (React/jsdom) tests and the backend (node) tests run under the right
 * environment from a single `pnpm test` at the repo root:
 *
 *   - `node` — every existing backend `*.test.ts` (engine-api, worker, packages,
 *     integrations). EXCLUDES `apps/web/**` so a SPA test never runs in node, and
 *     keeps the prior `vitest.config.ts` semantics (environment 'node', the same
 *     include/exclude globs). The worker `pricing-chain.integration.test.ts` still
 *     SKIPS its body without dev Postgres — that is expected/green.
 *   - `web`  — the SPA unit/component tests in `apps/web/**` under jsdom, with the
 *     React plugin + the `@/*` alias + a setup file (jest-dom matchers + a
 *     mock-registry reset between tests).
 *
 * The two projects are environment-isolated: the jsdom project never flips a
 * backend test's environment, and the node project excludes apps/web.
 */
export default defineWorkspace([
  {
    // ── Backend (node) — preserves vitest.config.ts semantics ──────────────────
    test: {
      name: 'node',
      include: ['**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', 'apps/web/**'],
      environment: 'node',
    },
  },
  {
    // ── SPA (jsdom) — React component + unit tests ─────────────────────────────
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
      },
    },
    test: {
      name: 'web',
      root: fileURLToPath(new URL('./apps/web', import.meta.url)),
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['**/node_modules/**', '**/dist/**'],
      environment: 'jsdom',
      globals: true,
      setupFiles: [fileURLToPath(new URL('./apps/web/src/test/setup.ts', import.meta.url))],
    },
  },
])
