import { z } from 'zod'
import type { WorkflowManifest } from '@godin-engine/contract'

/**
 * Vino pipeline, step 2 (agent runtime). Dispatched only after gate 1 approves
 * the CRM entry. Commits the CRM record (simulated), then drafts the proposal and
 * the client email. On success, opens approval gate 2 (owner approves the outbound)
 * which dispatches `send-step`. Input = the approved call-intake artifact.
 */
const manifest: WorkflowManifest = {
  id: 'proposal-step',
  version: '0.1.0',
  runtime: 'agent',
  timeoutMs: 120_000,
  policy: [{ kind: 'approval', approver: 'role:owner', onApprove: 'send-step' }],
  input: z
    .object({
      source: z.string().optional(),
      extraction: z.any(),
      crmEntry: z.any(),
      // Threaded from call-intake's artifact (no-LLM demo path). Passthrough would
      // carry it anyway; declared here because proposal-step.run() reads it.
      scripted: z.boolean().optional(),
    })
    .passthrough(),
}

export default manifest
