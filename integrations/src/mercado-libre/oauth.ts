/**
 * Mercado Libre OAuth — token refresh (fail-soft integration, D3).
 *
 * Ported from mi-pase/.../ml-oauth.ts. The ONE behavioural change vs the
 * original pipeline: credentials are passed IN by the caller (D2 — narrow the
 * secret blast radius). This module reads NO process.env. When the required
 * credentials are missing it THROWS 'not configured'; the workflow catches and
 * records an IntegrationResult (fail-soft) — this module never returns a
 * failure shape, it throws and lets the caller decide.
 */

const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token'

/** App credentials needed to exchange/refresh OAuth tokens. */
export interface MLOAuthConfig {
  clientId: string
  clientSecret: string
  /** Optional — only required by the authorization-code exchange, not refresh. */
  redirectUri?: string
}

export interface MLTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope?: string
  user_id: number
  refresh_token: string
}

function assertConfigured(config: MLOAuthConfig | undefined): asserts config is MLOAuthConfig {
  if (!config || !config.clientId || !config.clientSecret) {
    throw new Error('Mercado Libre OAuth not configured (clientId / clientSecret required)')
  }
}

/**
 * Exchange a refresh token for a fresh access token. THROWS when unconfigured
 * (missing clientId/clientSecret/refreshToken) or on OAuth API error — the
 * caller catches and records the failure (D3).
 */
export async function refreshAccessToken(
  refreshToken: string,
  config: MLOAuthConfig,
): Promise<MLTokenResponse> {
  assertConfigured(config)
  if (!refreshToken) {
    throw new Error('Mercado Libre OAuth not configured (refreshToken required)')
  }
  return postTokenRequest({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  })
}

/**
 * Exchange an authorization code for tokens (one-time bootstrap; not used in the
 * batch run path). THROWS when unconfigured or on OAuth API error.
 */
export async function exchangeAuthorizationCode(
  code: string,
  config: MLOAuthConfig,
): Promise<MLTokenResponse> {
  assertConfigured(config)
  if (!config.redirectUri) {
    throw new Error('Mercado Libre OAuth not configured (redirectUri required for code exchange)')
  }
  return postTokenRequest({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  })
}

async function postTokenRequest(params: Record<string, string>): Promise<MLTokenResponse> {
  const response = await fetch(ML_TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Mercado Libre OAuth error HTTP ${response.status}: ${body}`)
  }

  return response.json() as Promise<MLTokenResponse>
}
