import { z } from 'zod'
import type { WorkflowManifest } from '@godin-engine/contract'

/**
 * Vino pipeline, step 1 (agent runtime): read a call transcript, extract
 * structured data, and draft a CRM opportunity record. On success, opens
 * approval gate 1 (owner approves the CRM entry) which dispatches `proposal-step`.
 */
const manifest: WorkflowManifest<{ transcript: string; source?: string }> = {
  id: 'call-intake',
  version: '0.1.0',
  runtime: 'agent',
  timeoutMs: 120_000,
  policy: [{ kind: 'approval', approver: 'role:owner', onApprove: 'proposal-step' }],
  input: z.object({ transcript: z.string().min(1), source: z.string().optional() }),
}

export default manifest
