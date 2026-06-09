import { cn } from '@/lib/utils'
import { useLocale, useT, type Locale } from '@/i18n'

/**
 * EN / ES-MX segmented locale control (P1, wired in P7).
 *
 * Visual treatment from the landing page `LangToggle`: sharp, hairline-bordered,
 * active locale FILLED with Secondary (Midnight Violet) + light text. A11y:
 * `role="radiogroup"` with `role="radio"` + `aria-checked` options (M2 a11y DoD).
 *
 * Wired (P7): reads/writes the real active locale via the `@/i18n` `LocaleProvider`
 * (localStorage-persisted). `value`/`onChange` remain available for controlled use.
 */

const OPTIONS: { value: Locale; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'es-MX', label: 'ES' },
]

export interface LocaleToggleProps {
  value?: Locale
  onChange?: (next: Locale) => void
  className?: string
}

export function LocaleToggle({ value, onChange, className }: LocaleToggleProps) {
  const { locale, setLocale } = useLocale()
  const t = useT()
  const active = value ?? locale

  const select = (next: Locale) => {
    if (onChange) onChange(next)
    else setLocale(next)
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('shell.locale.label')}
      className={cn('inline-flex items-center border border-[var(--rule)]', className)}
    >
      {OPTIONS.map((loc, i) => {
        const isActive = loc.value === active
        return (
          <button
            key={loc.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => select(loc.value)}
            className={cn(
              'cursor-pointer select-none px-2.5 py-1.5 text-xs font-semibold tracking-[0.08em] transition-colors',
              i > 0 && 'border-l border-[var(--rule)]',
              isActive
                ? 'bg-secondary text-[var(--color-white-soft)]'
                : 'text-[var(--foreground-soft)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]',
            )}
          >
            {loc.label}
          </button>
        )
      })}
    </div>
  )
}
