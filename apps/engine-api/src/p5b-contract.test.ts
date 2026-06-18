import { describe, expect, it } from 'vitest'
import {
  workflowCardSchema,
  workspaceWorkflowsResponseSchema,
  integrationStatusSchema,
  integrationListResponseSchema,
  tenantViewSchema,
  type WorkflowCard,
  type IntegrationStatus,
  type WorkspaceWorkflowsResponse,
  type IntegrationListResponse,
} from '@pokta-engine/contract'
import { listManifests } from '@pokta-engine/workflows'
import { WORKSPACE_CARD_CATALOG } from './workspace-cards'

/**
 * P5b contract / id-drift guards (PURE — no DB, no app harness, REAL registries).
 *
 * These are the load-bearing "the wiring matches reality" assertions:
 *   (1) the new P5b contract schemas parse a valid sample and reject a bad status,
 *   (2) the workspace card catalog references ONLY real manifest ids (no mock
 *       'mipase.daily-pricing' drift),
 *   (3) the cards are the dispatchable PARENTS (pricing-draft is present; no bogus
 *       'mipase.daily-pricing' card),
 *   (4) TenantView no longer carries an `integrations` key (D-Codex#4 removal).
 *
 * We use the REAL contract schemas and the REAL workflow registry — nothing is
 * mocked, so a future rename of a manifest id (or a stray mock id leaking into the
 * catalog) fails this file.
 */

describe('P5b — contract schemas parse valid + reject invalid', () => {
  it('workflowCardSchema parses a valid card and infers WorkflowCard', () => {
    const sample: WorkflowCard = {
      id: 'pricing-draft',
      displayName: 'Daily Pricing',
      trigger: 'manual',
      lastRun: { status: 'succeeded', at: '2026-06-09T00:00:00.000Z' },
      pendingApprovals: 2,
      hasDetail: true,
    }
    expect(workflowCardSchema.parse(sample)).toEqual(sample)
  })

  it('workflowCardSchema accepts a null lastRun', () => {
    const sample: WorkflowCard = {
      id: 'pricing-draft',
      displayName: 'Daily Pricing',
      trigger: 'manual',
      lastRun: null,
      pendingApprovals: 0,
      hasDetail: true,
    }
    expect(workflowCardSchema.parse(sample)).toEqual(sample)
  })

  it('workflowCardSchema rejects a negative pendingApprovals', () => {
    expect(
      workflowCardSchema.safeParse({
        id: 'pricing-draft',
        displayName: 'Daily Pricing',
        trigger: 'manual',
        lastRun: null,
        pendingApprovals: -1,
        hasDetail: true,
      }).success,
    ).toBe(false)
  })

  it('workspaceWorkflowsResponseSchema parses an envelope', () => {
    const sample: WorkspaceWorkflowsResponse = {
      workflows: [
        {
          id: 'pricing-draft',
          displayName: 'Daily Pricing',
          trigger: 'manual',
          lastRun: null,
          pendingApprovals: 0,
          hasDetail: true,
        },
      ],
    }
    expect(workspaceWorkflowsResponseSchema.parse(sample)).toEqual(sample)
  })

  it('integrationStatusSchema parses a valid row and infers IntegrationStatus', () => {
    const sample: IntegrationStatus = {
      id: 'notion',
      displayName: 'Notion',
      category: 'crm',
      status: 'enabled',
      detail: 'connected',
    }
    expect(integrationStatusSchema.parse(sample)).toEqual(sample)
  })

  it('integrationStatusSchema rejects a bad connection status', () => {
    expect(
      integrationStatusSchema.safeParse({
        id: 'notion',
        displayName: 'Notion',
        category: 'crm',
        status: 'connected', // not in the enum: enabled | pending | disabled
      }).success,
    ).toBe(false)
  })

  it('integrationStatusSchema accepts every legal connection status', () => {
    for (const status of ['enabled', 'pending', 'disabled'] as const) {
      expect(
        integrationStatusSchema.safeParse({
          id: 'notion',
          displayName: 'Notion',
          category: 'crm',
          status,
        }).success,
      ).toBe(true)
    }
  })

  it('integrationListResponseSchema parses an envelope', () => {
    const sample: IntegrationListResponse = {
      integrations: [{ id: 'resend', displayName: 'Resend', category: 'email', status: 'pending' }],
    }
    expect(integrationListResponseSchema.parse(sample)).toEqual(sample)
  })
})

describe('P5b — card catalog uses ONLY real manifest ids (no id drift)', () => {
  const manifestIds = new Set(listManifests().map((m) => m.id))

  it('the registry actually contains the Daily Pricing family ids (sanity)', () => {
    expect(manifestIds.has('pricing-draft')).toBe(true)
    expect(manifestIds.has('pricing-apply-confident')).toBe(true)
    expect(manifestIds.has('pricing-apply-flagged')).toBe(true)
  })

  it('every card.id is a real manifest id', () => {
    for (const card of WORKSPACE_CARD_CATALOG) {
      expect(manifestIds.has(card.id)).toBe(true)
    }
  })

  it('every memberWorkflowId across the catalog is a real manifest id', () => {
    for (const card of WORKSPACE_CARD_CATALOG) {
      for (const memberId of card.memberWorkflowIds) {
        expect(manifestIds.has(memberId)).toBe(true)
      }
    }
  })

  it('each card.id is included in its own member set (parent is a family member)', () => {
    for (const card of WORKSPACE_CARD_CATALOG) {
      expect(card.memberWorkflowIds).toContain(card.id)
    }
  })
})

describe('P5b — cards are dispatchable parents, no mock ids', () => {
  const cardIds = WORKSPACE_CARD_CATALOG.map((c) => c.id)

  it('pricing-draft (the dispatchable parent) is present as a card', () => {
    expect(cardIds).toContain('pricing-draft')
  })

  it('the catalog does NOT contain the bogus mock id mipase.daily-pricing', () => {
    expect(cardIds).not.toContain('mipase.daily-pricing')
    const allMemberIds = WORKSPACE_CARD_CATALOG.flatMap((c) => c.memberWorkflowIds)
    expect(allMemberIds).not.toContain('mipase.daily-pricing')
  })

  it('no card surfaces a gated child as a STANDALONE card id', () => {
    // The gated children fold into pricing-draft; they must never be their own card.
    expect(cardIds).not.toContain('pricing-apply-confident')
    expect(cardIds).not.toContain('pricing-apply-flagged')
  })
})

describe('P5b — TenantView dropped the integrations field (D-Codex#4)', () => {
  it('tenantViewSchema.shape has no `integrations` key', () => {
    expect('integrations' in tenantViewSchema.shape).toBe(false)
  })

  it('tenantViewSchema still has the kept fields', () => {
    for (const key of ['id', 'name', 'status', 'currency', 'locale', 'branding', 'allowedWorkflows']) {
      expect(key in tenantViewSchema.shape).toBe(true)
    }
  })
})
