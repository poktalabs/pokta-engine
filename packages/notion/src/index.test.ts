import { describe, expect, it } from 'vitest'
import { commitCrmEntry, notionInfo } from './index'

// Phase 0 seed (D6). Lane A (TASK-001) expands this: mock @notionhq/client,
// assert success returns {pageId,url} and API error throws.
describe('notion stub', () => {
  it('exposes config info without throwing', () => {
    expect(typeof notionInfo().configured).toBe('boolean')
  })

  it('commitCrmEntry rejects until implemented (throws, never returns a failure shape)', async () => {
    await expect(
      commitCrmEntry({
        account: 'x',
        contactName: 'x',
        opportunityName: 'x',
        stage: 'x',
        estimatedValue: 'x',
        summary: 'x',
        tags: [],
      }),
    ).rejects.toThrow()
  })
})
