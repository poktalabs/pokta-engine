import type { RunContext } from '@godin-engine/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the LLM so we can assert exactly when it is (and isn't) called.
vi.mock('@godin-engine/llm', () => ({
  completeJSON: vi.fn(),
}))

import { completeJSON } from '@godin-engine/llm'
import { run } from './index'

const ctx: RunContext = {
  runId: 'run-1',
  traceId: 'trace-1',
  logger: { info: vi.fn(), error: vi.fn() },
  artifactDir: '/tmp/run-1',
  integration: (name: string) => {
    throw new Error(`integration('${name}') not stubbed in this test`)
  },
}

const transcript = 'Discovery call: homeowner wants a full kitchen + primary bath remodel...'

describe('call-intake run — scripted (no-LLM demo) mode', () => {
  afterEach(() => vi.clearAllMocks())

  it('scripted:true NEVER calls the LLM and echoes scripted:true into the output', async () => {
    // If the demo path leaked an LLM call, this would be used — assert it is NOT.
    vi.mocked(completeJSON).mockResolvedValue({ extraction: {}, crmEntry: {} } as never)

    const out = await run({ transcript, scripted: true }, ctx)

    expect(completeJSON).not.toHaveBeenCalled()
    expect(out.generatedBy).toBe('scripted')
    // The marker must thread into the gate-1 artifact so proposal-step also skips the LLM.
    expect(out.scripted).toBe(true)
    expect(out.crmEntry.opportunityName).toBeTruthy()
    expect(out.extraction.client).toBeTruthy()
  })

  it('without the flag, the normal path DOES call the LLM (control)', async () => {
    vi.mocked(completeJSON).mockResolvedValue({
      extraction: {
        client: 'C',
        contact: 'X',
        projectType: 'remodel',
        scopeHighlights: [],
        budgetSignal: 'n/a',
        timeline: 'soon',
        risks: [],
        nextSteps: [],
      },
      crmEntry: {
        account: 'C',
        contactName: 'X',
        opportunityName: 'Op',
        stage: 'Proposal',
        estimatedValue: '$1',
        summary: 's',
        tags: [],
      },
    } as never)

    const out = await run({ transcript }, ctx)

    expect(completeJSON).toHaveBeenCalledTimes(1)
    expect(out.generatedBy).toBe('llm')
    expect(out.scripted).toBeUndefined()
  })
})
