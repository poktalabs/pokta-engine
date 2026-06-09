import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Loading state — a quiet, reduced-motion-aware spinner with optional label.
 * The spin animation is dropped under `prefers-reduced-motion: reduce`.
 */
export interface LoadingStateProps {
  label?: string
  className?: string
}

export function LoadingState({ label = 'Loading…', className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      <Loader2
        className="size-6 text-[var(--muted-foreground)] motion-safe:animate-spin"
        aria-hidden="true"
      />
      <span className="text-sm text-[var(--muted-foreground)]">{label}</span>
    </div>
  )
}
