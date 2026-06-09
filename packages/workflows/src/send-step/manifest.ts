import { z } from 'zod'
import type { WorkflowManifest } from '@godin-engine/contract'

/**
 * Vino pipeline, step 3. Dispatched only after gate 2 approves the outbound email.
 * Simulated send (no real email leaves). Input = the approved proposal-step artifact.
 */
const manifest: WorkflowManifest = {
  id: 'send-step',
  version: '0.1.0',
  runtime: 'serverless',
  timeoutMs: 10_000,
  policy: [],
  input: z
    .object({
      email: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
    })
    .passthrough(),
}

export default manifest
