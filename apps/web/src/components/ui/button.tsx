import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Brand button — the hard-offset ink "stamp" (neo-brutalist signature).
 *
 * The stamp mechanics (1.5px solid ink border, box-shadow `4px→6px→0`, the
 * `prefers-reduced-motion` guard) live in `tokens.css` under `.btn` so the
 * affordance is shared across React + the marketing pages. This CVA layers the
 * Funnel Display face, fill variants and sizes ON TOP of `.btn`.
 *
 *   - primary     → amber fill / dark text (the one CTA per decision point)
 *   - secondary   → outline, Midnight Violet
 *   - destructive → brick-ember stamp + tint (Reject etc., used rarely)
 *   - ghost       → no stamp; low-commitment inline action
 */
export const buttonVariants = cva(
  // base: every variant rides the `.btn` stamp + Funnel face. `font-funnel`
  // resolves via the @theme inline mapping in index.css.
  'btn inline-flex items-center justify-center gap-2 font-funnel font-medium ' +
    'select-none whitespace-nowrap disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--primary)] text-[var(--primary-foreground)]',
        secondary:
          'bg-[var(--surface)] text-[var(--color-secondary)] ' +
          'border-[var(--color-secondary)]',
        // Destructive overrides the ink stamp with a brick-ember stamp + tint.
        destructive:
          'bg-[var(--status-fail-bg)] text-[var(--status-fail)] ' +
          'border-[var(--status-fail)] ' +
          '[box-shadow:4px_4px_0_0_var(--color-accent)] ' +
          'hover:[box-shadow:6px_6px_0_0_var(--color-accent)] ' +
          'active:[box-shadow:0_0_0_0_var(--color-accent)]',
        // Ghost drops the stamp entirely (no border / no shadow / no lift).
        ghost:
          'border-transparent bg-transparent text-[var(--foreground)] shadow-none ' +
          'hover:bg-[var(--surface-2)] hover:translate-x-0 hover:translate-y-0 ' +
          'hover:shadow-none active:translate-x-0 active:translate-y-0',
      },
      size: {
        sm: 'px-5 py-2.5 text-sm',
        default: 'px-6 py-3.5 text-sm',
        lg: 'px-7 py-4 text-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as the child element (Radix Slot) instead of a `<button>`. */
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        // Default native buttons to type="button" so they don't accidentally submit.
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
