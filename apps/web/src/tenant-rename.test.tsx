import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import {
  installMockFetch,
  mockLivePath,
  renderWithProviders,
  setPrivyState,
} from '@/test'
import type { TenantView } from '@pokta-engine/contract'
import {
  DEFAULT_TENANT,
  isTenantId,
  type TenantId,
} from '@/providers/TenantProvider'
import { AppShell } from '@/components/shell/AppShell'
import { resolveMock } from '@/mocks/registry'
// Side-effect import: registers every per-surface fixture with the registry, so a
// reachable page that goes through apiFetch → resolveMock has its handler present.
import '@/mocks'

/**
 * RENAME (PR2b W6, plan §3.8 / §6 RENAME) — the canonical tenant id is `mi-pase`.
 * The locked rename `mipase → mi-pase` must hold across the tenant CONFIG and the
 * ROUTE segment (NOT the workflow-domain namespace `mipase.daily-pricing`, which is
 * the engine's workflow id and is intentionally untouched). Coverage:
 *
 *   1. tenant config uses `mi-pase`; hyphenless `mipase` is NOT a valid tenant id;
 *   2. no hyphenless `mipase` survives as a TENANT id in the route/config code paths
 *      (a static scan of TenantProvider + App route config);
 *   3. a stale `/mipase/*` deep link redirects to the server tenant (or 404s cleanly);
 *   4. every reachable page resolves under mock mode (fixtures wired in mocks/index.ts).
 */

vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

const HERE = dirname(fileURLToPath(import.meta.url))

const MI_PASE_VIEW: TenantView = {
  id: 'mi-pase',
  name: 'Mi Pase',
  status: 'active',
  currency: 'MXN',
  locale: 'es-MX',
  branding: { name: 'Mi Pase', badge: 'Shopify test store' },
  allowedWorkflows: ['pricing-draft'],
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'test-privy-jwt' })
})

describe('RENAME — tenant config uses mi-pase, never hyphenless mipase', () => {
  it('DEFAULT_TENANT is the canonical hyphenated id', () => {
    expect(DEFAULT_TENANT).toBe('mi-pase')
    expect(DEFAULT_TENANT).not.toBe('mipase')
  })

  it('isTenantId accepts mi-pase and rejects the stale hyphenless mipase', () => {
    expect(isTenantId('mi-pase')).toBe(true)
    expect(isTenantId('vino')).toBe(true)
    // The pre-rename id must no longer be a recognized tenant.
    expect(isTenantId('mipase')).toBe(false)
    expect(isTenantId(undefined)).toBe(false)
  })

  it('the TenantId type admits mi-pase (compile-time guard, asserted at runtime)', () => {
    const id: TenantId = 'mi-pase'
    expect(id).toBe('mi-pase')
  })
})

describe('RENAME — no hyphenless mipase tenant id in route/config code paths', () => {
  // Static scan: the rename targets per plan §1 are the TENANT id in config + routes.
  // We assert the hyphenless `mipase` does not appear as a tenant-id literal there.
  // The workflow-domain namespace (`mipase.daily-pricing`) is the ENGINE's workflow
  // id (shared with the backend) and is explicitly out of scope, so we scan only the
  // tenant-identity source, not the demo fixtures.
  it('TenantProvider.tsx has no hyphenless mipase tenant-id literal', () => {
    const src = readFileSync(resolve(HERE, 'providers/TenantProvider.tsx'), 'utf8')
    // A bare 'mipase' quoted literal (no hyphen, not followed by `.` workflow domain).
    expect(src).not.toMatch(/['"]mipase['"]/)
    // The canonical id IS present.
    expect(src).toContain("'mi-pase'")
  })

  it('App.tsx route config has no hyphenless /mipase segment', () => {
    const src = readFileSync(resolve(HERE, 'App.tsx'), 'utf8')
    expect(src).not.toMatch(/\/mipase(\b|\/)/)
    expect(src).not.toMatch(/['"]mipase['"]/)
  })
})

/** Surface the current path so a redirect is observable in the test. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="pathname">{loc.pathname}</div>
}

describe('RENAME — stale /mipase/* deep link resolves cleanly (redirect to server tenant)', () => {
  it('redirects /mipase/approvals to the server tenant /mi-pase/approvals', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })

    renderWithProviders(<div />, {
      wrapInner: () => (
        <MemoryRouter initialEntries={['/mipase/approvals']}>
          <LocationProbe />
          <Routes>
            <Route path="/:tenant" element={<AppShell />}>
              <Route path="approvals" element={<div>approvals page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      ),
    })

    // The router-level guard (AppShell) sees the segment `mipase` disagree with the
    // server tenant `mi-pase` and redirects — a stale deep link never surfaces a
    // different tenant, and never dead-ends.
    await waitFor(() => {
      expect(screen.getByTestId('pathname').textContent).toBe('/mi-pase/approvals')
    })
    expect(await screen.findByText('approvals page')).toBeInTheDocument()
  })
})

describe('RENAME — every reachable page resolves under mock mode (fixtures wired)', () => {
  // The surfaces that flow through apiFetch → resolveMock (integrations/reports/
  // approvals). After importing `@/mocks` (W6 wired the barrel), each must resolve
  // rather than throw `[mocks] no fixture registered`.
  const liveMockPaths = [
    '/v1/approvals',
    '/v1/approvals?tenant=mi-pase',
    '/v1/integrations',
    '/v1/integrations?tenant=mi-pase',
    '/v1/reports',
    '/v1/reports?tenant=mi-pase',
    '/v1/reports/rpt_mipase_pricing_impact_20260608',
  ]

  it.each(liveMockPaths)('resolves the mock fixture for GET %s', async (path) => {
    await expect(resolveMock(path, { method: 'GET' })).resolves.toBeDefined()
  })

  it('the mock barrel wires more than just approvals (runs/workflows/integrations/reports/settings)', () => {
    // W6 acceptance: mocks/index.ts imports every surface, not only ./approvals.
    const src = readFileSync(resolve(HERE, 'mocks/index.ts'), 'utf8')
    for (const surface of ['./approvals', './integrations', './reports', './runs', './workflows', './settings']) {
      expect(src).toContain(`import '${surface}'`)
    }
  })
})
