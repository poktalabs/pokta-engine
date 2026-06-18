import { z } from 'zod'
import type { WorkflowManifest } from '@pokta-engine/contract'

/**
 * The committed action (run 2). Only reachable via an approved gate — the control
 * plane refuses a direct POST to it (APPROVAL_REQUIRED). Its input is the artifact
 * produced by `echo-draft`.
 */
const manifest: WorkflowManifest<{ proposal: string }> = {
  id: 'echo-send',
  version: '0.1.0',
  runtime: 'serverless',
  timeoutMs: 10_000,
  policy: [],
  input: z.object({ proposal: z.string() }),
}

export default manifest
