import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * EN / ES-MX segmented locale control (P1).
 *
 * Visual treatment from the landing page `LangToggle`: sharp, hairline-bordered,
 * active locale FILLED with Secondary (Midnight Violet) + light text. A11y:
 * `role="radiogroup"` with `role="radio"` + `aria-checked` options (M2 a11y DoD).
 *
 * P7 wires this to the real `useLanguage()` toggle + string catalogs. Until then
 * it holds local state so the control is interactive in the shell.
 */
export type Locale = 'en' | 'es-MX'

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'es-MX', label: 'ES' },
]

export interface LocaleToggleProps {
  value?: Locale
  onChange?: (next: Locale) => void
  className?: string
}

export function LocaleToggle({ value, onChange, className }: LocaleToggleProps) {
  // Uncontrolled fallback for P1 (P7 makes this controlled via LanguageProvider).
  const [internal, setInternal] = useState<Locale>('en')
  const active = value ?? internal

  const select = (next: Locale) => {
    if (onChange) onChange(next)
    else setInternal(next)
  }

  return (
    <div
      role="radiogroup"
      aria-label="Language"
      className={cn('inline-flex items-center border border-[var(--rule)]', className)}
    >
      {LOCALES.map((loc, i) => {
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
