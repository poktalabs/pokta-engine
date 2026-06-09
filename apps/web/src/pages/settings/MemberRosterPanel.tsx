import { Lock } from 'lucide-react'
import type { MemberRole, WorkspaceMember } from '@/mocks/settings'

/**
 * User roster — READ-ONLY (M2 P4-C). A hairline table of workspace members with
 * role + last-active. Member management (invite/remove/role change) is descoped
 * for M2; the panel states that explicitly with a quiet "coming soon" affordance
 * so there is never a dead write surface.
 */

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  approver: 'Approver',
  viewer: 'Viewer',
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function formatLastActive(iso: string | null): string {
  if (!iso) return 'Never signed in'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export interface MemberRosterPanelProps {
  members: WorkspaceMember[]
}

export function MemberRosterPanel({ members }: MemberRosterPanelProps) {
  return (
    <section aria-labelledby="settings-roster-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2
            id="settings-roster-heading"
            className="font-serif text-xl leading-tight text-[var(--foreground)]"
          >
            Team
          </h2>
          <p className="text-sm text-[var(--foreground-soft)]">
            {members.length} {members.length === 1 ? 'member' : 'members'} in this
            workspace.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
          <Lock className="size-3.5" aria-hidden="true" />
          Member management coming soon
        </span>
      </div>

      <div
        role="table"
        aria-label="Workspace members"
        className="border border-[var(--rule)] bg-[var(--surface)]"
      >
        <div
          role="row"
          className="grid grid-cols-[2fr_1fr_1fr] gap-4 border-b border-[var(--rule)] px-5 py-3"
        >
          <span role="columnheader" className="kicker text-[var(--foreground-soft)]">
            Member
          </span>
          <span role="columnheader" className="kicker text-[var(--foreground-soft)]">
            Role
          </span>
          <span role="columnheader" className="kicker text-[var(--foreground-soft)]">
            Last active
          </span>
        </div>

        <div className="divide-y divide-[var(--border)]">
          {members.map((member) => (
            <div
              key={member.id}
              role="row"
              className="grid grid-cols-[2fr_1fr_1fr] items-center gap-4 px-5 py-4"
            >
              <span role="cell" className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-9 place-items-center border border-[var(--rule)] bg-[var(--surface-2)] font-sans text-xs font-semibold text-[var(--foreground)]"
                >
                  {initials(member.name)}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-sans text-sm font-semibold text-[var(--foreground)]">
                    {member.name}
                  </span>
                  <span className="text-xs text-[var(--foreground-soft)]">
                    {member.email}
                  </span>
                </span>
              </span>
              <span
                role="cell"
                className="font-sans text-sm text-[var(--foreground)]"
              >
                {ROLE_LABEL[member.role]}
              </span>
              <span
                role="cell"
                className="font-sans text-sm text-[var(--foreground-soft)]"
              >
                {formatLastActive(member.lastActiveAt)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
