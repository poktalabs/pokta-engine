import type { IntegrationModule } from '../types.js'
import { resendConfigured, resendInfo, sendEmail } from './index.js'

/**
 * The Resend integration as a registry module. Resend reads its own env (D1 — it
 * is NOT a per-tenant `ctx.integration` provider in M1; send-step imports
 * `sendEmail` directly), so `create` ignores config and returns the env-bound
 * surface. The descriptor exists so it appears in `listIntegrations()`.
 */
export const resendModule: IntegrationModule<{
  sendEmail: typeof sendEmail
  resendConfigured: typeof resendConfigured
  resendInfo: typeof resendInfo
}> = {
  descriptor: {
    id: 'resend',
    displayName: 'Resend Email',
    category: 'email',
    secretKeys: ['RESEND_API_KEY', 'RESEND_FROM', 'RESEND_TO'],
  },
  create: () => ({ sendEmail, resendConfigured, resendInfo }),
}
