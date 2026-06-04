import type { RunContext } from '@godin-engine/contract'
import { completeJSON } from '@godin-engine/llm'
import type { CrmEntry, Extraction } from '../call-intake'

export interface ProposalLineItem {
  name: string
  detail: string
  price: string
}

export interface Proposal {
  title: string
  summary: string
  lineItems: ProposalLineItem[]
  subtotal: string
  timelineText: string
  exclusions: string[]
}

export interface ClientEmail {
  to: string
  subject: string
  body: string
}

export interface ProposalOutput {
  crmCommitted: true
  crmEntry: CrmEntry
  proposal: Proposal
  email: ClientEmail
  generatedBy: 'llm' | 'scripted'
}

type IntakeArtifact = { extraction: Extraction; crmEntry: CrmEntry; source?: string }

const SYSTEM = `You are an estimator + client-comms agent for Vino Design Build (residential design-build).
Given the structured extraction and the approved CRM opportunity from a discovery call, draft:
1) "proposal": a clear, line-itemed proposal grounded ONLY in the discussed scope. Round numbers reasonably; do not commit to anything not discussed.
2) "email": a warm, professional email to the client that references their specific project and invites them to review the attached proposal. Sign as "The Vino Design Build Team".
Return JSON: {
  "proposal": { "title": string, "summary": string, "lineItems": [{ "name": string, "detail": string, "price": string }], "subtotal": string, "timelineText": string, "exclusions": string[] },
  "email": { "to": string, "subject": string, "body": string }
}`

function scripted(crm: CrmEntry, ex: Extraction): { proposal: Proposal; email: ClientEmail } {
  return {
    proposal: {
      title: `Proposal — ${crm.opportunityName}`,
      summary: `Design-build proposal for ${ex.projectType.toLowerCase()} at the ${crm.contactName} residence, based on our discovery call.`,
      lineItems: [
        { name: 'Kitchen remodel', detail: 'Cabinetry, quartz counters, island w/ seating, appliances install', price: '$72,000' },
        { name: 'Primary bath remodel', detail: 'Walk-in shower, double vanity, heated floor, tile', price: '$38,000' },
        { name: 'Wall removal + structural', detail: 'Open kitchen/dining wall; engineer + beam (pending assessment)', price: '$15,000' },
        { name: 'Design + project management', detail: 'Drawings, selections, permits, on-site coordination', price: '$10,000' },
      ],
      subtotal: '$135,000',
      timelineText: 'Approx. 10–12 weeks from permit approval; targeting completion before the holidays.',
      exclusions: ['HOA approval fees', 'Appliances (client-supplied option available)', 'Unforeseen structural beyond noted wall'],
    },
    email: {
      to: 'maria.delgado@example.com',
      subject: `Your remodel proposal — ${crm.opportunityName}`,
      body: `Hi ${crm.contactName.split(' ')[0]},\n\nThank you for the great conversation. Based on what you shared, we've put together a line-item proposal for your kitchen and primary bath remodel, including opening up the kitchen/dining wall.\n\nA quick summary: full kitchen gut, primary bath with a walk-in shower and heated floor, and the structural work to open the space — estimated at $135,000, with a 10–12 week timeline targeting completion before the holidays.\n\nThe attached proposal breaks down every line item. Once you've had a look, we'd love to schedule the on-site measure and confirm the structural assessment for the wall.\n\nWarmly,\nThe Vino Design Build Team`,
    },
  }
}

export async function run(input: IntakeArtifact, ctx: RunContext): Promise<ProposalOutput> {
  ctx.logger.info('proposal-step: CRM entry committed (simulated); drafting proposal + email')
  try {
    const data = await completeJSON<{ proposal: Proposal; email: ClientEmail }>({
      system: SYSTEM,
      user: `Extraction:\n${JSON.stringify(input.extraction, null, 2)}\n\nApproved CRM entry:\n${JSON.stringify(input.crmEntry, null, 2)}`,
      maxTokens: 1400,
    })
    return { crmCommitted: true, crmEntry: input.crmEntry, proposal: data.proposal, email: data.email, generatedBy: 'llm' }
  } catch (e) {
    ctx.logger.info(`proposal-step: LLM unavailable (${(e as Error).message}); using scripted draft`)
    const s = scripted(input.crmEntry, input.extraction)
    return { crmCommitted: true, crmEntry: input.crmEntry, proposal: s.proposal, email: s.email, generatedBy: 'scripted' }
  }
}
