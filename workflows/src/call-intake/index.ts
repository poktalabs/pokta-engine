import type { RunContext } from '@godin-engine/contract'
import { completeJSON } from '@godin-engine/llm'

export interface Extraction {
  client: string
  contact: string
  projectType: string
  scopeHighlights: string[]
  budgetSignal: string
  timeline: string
  risks: string[]
  nextSteps: string[]
}

export interface CrmEntry {
  account: string
  contactName: string
  opportunityName: string
  stage: string
  estimatedValue: string
  summary: string
  tags: string[]
}

export interface IntakeOutput {
  source: string
  extraction: Extraction
  crmEntry: CrmEntry
  generatedBy: 'llm' | 'scripted'
}

const SYSTEM = `You are an operations agent for Vino Design Build, a residential construction / design-build firm.
You read a sales or discovery call transcript and produce two things:
1) "extraction": the structured facts from the call.
2) "crmEntry": a draft CRM opportunity record a human will review before it is written to the CRM.
Only use facts supported by the transcript. If something was not discussed, say "not discussed" — never invent budgets, names, or commitments.
Return JSON: {
  "extraction": { "client": string, "contact": string, "projectType": string, "scopeHighlights": string[], "budgetSignal": string, "timeline": string, "risks": string[], "nextSteps": string[] },
  "crmEntry": { "account": string, "contactName": string, "opportunityName": string, "stage": string, "estimatedValue": string, "summary": string, "tags": string[] }
}`

const SCRIPTED: { extraction: Extraction; crmEntry: CrmEntry } = {
  extraction: {
    client: 'Acme Renovations (homeowner: the Delgados)',
    contact: 'Maria Delgado',
    projectType: 'Kitchen + primary bathroom remodel',
    scopeHighlights: [
      'Full kitchen gut: cabinets, quartz counters, island with seating',
      'Primary bath: walk-in shower, double vanity, heated floor',
      'Open up wall between kitchen and dining (verify load-bearing)',
    ],
    budgetSignal: 'Comfortable around $120–150k; wants a clear line-item breakdown',
    timeline: 'Hoping to start in ~8 weeks; done before the holidays',
    risks: ['Possible load-bearing wall', 'HOA approval for any exterior changes', 'Long lead time on chosen tile'],
    nextSteps: ['Send line-item proposal', 'Schedule on-site measure', 'Confirm structural engineer for the wall'],
  },
  crmEntry: {
    account: 'Acme Renovations — Delgado Residence',
    contactName: 'Maria Delgado',
    opportunityName: 'Delgado Kitchen + Primary Bath Remodel',
    stage: 'Proposal',
    estimatedValue: '$135,000',
    summary:
      'Discovery call covered a full kitchen gut and primary bath remodel with an open-concept wall removal. Budget comfort ~$120–150k. Next: line-item proposal + on-site measure; flag load-bearing wall and tile lead time.',
    tags: ['remodel', 'kitchen', 'bath', 'proposal-ready'],
  },
}

export async function run(input: { transcript: string; source?: string }, ctx: RunContext): Promise<IntakeOutput> {
  const source = input.source ?? 'Granola call'
  try {
    const data = await completeJSON<{ extraction: Extraction; crmEntry: CrmEntry }>({
      system: SYSTEM,
      user: `Call transcript:\n\n${input.transcript}`,
      maxTokens: 1200,
    })
    ctx.logger.info('call-intake: extracted + drafted CRM entry via LLM')
    return { source, extraction: data.extraction, crmEntry: data.crmEntry, generatedBy: 'llm' }
  } catch (e) {
    ctx.logger.info(`call-intake: LLM unavailable (${(e as Error).message}); using scripted draft`)
    return { source, ...SCRIPTED, generatedBy: 'scripted' }
  }
}
