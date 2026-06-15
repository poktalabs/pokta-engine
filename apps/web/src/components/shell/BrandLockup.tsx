import { cn } from '@/lib/utils'

/**
 * The product brand lockup: the Pokta Labs mark + "PoktaEngine" wordmark, the
 * single source of truth for the lockup so the navbar and the pre-router auth
 * screens (login / access-denied / workspace-load error) never drift apart.
 *
 * Mirrors the poktalabs-landing-page lockup — logo + gap-1 + the words set
 * together in Funnel Display, "Pokta" = secondary (Midnight Violet) and
 * "Engine" = accent (Brick Ember). `size` scales both the mark and the wordmark
 * together: 'sm' for the in-app top bar, 'lg' for the centered auth heroes.
 */
export interface BrandLockupProps {
  size?: 'sm' | 'lg'
  className?: string
}

const SIZES = {
  sm: { box: 20, text: 'text-2xl', mark: 'size-5' },
  lg: { box: 28, text: 'text-3xl', mark: 'size-7' },
} as const

export function BrandLockup({ size = 'sm', className }: BrandLockupProps) {
  const s = SIZES[size]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-funnel font-medium tracking-tight',
        s.text,
        className,
      )}
    >
      <img
        src="/logo/poktalabs-logo.svg"
        alt="Pokta Labs"
        width={s.box}
        height={s.box}
        className={cn(s.mark, 'shrink-0')}
      />
      <span>
        <span className="text-secondary">Pokta</span>
        <span className="text-accent">Engine</span>
      </span>
    </span>
  )
}
