import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the Notion SDK. The mocked Client exposes pages.create, which each test
// reconfigures (resolve a page on success, reject on API error).
const createMock = vi.fn()
vi.mock('@notionhq/client', () => ({
  Client: vi.fn().mockImplementation(() => ({ pages: { create: createMock } })),
}))

const ROW = {
  account: 'Acme Renovations — Delgado Residence',
  contactName: 'Maria Delgado',
  opportunityName: 'Delgado Kitchen + Primary Bath Remodel',
  stage: 'Proposal',
  estimatedValue: '$135,000',
  summary: 'Discovery call covered a full kitchen gut and primary bath remodel.',
  tags: ['remodel', 'kitchen', 'bath'],
}

describe('notion commitCrmEntry', () => {
  beforeEach(() => {
    vi.resetModules()
    createMock.mockReset()
    process.env.NOTION_API_KEY = 'secret_test'
    process.env.NOTION_CRM_DB_ID = 'db_test_id'
  })

  afterEach(() => {
    delete process.env.NOTION_API_KEY
    delete process.env.NOTION_CRM_DB_ID
  })

  it('exposes config info without throwing', async () => {
    const { notionInfo } = await import('./index')
    expect(typeof notionInfo().configured).toBe('boolean')
  })

  it('creates a page and returns {pageId, url} on success', async () => {
    createMock.mockResolvedValue({ id: 'page-123', url: 'https://www.notion.so/page-123' })
    const { commitCrmEntry } = await import('./index')

    const result = await commitCrmEntry(ROW)

    expect(result).toEqual({ pageId: 'page-123', url: 'https://www.notion.so/page-123' })
    expect(createMock).toHaveBeenCalledTimes(1)
    const arg = createMock.mock.calls[0]![0]
    expect(arg.parent).toEqual({ database_id: 'db_test_id' })
    // title maps from opportunityName
    expect(arg.properties.Opportunity.title[0].text.content).toBe(ROW.opportunityName)
    expect(arg.properties.Account.rich_text[0].text.content).toBe(ROW.account)
    expect(arg.properties.Stage.select.name).toBe(ROW.stage)
    expect(arg.properties.Tags.multi_select).toEqual([
      { name: 'remodel' },
      { name: 'kitchen' },
      { name: 'bath' },
    ])
  })

  it('synthesizes a url when the API response omits one', async () => {
    createMock.mockResolvedValue({ id: 'abc-def' })
    const { commitCrmEntry } = await import('./index')

    const result = await commitCrmEntry(ROW)

    expect(result.pageId).toBe('abc-def')
    expect(result.url).toBe('https://www.notion.so/abcdef')
  })

  it('throws when the Notion API errors (never returns a failure shape)', async () => {
    createMock.mockRejectedValue(new Error('Notion API: unauthorized'))
    const { commitCrmEntry } = await import('./index')

    await expect(commitCrmEntry(ROW)).rejects.toThrow('Notion API: unauthorized')
  })

  it('throws when unconfigured', async () => {
    delete process.env.NOTION_API_KEY
    delete process.env.NOTION_CRM_DB_ID
    const { commitCrmEntry } = await import('./index')

    await expect(commitCrmEntry(ROW)).rejects.toThrow('Notion not configured')
    expect(createMock).not.toHaveBeenCalled()
  })
})
