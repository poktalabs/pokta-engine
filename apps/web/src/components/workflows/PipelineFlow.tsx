import { Fragment } from 'react'
import {
  ArrowRight,
  CircleDot,
  FileEdit,
  ShieldQuestion,
  UploadCloud,
  type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import type { PipelineNode } from '@/mocks/workflows'

/**
 * Pipeline-flow graphic (M2 P3-A).
 *
 * Renders a workflow's stages as a left-to-right flow: Draft → [Amber approval
 * gate] → Apply. The middle `approval-gate` node is the brand's amber gate — the
 * one place a human decision sits. The currently-active node is highlighted (a
 * brick-ember rule + a subtle motion-safe pulse on its tick).
 *
 * Brand: SHARP square instrument badges (radius 0, hairline border), Phosphor-
 * style Lucide icons, amber fill ONLY on the gate node, reduced-motion aware
 * (the active pulse is `motion-safe` only). Icons are decorative; the active
 * state is announced via text + `aria-current`, never color alone.
 */

/** Per-node icon — the gate gets the "human decision" mark. */
const NODE_ICON: Record<string, ComponentType<LucideProps>> = {
  draft: FileEdit,
  'approval-gate': ShieldQuestion,
  apply: UploadCloud,
}

export interface PipelineFlowProps {
  nodes: PipelineNode[]
  /** The id of the node currently active in the run (highlighted). */
  activeNodeId?: string
  className?: string
}

export function PipelineFlow({ nodes, activeNodeId, className }: PipelineFlowProps) {
  return (
    <section
      className={cn('border border-[var(--rule)] bg-[var(--surface)] p-6', className)}
      aria-label="Workflow pipeline"
    >
      <ol className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start">
        {nodes.map((node, i) => {
          const Icon = NODE_ICON[node.id] ?? CircleDot
          const isGate = node.kind === 'approval-gate'
          const isActive = node.id === activeNodeId

          return (
            <Fragment key={node.id}>
              <li
                aria-current={isActive ? 'step' : undefined}
                className={cn(
                  'flex flex-1 items-start gap-3 border p-4 transition-colors',
                  isGate
                    ? 'border-[var(--status-warn-line)] bg-[var(--status-warn-bg)]'
                    : 'border-[var(--border)] bg-[var(--surface)]',
                  isActive && 'border-[var(--accent-text)] [box-shadow:inset_0_0_0_1px_var(--accent-text)]',
                )}
              >
                {/* Square instrument badge. */}
                <span
                  className={cn(
                    'relative grid size-10 shrink-0 place-items-center border',
                    isGate
                      ? 'border-[var(--status-warn-line)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                      : 'border-[var(--rule)] bg-[var(--background)] text-[var(--accent-text)]',
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1 -top-1 size-2 bg-[var(--accent-text)] motion-safe:animate-pulse"
                    />
                  )}
                </span>

                <div className="min-w-0 space-y-1">
                  <p className="flex items-center gap-2 font-funnel text-sm font-medium text-[var(--foreground)]">
                    {node.label}
                    {isActive && (
                      <span className="text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[var(--accent-text)]">
                        Now
                      </span>
                    )}
                  </p>
                  {node.detail && (
                    <p className="text-xs leading-snug text-[var(--foreground-soft)]">
                      {node.detail}
                    </p>
                  )}
                </div>
              </li>

              {/* Connector between nodes (not after the last). */}
              {i < nodes.length - 1 && (
                <li
                  aria-hidden="true"
                  className="flex shrink-0 items-center justify-center self-center text-[var(--muted-foreground)] sm:pt-4"
                >
                  <ArrowRight className="size-5 rotate-90 sm:rotate-0" />
                </li>
              )}
            </Fragment>
          )
        })}
      </ol>
    </section>
  )
}
