import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  CATALOGS,
  DEFAULT_LOCALE,
  LOCALES,
  type Catalog,
  type Locale,
} from './catalog'

/**
 * Lightweight i18n core (P7 infra).
 *
 * - `LocaleProvider` holds the active locale and persists it to localStorage.
 * - `useT()` returns a typed dotted-path resolver over the active catalog.
 * - English is the default/fallback; ES-MX is a catalog stub.
 *
 * NOT react-i18next: no namespaces-as-files, no interpolation library. Keys are
 * resolved by dotted path (`shell.nav.approvals`) against `Catalog`. The path
 * type is derived from the EN catalog so typos are compile errors.
 */

const STORAGE_KEY = 'godin-locale'

// ── Typed dotted-path keys derived from the EN catalog ──────────────────────
type Primitive = string

type DottedPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Primitive
    ? `${Prefix}${K}`
    : DottedPaths<T[K], `${Prefix}${K}.`>
}[keyof T & string]

/** A valid, autocompletable translation key, e.g. `"shell.nav.approvals"`. */
export type TKey = DottedPaths<Catalog>

function resolvePath(catalog: Catalog, key: string): string | undefined {
  // Walk the dotted path; tolerate missing intermediate nodes.
  let node: unknown = catalog
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as object)) {
      node = (node as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return typeof node === 'string' ? node : undefined
}

interface I18nContextValue {
  locale: Locale
  setLocale: (next: Locale) => void
  toggleLocale: () => void
  /** Resolve a key against the active locale, falling back to EN then the key. */
  t: (key: TKey) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored && (LOCALES as string[]).includes(stored) ? (stored as Locale) : null
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode
  /** Override the starting locale (tests / tenant default seeding). */
  initialLocale?: Locale
}) {
  const [locale, setLocaleState] = useState<Locale>(
    () => readStoredLocale() ?? initialLocale ?? DEFAULT_LOCALE,
  )

  // Reflect the active locale on <html lang> for a11y / browser behavior.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
    }
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next)
    }
  }, [])

  const toggleLocale = useCallback(() => {
    setLocaleState((cur) => {
      const next: Locale = cur === 'en' ? 'es-MX' : 'en'
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, next)
      }
      return next
    })
  }, [])

  const t = useCallback(
    (key: TKey): string =>
      resolvePath(CATALOGS[locale], key) ??
      resolvePath(CATALOGS[DEFAULT_LOCALE], key) ??
      key,
    [locale],
  )

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, toggleLocale, t }),
    [locale, setLocale, toggleLocale, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('i18n hooks must be used within <LocaleProvider>')
  return ctx
}

/** Active locale + setters. */
export function useLocale() {
  const { locale, setLocale, toggleLocale } = useI18n()
  return { locale, setLocale, toggleLocale }
}

/** The translation resolver. `const t = useT(); t('shell.nav.approvals')`. */
export function useT(): (key: TKey) => string {
  return useI18n().t
}
