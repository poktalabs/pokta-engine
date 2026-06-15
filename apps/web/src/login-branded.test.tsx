import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  capturedRequests,
  installMockFetch,
  privyMockSpies,
  setPrivyState,
} from '@/test'
import { brandForPath, LoginScreen } from '@/components/auth/LoginScreen'

/**
 * BRANDED LOGIN ★ (tenant-invites Wave 2, plan §5 D3 — UX ONLY).
 *
 * `LoginScreen` is rendered by `AuthGate` PRE-router (above TenantProvider/the
 * router), so the branded variant is selected from `window.location.pathname`,
 * NOT a route param. `/mi-pase` (and its sub-paths) renders Mi-Pase-specific copy;
 * every other path renders the generic workspace copy (the PoktaEngine product
 * lockup is shown above either). The SAME `usePrivy().login()` CTA fires
 * regardless of path.
 *
 * The load-bearing invariant: this is PURELY COSMETIC. The login screen feeds
 * NOTHING into the claim/auth flow — it issues no network request (no
 * `/v1/tenants/me`, no `/v1/tenants/claim`), surfaces no tenant hint, and sets no
 * TenantProvider state. It is rendered with the REAL Privy mock so the login CTA
 * binds to the shared `login` spy; `installMockFetch()` lets us assert that the
 * fetch stub captured ZERO requests (no claim / no tenant call leaks from login).
 *
 * Mounted standalone (no provider tree) on purpose: in production the login
 * screen renders BEFORE Query/Tenant/router mount. Unit-testing `brandForPath`
 * directly covers the pure selector.
 */

// Privy cannot boot in jsdom — swap in the shared controllable mock so the CTA
// binds to `privyMockSpies.login`.
vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

beforeEach(() => {
  // Install the live-path fetch stub so any stray network call from the login
  // screen would be CAPTURED (or throw on an unregistered live path) — proving
  // the screen is inert. Pre-auth there is no session yet.
  installMockFetch()
  setPrivyState({ ready: true, authenticated: false, token: null })
})

describe('BRANDED LOGIN ★ — brandForPath pure selector (UX only)', () => {
  it('maps /mi-pase (and sub-paths) to Mi-Pase copy; everything else to generic workspace copy', () => {
    // Exact /mi-pase → full Mi Pase brand object.
    expect(brandForPath('/mi-pase')).toEqual({
      heading: 'Sign in to Mi Pase',
      subcopy: 'Access your Mi Pase workspace. Sign in with your authorized email.',
    })
    // Sub-paths of /mi-pase still resolve the Mi Pase brand.
    expect(brandForPath('/mi-pase/approvals').heading).toBe('Sign in to Mi Pase')
    expect(brandForPath('/mi-pase/runs/abc').heading).toBe('Sign in to Mi Pase')

    // Generic paths → the generic workspace copy.
    expect(brandForPath('/').heading).toBe('Sign in to your workspace')
    expect(brandForPath('/vino').heading).toBe('Sign in to your workspace')
    expect(brandForPath('/mi-pase-other').heading).toBe('Sign in to your workspace')
  })

  it('does NOT prefix-false-positive: /mi-pase-other is the generic brand, not Mi Pase', () => {
    // The selector must distinguish the exact segment `/mi-pase` (and `/mi-pase/…`)
    // from an unrelated path that merely starts with the same characters.
    const brand = brandForPath('/mi-pase-other')
    expect(brand.heading).toBe('Sign in to your workspace')
    expect(brand.heading).not.toBe('Sign in to Mi Pase')
  })
})

describe('BRANDED LOGIN ★ — /mi-pase pre-auth renders Mi-Pase copy', () => {
  it('renders Mi-Pase-branded heading + subcopy when the path is /mi-pase', () => {
    window.history.replaceState(null, '', '/mi-pase')
    render(<LoginScreen />)

    expect(screen.getByRole('heading', { name: 'Sign in to Mi Pase' })).toBeInTheDocument()
    expect(screen.getByText(/access your mi pase workspace/i)).toBeInTheDocument()
    // The generic workspace heading must NOT also be present.
    expect(screen.queryByRole('heading', { name: 'Sign in to your workspace' })).not.toBeInTheDocument()
  })

  it('renders the Mi-Pase brand on a /mi-pase sub-path too (deep-link entry)', () => {
    window.history.replaceState(null, '', '/mi-pase/approvals')
    render(<LoginScreen />)

    expect(screen.getByRole('heading', { name: 'Sign in to Mi Pase' })).toBeInTheDocument()
  })
})

describe('BRANDED LOGIN ★ — generic workspace copy on every other path', () => {
  it('renders the default generic workspace copy on the root path', () => {
    window.history.replaceState(null, '', '/')
    render(<LoginScreen />)

    expect(screen.getByRole('heading', { name: 'Sign in to your workspace' })).toBeInTheDocument()
    // No Mi-Pase branding bleeds through onto the generic surface.
    expect(screen.queryByRole('heading', { name: 'Sign in to Mi Pase' })).not.toBeInTheDocument()
  })

  it('renders the default generic copy on an unrelated tenant-shaped path (/vino)', () => {
    window.history.replaceState(null, '', '/vino')
    render(<LoginScreen />)

    expect(screen.getByRole('heading', { name: 'Sign in to your workspace' })).toBeInTheDocument()
  })
})

describe('BRANDED LOGIN ★ — the CTA calls usePrivy().login() on every path', () => {
  it('clicking "Sign in" invokes login() on the branded /mi-pase screen', async () => {
    window.history.replaceState(null, '', '/mi-pase')
    const user = userEvent.setup()
    render(<LoginScreen />)

    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(privyMockSpies.login).toHaveBeenCalledTimes(1)
    // No argument is threaded through — the CTA is identical regardless of brand.
    expect(privyMockSpies.login).toHaveBeenCalledWith()
  })

  it('clicking "Sign in" invokes login() on the generic screen too (same CTA)', async () => {
    window.history.replaceState(null, '', '/')
    const user = userEvent.setup()
    render(<LoginScreen />)

    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(privyMockSpies.login).toHaveBeenCalledTimes(1)
    expect(privyMockSpies.login).toHaveBeenCalledWith()
  })
})

describe('BRANDED LOGIN ★ — purely cosmetic: no tenant hint / no claim / no network', () => {
  it('the branded /mi-pase login issues ZERO network requests (no /me, no claim)', async () => {
    window.history.replaceState(null, '', '/mi-pase')
    const user = userEvent.setup()
    render(<LoginScreen />)

    // Even after the user clicks the CTA, the login screen itself fires no fetch —
    // login() hands off to Privy's hosted modal; the claim/tenant flow only begins
    // AFTER auth flips and TenantProvider mounts (a different layer entirely).
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    // The fetch stub captured nothing — no /v1/tenants/me, no /v1/tenants/claim.
    expect(capturedRequests).toHaveLength(0)
    const claimCalls = capturedRequests.filter(
      (r) => r.path.split('?')[0] === '/v1/tenants/claim',
    )
    expect(claimCalls).toHaveLength(0)
  })

  it('the generic login likewise issues ZERO network requests', async () => {
    window.history.replaceState(null, '', '/')
    const user = userEvent.setup()
    render(<LoginScreen />)

    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(capturedRequests).toHaveLength(0)
  })
})
