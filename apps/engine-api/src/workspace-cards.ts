/**
 * The workspace CARD CATALOG (P5b, Codex#9) — engine-api-owned, PURE (no db). A
 * workflow card is a dispatchable FAMILY: a parent workflow id plus the gated
 * children (onComplete / onApprove targets) that fold into it. Manifests carry NO
 * displayName/trigger (those are engine-api concerns), so the catalog lives HERE,
 * not in the workflow registry.
 *
 * A card is surfaced to a tenant iff its PARENT id is in the tenant's allow-list.
 * Gated children are NEVER standalone cards — they only appear folded into the
 * parent (their run/approval state rolls up into the parent card).
 */

/** One catalog entry: the parent card + the family member ids it folds. */
export interface WorkspaceCardCatalogEntry {
  /** The parent (dispatchable) workflow id — the card's identity. */
  id: string
  /** Human label (engine-api-owned, not a manifest field). */
  displayName: string
  /** How the card is dispatched (e.g. 'manual'). */
  trigger: string
  /** The family: parent + its gated children. Run/approval state rolls up across these. */
  memberWorkflowIds: string[]
  /** Whether the card has a drill-in detail surface. */
  hasDetail: boolean
}

/**
 * THE catalog. The mi-pase "Daily Pricing" family = parent `pricing-draft` +
 * children `pricing-apply-confident` (onComplete, auto) + `pricing-apply-flagged`
 * (onApprove, gated). The children are folded, never standalone.
 */
export const WORKSPACE_CARD_CATALOG: WorkspaceCardCatalogEntry[] = [
  {
    id: 'pricing-draft',
    displayName: 'Daily Pricing',
    trigger: 'manual',
    memberWorkflowIds: ['pricing-draft', 'pricing-apply-confident', 'pricing-apply-flagged'],
    hasDetail: true,
  },
]

/**
 * The catalog cards this tenant may see — those whose PARENT id is in the tenant's
 * (already-filtered) allow-list. Gated children are folded into their parent, so a
 * tenant allow-listed for a child but not its parent surfaces NO standalone card.
 */
export function cardsForTenant(allowedWorkflowIds: string[]): WorkspaceCardCatalogEntry[] {
  const allow = new Set(allowedWorkflowIds)
  return WORKSPACE_CARD_CATALOG.filter((card) => allow.has(card.id))
}

/**
 * Resolve a workflow id to its FAMILY member ids. A catalog PARENT id (or any of
 * its member ids) maps to that family's full member set; any other id maps to
 * `[itself]` (a non-catalog allowed workflow is its own one-member family).
 */
export function familyMemberIds(parentId: string): string[] {
  const entry = WORKSPACE_CARD_CATALOG.find(
    (card) => card.id === parentId || card.memberWorkflowIds.includes(parentId),
  )
  return entry ? entry.memberWorkflowIds : [parentId]
}
