import { NavLink } from 'react-router-dom'
import {
  Workflow,
  CheckSquare,
  Plug,
  FileBarChart,
  Settings as SettingsIcon,
  type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import { useTenant } from '@/providers/TenantProvider'
import { useT } from '@/i18n'

/**
 * Left nav (P1). Tenant-scoped routes (`/:tenant/...`); active link gets the
 * Lavender surface-2 fill + a brick-ember leading rule. Approvals carries a
 * pending-count badge (P2 drives the real count; 0 hides it).
 *
 * Settings is built in P4-C (read-only for M2) — it is NOT a dead link.
 */
interface NavItem {
  to: string
  label: string
  Icon: ComponentType<LucideProps>
  /** Pending count badge (Approvals only). */
  badge?: number
}

export interface SidebarProps {
  /** Pending-approval count, drives the Approvals badge. */
  pendingApprovals?: number
}

export function Sidebar({ pendingApprovals = 0 }: SidebarProps) {
  const tenant = useTenant()
  const t = useT()
  const base = `/${tenant.id}`

  const items: NavItem[] = [
    { to: `${base}/workflows`, label: t('shell.nav.workflows'), Icon: Workflow },
    {
      to: `${base}/approvals`,
      label: t('shell.nav.approvals'),
      Icon: CheckSquare,
      badge: pendingApprovals,
    },
    { to: `${base}/integrations`, label: t('shell.nav.integrations'), Icon: Plug },
    { to: `${base}/reports`, label: t('shell.nav.reports'), Icon: FileBarChart },
    { to: `${base}/settings`, label: t('shell.nav.settings'), Icon: SettingsIcon },
  ]

  return (
    <nav
      aria-label="Primary"
      className="flex w-56 shrink-0 flex-col gap-1 border-r border-[var(--rule)] bg-[var(--surface)] p-3"
    >
      {items.map(({ to, label, Icon, badge }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'group flex items-center gap-3 border-l-2 px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-l-[var(--accent-text)] bg-[var(--surface-2)] text-[var(--foreground)]'
                : 'border-l-transparent text-[var(--foreground-soft)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]',
            )
          }
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{label}</span>
          {badge != null && badge > 0 && (
            <span
              className="border border-[var(--status-warn-line)] bg-[var(--status-warn-bg)] px-1.5 text-[11px] font-semibold text-[var(--status-warn)]"
              aria-label={`${badge} pending`}
            >
              {badge}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
