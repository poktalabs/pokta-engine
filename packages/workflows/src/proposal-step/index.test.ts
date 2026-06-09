import type { RunContext } from '@godin-engine/contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the LLM so drafting is deterministic (force the scripted path by throwing).
vi.mock('@godin-engine/llm', () => ({
  completeJSON: vi.fn(),
}))
// Mock the Notion client module — proposal-step owns the fail-soft try/catch.
vi.mock('@godin-engine/integrations', () => ({
  commitCrmEntry: vi.fn(),
}))

import { completeJSON } from '@godin-engine/llm'
import { commitCrmEntry } from '@godin-engine/integrations'
import { run } from './index'

const ctx: RunContext = {
  runId: 'run-1',
  traceId: 'trace-1',
  logger: { info: vi.fn(), error: vi.fn() },
  artifactDir: '/tmp/run-1',
  // proposal-step uses the @godin-engine/integrations module directly, not ctx.integration;
  // a throwing stub satisfies the RunContext shape (D2) without being exercised.
  integration: (name: string) => {
    throw new Error(`integration('${name}') not stubbed in this test`)
  },
}

const crmEntry = {
  account: 'Acme Renovations — Delgado Residence',
  contactName: 'Maria Delgado',
  opportunityName: 'Delgado Kitchen + Primary Bath Remodel',
  stage: 'Proposal',
  estimatedValue: '$135,000',
  summary: 'Discovery call summary.',
  tags: ['remodel', 'kitchen'],
}

const extraction = {
  client: 'Acme',
  contact: 'Maria Delgado',
  projectType: 'Kitchen remodel',
  scopeHighlights: [],
  budgetSignal: '~$135k',
  timeline: 'before holidays',
  risks: [],
  nextSteps: [],
}

const input = { extraction, crmEntry, source: 'Granola call' }

describe('proposal-step run — CRM commit', () => {
  beforeEach(() => {
    // Force the scripted draft path so the proposal is deterministic.
    vi.mocked(completeJSON).mockRejectedValue(new Error('LLM off in test'))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('records crmResult.status=ok and a url when Notion succeeds', async () => {
    vi.mocked(commitCrmEntry).mockResolvedValue({
      pageId: 'page-abc',
      url: 'https://www.notion.so/page-abc',
    })

    const out = await run(input, ctx)

    expect(out.crmResult.provider).toBe('notion')
    expect(out.crmResult.status).toBe('ok')
    expect(out.crmResult.ref).toBe('page-abc')
    expect(out.crmResult.url).toBe('https://www.notion.so/page-abc')
    expect(out.crmResult.error).toBeUndefined()
    expect(typeof out.crmResult.at).toBe('string')
    // Proposal still produced.
    expect(out.proposal.title).toContain(crmEntry.opportunityName)
    expect(out.email.to).toBeTruthy()
  })

  it('fails soft: Notion error -> status=failed, proposal still drafts, run resolves', async () => {
    vi.mocked(commitCrmEntry).mockRejectedValue(new Error('Notion API: unauthorized'))

    const out = await run(input, ctx)

    expect(out.crmResult.status).toBe('failed')
    expect(out.crmResult.error).toBe('Notion API: unauthorized')
    expect(out.crmResult.ref).toBeUndefined()
    expect(out.crmResult.url).toBeUndefined()
    expect(typeof out.crmResult.at).toBe('string')
    // The drafted proposal must survive the CRM failure.
    expect(out.crmCommitted).toBe(true)
    expect(out.proposal).toBeDefined()
    expect(out.proposal.lineItems.length).toBeGreaterThan(0)
    expect(out.email.subject).toBeTruthy()
  })

  it('passes the approved CrmEntry through to commitCrmEntry', async () => {
    vi.mocked(commitCrmEntry).mockResolvedValue({ pageId: 'p', url: 'u' })

    await run(input, ctx)

    expect(commitCrmEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        account: crmEntry.account,
        opportunityName: crmEntry.opportunityName,
        tags: crmEntry.tags,
      }),
    )
  })
})
