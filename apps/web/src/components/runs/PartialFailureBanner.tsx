import { XCircle } from 'lucide-react'
import type { ErrorEnvelope } from '@godin-engine/contract'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import type { RunFlaggedItem } from '@/mocks/runs'

/**
 * Partial-failure banner for the run-detail surface.
 *
 * When applying the confident set hits a provider error on a SUBSET of items, the
 * run reports which items failed (uniform `failedItemIds` shape from the P2-A
 * renderer contract) and offers "Retry failed". This is the fail status role
 * (brick-ember line + faint tint), the only "stop" color, paired with the error
 * envelope's plain-language message + the explicit failed-item list. `error.code`
 * (not HTTP status) drives copy upstream; here we render the message verbatim.
 */
export interface PartialFailureBannerProps {
  error: ErrorEnvelope
  /** The items that failed to apply — listed explicitly so it's never ambiguous. */
  failedItems: RunFlaggedItem[]
  /** Retry just the failed subset. Hidden when the error is non-retryable. */
  onRetry?: () => void
}

export function PartialFailureBanner({
  error,
  failedItems,
  onRetry,
}: PartialFailureBannerProps) {
  const canRetry = !!onRetry && (error.retryable ?? false)
  const failedById = new Set(failedItems.map((i) => i.rowId))

  return (
    <section
      role="alert"
      aria-labelledby="run-failure-heading"
      className="border border-[var(--status-fail-line)] bg-[var(--status-fail-bg)]"
    >
      <div className="flex flex-col gap-5 p-7 md:flex-row md:items-start md:justify-between md:p-8">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center border border-[var(--status-fail-line)] bg-[var(--surface)]">
            <XCircle className="size-5 text-[var(--status-fail)]" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h2
              id="run-failure-heading"
              className="font-serif text-2xl leading-tight text-[var(--foreground)]"
            >
              {failedItems.length}{' '}
              {failedItems.length === 1 ? 'price' : 'prices'} couldn’t be applied
            </h2>
            <p className="max-w-[60ch] text-sm leading-relaxed text-[var(--foreground-soft)]">
              {error.message}
            </p>
          </div>
        </div>
        {canRetry && (
          <Button
            variant="destructive"
            onClick={onRetry}
            className="shrink-0 self-start"
          >
            Retry failed
          </Button>
        )}
      </div>

      <ul className="border-t border-[var(--status-fail-line)] divide-y divide-[var(--border)]">
        {failedItems.map((item) => (
          <li
            key={item.rowId}
            className="flex flex-col gap-2 px-7 py-4 md:flex-row md:items-start md:gap-6 md:px-8"
          >
            <div className="flex items-center gap-2 md:w-[44%] md:shrink-0">
              <span aria-hidden="true" className="status-tick status-tick-fail mt-0.5" />
              <span
                className="truncate font-sans text-sm font-medium text-[var(--foreground)]"
                title={item.product}
              >
                {item.product}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Pill
                status={failedById.has(item.rowId) ? 'fail' : 'warn'}
                iconLabel={failedById.has(item.rowId) ? 'Failed to apply' : 'Held'}
              >
                {failedById.has(item.rowId) ? 'Failed' : 'Held'}
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
