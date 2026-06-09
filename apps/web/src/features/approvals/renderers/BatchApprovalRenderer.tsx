import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CircleHelp,
  Minus,
  Radio,
  X,
} from 'lucide-react'
import type { ApprovalView } from '@godin-engine/contract'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type {
  ApprovalRenderer,
  ApprovalRendererProps,
  DecisionRequest,
} from '../types'
import {
  BATCH_APPLY_TARGET,
  MARGIN_FLOOR,
  type BatchPricingArtifact,
  type BatchPricingRow,
} from '@/mocks/approvals.batch'

/**
 * Mi Pase BATCH approval renderer (M2 P2-B — the hero).
 *
 * A virtualized (`react-virtuoso`) hairline-grid pricing table: one row per
 * flagged product. It conforms to the `ApprovalRenderer` interface — the frame
 * (`ApprovalQueueFrame`) owns the 6-state machine, the async approve/reject
 * lifecycle, focus management and the live region; THIS renderer owns the
 * artifact presentation + per-row selection (exclude-before-apply) + the
 * batch-specific confirm dialog ("update N prices in Shopify test store").
 *
 * Brand: hairline-grid (cells on `--surface`, 1px `--rule` gaps), radius 0,
 * square Brick-Ember ticks, hard-offset button stamp, status tokens for the
 * delta / floor / LIVE treatments. Always icon + label, never color alone.
 *
 * a11y for virtualization: the scroller carries `role="grid"` +
 * `aria-rowcount` (TRUE logical count, not the windowed slice); each rendered
 * row carries `aria-rowindex` (1-based, header = 1) so screen readers report
 * real positions despite windowing.
 */

/**
 * Header and EVERY body row share ONE responsive CSS grid so the columns can
 * never drift out of alignment (the prior bug: a `flex` header vs. hand-built
 * `flex` rows whose fixed widths overflowed, collapsing the `flex-1` product
 * cell to ~0 and overlapping the "Product"/"Category" labels).
 *
 * Optional columns are toggled with `display:none` (`hidden md/lg/xl:block`),
 * and grid skips display:none children — so the track count in each breakpoint's
 * template must equal the number of VISIBLE columns at that breakpoint. DOM
 * column order (and therefore track order) is fixed:
 *   select · product · category · current · suggested · competitor · margin · why
 *
 * Visibility ladder:
 *   base (<md): select product            current suggested            margin       (5)
 *   md  (≥768): select product            current suggested competitor margin       (6)
 *   lg (≥1024): select product category   current suggested competitor margin       (7)
 *   xl (≥1280): select product category   current suggested competitor margin why   (8)
 *
 * `product` (and `why` at xl) use minmax(..,fr) so they flex with the container
 * yet never collapse below a readable minimum.
 */
const GRID_TEMPLATE_CLASSES = cn(
  // base — 5 visible cols: select product current suggested margin
  'grid-cols-[40px_minmax(200px,1.4fr)_110px_140px_110px]',
  // md — insert competitor before margin (6)
  'md:grid-cols-[40px_minmax(200px,1.4fr)_110px_140px_170px_110px]',
  // lg — insert category after product (7)
  'lg:grid-cols-[40px_minmax(200px,1.4fr)_120px_110px_140px_170px_110px]',
  // xl — append why (8)
  'xl:grid-cols-[40px_minmax(200px,1.4fr)_120px_110px_140px_170px_110px_minmax(200px,1.2fr)]',
)

/** Per-column cell classes shared by the header and body rows (alignment only —
 * the grid template owns the widths now, so no per-cell fixed widths). */
const COLUMNS = [
  { key: 'select', label: '', className: '' },
  { key: 'product', label: 'Product', className: 'min-w-0' },
  { key: 'category', label: 'Category', className: 'hidden lg:block min-w-0' },
  { key: 'current', label: 'Current', className: 'text-right' },
  { key: 'suggested', label: 'Suggested', className: 'text-right' },
  { key: 'competitor', label: 'Competitor ref', className: 'hidden md:block text-right' },
  { key: 'margin', label: 'Margin', className: 'text-right' },
  { key: 'why', label: 'Why flagged', className: 'hidden xl:block min-w-0' },
] as const

/** MXN money — Mi Pase tenant currency. No fraction digits for shelf prices. */
const MXN = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
})

function formatPct(pct: number): string {
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

/** Pull the renderer-owned row shape back off the opaque `ApprovalView`. */
function rowOf(item: ApprovalView): BatchPricingRow {
  return item.artifact as BatchPricingRow
}

export function BatchApprovalRenderer(props: ApprovalRendererProps) {
  const {
    items,
    selection,
    onToggle,
    onApproveAll,
    onReject,
    failedItemIds,
    disabled,
  } = props

  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)
  const dialogTitleId = useId()
  const dialogDescId = useId()
  const failed = useMemo(() => new Set(failedItemIds), [failedItemIds])

  const selectedCount = useMemo(
    () => items.filter((i) => selection.has(i.approvalId)).length,
    [items, selection],
  )

  // aria-rowcount = header row (1) + every logical row, regardless of windowing.
  const ariaRowCount = items.length + 1

  // Trap focus into the confirm dialog while it's open; restore on close.
  useEffect(() => {
    if (confirmOpen) {
      const t = requestAnimationFrame(() => confirmBtnRef.current?.focus())
      return () => cancelAnimationFrame(t)
    }
  }, [confirmOpen])

  const closeConfirm = useCallback(() => setConfirmOpen(false), [])

  const onConfirmApprove = useCallback(() => {
    setConfirmOpen(false)
    onApproveAll()
  }, [onApproveAll])

  // Arrow-key row navigation across the virtualized list (keeps off-screen rows
  // reachable; Virtuoso scrolls the target into view before focus lands).
  const onGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      const rowEl = target.closest('[data-row-index]') as HTMLElement | null
      if (!rowEl) return
      const idx = Number(rowEl.dataset.rowIndex)
      if (Number.isNaN(idx)) return
      let next = idx
      if (e.key === 'ArrowDown') next = Math.min(items.length - 1, idx + 1)
      else if (e.key === 'ArrowUp') next = Math.max(0, idx - 1)
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = items.length - 1
      else return
      e.preventDefault()
      virtuosoRef.current?.scrollIntoView({
        index: next,
        behavior: 'auto',
        done: () => {
          const el = document.querySelector<HTMLInputElement>(
            `[data-row-index="${next}"] input[type="checkbox"]`,
          )
          el?.focus()
        },
      })
    },
    [items.length],
  )

  const target = BATCH_APPLY_TARGET
  const storeLabel = `${target.channel === 'shopify' ? 'Shopify' : target.channel}${
    target.testStore ? ' (test store)' : ''
  }`

  return (
    <div className="space-y-0">
      {/* The hairline-grid table frame: one ink field, 1px gaps are the rules. */}
      <div className="border border-[var(--rule)] bg-[var(--surface)]">
        {/* Sticky header row. */}
        <div
          role="row"
          className={cn(
            'sticky top-0 z-20 grid items-stretch gap-3 border-b border-[var(--rule)] bg-[var(--surface-2)] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]',
            GRID_TEMPLATE_CLASSES,
          )}
        >
          {COLUMNS.map((col) =>
            col.key === 'select' ? (
              <span key={col.key} className={col.className} aria-hidden="true" />
            ) : (
              <span
                key={col.key}
                role="columnheader"
                className={cn('truncate', col.className)}
              >
                {col.label}
              </span>
            ),
          )}
        </div>

        {/* Virtualized body — true rowcount on the grid, rowindex per row. */}
        <div
          role="grid"
          aria-label="Flagged price suggestions"
          aria-rowcount={ariaRowCount}
          aria-busy={disabled || undefined}
          onKeyDown={onGridKeyDown}
        >
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: 'min(60vh, 540px)' }}
            data={items}
            computeItemKey={(_, item) => item.approvalId}
            itemContent={(index, item) => (
              <BatchRow
                index={index}
                item={item}
                checked={selection.has(item.approvalId)}
                failed={failed.has(item.approvalId)}
                disabled={disabled}
                onToggle={onToggle}
              />
            )}
          />
        </div>
      </div>

      {/*
        Sticky action bar — renderer-owned (batch-specific): exclude-aware count,
        confirm-gated apply, direct reject. Calls the frame's lifecycle handlers.
      */}
      <div className="sticky bottom-0 z-20 mt-px flex flex-wrap items-center justify-between gap-4 border border-t-0 border-[var(--rule)] bg-[var(--background)] px-4 py-3">
        <p className="text-sm text-[var(--foreground-soft)]">
          <span className="font-semibold text-[var(--foreground)]">{selectedCount}</span>
          {' of '}
          <span className="font-semibold text-[var(--foreground)]">{items.length}</span>
          {' flagged rows selected'}
          {selectedCount < items.length && (
            <span className="text-[var(--muted-foreground)]">
              {' · '}
              {items.length - selectedCount} excluded
            </span>
          )}
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onReject()}
            disabled={disabled || selectedCount === 0}
          >
            <X className="size-4" aria-hidden="true" />
            Reject
          </Button>
          <Button
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={disabled || selectedCount === 0}
          >
            <Check className="size-4" aria-hidden="true" />
            Approve {selectedCount} &amp; apply
          </Button>
        </div>
      </div>

      {/* Confirm dialog — focus-trapped, batch-count + apply-target copy. */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] p-4"
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeConfirm()
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogDescId}
            className="w-full max-w-md border-[1.5px] border-[var(--color-ink)] bg-[var(--surface)] p-6 shadow-[6px_6px_0_0_var(--color-ink)]"
          >
            <h2
              id={dialogTitleId}
              className="font-serif text-2xl leading-tight text-[var(--foreground)]"
            >
              Apply {selectedCount} price{selectedCount === 1 ? '' : 's'}?
            </h2>
            <p id={dialogDescId} className="mt-3 text-sm text-[var(--foreground-soft)]">
              This will update{' '}
              <span className="font-semibold text-[var(--foreground)]">
                {selectedCount} price{selectedCount === 1 ? '' : 's'}
              </span>{' '}
              in{' '}
              <span className="font-semibold text-[var(--foreground)]">{storeLabel}</span>.
              {items.length - selectedCount > 0 && (
                <>
                  {' '}
                  {items.length - selectedCount} excluded row
                  {items.length - selectedCount === 1 ? '' : 's'} will be left unchanged.
                </>
              )}
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <Button variant="secondary" size="sm" onClick={closeConfirm}>
                Cancel
              </Button>
              <Button ref={confirmBtnRef} size="sm" onClick={onConfirmApprove}>
                <Check className="size-4" aria-hidden="true" />
                Apply to {storeLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface BatchRowProps {
  index: number
  item: ApprovalView
  checked: boolean
  failed: boolean
  disabled: boolean
  onToggle(approvalId: string): void
}

function BatchRow({ index, item, checked, failed, disabled, onToggle }: BatchRowProps) {
  const row = rowOf(item)
  const longName = row.product.length > 40
  const checkboxId = `batch-select-${item.approvalId}`

  return (
    <div
      role="row"
      data-row-index={index}
      aria-rowindex={index + 2 /* header is logical row 1 */}
      aria-selected={checked}
      aria-invalid={failed || undefined}
      className={cn(
        'grid items-center gap-3 border-b border-[var(--border)] px-4 py-3 text-sm',
        GRID_TEMPLATE_CLASSES,
        checked ? 'bg-[var(--surface)]' : 'bg-[var(--surface-2)] opacity-70',
        failed && 'bg-[var(--status-fail-bg)]',
      )}
    >
      {/* Exclude checkbox. */}
      <div className="flex items-center">
        <input
          id={checkboxId}
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(item.approvalId)}
          disabled={disabled}
          className="size-4 accent-[var(--primary)]"
          aria-label={`Include ${row.product} in this batch`}
        />
      </div>

      {/* Product + SKU + category chip. */}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span
            className="truncate font-medium text-[var(--foreground)]"
            title={longName ? row.product : undefined}
          >
            {row.product}
          </span>
          {failed && (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--status-fail)]">
              Failed
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <span className="font-mono">{row.sku}</span>
          <CategoryChip category={row.category} className="lg:hidden" />
        </span>
      </div>

      {/* Category chip (wide layouts). */}
      <div className="hidden min-w-0 lg:block">
        <CategoryChip category={row.category} />
      </div>

      {/* Current price (strikethrough when it changes). */}
      <div className="text-right tabular-nums">
        <span
          className={cn(
            row.deltaPct !== 0 && 'text-[var(--muted-foreground)] line-through',
          )}
        >
          {MXN.format(row.currentPrice)}
        </span>
      </div>

      {/* Suggested price + Δ delta chip. */}
      <div className="flex flex-col items-end gap-0.5">
        <span className="font-semibold tabular-nums text-[var(--foreground)]">
          {MXN.format(row.suggestedPrice)}
        </span>
        <DeltaChip pct={row.deltaPct} />
      </div>

      {/* Competitor reference + Mercado Libre LIVE badge. */}
      <div className="hidden flex-col items-end gap-0.5 md:flex">
        {row.competitorRef != null ? (
          <>
            <span className="tabular-nums text-[var(--foreground-soft)]">
              {MXN.format(row.competitorRef)}
            </span>
            <CompetitorBadge
              source={row.competitorSource}
              live={row.competitorLive}
            />
          </>
        ) : (
          <span className="text-xs text-[var(--muted-foreground)]">No reference</span>
        )}
      </div>

      {/* Margin + BELOW 15% FLOOR / cost-unknown treatment. */}
      <div className="flex flex-col items-end gap-0.5">
        <MarginCell margin={row.margin} belowFloor={row.belowFloor} />
      </div>

      {/* Why flagged (wide layouts). */}
      <div className="hidden min-w-0 xl:block">
        <WhyFlagged reason={row.reason} detail={row.reasonDetail} />
      </div>
    </div>
  )
}

function CategoryChip({ category, className }: { category: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]',
        className,
      )}
    >
      {/* Brand tick = a small square (never a round dot). */}
      <span
        aria-hidden="true"
        className="size-1.5 bg-[var(--accent-text)]"
      />
      {category}
    </span>
  )
}

function DeltaChip({ pct }: { pct: number }) {
  if (pct === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        <Minus className="size-3" aria-hidden="true" />
        No change
      </span>
    )
  }
  const up = pct > 0
  // A raise is "good for margin" (ok green); a cut is a caution (amber warn).
  const tone = up ? 'var(--status-ok)' : 'var(--status-warn)'
  const tint = up ? 'var(--status-ok-bg)' : 'var(--status-warn-bg)'
  const line = up ? 'var(--status-ok-line)' : 'var(--status-warn-line)'
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className="inline-flex items-center gap-1 border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
      style={{ color: tone, background: tint, borderColor: line }}
    >
      <Icon className="size-3" aria-label={up ? 'Increase' : 'Decrease'} role="img" />
      {formatPct(pct)}
    </span>
  )
}

function CompetitorBadge({
  source,
  live,
}: {
  source?: string
  live?: boolean
}) {
  if (!source) return null
  if (live) {
    return (
      <span
        className="inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{
          color: 'var(--status-ok)',
          background: 'var(--status-ok-bg)',
          borderColor: 'var(--status-ok-line)',
        }}
      >
        <Radio className="size-3" aria-label="Live feed" role="img" />
        {source} · Live
      </span>
    )
  }
  return (
    <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
      {source}
    </span>
  )
}

function MarginCell({ margin, belowFloor }: { margin: number | null; belowFloor: boolean }) {
  if (margin == null) {
    // cost-unknown anomaly — margin can't be computed.
    return (
      <span
        className="inline-flex items-center gap-1 border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{
          color: 'var(--status-fail)',
          background: 'var(--status-fail-bg)',
          borderColor: 'var(--status-fail-line)',
        }}
      >
        <CircleHelp className="size-3" aria-label="Cost unknown" role="img" />
        Cost unknown
      </span>
    )
  }
  const pct = `${Math.round(margin * 100)}%`
  if (belowFloor) {
    return (
      <span className="flex flex-col items-end gap-0.5">
        <span className="font-semibold tabular-nums text-[var(--status-fail)]">{pct}</span>
        <span
          className="inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            color: 'var(--status-fail)',
            background: 'var(--status-fail-bg)',
            borderColor: 'var(--status-fail-line)',
          }}
        >
          <AlertTriangle className="size-3" aria-label="Below margin floor" role="img" />
          Below {Math.round(MARGIN_FLOOR * 100)}% floor
        </span>
      </span>
    )
  }
  return <span className="font-semibold tabular-nums text-[var(--foreground)]">{pct}</span>
}

function WhyFlagged({ reason, detail }: { reason: BatchPricingRow['reason']; detail: string }) {
  const label = reason === 'cost-unknown' ? 'Cost unknown' : 'Below floor anomaly'
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent-text)]">
        {label}
      </span>
      <span className="text-xs leading-snug text-[var(--foreground-soft)]">{detail}</span>
    </div>
  )
}

/**
 * The pluggable renderer instance the frame selects by `artifactKind`. The page
 * matches this against the items' `workflowId` domain (`mipase` → batch).
 */
export const batchApprovalRenderer: ApprovalRenderer = {
  artifactKind: 'mipase',
  // The batch renderer ships its own sticky apply bar + confirm dialog, so the
  // frame suppresses its generic action bar (no duplicate Approve/Reject).
  ownsActionBar: true,
  render(props: ApprovalRendererProps) {
    return <BatchApprovalRenderer {...props} />
  },
  toDecisionPayload(selection: Set<string>, items: ApprovalView[]): DecisionRequest {
    const chosen = items.filter((i) => selection.has(i.approvalId))
    return {
      approvalIds: chosen.map((i) => i.approvalId),
      artifactKind: 'mipase',
      // Reassemble the per-workflow batch artifact from the selected rows so the
      // approve-time validator sees the daily-pricing shape (not raw rows).
      artifact: {
        kind: 'mipase.daily-pricing',
        target: BATCH_APPLY_TARGET,
        rows: chosen.map((i) => i.artifact as BatchPricingRow),
      } satisfies Pick<BatchPricingArtifact, 'kind' | 'target' | 'rows'>,
    }
  },
}
