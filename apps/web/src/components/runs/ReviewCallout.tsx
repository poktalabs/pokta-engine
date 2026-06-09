import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import type { RunFlaggedItem } from '@/mocks/runs'

/**
 * The amber "N prices need review" callout — the surface's one action that asks
 * for the operator. A warn-tinted panel (amber line + faint amber fill, radius 0)
 * with the count headline, the per-item flag reasons (real copy: below-floor /
 * cost-unknown), and the primary "Review N prices" CTA that routes to Approvals.
 *
 * Brand: square instrument badge, serif count, amber carries "needs-review" but
 * is always paired with the label + each row's plain-language reason (never color
 * alone). The CTA is the single primary on this surface.
 */
const REASON_LABEL: Record<RunFlaggedItem['reason'], string> = {
  'below-floor': 'Below 15% floor',
  'cost-unknown': 'Cost unknown',
}

export interface ReviewCalloutProps {
  count: number
  items: RunFlaggedItem[]
  /** Routes to the Approvals queue (the batch held at this run's gate). */
  onReview: () => void
}

export function ReviewCallout({ count, items, onReview }: ReviewCalloutProps) {
  return (
    <section
      aria-labelledby="run-review-heading"
      className="border border-[var(--status-warn-line)] bg-[var(--status-warn-bg)]"
    >
      <div className="flex flex-col gap-5 p-7 md:flex-row md:items-start md:justify-between md:p-8">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center border border-[var(--status-warn-line)] bg-[var(--surface)]">
            <AlertTriangle
              className="size-5 text-[var(--status-warn)]"
              aria-hidden="true"
            />
          </span>
          <div className="space-y-1">
            <h2
              id="run-review-heading"
              className="font-serif text-2xl leading-tight text-[var(--foreground)]"
            >
              {count} {count === 1 ? 'price needs' : 'prices need'} review
            </h2>
            <p className="max-w-[56ch] text-sm leading-relaxed text-[var(--foreground-soft)]">
              The agent held these at the gate — applying them needs your call
              before they go live in Shopify.
            </p>
          </div>
        </div>
        <Button onClick={onReview} className="shrink-0 self-start">
          Review {count} {count === 1 ? 'price' : 'prices'}
        </Button>
      </div>

      <ul className="border-t border-[var(--status-warn-line)] divide-y divide-[var(--border)]">
        {items.map((item) => (
          <li
            key={item.rowId}
            className="flex flex-col gap-2 px-7 py-4 md:flex-row md:items-start md:gap-6 md:px-8"
          >
            <div className="flex items-center gap-2 md:w-[44%] md:shrink-0">
              <span
                aria-hidden="true"
                className="status-tick status-tick-warn mt-0.5"
              />
              <span
                className="truncate font-sans text-sm font-medium text-[var(--foreground)]"
                title={item.product}
              >
                {item.product}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Pill status="warn" iconLabel={`Flagged: ${REASON_LABEL[item.reason]}`}>
                {REASON_LABEL[item.reason]}
              </Pill>
              <p className="text-sm leading-relaxed text-[var(--foreground-soft)]">
                {item.reasonDetail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
