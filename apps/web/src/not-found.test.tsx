import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import NotFound from '@/pages/NotFound'
import { DEFAULT_TENANT } from '@/providers/TenantProvider'

/**
 * NotFound CTA hygiene (PR2b harden) — §3.2 "derive tenant from the server". The
 * 404 "Go to workspace" CTA must NOT navigate to a static `/${DEFAULT_TENANT}/…`
 * URL (a client-side default driving a tenant URL). It navigates to the ROOT, and
 * RootRedirect (App.tsx) derives the real landing URL from `/v1/tenants/me`. The
 * AppShell gate already neutralizes a wrong segment for security; this closes the
 * residual cosmetic "static default in a nav target" inconsistency.
 */

/** Renders the current pathname so the test can assert where navigation landed. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="pathname">{loc.pathname}</div>
}

describe('NotFound CTA — derives tenant from server, no static default in URL', () => {
  it('navigates to "/" (server-derived), not to a hardcoded /:tenant/approvals', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/does-not-exist']}>
        <LocationProbe />
        <Routes>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: /go to workspace/i }))

    const pathname = screen.getByTestId('pathname').textContent
    expect(pathname).toBe('/')
    // Regression guard: it must NOT route to the static default-tenant URL that the
    // pre-harden CTA used. The server (RootRedirect) decides the tenant, not the SPA.
    expect(pathname).not.toBe(`/${DEFAULT_TENANT}/approvals`)
    expect(pathname).not.toContain(DEFAULT_TENANT)
  })
})
