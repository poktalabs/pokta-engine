import type { ComponentType } from 'react'
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Circle,
  type LucideProps,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Status pill — `.pill` / `.pill-{ok,warn,fail,idle}` from `status-tokens.css`.
 *
 * Brand rule: NEVER meaning by color alone. Every pill renders an icon AND a
 * text label; the icon carries an accessible name (`aria-label`) so screen
 * readers announce the status even if the visual label is ambiguous. 11px
 * all-caps. The leading square `.status-tick` is the brand's tick (never a dot).
 */
export type PillStatus = 'ok' | 'warn' | 'fail' | 'idle'

interface StatusMeta {
  pillClass: string
  tickClass: string
  Icon: ComponentType<LucideProps>
  /** Accessible name for the icon (e.g. "Status: approved"). */
  accessibleName: string
}

const STATUS_META: Record<PillStatus, StatusMeta> = {
  ok: {
    pillClass: 'pill-ok',
    tickClass: 'status-tick-ok',
    Icon: CheckCircle2,
    accessibleName: 'OK',
  },
  warn: {
    pillClass: 'pill-warn',
    tickClass: 'status-tick-warn',
    Icon: AlertTriangle,
    accessibleName: 'Needs review',
  },
  fail: {
    pillClass: 'pill-fail',
    tickClass: 'status-tick-fail',
    Icon: XCircle,
    accessibleName: 'Failed',
  },
  idle: {
    pillClass: 'pill-idle',
    // status-tokens.css only ships ok/warn/fail ticks; idle reuses the warn-less
    // muted color via inline currentColor.
    tickClass: '',
    Icon: Circle,
    accessibleName: 'Idle',
  },
}

export interface PillProps {
  status: PillStatus
  /** Visible label text (uppercased by CSS). */
  children: React.ReactNode
  /**
   * Override the icon's accessible name. Defaults to a sensible per-status name.
   * Use this to make the announcement domain-specific ("Applied", "Connected").
   */
  iconLabel?: string
  /** Show the leading square tick in addition to the icon. */
  showTick?: boolean
  className?: string
}

export function Pill({
  status,
  children,
  iconLabel,
  showTick = false,
  className,
}: PillProps) {
  const meta = STATUS_META[status]
  const { Icon } = meta
  return (
    <span className={cn('pill', meta.pillClass, className)}>
      {showTick && (
        <span
          aria-hidden="true"
          className={cn('status-tick', meta.tickClass)}
          style={meta.tickClass ? undefined : { background: 'currentColor' }}
        />
      )}
      <Icon
        className="size-3"
        aria-label={iconLabel ?? meta.accessibleName}
        role="img"
      />
      <span>{children}</span>
    </span>
  )
}
