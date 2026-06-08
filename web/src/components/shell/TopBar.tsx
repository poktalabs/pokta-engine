import { useState } from 'react'
import { ChevronDown, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TenantHeader } from '@/components/shell/TenantHeader'
import { LocaleToggle } from '@/components/shell/LocaleToggle'

/**
 * Sticky top bar (P1): co-branding lockup on the left, locale toggle + user menu
 * on the right. 68px bar to match the landing-page header proportions.
 *
 * The user menu is a lightweight disclosure for M2 (Privy wires real identity +
 * sign-out in P6); it shows a placeholder operator + a sign-out affordance.
 */
export function TopBar() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--rule)] bg-[var(--background)]">
      <div className="flex h-[68px] items-center justify-between gap-6 px-6">
        <TenantHeader />

        <div className="flex items-center gap-4">
          <LocaleToggle />

          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="flex cursor-pointer items-center gap-2 border border-[var(--rule)] bg-[var(--surface)] px-2.5 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-2)]"
            >
              <UserRound className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Operator</span>
              <ChevronDown
                className={cn('size-3.5 transition-transform', menuOpen && 'rotate-180')}
                aria-hidden="true"
              />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-48 border border-[var(--rule)] bg-[var(--surface)] shadow-[4px_4px_0_0_var(--color-ink)]"
              >
                <div className="border-b border-[var(--border)] px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
                  Signed in as
                  <div className="font-medium text-[var(--foreground)]">operator@tenant</div>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full cursor-pointer px-3 py-2.5 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--surface-2)]"
                  onClick={() => setMenuOpen(false)}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
