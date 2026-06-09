/**
 * String catalogs (P7 infra).
 *
 * English is the PRIMARY catalog and the type source — `content-es` must satisfy
 * the same shape (`Catalog = typeof en`). This is a lightweight string-catalog,
 * NOT react-i18next: keys are namespaced by surface (`shell.*`, `approvals.*`)
 * and resolved by dotted path through `useT()`.
 *
 * This is an INFRA stub, not a full string sweep. It carries the shell strings
 * (the wired proof surface) plus a couple of representative surface namespaces so
 * the type + lookup machinery is exercised. Per-surface sweeps land later (P7-C)
 * gated on each surface's component-lane DoD.
 */

export type Locale = 'en' | 'es-MX'

export const LOCALES: Locale[] = ['en', 'es-MX']

export const DEFAULT_LOCALE: Locale = 'en'

/** EN is the primary catalog and the source of the `Catalog` type. */
export const en = {
  shell: {
    nav: {
      workflows: 'Workflows',
      approvals: 'Approvals',
      integrations: 'Integrations',
      reports: 'Reports',
      settings: 'Settings',
    },
    user: {
      operator: 'Operator',
      signedInAs: 'Signed in as',
      signOut: 'Sign out',
    },
    locale: {
      label: 'Language',
    },
  },
  approvals: {
    title: 'Approvals',
    empty: 'No pending approvals.',
  },
  common: {
    retry: 'Retry',
    loading: 'Loading…',
    cancel: 'Cancel',
  },
} as const

/**
 * The shape every locale catalog must satisfy. `en` is `as const`, so its raw
 * type is the literal EN strings — we deep-widen every leaf to `string` so other
 * locales can supply different copy while keeping the exact key structure.
 */
type Widen<T> = {
  [K in keyof T]: T[K] extends string ? string : Widen<T[K]>
}
export type Catalog = Widen<typeof en>

/**
 * ES-MX catalog STUB. Specialized domain copy (pricing/margin/approval) is NOT
 * mechanical translation (P7-D: Spanish-native review per surface) — these are
 * placeholder strings to exercise the toggle, not reviewed product copy.
 */
export const esMX: Catalog = {
  shell: {
    nav: {
      workflows: 'Flujos',
      approvals: 'Aprobaciones',
      integrations: 'Integraciones',
      reports: 'Reportes',
      settings: 'Ajustes',
    },
    user: {
      operator: 'Operador',
      signedInAs: 'Sesión iniciada como',
      signOut: 'Cerrar sesión',
    },
    locale: {
      label: 'Idioma',
    },
  },
  approvals: {
    title: 'Aprobaciones',
    empty: 'No hay aprobaciones pendientes.',
  },
  common: {
    retry: 'Reintentar',
    loading: 'Cargando…',
    cancel: 'Cancelar',
  },
}

export const CATALOGS: Record<Locale, Catalog> = {
  en,
  'es-MX': esMX,
}
