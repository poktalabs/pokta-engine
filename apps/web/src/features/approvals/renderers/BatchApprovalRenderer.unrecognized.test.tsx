import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ApprovalView } from '@godin-engine/contract'
import type { ApprovalRendererProps } from '../types'
import { BatchApprovalRenderer } from './BatchApprovalRenderer'

/**
 * BATCH RENDERER — artifact-shape hardening (P5b Wave 2 adversarial finding #3).
 *
 * The Approvals page selects this renderer purely by `workflowId` domain
 * (`mipase*`) with NO artifact-shape check. `ApprovalView.artifact` is `unknown`:
 * the backend serves the RAW draft output, which for Mi Pase daily-pricing is the
 * BATCH ENVELOPE `{kind, target, rows}` — NOT the flattened single `BatchPricingRow`
 * the renderer's per-row body expects. A blind `artifact as BatchPricingRow` +
 * `row.product.length` would `undefined.length` → throw → white screen (there is no
 * app-wide error boundary catching a synchronous render throw inside a list row).
 *
 * `BatchApprovalRenderer` uses `react-virtuoso`, which does NOT lay out rows in
 * jsdom (no measurable viewport), so a page-level test can't reach the row body.
 * We mock `Virtuoso` to render every item synchronously so the REAL `BatchRow`
 * executes against a malformed artifact and we can assert it degrades to an honest
 * "Unrecognized artifact" cell instead of throwing.
 */

// Render every item synchronously (jsdom has no layout for the windowed list).
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: readonly unknown[]
    itemContent: (index: number, item: unknown) => React.ReactNode
  }) => <div>{data.map((item, i) => <div key={i}>{itemContent(i, item)}</div>)}</div>,
}))

function props(items: ApprovalView[]): ApprovalRendererProps {
  return {
    items,
    state: 'default',
    selection: new Set<string>(),
    onToggle: () => {},
    onApproveAll: () => {},
    onReject: () => {},
    failedItemIds: [],
    disabled: false,
  }
}

/** A well-formed flat row artifact (what the renderer's body expects). */
const ROW_APPROVAL: ApprovalView = {
  approvalId: 'apr-row-1',
  sourceRunId: 'run-1',
  workflowId: 'mipase.daily-pricing',
  state: 'pending',
  createdAt: '2026-06-08T12:00:00.000Z',
  artifact: {
    id: 'row-1',
    product: 'Apple iPhone 15 Pro 256GB',
    sku: 'MP-APL-IP15P-256',
    category: 'Electrónica',
    currentPrice: 25999,
    suggestedPrice: 24499,
    deltaPct: -5.8,
    margin: 0.19,
    belowFloor: false,
    reason: 'below-floor',
    reasonDetail: 'Undercut on Mercado Libre.',
  },
}

/**
 * The LIVE shape the page would actually receive: the batch ENVELOPE as the single
 * approval's artifact (NOT a flat row). `envelope.product` is undefined.
 */
const ENVELOPE_APPROVAL: ApprovalView = {
  approvalId: 'apr-envelope-1',
  sourceRunId: 'run-1',
  workflowId: 'mipase.daily-pricing',
  state: 'pending',
  createdAt: '2026-06-08T12:00:00.000Z',
  artifact: {
    kind: 'mipase.daily-pricing',
    target: { channel: 'shopify', store: 'mi-pase-test', testStore: true },
    analyzedCount: 1284,
    autoAppliedCount: 248,
    rows: [{ id: 'row-1', product: 'Apple iPhone 15 Pro', currentPrice: 25999 }],
  },
}

describe('BatchApprovalRenderer — defensive row narrow (no white-screen on a non-row artifact)', () => {
  it('renders an "Unrecognized artifact" cell — not a throw — for a batch-envelope artifact', () => {
    // This would throw on `row.product.length` against the un-hardened blind cast.
    expect(() => render(<BatchApprovalRenderer {...props([ENVELOPE_APPROVAL])} />)).not.toThrow()
    expect(screen.getByText(/unrecognized artifact/i)).toBeInTheDocument()
    // The action bar still stood up (the queue did not crash).
    expect(screen.getByText(/flagged rows selected/i)).toBeInTheDocument()
  })

  it('still renders a well-formed flat row normally (the guard does not over-reject)', () => {
    render(<BatchApprovalRenderer {...props([ROW_APPROVAL])} />)
    expect(screen.getByText('Apple iPhone 15 Pro 256GB')).toBeInTheDocument()
    expect(screen.queryByText(/unrecognized artifact/i)).not.toBeInTheDocument()
  })

  it('isolates a bad row — a mixed queue renders the good row AND the unrecognized cell', () => {
    render(<BatchApprovalRenderer {...props([ROW_APPROVAL, ENVELOPE_APPROVAL])} />)
    expect(screen.getByText('Apple iPhone 15 Pro 256GB')).toBeInTheDocument()
    expect(screen.getByText(/unrecognized artifact/i)).toBeInTheDocument()
  })
})
