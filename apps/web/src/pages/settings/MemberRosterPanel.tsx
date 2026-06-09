import { Users } from 'lucide-react'
import { ComingSoon } from '@/components/ui/ComingSoon'

/**
 * Team roster panel — DEFERRED (P5b Wave 2).
 *
 * There is no member-roster read model yet (the engine resolves the human only as
 * an opaque Privy DID from the JWT — NOT an email/name we may render). Rather than
 * fabricate a roster or render DIDs-as-emails, this panel keeps its SHELL and says
 * member management is coming. No fabricated rows.
 */
export function MemberRosterPanel() {
  return (
    <section aria-labelledby="settings-roster-heading" className="space-y-4">
      <h2
        id="settings-roster-heading"
        className="font-serif text-xl leading-tight text-[var(--foreground)]"
      >
        Team
      </h2>
      <ComingSoon
        Icon={Users}
        title="Team management coming soon"
        description="Inviting teammates and managing roles isn’t available yet. Your workspace access is governed by your sign-in for now."
      />
    </section>
  )
}
