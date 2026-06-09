import { z } from 'zod'
import type { WorkflowManifest } from '@godin-engine/contract'

/** Quota-gated echo (spike steps 7-9). Stands in for the landing-page job. */
const manifest: WorkflowManifest<{ message: string }> = {
  id: 'echo',
  version: '0.1.0',
  runtime: 'serverless',
  timeoutMs: 10_000,
  policy: [{ kind: 'quota', perDay: 1, scope: 'consumer', tier: 'free' }],
  input: z.object({ message: z.string() }),
}

export default manifest
