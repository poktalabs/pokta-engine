import { useCallback, useMemo, useState } from 'react'
import {
  Check,
  Mail,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Workflow,
  X,
  type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { ApprovalView } from '@pokta-engine/contract'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import type {
  ApprovalRenderer,
  ApprovalRendererProps,
  DecisionRequest,
} from '../types'

/**
 * The Vino SINGLE-ACTION approval renderer (M2 P2-C).
 *
 * Vino's queue is the OPPOSITE of Mi Pase's: not a 316-row batch table but a
 * handful of high-stakes, one-at-a-time decisions — send this email, move this
 * lead, commit this $48.5k estimate. So instead of a virtualized grid this
 * renderer emits ONE focused card per item: what / where / risk (3-tier badge,
 * no new color) / why, the drafted-content PREVIEW, and Approve / Reject with an
 * inline "edit before approving" affordance.
 *
 * It conforms to the universal `ApprovalRenderer` contract (types.ts): the FRAME
 * owns the 6 lifecycle states + the async approve/reject lifecycle + the global
 * action bar + the a11y live region; this renderer owns only artifact
 * PRESENTATION, per-card selection, and the per-card decision affordances. The
 * only thing that changes between Vino and Mi Pase is which renderer the frame
 * is handed — everything else is shared.
 *
 * Per-card Approve/Reject call `onApproveAll` / `onReject(id)` after narrowing
 * the frame's selection to this one card (`onToggle`), so a single click on one
 * card never accidentally applies the others.
 *
 * Brand: SHARP (radius 0), hairline-frame cards, `.risk-*` tiers from
 * `risk-tiers.css` (always icon + text — never meaning by color alone), Source
 * Serif headings / Manrope body / Funnel buttons, brick-ember reject stamp.
 */

/** The single-action artifact this renderer presents (renderer-owned shape). */
interface SingleActionArtifact {
  kind: 'vino.email-send' | 'vino.crm-move' | 'vino.estimate-commit'
  /** What the action does, in plain language. */
  what: string
  /** Where it lands (the integration target). */
  where: string
  /** Coarse risk tier — maps to the 3-tier risk scale (P1-C-risk, no new color). */
  risk: 'low' | 'medium' | 'high'
  /** Drafted content the operator reviews before approving. */
  preview: string
  /** Plain-language reason the agent took this action (optional). */
  why?: string
}

const ARTIFACT_KIND = 'vino' as const

/** 3-tier risk metadata — class from risk-tiers.css + icon + accessible name. */
const RISK_META: Record<
  SingleActionArtifact['risk'],
  { riskClass: string; Icon: ComponentType<LucideProps>; label: string; name: string }
> = {
  low: { riskClass: 'risk-low', Icon: ShieldCheck, label: 'Low risk', name: 'Risk: low' },
  medium: { riskClass: 'risk-med', Icon: ShieldAlert, label: 'Medium risk', name: 'Risk: medium' },
  high: { riskClass: 'risk-high', Icon: ShieldX, label: 'High risk', name: 'Risk: high' },
}

/** Per-kind preview affordances — heading + icon + how to render the body. */
const KIND_META: Record<
  SingleActionArtifact['kind'],
  { previewLabel: string; Icon: ComponentType<LucideProps>; editable: boolean; mono: boolean }
> = {
  'vino.email-send': { previewLabel: 'Email draft', Icon: Mail, editable: true, mono: false },
  'vino.crm-move': { previewLabel: 'Stage move', Icon: Workflow, editable: false, mono: false },
  'vino.estimate-commit': { previewLabel: 'Estimate', Icon: Workflow, editable: false, mono: true },
}

/** Best-effort narrow of the opaque `ApprovalView.artifact` to our shape. */
function asArtifact(item: ApprovalView): SingleActionArtifact | null {
  const a = item.artifact
  if (a && typeof a === 'object' && 'kind' in a && 'what' in a && 'preview' in a) {
    return a as SingleActionArtifact
  }
  return null
}

/** A single focused action card. */
function ActionCard({
  item,
  selected,
  failed,
  disabled,
  state,
  onToggle,
  onApprove,
  onReject,
}: {
  item: ApprovalView
  selected: boolean
  failed: boolean
  disabled: boolean
  state: ApprovalRendererProps['state']
  onToggle(id: string): void
  onApprove(id: string): void
  onReject(id: string): void
}) {
  const artifact = asArtifact(item)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => artifact?.preview ?? '')

  if (!artifact) {
    // Defensive: an item whose artifact isn't a single-action shape. Surface it
    // rather than crash, so the queue still renders the rest.
    return (
      <li className="border border-[var(--status-fail)] bg-[var(--status-fail-bg)] p-5 text-sm text-[var(--status-fail)]">
        Unrecognized artifact for {item.approvalId}. Cannot render a preview.
      </li>
    )
  }

  const risk = RISK_META[artifact.risk]
  const kind = KIND_META[artifact.kind]
  const RiskIcon = risk.Icon
  const KindIcon = kind.Icon
  const previewId = `preview-${item.approvalId}`
  const edited = editing && draft !== artifact.preview

  return (
    <li
      data-failed={failed || undefined}
      className={cn(
        'border bg-[var(--surface)]',
        failed
          ? 'border-[var(--status-fail)]'
          : selected
            ? 'border-[var(--color-ink)]'
            : 'border-[var(--rule)]',
      )}
    >
      {/* Header: selection + what / where + risk badge. */}
      <div className="flex items-start gap-4 border-b border-[var(--border)] p-5">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={() => onToggle(item.approvalId)}
          aria-label={`Select: ${artifact.what}`}
          className="mt-1 size-4 shrink-0 accent-[var(--color-ink)]"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-serif text-lg leading-snug text-[var(--foreground)]">
            {artifact.what}
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-[var(--foreground-soft)]">
            <KindIcon className="size-3.5 text-[var(--muted-foreground)]" aria-hidden="true" />
            <span className="truncate">{artifact.where}</span>
          </p>
        </div>
        {/* 3-tier risk badge — icon + text, never color alone. */}
        <span className={cn('risk', risk.riskClass, 'shrink-0')}>
          <RiskIcon className="size-3" aria-label={risk.name} role="img" />
          <span>{risk.label}</span>
        </span>
      </div>

      {/* Why this was drafted. */}
      {artifact.why && (
        <p className="border-b border-[var(--border)] px-5 py-3 text-sm text-[var(--foreground-soft)]">
          <span className="font-semibold uppercase tracking-wide text-[var(--muted-foreground)] text-[0.6875rem]">
            Why{' '}
          </span>
          {artifact.why}
        </p>
      )}

      {/* Drafted-content preview — the heart of the review. */}
      <div className="p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            {kind.previewLabel}
            {edited && (
              <span className="ml-2 normal-case tracking-normal text-[var(--accent-text)]">
                · edited
              </span>
            )}
          </span>
          {kind.editable && !editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={disabled}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit before approving
            </Button>
          )}
        </div>

        {kind.editable && editing ? (
          <div className="space-y-2">
            <label htmlFor={`edit-${item.approvalId}`} className="sr-only">
              Edit {kind.previewLabel.toLowerCase()} before approving
            </label>
            <textarea
              id={`edit-${item.approvalId}`}
              className="field min-h-32 resize-y"
              value={draft}
              disabled={disabled}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={disabled}
              >
                Done editing
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(artifact.preview)
                  setEditing(false)
                }}
                disabled={disabled}
              >
                Revert
              </Button>
            </div>
          </div>
        ) : (
          <p
            id={previewId}
            className={cn(
              'whitespace-pre-wrap border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--foreground)]',
              kind.mono && 'font-mono text-[0.8125rem]',
            )}
          >
            {kind.editable ? draft : artifact.preview}
          </p>
        )}
      </div>

      {/* Per-card decision affordances. */}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--border)] bg-[var(--surface-2)] px-5 py-3">
        {failed && (
          <span className="mr-auto text-sm text-[var(--status-fail)]">
            This action failed to apply. Review and retry.
          </span>
        )}
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onReject(item.approvalId)}
          disabled={disabled}
        >
          <X className="size-4" aria-hidden="true" />
          Reject
        </Button>
        <Button
          size="sm"
          onClick={() => onApprove(item.approvalId)}
          disabled={disabled}
        >
          <Check className="size-4" aria-hidden="true" />
          {state === 'submitting' ? 'Applying…' : edited ? 'Approve edited' : 'Approve'}
        </Button>
      </div>
    </li>
  )
}

/** The renderer body the frame mounts via `renderer.render(props)`. */
function SingleActionBody({
  items,
  state,
  selection,
  onToggle,
  onApproveAll,
  onReject,
  failedItemIds,
  disabled,
}: ApprovalRendererProps) {
  const failed = useMemo(() => new Set(failedItemIds), [failedItemIds])

  // Per-card Approve narrows the frame's selection to just that card, then fires
  // the frame's approve. This keeps a single "Approve" click from applying the
  // sibling cards that happen to be selected.
  const approveOne = useCallback(
    (id: string) => {
      for (const other of selection) if (other !== id) onToggle(other)
      if (!selection.has(id)) onToggle(id)
      // Defer so the frame re-renders with the narrowed selection first.
      requestAnimationFrame(() => onApproveAll())
    },
    [selection, onToggle, onApproveAll],
  )

  // Reject is already per-id at the contract level.
  const rejectOne = useCallback((id: string) => onReject(id), [onReject])

  if (items.length === 0) {
    return (
      <EmptyState
        Icon={Check}
        title="Nothing to approve"
        description="No drafted actions are waiting on you right now."
      />
    )
  }

  return (
    <ul className="space-y-4" aria-label="Pending actions">
      {items.map((item) => (
        <ActionCard
          key={item.approvalId}
          item={item}
          selected={selection.has(item.approvalId)}
          failed={failed.has(item.approvalId)}
          disabled={disabled}
          state={state}
          onToggle={onToggle}
          onApprove={approveOne}
          onReject={rejectOne}
        />
      ))}
    </ul>
  )
}

/**
 * The Vino single-action renderer instance. The frame selects it by
 * `artifactKind` (the `vino.*` workflow domain) and drives it through the shared
 * `ApprovalRenderer` contract.
 */
export const singleActionRenderer: ApprovalRenderer = {
  artifactKind: ARTIFACT_KIND,

  // Each card carries its own Approve/Reject (per-action decisions), so the frame
  // suppresses its generic batch action bar.
  ownsActionBar: true,

  render(props: ApprovalRendererProps) {
    return <SingleActionBody {...props} />
  },

  toDecisionPayload(selection: Set<string>, items: ApprovalView[]): DecisionRequest {
    const selected = items.filter((i) => selection.has(i.approvalId))
    return {
      approvalIds: selected.map((i) => i.approvalId),
      artifactKind: ARTIFACT_KIND,
      // Single-action: one opaque per-workflow draft per selected item. The frame
      // POSTs this; the engine validates each against its target manifest input.
      artifact: selected.map((i) => ({
        approvalId: i.approvalId,
        workflowId: i.workflowId,
        draft: i.artifact,
      })),
    }
  },
}

export default singleActionRenderer
