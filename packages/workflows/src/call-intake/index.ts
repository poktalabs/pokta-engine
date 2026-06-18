import type { RunContext } from '@pokta-engine/contract'
import { completeJSON } from '@pokta-engine/llm'
import { pickScenario } from '../demo-scenarios'

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
  /**
   * Demo / no-LLM marker. When dispatched with `scripted: true` (the public /demo
   * path), this threads through the gate-1 artifact into proposal-step so the WHOLE
   * chain stays LLM-free, not just step 1.
   */
  scripted?: boolean
  /**
   * Per-run demo ref (e.g. "A7F3"). Baked into the scripted CRM opportunity title +
   * a tag so each public demo run writes a UNIQUE, recognizable Notion row (not a
   * repeated identical scripted entry). Surfaced in the demo UI so the visitor can
   * find THEIR row in Notion.
   */
  demoRef?: string
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


export async function run(
  input: { transcript: string; source?: string; scripted?: boolean; demoRef?: string },
  ctx: RunContext,
): Promise<IntakeOutput> {
  const source = input.source ?? 'Granola call'
  // Demo / no-LLM mode (public /demo): deterministic scripted draft, ZERO LLM call.
  // Set on the run input by the demo dispatcher so a public visitor can never drive
  // an LLM request. `scripted: true` is echoed so it threads into proposal-step.
  if (input.scripted) {
    ctx.logger.info('call-intake: scripted mode (no LLM — demo path)')
    const ref = input.demoRef
    // Pick one of the varied demo scenarios (deterministically from the ref) so each
    // run is a DIFFERENT believable opportunity, then stamp the unique ref onto the CRM
    // entry (title suffix + tag) so the Notion row is unmistakably this visitor's.
    const sc = pickScenario(ref)
    const crmEntry: CrmEntry = ref
      ? {
          ...sc.crmEntry,
          opportunityName: `${sc.crmEntry.opportunityName} · Demo ${ref}`,
          tags: [...sc.crmEntry.tags, `demo-${ref}`],
        }
      : sc.crmEntry
    return {
      source,
      extraction: sc.extraction,
      crmEntry,
      generatedBy: 'scripted',
      scripted: true,
      demoRef: ref,
    }
  }
  try {
    const data = await completeJSON<{ extraction: Extraction; crmEntry: CrmEntry }>({
      system: SYSTEM,
      user: `Call transcript:\n\n${input.transcript}`,
      maxTokens: 900,
    })
    ctx.logger.info('call-intake: extracted + drafted CRM entry via LLM')
    return { source, extraction: data.extraction, crmEntry: data.crmEntry, generatedBy: 'llm' }
  } catch (e) {
    ctx.logger.info(`call-intake: LLM unavailable (${(e as Error).message}); using scripted draft`)
    const sc = pickScenario()
    return { source, extraction: sc.extraction, crmEntry: sc.crmEntry, generatedBy: 'scripted' }
  }
}
