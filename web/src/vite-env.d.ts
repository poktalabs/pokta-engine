/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Route apiFetch to the in-process mock registry when `"true"`. */
  readonly VITE_USE_MOCKS?: string
  /** engine-api `/v1` base URL (baked at build via Dockerfile ARG in P8). */
  readonly VITE_API_URL?: string
  /** Privy app id — filled in P6. */
  readonly VITE_PRIVY_APP_ID?: string
  /** Sentry DSN — filled in P8. */
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
