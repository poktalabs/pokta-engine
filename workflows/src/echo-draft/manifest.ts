import { z } from 'zod'
import type { WorkflowManifest } from '@godin-engine/contract'

/**
 * Approval-gated draft (spike step 10). Run 1 of the chained pair: produces a
 * proposal, performs NO real write. On success the worker opens an approval gate
 * whose onApprove dispatches `echo-send`.
 */
const manifest: WorkflowManifest<{ topic: string }> = {
  id: 'echo-draft',
  version: '0.1.0',
  runtime: 'agent',
  timeoutMs: 30_000,
  policy: [{ kind: 'approval', approver: 'role:reviewer', onApprove: 'echo-send' }],
  input: z.object({ topic: z.string() }),
}

export default manifest
